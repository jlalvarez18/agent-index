import path from "node:path";
import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const rustExtractor: LanguageExtractor = {
  language: "rust",
  extensions: [".rs"],
  extract: extractRust
};

interface RustItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "method" | "typealias" | "module";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  conformsTo?: string[];
}

interface RustContainer {
  name: string;
  qualifiedName: string;
  kind: "module" | "class";
  endLine: number;
}

interface RustImpl {
  owner: string;
  traitName?: string;
  endLine: number;
}

export function extractRust(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const logicalModule = rustModulePath(file.relativePath);
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = collectRustItems(lines, moduleName, logicalModule);
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
    ...importEdges(moduleName, lines),
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName ? "file_contains_symbol" as const : "symbol_contains_symbol" as const,
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => conformanceEdges(item))
  ];
  for (const item of items.filter((current) => current.kind !== "class" && current.kind !== "module")) {
    edges.push(...callEdges(item, lines));
  }

  return { file, symbols, chunks, edges };
}

function collectRustItems(lines: string[], moduleName: string, logicalModule: string): RustItem[] {
  const items: RustItem[] = [];
  const containers: RustContainer[] = [];
  const implStack: RustImpl[] = [];
  const typeNames = new Map<string, string>();

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    while (containers.length > 0 && index + 1 > containers[containers.length - 1].endLine) {
      containers.pop();
    }
    while (implStack.length > 0 && index + 1 > implStack[implStack.length - 1].endLine) {
      implStack.pop();
    }

    const parent = containers[containers.length - 1];
    const parentSymbolName = parent?.qualifiedName ?? moduleName;
    const namespace = parent ? parent.qualifiedName : logicalModule;

    const moduleDeclaration = moduleForLine(line);
    if (moduleDeclaration) {
      const inline = line.includes("{");
      const qualifiedName = qualifyRustName(moduleDeclaration, namespace);
      items.push({
        name: moduleDeclaration,
        qualifiedName,
        kind: "module",
        startLine: index + 1,
        endLine: inline ? endLineForBlock(lines, index) : index + 1,
        parentSymbolName
      });
      if (inline) {
        containers.push({ name: moduleDeclaration, qualifiedName, kind: "module", endLine: endLineForBlock(lines, index) });
      }
      continue;
    }

    const typeDeclaration = typeDeclarationForLine(line);
    if (typeDeclaration) {
      const qualifiedName = qualifyRustName(typeDeclaration.name, namespace);
      typeNames.set(typeDeclaration.name, qualifiedName);
      const endLine = endLineForBlockOrLine(lines, index);
      items.push({
        name: typeDeclaration.name,
        qualifiedName,
        kind: typeDeclaration.kind,
        startLine: index + 1,
        endLine,
        parentSymbolName,
        conformsTo: typeDeclaration.conformsTo
      });
      if (typeDeclaration.kind === "class" && line.includes("{") && endLine > index + 1) {
        containers.push({ name: typeDeclaration.name, qualifiedName, kind: "class", endLine });
      }
      continue;
    }

    const macroName = macroNameForLine(line);
    if (macroName) {
      const qualifiedName = qualifyRustName(macroName, namespace);
      items.push({
        name: macroName,
        qualifiedName,
        kind: "function",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName
      });
      continue;
    }

    const implDeclaration = implForLine(line);
    if (implDeclaration) {
      implStack.push({
        owner: typeNames.get(implDeclaration.owner) ?? qualifyRustName(implDeclaration.owner, logicalModule),
        traitName: implDeclaration.traitName,
        endLine: endLineForBlock(lines, index)
      });
      continue;
    }

    const functionName = functionNameForLine(line);
    if (functionName) {
      const implOwner = implStack[implStack.length - 1];
      const owner = implOwner?.owner ?? (parent?.kind === "class" ? parent.qualifiedName : undefined);
      const qualifiedName = owner ? `${owner}.${functionName}` : qualifyRustName(functionName, namespace);
      items.push({
        name: functionName,
        qualifiedName,
        kind: owner ? "method" : "function",
        startLine: index + 1,
        endLine: endLineForBlockOrLine(lines, index),
        parentSymbolName: owner ?? parentSymbolName
      });
    }
  }

  for (const implItem of implConformanceItems(items, lines, logicalModule, typeNames)) {
    const source = items.find((item) => item.qualifiedName === implItem.owner);
    if (source) {
      source.conformsTo = uniqueValues([...(source.conformsTo ?? []), implItem.traitName]);
    }
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function implConformanceItems(
  items: RustItem[],
  lines: string[],
  logicalModule: string,
  typeNames: Map<string, string>
): Array<{ owner: string; traitName: string }> {
  const conformances: Array<{ owner: string; traitName: string }> = [];
  for (const rawLine of lines) {
    const implDeclaration = implForLine(stripLineComment(rawLine));
    if (implDeclaration?.traitName) {
      conformances.push({
        owner: typeNames.get(implDeclaration.owner) ?? qualifyRustName(implDeclaration.owner, logicalModule),
        traitName: implDeclaration.traitName
      });
    }
  }
  return conformances.filter((conformance) => items.some((item) => item.qualifiedName === conformance.owner));
}

function moduleForLine(line: string): string | undefined {
  return /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:;|\{)/u.exec(line)?.[1];
}

function typeDeclarationForLine(line: string): { name: string; kind: "class" | "typealias"; conformsTo: string[] } | undefined {
  const typeAlias = /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\b/u.exec(line)?.[1];
  if (typeAlias) {
    return { name: typeAlias, kind: "typealias", conformsTo: [] };
  }

  const match =
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:struct|enum|trait|union)\s+([A-Za-z_][A-Za-z0-9_]*)([^{};]*)/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { name: match[1], kind: "class", conformsTo: conformanceNames(match[2] ?? "") };
}

function macroNameForLine(line: string): string | undefined {
  return /^\s*(?:#\[[^\]]+\]\s*)*macro_rules!\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(line)?.[1];
}

function implForLine(line: string): { owner: string; traitName?: string } | undefined {
  const match = /^\s*(?:unsafe\s+)?impl\b(.*?)(?:\{|$)/u.exec(line);
  if (!match) {
    return undefined;
  }

  const body = match[1].trim().replace(/^<[^>]+>\s*/u, "");
  const traitImpl = /^(.+?)\s+for\s+(.+)$/u.exec(body);
  if (traitImpl) {
    return {
      traitName: rustTypeLeaf(traitImpl[1]),
      owner: rustTypeLeaf(traitImpl[2])
    };
  }
  return { owner: rustTypeLeaf(body) };
}

function functionNameForLine(line: string): string | undefined {
  return /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]+"\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(
    line
  )?.[1];
}

function conformanceNames(tail: string): string[] {
  const colonIndex = tail.lastIndexOf(":");
  if (colonIndex < 0) {
    return [];
  }
  return tail
    .slice(colonIndex + 1)
    .split("+")
    .map((part) => rustTypeLeaf(part.trim()))
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name));
}

function conformanceEdges(item: RustItem): CodeEdge[] {
  return (item.conformsTo ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function importEdges(moduleName: string, lines: string[]): CodeEdge[] {
  const modules = new Set<string>();
  for (const rawLine of lines) {
    const imported = rustUseLine(stripLineComment(rawLine));
    if (imported) {
      rustUsePathVariants(imported).forEach((variant) => modules.add(variant));
    }
  }
  return [...modules].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module",
    confidence: "name"
  }));
}

function rustUseLine(line: string): string | undefined {
  return /^\s*use\s+([^;]+);/u.exec(line)?.[1];
}

function rustUsePathVariants(usePath: string): string[] {
  const expanded = expandRustUsePath(usePath.trim());
  return uniqueValues(
    expanded.flatMap((item) => {
      const cleaned = item.replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*$/u, "").trim();
      if (!cleaned) {
        return [];
      }
      const variants = [cleaned];
      const withoutRoot = cleaned.replace(/^(?:crate|self|super)::/u, "");
      if (withoutRoot !== cleaned) {
        variants.push(withoutRoot);
      }
      return variants;
    })
  );
}

function expandRustUsePath(value: string): string[] {
  const braceStart = value.indexOf("{");
  if (braceStart === -1) {
    return [value];
  }
  const braceEnd = value.lastIndexOf("}");
  if (braceEnd <= braceStart) {
    return [value];
  }
  const prefix = value.slice(0, braceStart).replace(/::$/u, "");
  return value
    .slice(braceStart + 1, braceEnd)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part === "self" ? prefix : `${prefix}::${part}`));
}

function callEdges(item: RustItem, lines: string[]): CodeEdge[] {
  return calledNames(lines.slice(item.startLine - 1, item.endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  const stripped = stripRustCommentsAndStrings(text);
  for (const match of stripped.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:!|::\s*(?:<[^>]+>\s*)?[A-Za-z_][A-Za-z0-9_]*\s*\(|\()/gu)) {
    const name = match[1];
    if (!rustCallStopwords.has(name)) {
      names.add(name);
    }
  }
  for (const match of stripped.matchAll(/(?:\.|::)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:!|\()/gu)) {
    const name = match[1];
    if (!rustCallStopwords.has(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

const rustCallStopwords = new Set([
  "if",
  "for",
  "while",
  "loop",
  "match",
  "return",
  "Some",
  "Ok",
  "Err",
  "None",
  "Self",
  "self",
  "assert",
  "assert_eq",
  "assert_ne"
]);

function rustTypeLeaf(value: string): string {
  const cleaned = value
    .replace(/^dyn\s+/u, "")
    .replace(/^&'?[\w]*\s*/u, "")
    .replace(/[?;]/gu, "")
    .replace(/<.*$/u, "")
    .trim();
  return cleaned.split("::").pop()?.trim() ?? cleaned;
}

function rustModulePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/gu, "/");
  if (/^(?:tests|benches|examples)\//u.test(normalized)) {
    return normalized.replace(/\.rs$/u, "").split("/").slice(1).join(".") || path.posix.basename(normalized, ".rs");
  }
  const srcIndex = normalized.lastIndexOf("/src/");
  const fromSource = srcIndex >= 0 ? normalized.slice(srcIndex + "/src/".length) : normalized.startsWith("src/") ? normalized.slice("src/".length) : normalized;
  const withoutExtension = fromSource.replace(/\.rs$/u, "");
  const withoutSpecialLeaf = withoutExtension.replace(/\/(?:mod|lib|main)$/u, "");
  const modulePath = withoutSpecialLeaf === "lib" || withoutSpecialLeaf === "main" ? "crate" : withoutSpecialLeaf;
  return modulePath.split("/").filter(Boolean).join(".") || path.posix.basename(normalized, ".rs");
}

function qualifyRustName(name: string, namespace: string): string {
  return namespace ? `${namespace}.${name}` : name;
}

function endLineForBlockOrLine(lines: string[], startIndex: number): number {
  const line = stripLineComment(lines[startIndex]);
  return line.includes("{") ? endLineForBlock(lines, startIndex) : startIndex + 1;
}

function endLineForBlock(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawOpenBrace = false;
  for (let index = startIndex; index < lines.length; index++) {
    const deltaLine = stripLineComment(lines[index]);
    if (deltaLine.includes("{")) {
      sawOpenBrace = true;
    }
    depth += braceDelta(deltaLine);
    if (sawOpenBrace && depth <= 0) {
      return index + 1;
    }
  }
  return startIndex + 1;
}

function braceDelta(line: string): number {
  return countChar(line, "{") - countChar(line, "}");
}

function countChar(value: string, char: string): number {
  return [...value].filter((current) => current === char).length;
}

function stripLineComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index - 1] !== "\\") {
      inString = !inString;
    }
    if (char === "/" && line[index + 1] === "/" && !inString) {
      return line.slice(0, index);
    }
  }
  return line;
}

function stripRustCommentsAndStrings(text: string): string {
  return text
    .replace(/\/\/.*$/gmu, "")
    .replace(/"(?:\\.|[^"\\])*"/gu, "\"\"")
    .replace(/'(?:\\.|[^'\\])'/gu, "''");
}

function normalizedLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function uniqueValues<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}
