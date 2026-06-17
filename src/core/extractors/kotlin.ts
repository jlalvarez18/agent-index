import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const kotlinExtractor: LanguageExtractor = {
  language: "kotlin",
  extensions: [".kt", ".kts"],
  extract: extractKotlin
};

interface KotlinItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  conformsTo?: string[];
  relatedNames?: string[];
}

interface KotlinType {
  name: string;
  qualifiedName: string;
  depth: number;
  endLine: number;
}

export function extractKotlin(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const packageName = kotlinPackageName(lines);
  const structureLines = kotlinStructureLines(lines);
  const items = collectKotlinItems(structureLines, moduleName, packageName);
  items.push(...collectGradleKtsItems(file, lines, moduleName));
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
      kind: item.parentSymbolName === moduleName ? "file_contains_symbol" as const : "symbol_contains_symbol" as const,
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => conformanceEdges(item)),
    ...items.flatMap((item) => relatedNameEdges(item))
  ];
  for (const item of items.filter((current) => current.kind !== "class")) {
    edges.push(...callEdges(item, structureLines));
  }

  return { file, symbols, chunks, edges };
}

function collectKotlinItems(lines: string[], moduleName: string, packageName?: string): KotlinItem[] {
  const items: KotlinItem[] = [];
  const typeStack: KotlinType[] = [];
  let depth = 0;
  let pendingAnnotations: string[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const annotations = annotationNames(line);
    if (annotations.length > 0) {
      pendingAnnotations = [...pendingAnnotations, ...annotations];
    }
    const signatureLine = signatureWindow(lines, index, line);
    while (typeStack.length > 0 && index + 1 > typeStack[typeStack.length - 1].endLine) {
      typeStack.pop();
    }

    const typeDeclaration = canStartKotlinType(line) ? typeDeclarationForLine(signatureLine) : undefined;
    if (typeDeclaration) {
      const owner = typeStack[typeStack.length - 1];
      const qualifiedName = qualifyKotlinName(typeDeclaration.name, owner?.qualifiedName, packageName);
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
        typeStack.push({ name: typeDeclaration.name, qualifiedName, depth: depth + 1, endLine });
      }
    }

    const functionDeclaration = canStartKotlinFunction(line) ? functionForLine(signatureLine) : undefined;
    if (functionDeclaration && !typeDeclaration) {
      const owner = typeStack[typeStack.length - 1];
      const extensionOwner = functionDeclaration.receiver ? kotlinTypeLeaf(functionDeclaration.receiver) : undefined;
      const parentSymbolName = owner?.qualifiedName ?? moduleName;
      const qualifiedName = owner
        ? `${owner.qualifiedName}.${functionDeclaration.name}`
        : qualifyKotlinName(extensionOwner ? `${extensionOwner}.${functionDeclaration.name}` : functionDeclaration.name, undefined, packageName);
      items.push({
        name: functionDeclaration.name,
        qualifiedName,
        kind: owner ? "method" : "function",
        startLine: index + 1,
        endLine: endLineForFunction(lines, index),
        parentSymbolName,
        relatedNames: [...pendingAnnotations, ...(extensionOwner ? [extensionOwner] : [])]
      });
      pendingAnnotations = [];
    }

    depth += braceDelta(line);
    if (line.trim() !== "" && annotations.length === 0 && !line.trim().startsWith("@")) {
      pendingAnnotations = [];
    }
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function collectGradleKtsItems(file: SourceFile, lines: string[], moduleName: string): KotlinItem[] {
  if (!file.relativePath.endsWith(".gradle.kts") && !file.relativePath.endsWith("settings.gradle.kts")) {
    return [];
  }
  const items: KotlinItem[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const declaration = gradleDeclaration(line);
    if (!declaration) {
      continue;
    }
    const endLine = endLineForBlock(lines, index);
    const text = lines.slice(index, endLine).join("\n");
    items.push({
      name: declaration.name,
      qualifiedName: `gradle.${declaration.kind}.${gradleQualifiedNamePart(declaration)}`,
      kind: "method",
      startLine: index + 1,
      endLine,
      parentSymbolName: moduleName,
      relatedNames: gradleRelatedNames(text, declaration.name)
    });
  }
  return items;
}

function gradleQualifiedNamePart(declaration: { kind: string; name: string }): string {
  return declaration.kind === "sourceSet" ? declaration.name : slugName(declaration.name);
}

function typeDeclarationForLine(line: string): { name: string; conformsTo: string[] } | undefined {
  const companion =
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|internal)\s+)*companion\s+object(?:\s+([A-Za-z_][A-Za-z0-9_]*))?([^{}]*)/u.exec(
      line
    );
  if (companion) {
    return { name: companion[1] ?? "companion", conformsTo: conformanceNames(companion[2] ?? "") };
  }

  const match =
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|internal|expect|actual|data|sealed|open|abstract|final|value|fun|inner|companion)\s+)*\b(class|interface|object|enum\s+class|annotation\s+class)\s+([A-Za-z_][A-Za-z0-9_]*)([^{}]*)/u.exec(
      line
    );
  if (!match) {
    return undefined;
  }
  return { name: match[2], conformsTo: conformanceNames(match[3] ?? "") };
}

function canStartKotlinType(line: string): boolean {
  return /\b(?:class|interface|object|enum\s+class|annotation\s+class)\b/u.test(line) && !line.trim().startsWith("@");
}

function canStartKotlinFunction(line: string): boolean {
  return /\bfun\b/u.test(line) && !line.trim().startsWith("@");
}

function functionForLine(line: string): { name: string; receiver?: string } | undefined {
  const match =
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|internal|expect|actual|override|operator|infix|tailrec|suspend|inline|external)\s+)*fun\s+(?:(?:<[^>]+>\s*)?([A-Za-z_][A-Za-z0-9_<>,.? :]*?)\s*\.\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]+>)?\s*\(/u.exec(
      line
    );
  if (!match) {
    return undefined;
  }
  return { receiver: match[1]?.trim(), name: match[2] };
}

function gradleDeclaration(line: string): { kind: string; name: string } | undefined {
  const pluginAlias = /^\s*alias\s*\(\s*libs\.plugins\.([A-Za-z0-9_.-]+)/u.exec(line)?.[1];
  if (pluginAlias) {
    return { kind: "plugin", name: `libs.plugins.${pluginAlias}` };
  }
  const pluginId = /^\s*id\s*\(\s*"([^"]+)"/u.exec(line)?.[1];
  if (pluginId) {
    return { kind: "plugin", name: pluginId };
  }
  const kotlinPlugin = /^\s*kotlin\s*\(\s*"([^"]+)"/u.exec(line)?.[1];
  if (kotlinPlugin) {
    return { kind: "plugin", name: `kotlin-${kotlinPlugin}` };
  }
  const projectDependency = /^\s*(api|implementation|compileOnly|runtimeOnly|testImplementation|androidTestImplementation)\s*\(\s*project\s*\(\s*"([^"]+)"/u.exec(line);
  if (projectDependency) {
    return { kind: projectDependency[1], name: projectDependency[2] };
  }
  const catalogDependency = /^\s*(api|implementation|compileOnly|runtimeOnly|testImplementation|androidTestImplementation)\s*\(\s*libs\.([A-Za-z0-9_.-]+)/u.exec(line);
  if (catalogDependency) {
    return { kind: catalogDependency[1], name: `libs.${catalogDependency[2]}` };
  }
  const externalDependency = /^\s*(api|implementation|compileOnly|runtimeOnly|testImplementation|androidTestImplementation)\s*\(\s*"([^"]+)"/u.exec(line);
  if (externalDependency) {
    return { kind: externalDependency[1], name: externalDependency[2] };
  }
  const include = /^\s*include\s*\((.+)\)/u.exec(line);
  if (include) {
    return { kind: "include", name: include[1].replace(/["\s]/gu, "") };
  }
  const namespace = /^\s*namespace\s*=\s*"([^"]+)"/u.exec(line)?.[1];
  if (namespace) {
    return { kind: "namespace", name: namespace };
  }
  const sourceSetProperty = /^\s*val\s+([A-Za-z][A-Za-z0-9]*(?:Main|Test))\s+by\s+(?:getting|creating)/u.exec(line)?.[1];
  if (sourceSetProperty) {
    return { kind: "sourceSet", name: sourceSetProperty };
  }
  const sourceSetBlock = /^\s*([A-Za-z][A-Za-z0-9]*(?:Main|Test))\s*(?:\.dependencies\s*)?\{/u.exec(line)?.[1];
  if (sourceSetBlock && !gradleBlockStopwords.has(sourceSetBlock)) {
    return { kind: "sourceSet", name: sourceSetBlock };
  }
  return undefined;
}

const gradleBlockStopwords = new Set(["plugins", "android", "dependencies", "repositories", "sourceSets", "kotlin"]);

function packageImportEdges(moduleName: string, lines: string[], packageName: string | undefined): CodeEdge[] {
  const modules = new Set<string>();
  if (packageName) {
    modules.add(packageName);
  }
  for (const rawLine of lines) {
    const imported = kotlinImportModule(stripLineComment(rawLine));
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

function kotlinImportModule(line: string): string | undefined {
  const match = /^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?/u.exec(line);
  return match?.[1];
}

function kotlinPackageName(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = /^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)/u.exec(stripLineComment(line));
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function conformanceNames(tail: string): string[] {
  const colonIndex = tail.lastIndexOf(":");
  if (colonIndex < 0) {
    return [];
  }
  return tail
    .slice(colonIndex + 1)
    .split(",")
    .map((part) => kotlinTypeLeaf(part.replace(/\([^)]*\)/gu, "").trim()))
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name));
}

function conformanceEdges(item: KotlinItem): CodeEdge[] {
  return (item.conformsTo ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function relatedNameEdges(item: KotlinItem): CodeEdge[] {
  return (item.relatedNames ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function callEdges(item: KotlinItem, lines: string[]): CodeEdge[] {
  return calledNames(lines.slice(item.startLine - 1, item.endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|\b)([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|\{)/gu)) {
    const name = match[1];
    if (!kotlinCallStopwords.has(name)) {
      names.add(name);
    }
  }
  for (const annotation of text.matchAll(/@([A-Za-z_][A-Za-z0-9_.]*)/gu)) {
    names.add(kotlinTypeLeaf(annotation[1]));
  }
  return [...names].sort();
}

function gradleRelatedNames(text: string, declarationName: string): string[] {
  const names = new Set<string>([declarationName]);
  for (const match of text.matchAll(/project\s*\(\s*"([^"]+)"/gu)) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(/"([A-Za-z0-9_.:-]+)"/gu)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function annotationNames(line: string): string[] {
  return [...line.matchAll(/@([A-Za-z_][A-Za-z0-9_.]*)/gu)].map((match) => kotlinTypeLeaf(match[1]));
}

function kotlinTypeLeaf(value: string): string {
  const cleaned = value.replace(/[?&]/gu, "").replace(/<.*$/u, "").trim();
  const parts = cleaned.split(".");
  return parts[parts.length - 1] || cleaned;
}

function qualifyKotlinName(name: string, owner: string | undefined, packageName: string | undefined): string {
  if (owner) {
    return `${owner}.${name}`;
  }
  return packageName ? `${packageName}.${name}` : name;
}

const kotlinCallStopwords = new Set([
  "if",
  "for",
  "when",
  "while",
  "return",
  "fun",
  "class",
  "interface",
  "object",
  "try",
  "catch",
  "else"
]);

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

function endLineForType(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 8); index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      return endLineForBlock(lines, index);
    }
    if (index > startIndex && canStartKotlinDeclaration(line)) {
      return index;
    }
    if (index > startIndex && line.trim() === "") {
      return index;
    }
  }
  return startIndex + 1;
}

function endLineForFunction(lines: string[], startIndex: number): number {
  const firstLine = stripLineComment(lines[startIndex]);
  if (firstLine.includes("{")) {
    return endLineForBlock(lines, startIndex);
  }
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 6); index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      return endLineForBlock(lines, index);
    }
    if (line.includes("=")) {
      return index + 1;
    }
    if (index > startIndex && canStartKotlinDeclaration(line)) {
      return index;
    }
  }
  return startIndex + 1;
}

function canStartKotlinDeclaration(line: string): boolean {
  return canStartKotlinType(line) || canStartKotlinFunction(line);
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
  while (!parts.join(" ").includes("{") && cursor < Math.min(lines.length, index + 6)) {
    const next = stripLineComment(lines[cursor]).trim();
    if (next === "" || next.startsWith("@")) {
      break;
    }
    parts.push(next);
    if (/[)=]\s*(?::[^{]+)?\s*$/u.test(next) || next.includes("{")) {
      break;
    }
    cursor++;
  }
  return parts.join(" ");
}

function kotlinStructureLines(lines: string[]): string[] {
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
