import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const javaExtractor: LanguageExtractor = {
  language: "java",
  extensions: [".java"],
  extract: extractJava
};

interface JavaItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  conformsTo?: string[];
  relatedNames?: string[];
}

interface JavaType {
  name: string;
  qualifiedName: string;
  endLine: number;
}

export function extractJava(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const packageName = javaPackageName(lines);
  const structureLines = javaStructureLines(lines);
  const items = collectJavaItems(structureLines, moduleName, packageName);
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
    ...packageImportEdges(moduleName, lines, packageName),
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName ? ("file_contains_symbol" as const) : ("symbol_contains_symbol" as const),
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => conformanceEdges(item)),
    ...items.flatMap((item) => relatedNameEdges(item))
  ];
  for (const item of items.filter((current) => current.kind === "method")) {
    edges.push(...callEdges(item, structureLines));
  }

  return { file, symbols, chunks, edges };
}

function collectJavaItems(lines: string[], moduleName: string, packageName?: string): JavaItem[] {
  const items: JavaItem[] = [];
  const typeStack: JavaType[] = [];
  let pendingAnnotations: string[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    while (typeStack.length > 0 && index + 1 > typeStack[typeStack.length - 1].endLine) {
      typeStack.pop();
    }

    const annotations = annotationNames(line);
    if (annotations.length > 0) {
      pendingAnnotations = [...pendingAnnotations, ...annotations];
    }

    const signatureLine = signatureWindow(lines, index, line);
    const owner = typeStack[typeStack.length - 1];
    const typeDeclaration = canStartJavaType(line) ? typeDeclarationForLine(signatureLine) : undefined;
    if (typeDeclaration) {
      const qualifiedName = qualifyJavaName(typeDeclaration.name, owner?.qualifiedName, packageName);
      const endLine = endLineForType(lines, index);
      items.push({
        name: typeDeclaration.name,
        qualifiedName,
        kind: "class",
        startLine: index + 1,
        endLine,
        parentSymbolName: owner?.qualifiedName ?? moduleName,
        conformsTo: typeDeclaration.conformsTo,
        relatedNames: pendingAnnotations
      });
      pendingAnnotations = [];
      if (endLine > index + 1) {
        typeStack.push({ name: typeDeclaration.name, qualifiedName, endLine });
      }
    }

    const currentOwner = typeDeclaration
      ? { name: typeDeclaration.name, qualifiedName: qualifyJavaName(typeDeclaration.name, owner?.qualifiedName, packageName) }
      : typeStack[typeStack.length - 1];
    const methodDeclaration = currentOwner && canStartJavaMethod(line) ? methodForLine(signatureLine, currentOwner.name) : undefined;
    if (methodDeclaration && !typeDeclaration) {
      const parentSymbolName = currentOwner.qualifiedName;
      items.push({
        name: methodDeclaration.name,
        qualifiedName: `${parentSymbolName}.${methodDeclaration.name}`,
        kind: "method",
        startLine: index + 1,
        endLine: endLineForMethod(lines, index),
        parentSymbolName,
        relatedNames: pendingAnnotations
      });
      pendingAnnotations = [];
    }

    const fieldDeclaration = currentOwner && !methodDeclaration && !typeDeclaration ? fieldForLine(line) : undefined;
    if (fieldDeclaration) {
      const parentSymbolName = currentOwner.qualifiedName;
      items.push({
        name: fieldDeclaration.name,
        qualifiedName: `${parentSymbolName}.${fieldDeclaration.name}`,
        kind: "method",
        startLine: index + 1,
        endLine: index + 1,
        parentSymbolName,
        relatedNames: [...pendingAnnotations, fieldDeclaration.type]
      });
      pendingAnnotations = [];
    }

    if (line.trim() !== "" && annotations.length === 0 && !line.trim().startsWith("@")) {
      pendingAnnotations = [];
    }
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function typeDeclarationForLine(line: string): { name: string; conformsTo: string[] } | undefined {
  const match =
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|static|final|abstract|strictfp|sealed|non-sealed)\s+)*\b(class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)([^{};]*)/u.exec(
      line
    );
  if (!match) {
    return undefined;
  }
  return { name: match[2], conformsTo: conformanceNames(match[3] ?? "") };
}

function methodForLine(line: string, ownerName: string): { name: string } | undefined {
  const constructor =
    new RegExp(
      `^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s*)*(?:(?:public|private|protected)\\s+)?${ownerName}\\s*\\(`,
      "u"
    ).exec(line);
  if (constructor) {
    return { name: ownerName };
  }

  const method =
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|static|final|abstract|synchronized|native|strictfp|default)\s+)*(?:<[^>]+>\s*)?(?!if\b|for\b|while\b|switch\b|catch\b|return\b|new\b)([A-Za-z_][A-Za-z0-9_<>\[\].?,\s]*?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(
      line
    );
  if (!method) {
    return undefined;
  }
  return { name: method[2] };
}

function fieldForLine(line: string): { name: string; type: string } | undefined {
  const match =
    /^\s*(?:(?:public|private|protected|static|final|volatile|transient)\s+)*(?!return\b|throw\b|new\b)([A-Za-z_][A-Za-z0-9_<>\[\].?,\s]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=[^;]*)?;/u.exec(
      line
    );
  if (!match || line.includes("(")) {
    return undefined;
  }
  return { type: javaTypeLeaf(match[1]), name: match[2] };
}

function canStartJavaType(line: string): boolean {
  return /\b(?:class|interface|enum|record)\b/u.test(line) && !line.trim().startsWith("@");
}

function canStartJavaMethod(line: string): boolean {
  return line.includes("(") && !line.trim().startsWith("@");
}

function packageImportEdges(moduleName: string, lines: string[], packageName: string | undefined): CodeEdge[] {
  const modules = new Set<string>();
  if (packageName) {
    modules.add(packageName);
  }
  for (const rawLine of lines) {
    const imported = javaImportModule(stripLineComment(rawLine));
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

function javaPackageName(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = /^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/u.exec(stripLineComment(line));
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function javaImportModule(line: string): string | undefined {
  const match = /^\s*import\s+(?:static\s+)?([A-Za-z_][A-Za-z0-9_.*]*)\s*;/u.exec(line);
  return match?.[1];
}

function conformanceNames(tail: string): string[] {
  const names = new Set<string>();
  for (const keyword of ["extends", "implements", "permits"]) {
    const match = new RegExp(`\\b${keyword}\\s+([^{};]+)`, "u").exec(tail);
    if (!match) {
      continue;
    }
    for (const part of match[1].split(",")) {
      const name = javaTypeLeaf(part.replace(/\([^)]*\)/gu, "").trim());
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

function conformanceEdges(item: JavaItem): CodeEdge[] {
  return (item.conformsTo ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function relatedNameEdges(item: JavaItem): CodeEdge[] {
  return (item.relatedNames ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function callEdges(item: JavaItem, lines: string[]): CodeEdge[] {
  return calledNames(lines.slice(item.startLine - 1, item.endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|::|\b)([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
    const name = match[1];
    if (!javaCallStopwords.has(name)) {
      names.add(name);
    }
  }
  for (const annotation of text.matchAll(/@([A-Za-z_][A-Za-z0-9_.]*)/gu)) {
    names.add(javaTypeLeaf(annotation[1]));
  }
  for (const methodReference of text.matchAll(/::\s*([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    names.add(methodReference[1]);
  }
  return [...names].sort();
}

function annotationNames(line: string): string[] {
  return [...line.matchAll(/@([A-Za-z_][A-Za-z0-9_.]*)/gu)].map((match) => javaTypeLeaf(match[1]));
}

function javaTypeLeaf(value: string): string {
  const cleaned = value.replace(/[?&]/gu, "").replace(/<.*$/u, "").replace(/\[\]/gu, "").trim();
  const parts = cleaned.split(".");
  return parts[parts.length - 1] || cleaned;
}

function qualifyJavaName(name: string, owner: string | undefined, packageName: string | undefined): string {
  if (owner) {
    return `${owner}.${name}`;
  }
  return packageName ? `${packageName}.${name}` : name;
}

const javaCallStopwords = new Set(["if", "for", "while", "switch", "catch", "return", "throw", "new", "super", "this"]);

function endLineForType(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 8); index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      return endLineForBlock(lines, index);
    }
    if (index > startIndex && canStartJavaDeclaration(line)) {
      return index;
    }
    if (line.includes(";")) {
      return index + 1;
    }
  }
  return startIndex + 1;
}

function endLineForMethod(lines: string[], startIndex: number): number {
  const firstLine = stripLineComment(lines[startIndex]);
  if (firstLine.includes("{")) {
    return endLineForBlock(lines, startIndex);
  }
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 8); index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      return endLineForBlock(lines, index);
    }
    if (line.includes(";")) {
      return index + 1;
    }
    if (index > startIndex && canStartJavaDeclaration(line)) {
      return index;
    }
  }
  return startIndex + 1;
}

function endLineForBlock(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawOpenBrace = false;
  for (let index = startIndex; index < lines.length; index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      sawOpenBrace = true;
    }
    depth += braceDelta(line);
    if (sawOpenBrace && depth <= 0) {
      return index + 1;
    }
  }
  return startIndex + 1;
}

function canStartJavaDeclaration(line: string): boolean {
  return canStartJavaType(line) || canStartJavaMethod(line);
}

function braceDelta(line: string): number {
  return countChar(line, "{") - countChar(line, "}");
}

function countChar(value: string, char: string): number {
  return [...value].filter((current) => current === char).length;
}

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/u, "");
}

function signatureWindow(lines: string[], index: number, currentLine: string): string {
  const parts = [currentLine.trimEnd()];
  let cursor = index + 1;
  while (!parts.join(" ").includes("{") && !parts.join(" ").includes(";") && cursor < Math.min(lines.length, index + 8)) {
    const next = stripLineComment(lines[cursor]).trim();
    if (next === "" || next.startsWith("@")) {
      break;
    }
    parts.push(next);
    if (next.includes("{") || next.includes(";")) {
      break;
    }
    cursor++;
  }
  return parts.join(" ");
}

function javaStructureLines(lines: string[]): string[] {
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

function normalizedLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}
