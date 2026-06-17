import path from "node:path";
import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const cppExtractor: LanguageExtractor = {
  language: "cpp",
  extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx", ".h"],
  extract: extractCpp
};

interface CppItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "method" | "module";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  conformsTo?: string[];
  relatedNames?: string[];
}

interface CppScope {
  name: string;
  qualifiedName: string;
  kind: "namespace" | "type";
  endLine: number;
}

export function extractCpp(file: SourceFile): ExtractionResult {
  if (isCppBuildFile(file.relativePath)) {
    return extractCppBuildFile(file);
  }

  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const structureLines = cppStructureLines(lines);
  const items = collectCppItems(structureLines, moduleName);
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
    ...includeEdges(moduleName, structureLines),
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName ? ("file_contains_symbol" as const) : ("symbol_contains_symbol" as const),
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => conformanceEdges(item)),
    ...items.flatMap((item) => relatedNameEdges(item)),
    ...items.filter((item) => item.kind === "function" || item.kind === "method").flatMap((item) => callEdges(item, structureLines))
  ];

  return { file, symbols, chunks, edges };
}

function collectCppItems(lines: string[], moduleName: string): CppItem[] {
  const items: CppItem[] = [];
  const scopeStack: CppScope[] = [];
  let pendingTemplate = false;
  let skipBodyUntilLine = 0;

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    while (scopeStack.length > 0 && index + 1 > scopeStack[scopeStack.length - 1].endLine) {
      scopeStack.pop();
    }
    if (index + 1 <= skipBodyUntilLine) {
      continue;
    }
    if (isIgnorableStructureLine(line)) {
      continue;
    }
    if (line.trim().startsWith("template")) {
      pendingTemplate = true;
      continue;
    }

    const owner = currentScope(scopeStack);
    const signatureLine = signatureWindow(lines, index, line);
    const namespaceDeclaration = namespaceForLine(line);
    if (namespaceDeclaration) {
      const qualifiedName = qualifyCppName(namespaceDeclaration.name, owner?.qualifiedName, "namespace");
      const item: CppItem = {
        name: namespaceDeclaration.name,
        qualifiedName,
        kind: "module",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: owner?.qualifiedName ?? moduleName
      };
      items.push(item);
      scopeStack.push({ name: namespaceDeclaration.name, qualifiedName, kind: "namespace", endLine: item.endLine });
      pendingTemplate = false;
      continue;
    }

    const typeDeclaration = typeForLine(signatureLine);
    if (typeDeclaration) {
      const qualifiedName = qualifyCppName(typeDeclaration.name, owner?.qualifiedName, owner?.kind ?? "namespace");
      const item: CppItem = {
        name: typeDeclaration.name,
        qualifiedName,
        kind: "class",
        startLine: index + 1,
        endLine: endLineForDeclaration(lines, index),
        parentSymbolName: owner?.qualifiedName ?? moduleName,
        conformsTo: typeDeclaration.conformsTo,
        relatedNames: pendingTemplate ? ["template"] : []
      };
      items.push(item);
      if (item.endLine > index + 1 && signatureLine.includes("{")) {
        scopeStack.push({ name: typeDeclaration.name, qualifiedName, kind: "type", endLine: item.endLine });
      }
      pendingTemplate = false;
      continue;
    }

    const gtest = gtestForLine(line);
    if (gtest) {
      const namespaceOwner = currentNamespace(scopeStack);
      items.push({
        name: gtest.name,
        qualifiedName: qualifyCppName(gtest.suite, namespaceOwner?.qualifiedName, "namespace") + `.${gtest.name}`,
        kind: "method",
        startLine: index + 1,
        endLine: endLineForDeclaration(lines, index),
        parentSymbolName: namespaceOwner?.qualifiedName ?? moduleName
      });
      pendingTemplate = false;
      continue;
    }

    const currentOwner = currentScope(scopeStack);
    const functionDeclaration = functionForLine(signatureLine, currentOwner, moduleName);
    if (functionDeclaration) {
      const endLine = endLineForDeclaration(lines, index);
      items.push({
        name: functionDeclaration.name,
        qualifiedName: functionDeclaration.qualifiedName,
        kind: functionDeclaration.kind,
        startLine: index + 1,
        endLine,
        parentSymbolName: functionDeclaration.parentSymbolName,
        relatedNames: pendingTemplate ? ["template"] : []
      });
      if (signatureLine.includes("{") && endLine > index + 1) {
        skipBodyUntilLine = endLine;
      }
      pendingTemplate = false;
      continue;
    }

    if (line.trim() !== "" && !line.trim().startsWith("#")) {
      pendingTemplate = false;
    }
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function isIgnorableStructureLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#") || /^(?:public|private|protected)\s*:\s*$/u.test(trimmed);
}

function namespaceForLine(line: string): { name: string } | undefined {
  const match = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)\s*\{/u.exec(line);
  return match ? { name: match[1] } : undefined;
}

function typeForLine(line: string): { name: string; conformsTo: string[] } | undefined {
  const match =
    /^\s*(?:(?:[A-Z_][A-Z0-9_]*|inline|export)\s+)*(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:final|sealed))?\s*([^;{]*)/u.exec(
      line
    );
  if (!match) {
    return undefined;
  }
  return { name: match[1], conformsTo: conformanceNames(match[2] ?? "") };
}

function functionForLine(
  line: string,
  owner: CppScope | undefined,
  moduleName: string
): { name: string; qualifiedName: string; kind: "function" | "method"; parentSymbolName: string } | undefined {
  if (!line.includes("(") || /^\s*(?:if|for|while|switch|catch|return|delete|new)\b/u.test(line)) {
    return undefined;
  }
  const outOfClass = /(?:^|[\s*&])([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)::(~?[A-Za-z_][A-Za-z0-9_]*|operator\s*[^\s(]+)\s*\(/u.exec(
    line
  );
  if (outOfClass) {
    const parentSymbolName = qualifyCppName(outOfClass[1], currentNamespaceName(owner), "namespace");
    const name = normalizeOperatorName(outOfClass[2]);
    return {
      name,
      qualifiedName: `${parentSymbolName}.${name}`,
      kind: "method",
      parentSymbolName
    };
  }

  if (owner?.kind === "type") {
    const constructor = new RegExp(`(?:^|[\\s:*&])(~?${escapeRegExp(owner.name)})\\s*\\(`, "u").exec(line);
    if (constructor) {
      const name = constructor[1];
      return {
        name,
        qualifiedName: `${owner.qualifiedName}.${name}`,
        kind: "method",
        parentSymbolName: owner.qualifiedName
      };
    }
  }

  const name = functionNameBeforeParen(line);
  if (!name || cppDeclarationStopwords.has(name)) {
    return undefined;
  }
  if (owner?.kind === "type") {
    return {
      name,
      qualifiedName: `${owner.qualifiedName}.${name}`,
      kind: "method",
      parentSymbolName: owner.qualifiedName
    };
  }
  const parentSymbolName = owner?.qualifiedName ?? moduleName;
  return {
    name,
    qualifiedName: owner?.qualifiedName ? `${owner.qualifiedName}::${name}` : name,
    kind: "function",
    parentSymbolName
  };
}

function functionNameBeforeParen(line: string): string | undefined {
  const prefix = line.slice(0, line.indexOf("(")).trim();
  const match = /(?:^|[\s*&<>])(~?[A-Za-z_][A-Za-z0-9_]*|operator\s*[^\s(]+)$/u.exec(prefix);
  return match ? normalizeOperatorName(match[1]) : undefined;
}

function gtestForLine(line: string): { suite: string; name: string } | undefined {
  const match = /^\s*TEST(?:_F|_P)?\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(line);
  return match ? { suite: match[1], name: match[2] } : undefined;
}

function includeEdges(moduleName: string, lines: string[]): CodeEdge[] {
  const imports = new Set<string>();
  for (const rawLine of lines) {
    const match = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/u.exec(stripLineComment(rawLine));
    if (match) {
      imports.add(match[1]);
    }
  }
  return [...imports].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module",
    confidence: "name"
  }));
}

function conformanceNames(tail: string): string[] {
  const colon = tail.indexOf(":");
  if (colon < 0) {
    return [];
  }
  const names = new Set<string>();
  for (const part of tail.slice(colon + 1).split(",")) {
    const cleaned = part
      .replace(/\b(?:public|private|protected|virtual|final|override)\b/gu, "")
      .replace(/<.*>/gu, "")
      .trim();
    const name = cleaned.split("::").pop() ?? cleaned;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function conformanceEdges(item: CppItem): CodeEdge[] {
  return (item.conformsTo ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function relatedNameEdges(item: CppItem): CodeEdge[] {
  return (item.relatedNames ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function callEdges(item: CppItem, lines: string[]): CodeEdge[] {
  return calledNames(lines.slice(item.startLine - 1, item.endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|->|::|\b)(~?[A-Za-z_][A-Za-z0-9_]*)(?:<[^>\n]+>)?\s*\(/gu)) {
    const name = match[1];
    if (!cppCallStopwords.has(name)) {
      names.add(name);
    }
  }
  for (const reference of text.matchAll(/::\s*([A-Za-z_][A-Za-z0-9_]*)\b/gu)) {
    const name = reference[1];
    if (!cppCallStopwords.has(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function currentScope(scopes: CppScope[]): CppScope | undefined {
  return scopes[scopes.length - 1];
}

function currentNamespace(scopes: CppScope[]): CppScope | undefined {
  return [...scopes].reverse().find((scope) => scope.kind === "namespace");
}

function currentNamespaceName(owner: CppScope | undefined): string | undefined {
  return owner?.kind === "namespace" ? owner.qualifiedName : undefined;
}

function qualifyCppName(name: string, owner: string | undefined, ownerKind: "namespace" | "type"): string {
  if (!owner) {
    return name;
  }
  if (name.includes("::")) {
    return name.startsWith(`${owner}::`) ? name : `${owner}::${name}`;
  }
  return ownerKind === "type" ? `${owner}::${name}` : `${owner}::${name}`;
}

function normalizeOperatorName(name: string): string {
  return name.replace(/\s+/gu, "");
}

const cppDeclarationStopwords = new Set(["if", "for", "while", "switch", "catch", "return", "sizeof", "alignof", "decltype"]);
const cppCallStopwords = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "sizeof",
  "alignof",
  "decltype",
  "static_cast",
  "dynamic_cast",
  "reinterpret_cast",
  "const_cast"
]);

function endLineForDeclaration(lines: string[], startIndex: number): number {
  const firstLine = stripLineComment(lines[startIndex]);
  if (firstLine.includes("{")) {
    return endLineForBlock(lines, startIndex);
  }
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 10); index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      return endLineForBlock(lines, index);
    }
    if (line.includes(";")) {
      return index + 1;
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

function braceDelta(line: string): number {
  return countChar(line, "{") - countChar(line, "}");
}

function countChar(value: string, char: string): number {
  return [...value].filter((current) => current === char).length;
}

function signatureWindow(lines: string[], index: number, currentLine: string): string {
  const parts = [currentLine.trimEnd()];
  let cursor = index + 1;
  while (!parts.join(" ").includes("{") && !parts.join(" ").includes(";") && cursor < Math.min(lines.length, index + 10)) {
    const next = stripLineComment(lines[cursor]).trim();
    if (next === "" || next.startsWith("#")) {
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

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/u, "");
}

function cppStructureLines(lines: string[]): string[] {
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

function extractCppBuildFile(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = buildItems(file.relativePath, lines, moduleName);
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
    ...items.map((item) => ({
      sourceSymbolName: moduleName,
      targetName: item.qualifiedName,
      kind: "file_contains_symbol" as const,
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => relatedNameEdges(item))
  ];
  return { file, symbols, chunks, edges };
}

function buildItems(relativePath: string, lines: string[], moduleName: string): CppItem[] {
  const basename = path.posix.basename(relativePath);
  if (basename === "CMakeLists.txt") {
    return cmakeItems(lines, moduleName);
  }
  if (basename === "BUILD" || basename === "BUILD.bazel") {
    return bazelItems(lines, moduleName);
  }
  if (basename === "meson.build") {
    return mesonItems(lines, moduleName);
  }
  return [];
}

function cmakeItems(lines: string[], moduleName: string): CppItem[] {
  const items: CppItem[] = [];
  const targets = new Map<string, CppItem>();
  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const target = /^\s*add_(?:library|executable)\s*\(\s*([A-Za-z_][A-Za-z0-9_.+-]*)/u.exec(line);
    if (target) {
      const item = buildItem("cmake.target", target[1], index + 1, moduleName);
      items.push(item);
      targets.set(target[1], item);
      continue;
    }
    const link = /^\s*target_link_libraries\s*\(\s*([A-Za-z_][A-Za-z0-9_.+-]*)\s+(.+)\)/u.exec(line);
    if (link) {
      const item = targets.get(link[1]) ?? buildItem("cmake.target", link[1], index + 1, moduleName);
      if (!targets.has(link[1])) {
        items.push(item);
        targets.set(link[1], item);
      }
      item.relatedNames = [...(item.relatedNames ?? []), ...cmakeDeps(link[2])];
    }
  }
  return items;
}

function bazelItems(lines: string[], moduleName: string): CppItem[] {
  const text = lines.join("\n");
  const items: CppItem[] = [];
  for (const match of text.matchAll(/\bcc_(library|binary|test)\s*\(([\s\S]*?)\n\)/gu)) {
    const body = match[2];
    const name = /name\s*=\s*"([^"]+)"/u.exec(body)?.[1];
    if (!name) {
      continue;
    }
    const startLine = text.slice(0, match.index).split("\n").length;
    const item = buildItem(`bazel.cc_${match[1]}`, name, startLine, moduleName);
    item.endLine = startLine + body.split("\n").length;
    item.relatedNames = [...body.matchAll(/"([^"]+)"/gu)]
      .map((dep) => dep[1])
      .filter((dep) => dep !== name && (dep.startsWith("//") || dep.startsWith(":") || dep.includes("/")));
    items.push(item);
  }
  return items;
}

function mesonItems(lines: string[], moduleName: string): CppItem[] {
  const items: CppItem[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const match = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?(library|executable|static_library|shared_library)\s*\(\s*['"]([^'"]+)['"]/u.exec(
      line
    );
    if (match) {
      items.push(buildItem(`meson.${match[1]}`, match[2], index + 1, moduleName));
    }
  }
  return items;
}

function buildItem(prefix: string, name: string, line: number, moduleName: string): CppItem {
  return {
    name,
    qualifiedName: `${prefix}.${slugName(name)}`,
    kind: "method",
    startLine: line,
    endLine: line,
    parentSymbolName: moduleName
  };
}

function cmakeDeps(value: string): string[] {
  return value
    .split(/\s+/u)
    .map((part) => part.replace(/[()"]/gu, "").trim())
    .filter((part) => part.length > 0 && !["PUBLIC", "PRIVATE", "INTERFACE"].includes(part));
}

function isCppBuildFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return basename === "CMakeLists.txt" || basename === "BUILD" || basename === "BUILD.bazel" || basename === "meson.build";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function slugName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_")
    .toLowerCase();
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
