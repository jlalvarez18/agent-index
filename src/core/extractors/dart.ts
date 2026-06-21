import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const dartExtractor: LanguageExtractor = {
  language: "dart",
  extensions: [".dart"],
  extract: extractDart
};

interface DartItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "method" | "typealias";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  declarationKind?: string;
  conformsTo?: string[];
}

interface DartContainer {
  name: string;
  qualifiedName: string;
  declarationKind: string;
  endLine: number;
}

export function extractDart(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const structureLines = dartStructureLines(lines);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = collectDartItems(structureLines, moduleName);
  const symbols: CodeSymbol[] = [
    moduleSymbol,
    ...items.map((item) => ({
      name: item.name,
      qualifiedName: item.qualifiedName,
      kind: item.kind,
      startLine: item.startLine,
      endLine: item.endLine,
      parentSymbolName: item.parentSymbolName
    }))
  ];
  const chunks: CodeChunk[] = [
    chunkForLines(moduleName, lines, 1, moduleSymbol.endLine),
    ...items.map((item) => chunkForLines(item.qualifiedName, lines, item.startLine, item.endLine))
  ];
  const edges: CodeEdge[] = [
    ...importEdges(moduleName, structureLines),
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName ? "file_contains_symbol" as const : "symbol_contains_symbol" as const,
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => conformanceEdges(item))
  ];
  for (const item of items.filter((current) => current.kind !== "class" && current.kind !== "typealias")) {
    edges.push(...callEdges(item, structureLines));
  }
  return { file, symbols, chunks, edges };
}

function collectDartItems(lines: string[], moduleName: string): DartItem[] {
  const items: DartItem[] = [];
  const stack: DartContainer[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const signatureLine = signatureWindow(lines, index, line);
    while (stack.length > 0 && index + 1 > stack[stack.length - 1].endLine) {
      stack.pop();
    }
    const owner = stack[stack.length - 1];

    const typeDeclaration = typeDeclarationForLine(signatureLine);
    if (typeDeclaration) {
      const qualifiedName = qualifiedTypeName(typeDeclaration, owner);
      const endLine = endLineForBlock(lines, index);
      items.push({
        name: typeDeclaration.name,
        qualifiedName,
        kind: "class",
        startLine: index + 1,
        endLine,
        parentSymbolName: owner?.qualifiedName ?? moduleName,
        declarationKind: typeDeclaration.declarationKind,
        conformsTo: typeDeclaration.conformsTo
      });
      if (endLine > index + 1 || line.includes("{")) {
        stack.push({ name: typeDeclaration.name, qualifiedName, declarationKind: typeDeclaration.declarationKind, endLine });
      }
      continue;
    }

    const aliasName = typealiasNameForLine(signatureLine);
    if (aliasName) {
      items.push({
        name: aliasName,
        qualifiedName: owner ? `${owner.qualifiedName}.${aliasName}` : aliasName,
        kind: "typealias",
        startLine: index + 1,
        endLine: endLineForStatement(lines, index),
        parentSymbolName: owner?.qualifiedName ?? moduleName
      });
      continue;
    }

    if (owner?.declarationKind === "enum") {
      for (const enumCaseName of enumCaseNamesForLine(signatureLine)) {
        items.push({
          name: enumCaseName,
          qualifiedName: `${owner.qualifiedName}.${enumCaseName}`,
          kind: "method",
          startLine: index + 1,
          endLine: index + 1,
          parentSymbolName: owner.qualifiedName
        });
      }
    }

    const testDeclaration = testDeclarationForLine(signatureLine);
    if (testDeclaration && owner?.declarationKind === "function") {
      const endLine = endLineForBlock(lines, index);
      items.push({
        name: testDeclaration.name,
        qualifiedName: `${owner.qualifiedName}.${testDeclaration.name}`,
        kind: "method",
        startLine: index + 1,
        endLine,
        parentSymbolName: owner.qualifiedName
      });
      continue;
    }

    const memberDeclaration = memberDeclarationForLine(signatureLine, owner);
    if (memberDeclaration) {
      const qualifiedName = owner ? `${owner.qualifiedName}.${memberDeclaration.name}` : memberDeclaration.name;
      const endLine = memberDeclaration.hasBlock ? endLineForBlock(lines, index) : endLineForStatement(lines, index);
      items.push({
        name: memberDeclaration.displayName,
        qualifiedName,
        kind: owner && owner.declarationKind !== "function" ? "method" : "function",
        startLine: index + 1,
        endLine,
        parentSymbolName: owner?.qualifiedName ?? moduleName,
        declarationKind: "function"
      });
      if (memberDeclaration.hasBlock) {
        stack.push({ name: memberDeclaration.displayName, qualifiedName, declarationKind: "function", endLine });
      }
    }
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function typeDeclarationForLine(line: string): { name: string; declarationKind: string; onType?: string; conformsTo: string[] } | undefined {
  const extensionMatch = /^\s*extension\s+([A-Za-z_][A-Za-z0-9_]*)?\s*on\s+([A-Za-z_][A-Za-z0-9_<>.?]*)/u.exec(line);
  if (extensionMatch) {
    const name = extensionMatch[1] ?? "extension";
    return { name, declarationKind: "extension", onType: dartTypeLeaf(extensionMatch[2]), conformsTo: [] };
  }

  const match =
    /^\s*(?:(?:abstract|base|final|interface|sealed|mixin)\s+)*\b(class|mixin|enum)\s+([A-Za-z_][A-Za-z0-9_]*)([^{};]*)/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { name: match[2], declarationKind: match[1], conformsTo: conformanceNames(match[3] ?? "") };
}

function qualifiedTypeName(typeDeclaration: { name: string; declarationKind: string; onType?: string }, owner: DartContainer | undefined): string {
  const name =
    typeDeclaration.declarationKind === "extension" && typeDeclaration.onType
      ? `${typeDeclaration.onType}.extension.${typeDeclaration.name}`
      : typeDeclaration.name;
  return owner ? `${owner.qualifiedName}.${name}` : name;
}

function typealiasNameForLine(line: string): string | undefined {
  return /^\s*typedef\s+([A-Za-z_][A-Za-z0-9_]*)\b/u.exec(line)?.[1];
}

function enumCaseNamesForLine(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.includes("(") || /\b(?:class|mixin|enum|extension|static|final|var|const|get|set|void|Future|Stream|bool|int|double|String|Map|List|Set)\b/u.test(trimmed)) {
    return [];
  }
  return trimmed
    .replace(/[;,]\s*$/u, "")
    .split(",")
    .map((part) => /^[A-Za-z_][A-Za-z0-9_]*/u.exec(part.trim())?.[0])
    .filter((part): part is string => Boolean(part));
}

function testDeclarationForLine(line: string): { name: string } | undefined {
  const match = /^\s*(?:test|testWidgets)\s*\(\s*(["'])([^"']+)\1/u.exec(line);
  const name = match?.[2] ? slugName(match[2]) : undefined;
  return name ? { name } : undefined;
}

function memberDeclarationForLine(
  line: string,
  owner: DartContainer | undefined
): { name: string; displayName: string; hasBlock: boolean } | undefined {
  if (owner?.declarationKind === "function") {
    return undefined;
  }
  const constructorName = owner ? constructorNameForLine(line, owner.name) : undefined;
  if (constructorName) {
    return { name: constructorName.qualifiedPart, displayName: constructorName.displayName, hasBlock: line.includes("{") };
  }
  const getterName = /^\s*(?:(?:static|external|late|final|const|var|required|covariant)\s+)*(?:[A-Za-z_][A-Za-z0-9_<>.?]*\s+)?get\s+([A-Za-z_][A-Za-z0-9_]*)\b/u.exec(
    line
  )?.[1];
  if (getterName) {
    return { name: getterName, displayName: getterName, hasBlock: line.includes("{") };
  }
  const setterName = /^\s*(?:(?:static|external|late|final|const|var|required|covariant)\s+)*(?:[A-Za-z_][A-Za-z0-9_<>.?]*\s+)?set\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(
    line
  )?.[1];
  if (setterName) {
    return { name: setterName, displayName: setterName, hasBlock: line.includes("{") };
  }
  const functionName = functionNameForLine(line);
  if (functionName) {
    return { name: functionName, displayName: functionName, hasBlock: line.includes("{") };
  }
  if (owner && owner.declarationKind !== "enum") {
    const fieldName = fieldNameForLine(line);
    if (fieldName) {
      return { name: fieldName, displayName: fieldName, hasBlock: false };
    }
  }
  return undefined;
}

function constructorNameForLine(line: string, ownerName: string): { qualifiedPart: string; displayName: string } | undefined {
  const escaped = ownerName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*(?:(?:const|factory|external)\\s+)*(${escaped}(?:\\.[A-Za-z_][A-Za-z0-9_]*)?)\\s*\\(`, "u").exec(line);
  if (!match) {
    return undefined;
  }
  return { qualifiedPart: match[1], displayName: match[1] };
}

function functionNameForLine(line: string): string | undefined {
  if (/^\s*(?:if|for|while|switch|catch|return)\b/u.test(line)) {
    return undefined;
  }
  const match =
    /^\s*(?:(?:static|external|async|sync)\s+)*(?:(?:[A-Za-z_][A-Za-z0-9_<>.?]*|void)\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]+>)?\s*\(/u.exec(
      line
    );
  return match?.[1];
}

function fieldNameForLine(line: string): string | undefined {
  if (!line.trim().endsWith(";") || line.includes("(")) {
    return undefined;
  }
  const match =
    /^\s*(?:(?:static|late|final|const|var|required|covariant)\s+)*(?:[A-Za-z_][A-Za-z0-9_<>.?]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:[=;])/u.exec(
      line
    );
  return match?.[1];
}

function importEdges(moduleName: string, lines: string[]): CodeEdge[] {
  const modules = new Set<string>();
  for (const rawLine of lines) {
    const imported = dartImportModule(stripLineComment(rawLine));
    if (imported) {
      modules.add(imported);
    }
  }
  return [...modules].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module",
    confidence: "name"
  }));
}

function dartImportModule(line: string): string | undefined {
  return /^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/u.exec(line)?.[1];
}

function conformanceNames(value: string): string[] {
  const names = new Set<string>();
  const extendsName = /\bextends\s+([A-Za-z_][A-Za-z0-9_<>.?]*)/u.exec(value)?.[1];
  if (extendsName) {
    names.add(dartTypeLeaf(extendsName));
  }
  const onName = /\bon\s+([A-Za-z_][A-Za-z0-9_<>.?]*)/u.exec(value)?.[1];
  if (onName) {
    names.add(dartTypeLeaf(onName));
  }
  for (const keyword of ["with", "implements"]) {
    const match = new RegExp(`\\b${keyword}\\s+([^{}]+?)(?=\\b(?:extends|with|implements|on)\\b|$)`, "u").exec(value);
    if (!match) {
      continue;
    }
    for (const part of match[1].split(",")) {
      const name = dartTypeLeaf(part.trim());
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

function conformanceEdges(item: DartItem): CodeEdge[] {
  return (item.conformsTo ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function callEdges(item: DartItem, lines: string[]): CodeEdge[] {
  return calledNames(lines.slice(item.startLine - 1, item.endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|\b)([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]+>\s*)?\(/gu)) {
    const name = match[1];
    if (!dartCallStopwords.has(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

const dartCallStopwords = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "class",
  "mixin",
  "enum",
  "extension",
  "Future",
  "Stream",
  "test",
  "testWidgets"
]);

function dartTypeLeaf(value: string): string {
  const cleaned = value.replace(/[?&]/gu, "").replace(/<.*$/u, "").trim();
  const parts = cleaned.split(".");
  return parts[parts.length - 1] || cleaned;
}

function signatureWindow(lines: string[], index: number, line: string): string {
  if (!canStartDartItem(line)) {
    return line;
  }
  const parts = [line.trimEnd()];
  let cursor = index + 1;
  while (!/[{;=>]\s*$/u.test(parts.join(" ")) && cursor < Math.min(lines.length, index + 6)) {
    const next = stripLineComment(lines[cursor]).trim();
    if (next === "" || next.startsWith("@")) {
      break;
    }
    parts.push(next);
    if (/[{;=>]\s*$/u.test(next)) {
      break;
    }
    cursor++;
  }
  return parts.join(" ");
}

function canStartDartItem(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^(?:(?:abstract|base|final|interface|sealed|mixin)\s+)*(?:class|mixin|enum|extension)\b/u.test(trimmed) ||
    /^typedef\b/u.test(trimmed) ||
    /^(?:const|factory|external)?\s*[A-Za-z_][A-Za-z0-9_.]*\s*\(/u.test(trimmed) ||
    /\b(?:get|set)\s+[A-Za-z_][A-Za-z0-9_]*/u.test(trimmed) ||
    /^\s*(?:test|testWidgets)\s*\(/u.test(trimmed) ||
    /^\s*(?:(?:static|external|async|sync|late|final|const|var|required|covariant)\s+)*(?:(?:[A-Za-z_][A-Za-z0-9_<>.?]*|void)\s+)+[A-Za-z_][A-Za-z0-9_]*\s*(?:[;(=]|=>)/u.test(
      trimmed
    )
  );
}

function endLineForBlock(lines: string[], startIndex: number): number {
  let depth = 0;
  let parenDepth = 0;
  let sawOpenBrace = false;
  let sawOpenParen = false;
  for (let index = startIndex; index < lines.length; index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      sawOpenBrace = true;
    }
    if (line.includes("(")) {
      sawOpenParen = true;
    }
    depth += braceDelta(line);
    parenDepth += parenDelta(line);
    if (sawOpenBrace && depth <= 0) {
      return index + 1;
    }
    if (!sawOpenBrace && sawOpenParen && parenDepth <= 0) {
      return index + 1;
    }
  }
  return startIndex + 1;
}

function endLineForStatement(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 6); index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      return endLineForBlock(lines, index);
    }
    if (line.includes(";") || line.includes("=>")) {
      return index + 1;
    }
  }
  return startIndex + 1;
}

function braceDelta(line: string): number {
  return countChar(line, "{") - countChar(line, "}");
}

function parenDelta(line: string): number {
  return countChar(line, "(") - countChar(line, ")");
}

function countChar(value: string, char: string): number {
  return [...value].filter((current) => current === char).length;
}

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/u, "");
}

function dartStructureLines(lines: string[]): string[] {
  const result: string[] = [];
  let inBlockComment = false;
  for (const rawLine of lines) {
    let line = rawLine;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end < 0) {
        result.push("");
        continue;
      }
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    while (line.includes("/*")) {
      const start = line.indexOf("/*");
      const end = line.indexOf("*/", start + 2);
      if (end < 0) {
        line = line.slice(0, start);
        inBlockComment = true;
        break;
      }
      line = `${line.slice(0, start)} ${line.slice(end + 2)}`;
    }
    result.push(line);
  }
  return result;
}

function slugName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_")
    .toLowerCase();
}

function normalizedLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}
