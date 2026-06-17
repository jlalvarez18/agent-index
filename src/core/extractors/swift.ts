import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const swiftExtractor: LanguageExtractor = {
  language: "swift",
  extensions: [".swift"],
  extract: extractSwift
};

interface SwiftItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "method" | "typealias";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  conformsTo?: string[];
  relatedNames?: string[];
}

interface SwiftType {
  name: string;
  qualifiedName: string;
  declarationKind: string;
  depth: number;
}

export function extractSwift(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const structureLines = swiftStructureLines(lines);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = collectSwiftItems(structureLines, moduleName);
  items.push(...collectSwiftPackageManifestItems(file, lines, items));
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
  const edges: CodeEdge[] = [];
  edges.push(...importEdges(moduleName, structureLines));
  edges.push(
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName ? "file_contains_symbol" as const : "symbol_contains_symbol" as const,
      confidence: "exact" as const
    }))
  );
  edges.push(...items.flatMap((item) => conformanceEdges(item)));
  for (const item of items.filter((current) => current.kind !== "class")) {
    edges.push(...callEdges(item, structureLines));
  }
  edges.push(...items.flatMap((item) => relatedNameEdges(item)));

  return { file, symbols, chunks, edges };
}

function collectSwiftPackageManifestItems(file: SourceFile, lines: string[], items: SwiftItem[]): SwiftItem[] {
  if (!file.relativePath.endsWith("Package.swift")) {
    return [];
  }
  const packageSymbol = items.find((item) => item.qualifiedName === "package");
  if (!packageSymbol) {
    return [];
  }
  const manifestItems: SwiftItem[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const declaration = packageManifestDeclaration(line);
    if (!declaration) {
      continue;
    }
    const endLine = endLineForBlock(lines, index);
    const chunkText = lines.slice(index, endLine).join("\n");
    manifestItems.push({
      name: declaration.name,
      qualifiedName: `package.${declaration.kind}.${slugName(declaration.name)}`,
      kind: "method",
      startLine: index + 1,
      endLine,
      parentSymbolName: packageSymbol.qualifiedName,
      relatedNames: packageManifestRelatedNames(chunkText, declaration.name)
    });
  }
  return manifestItems;
}

function packageManifestDeclaration(line: string): { kind: string; name: string } | undefined {
  const match = /^\s*\.(library|executable|plugin|macro|target|executableTarget|testTarget|systemLibrary|binaryTarget)\s*\(\s*name:\s*"([^"]+)"/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { kind: match[1], name: match[2] };
}

function collectSwiftItems(lines: string[], moduleName: string): SwiftItem[] {
  const items: SwiftItem[] = [];
  const typeStack: SwiftType[] = [];
  const extensionCounts = new Map<string, number>();
  let depth = 0;

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const signatureLine = signatureWindow(lines, index, line);
    while (typeStack.length > 0 && depth < typeStack[typeStack.length - 1].depth) {
      typeStack.pop();
    }

    const typeDeclaration = typeDeclarationForLine(signatureLine);
    if (typeDeclaration) {
      const owner = typeStack[typeStack.length - 1];
      const typeName = typeDeclaration.name;
      const symbolName = typeDeclaration.isExtension ? extensionSymbolName(typeName, typeDeclaration, extensionCounts) : typeName;
      const qualifiedName = owner ? `${owner.qualifiedName}.${symbolName}` : symbolName;
      items.push({
        name: typeName,
        qualifiedName,
        kind: "class",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: owner?.qualifiedName ?? moduleName,
        conformsTo: typeDeclaration.conformsTo
      });
      if (braceDelta(line) > 0) {
        typeStack.push({ name: typeName, qualifiedName, declarationKind: typeDeclaration.declarationKind, depth: depth + braceDelta(line) });
      }
    }

    const aliasName = typealiasNameForLine(signatureLine);
    if (aliasName && !typeDeclaration) {
      const owner = typeStack[typeStack.length - 1];
      items.push({
        name: aliasName,
        qualifiedName: owner ? `${owner.qualifiedName}.${aliasName}` : aliasName,
        kind: "typealias",
        startLine: index + 1,
        endLine: index + 1,
        parentSymbolName: owner?.qualifiedName ?? moduleName
      });
    }

    const owner = typeStack[typeStack.length - 1];
    if (owner?.declarationKind === "enum" && !typeDeclaration) {
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

    const functionName = functionNameForLine(signatureLine);
    if (functionName && !typeDeclaration) {
      items.push({
        name: functionName,
        qualifiedName: owner ? `${owner.qualifiedName}.${functionName}` : functionName,
        kind: owner ? "method" : "function",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: owner?.qualifiedName ?? moduleName
      });
    }

    depth += braceDelta(line);
  }

  return items;
}

function typeDeclarationForLine(line: string): { name: string; conformsTo: string[]; isExtension: boolean; declarationKind: string; qualifier?: string } | undefined {
  const match = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|final|actor|indirect|\s)*\b(class|struct|enum|actor|protocol|extension)\s+([A-Za-z_][A-Za-z0-9_]*)([^{}]*)/u.exec(
    line
  );
  if (!match) {
    return undefined;
  }
  const tail = match[3] ?? "";
  const conformsTo = conformanceNames(tail);
  return {
    name: match[2],
    conformsTo,
    isExtension: match[1] === "extension",
    declarationKind: match[1],
    qualifier: extensionQualifier(tail, conformsTo)
  };
}

function extensionSymbolName(typeName: string, declaration: { qualifier?: string }, extensionCounts: Map<string, number>): string {
  const base = `${typeName}.extension${declaration.qualifier ? `.${declaration.qualifier}` : ""}`;
  const count = (extensionCounts.get(base) ?? 0) + 1;
  extensionCounts.set(base, count);
  return count === 1 ? base : `${base}_${count}`;
}

function functionNameForLine(line: string): string | undefined {
  return firstMatch([
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|static|class|mutating|nonmutating|override|async|\s)*func\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(line)?.[1],
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|static|class|mutating|nonmutating|override|\s)*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/u.exec(line)?.[1],
    /^\s*@(?:State|StateObject|ObservedObject|EnvironmentObject|Environment|Binding|Bindable|FocusState|AppStorage|SceneStorage)\b(?:\([^)]*\))?\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|static|\s)*(?:var|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)?.[1],
    /^\s*(?:public|private|fileprivate|internal|open|\s)*(?:let|var)\s+(package)\s*=\s*Package\s*\(/u.exec(line)?.[1],
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|convenience|required|override|\s)*init\s*\(/u.test(line)
      ? "init"
      : undefined,
    /^\s*(?:test|it)\s*\(\s*(["'])([^"']+)\1/u.exec(line)?.[2]?.replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "")
  ]);
}

function typealiasNameForLine(line: string): string | undefined {
  return /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|\s)*typealias\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(line)?.[1];
}

function enumCaseNamesForLine(line: string): string[] {
  const match = /^\s*case\s+(.+)$/u.exec(line);
  if (!match) {
    return [];
  }
  return match[1]
    .split(",")
    .map((part) => /^[A-Za-z_][A-Za-z0-9_]*/u.exec(part.trim())?.[0])
    .filter((part): part is string => Boolean(part));
}

function importEdges(moduleName: string, lines: string[]): CodeEdge[] {
  const modules = new Set<string>();
  for (const rawLine of lines) {
    const imported = swiftImportModule(stripLineComment(rawLine));
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

function swiftImportModule(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.includes("import")) {
    return undefined;
  }
  const tokens = trimmed.split(/\s+/u);
  const importIndex = tokens.indexOf("import");
  if (importIndex < 0) {
    return undefined;
  }
  const imported = tokens[importIndex + 1];
  const moduleToken = swiftImportKinds.has(imported) ? tokens[importIndex + 2] : imported;
  return /^[A-Za-z_][A-Za-z0-9_]*/u.exec(moduleToken ?? "")?.[0];
}

const swiftImportKinds = new Set(["class", "struct", "enum", "protocol", "func", "var", "let", "typealias"]);

function conformanceEdges(item: SwiftItem): CodeEdge[] {
  return (item.conformsTo ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function relatedNameEdges(item: SwiftItem): CodeEdge[] {
  return (item.relatedNames ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function callEdges(item: SwiftItem, lines: string[]): CodeEdge[] {
  return calledNames(lines.slice(item.startLine - 1, item.endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!isIdentifierStart(char)) {
      continue;
    }
    let end = index + 1;
    while (end < text.length && isIdentifierPart(text[end])) {
      end += 1;
    }
    let next = end;
    while (next < text.length && /\s/u.test(text[next])) {
      next += 1;
    }
    if (text[next] === "(" || text[next] === "{") {
      const name = text.slice(index, end);
      if (!swiftCallStopwords.has(name)) {
        names.add(name);
      }
    }
    index = end;
  }
  return [...names].sort();
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_]/u.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/u.test(char);
}

function packageManifestRelatedNames(text: string, declarationName: string): string[] {
  const relatedNames = new Set<string>();
  const firstName = text.indexOf(`"${declarationName}"`);
  if (firstName < 0) {
    return [];
  }
  for (const match of text.slice(firstName + declarationName.length + 2).matchAll(/"([^"]+)"/gu)) {
    relatedNames.add(match[1]);
  }
  return [...relatedNames].sort();
}

const swiftCallStopwords = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "guard",
  "func",
  "init",
  "return",
  "throw",
  "throws",
  "async",
  "await",
  "Task",
  "VStack",
  "HStack",
  "List",
  "ForEach"
]);

function conformanceNames(value: string): string[] {
  const tail = value.split(/\bwhere\b/u)[0] ?? "";
  const colonIndex = tail.indexOf(":");
  if (colonIndex < 0) {
    return [];
  }
  return tail
    .slice(colonIndex + 1)
    .split(",")
    .map((part) => part.trim().replace(/\?.*$/u, "").replace(/<.*$/u, ""))
    .map((part) => /^[A-Za-z_][A-Za-z0-9_]*/u.exec(part)?.[0])
    .filter((part): part is string => Boolean(part));
}

function extensionQualifier(value: string, conformsTo: string[]): string | undefined {
  if (conformsTo.length > 0) {
    return slugName(conformsTo.join("_"));
  }
  const whereClause = /\bwhere\b\s+(.+)$/u.exec(value)?.[1];
  return whereClause ? slugName(whereClause.replace(/==/gu, " ")) : undefined;
}

function slugName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_");
}

function firstMatch(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}

function signatureWindow(lines: string[], index: number, line: string): string {
  if (!canStartSwiftItem(line)) {
    return line;
  }
  return stripLineComment(lines.slice(index, index + 4).join(" "));
}

function canStartSwiftItem(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|final|actor|indirect|\s)*(?:class|struct|enum|actor|protocol|extension)\b/u.test(trimmed) ||
    /^(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|static|class|mutating|nonmutating|override|async|\s)*func\b/u.test(trimmed) ||
    /^(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|convenience|required|override|\s)*init\s*\(/u.test(trimmed) ||
    /^(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|fileprivate|internal|open|static|class|mutating|nonmutating|override|\s)*(?:var|let)\b/u.test(trimmed) ||
    /^(?:test|it)\s*\(/u.test(trimmed)
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

function braceDelta(line: string): number {
  return countChar(line, "{") - countChar(line, "}");
}

function countChar(value: string, char: string): number {
  return [...value].filter((current) => current === char).length;
}

function parenDelta(line: string): number {
  return countChar(line, "(") - countChar(line, ")");
}

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/u, "");
}

function normalizedLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

function swiftStructureLines(lines: string[]): string[] {
  let inMultilineString = false;
  return lines.map((line) => {
    let index = 0;
    let structural = "";
    while (index < line.length) {
      const delimiterIndex = line.indexOf('"""', index);
      if (delimiterIndex < 0) {
        if (!inMultilineString) {
          structural += line.slice(index);
        }
        break;
      }
      if (!inMultilineString) {
        structural += line.slice(index, delimiterIndex);
        inMultilineString = true;
      } else {
        inMultilineString = false;
      }
      index = delimiterIndex + 3;
    }
    return structural;
  });
}

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}
