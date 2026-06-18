import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const csharpExtractor: LanguageExtractor = {
  language: "csharp",
  extensions: [".cs"],
  extract: extractCSharp
};

interface CSharpItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "method" | "module";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  conformsTo?: string[];
  relatedNames?: string[];
  parameterSignature?: string;
}

interface CSharpScope {
  name: string;
  qualifiedName: string;
  endLine: number;
}

export function extractCSharp(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const structureLines = csharpStructureLines(lines);
  const items = collectCSharpItems(structureLines, moduleName);
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
    ...usingEdges(moduleName, lines),
    ...namespaceImportEdges(moduleName, items),
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

function collectCSharpItems(lines: string[], moduleName: string): CSharpItem[] {
  const items: CSharpItem[] = [];
  const namespaceStack: CSharpScope[] = [];
  const typeStack: CSharpScope[] = [];
  let fileScopedNamespace: CSharpScope | undefined;
  let pendingAttributes: string[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    while (typeStack.length > 0 && index + 1 > typeStack[typeStack.length - 1].endLine) {
      typeStack.pop();
    }
    while (namespaceStack.length > 0 && index + 1 > namespaceStack[namespaceStack.length - 1].endLine) {
      namespaceStack.pop();
    }

    const attributes = attributeNames(line);
    if (attributes.length > 0) {
      pendingAttributes = [...pendingAttributes, ...attributes];
    }

    const signatureLine = signatureWindow(lines, index, line);
    const namespaceDeclaration = namespaceForLine(signatureLine);
    if (namespaceDeclaration) {
      const parentNamespace = namespaceStack[namespaceStack.length - 1];
      const qualifiedName = parentNamespace ? `${parentNamespace.qualifiedName}.${namespaceDeclaration.name}` : namespaceDeclaration.name;
      const endLine = namespaceDeclaration.fileScoped ? Math.max(lines.length, 1) : endLineForBlock(lines, index);
      const item = {
        name: namespaceDeclaration.name,
        qualifiedName,
        kind: "module" as const,
        startLine: index + 1,
        endLine,
        parentSymbolName: parentNamespace?.qualifiedName ?? moduleName
      };
      items.push(item);
      if (namespaceDeclaration.fileScoped) {
        fileScopedNamespace = { name: namespaceDeclaration.name, qualifiedName, endLine };
      } else {
        namespaceStack.push({ name: namespaceDeclaration.name, qualifiedName, endLine });
      }
      pendingAttributes = [];
      continue;
    }

    const owner = typeStack[typeStack.length - 1];
    const namespaceOwner = namespaceStack[namespaceStack.length - 1] ?? fileScopedNamespace;
    const typeDeclaration = canStartCSharpType(line) ? typeDeclarationForLine(signatureLine) : undefined;
    if (typeDeclaration) {
      const qualifiedName = qualifyCSharpName(typeDeclaration.name, owner?.qualifiedName, namespaceOwner?.qualifiedName);
      const endLine = endLineForType(lines, index);
      items.push({
        name: typeDeclaration.name,
        qualifiedName,
        kind: "class",
        startLine: index + 1,
        endLine,
        parentSymbolName: owner?.qualifiedName ?? namespaceOwner?.qualifiedName ?? moduleName,
        conformsTo: typeDeclaration.conformsTo,
        relatedNames: [...pendingAttributes, ...roleNamesForType(typeDeclaration.name)]
      });
      pendingAttributes = [];
      if (endLine > index + 1) {
        typeStack.push({ name: typeDeclaration.name, qualifiedName, endLine });
      }
      for (const property of typeDeclaration.primaryProperties) {
        items.push({
          name: property.name,
          qualifiedName: `${qualifiedName}.${property.name}`,
          kind: "method",
          startLine: index + 1,
          endLine: index + 1,
          parentSymbolName: qualifiedName,
          relatedNames: [property.type]
        });
      }
    }

    const currentOwner = typeDeclaration
      ? {
          name: typeDeclaration.name,
          qualifiedName: qualifyCSharpName(typeDeclaration.name, owner?.qualifiedName, namespaceOwner?.qualifiedName)
        }
      : typeStack[typeStack.length - 1];
    const methodDeclaration = currentOwner && !typeDeclaration && canStartCSharpMethod(line) ? methodForLine(signatureLine, currentOwner.name) : undefined;
    if (methodDeclaration) {
      const parentSymbolName = currentOwner.qualifiedName;
      const extensionOwner = methodDeclaration.receiver ? csharpTypeLeaf(methodDeclaration.receiver) : undefined;
      items.push({
        name: methodDeclaration.name,
        qualifiedName: `${parentSymbolName}.${extensionOwner ? `${extensionOwner}.` : ""}${methodDeclaration.name}`,
        kind: "method",
        startLine: index + 1,
        endLine: endLineForMember(lines, index),
        parentSymbolName,
        relatedNames: [...pendingAttributes, ...(extensionOwner ? [extensionOwner] : [])],
        parameterSignature: methodDeclaration.parameterSignature
      });
      pendingAttributes = [];
    }

    const propertyDeclaration = currentOwner && !typeDeclaration && !methodDeclaration ? propertyForLine(signatureLine) : undefined;
    if (propertyDeclaration) {
      const parentSymbolName = currentOwner.qualifiedName;
      items.push({
        name: propertyDeclaration.name,
        qualifiedName: `${parentSymbolName}.${propertyDeclaration.name}`,
        kind: "method",
        startLine: index + 1,
        endLine: endLineForMember(lines, index),
        parentSymbolName,
        relatedNames: [...pendingAttributes, propertyDeclaration.type]
      });
      pendingAttributes = [];
    }

    if (line.trim() !== "" && attributes.length === 0 && !line.trim().startsWith("[")) {
      pendingAttributes = [];
    }
  }

  return disambiguateOverloadedMethods(items).sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function namespaceForLine(line: string): { name: string; fileScoped: boolean } | undefined {
  const match = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_.]*)\s*([;{])/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { name: match[1], fileScoped: match[2] === ";" };
}

function typeDeclarationForLine(line: string): { name: string; conformsTo: string[]; primaryProperties: Array<{ name: string; type: string }> } | undefined {
  const match =
    /^\s*(?:\[[^\]]+\]\s*)*(?:(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|unsafe|ref|required|file)\s+)*\b(?:class|interface|struct|enum|record(?:\s+(?:class|struct))?)\s+([A-Za-z_][A-Za-z0-9_]*)([^{};]*)/u.exec(
      line
    );
  if (!match) {
    return undefined;
  }
  const tail = match[2] ?? "";
  return { name: match[1], conformsTo: conformanceNames(tail), primaryProperties: primaryConstructorProperties(tail) };
}

function methodForLine(line: string, ownerName: string): { name: string; receiver?: string; parameterSignature: string } | undefined {
  const constructor = new RegExp(`^\\s*(?:\\[[^\\]]+\\]\\s*)*(?:(?:public|private|protected|internal|static|extern|unsafe)\\s+)*${ownerName}\\s*\\(`, "u").exec(
    line
  );
  if (constructor) {
    return { name: ownerName, parameterSignature: parameterSignatureForLine(line) };
  }

  const method =
    /^\s*(?:\[[^\]]+\]\s*)*(?:(?:public|private|protected|internal|static|sealed|abstract|virtual|override|async|extern|unsafe|new|partial)\s+)*(?!return\b|throw\b|new\b|await\b|var\b)(?:[A-Za-z_][A-Za-z0-9_<>,.?[\]\s]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/u.exec(
      line
    );
  if (!method || csharpMethodStopwords.has(method[1])) {
    return undefined;
  }
  return { name: method[1], receiver: extensionReceiver(method[2] ?? ""), parameterSignature: parameterSignature(method[2] ?? "") };
}

function propertyForLine(line: string): { name: string; type: string } | undefined {
  if (line.includes("(")) {
    return undefined;
  }
  const autoProperty =
    /^\s*(?:\[[^\]]+\]\s*)*(?:(?:public|private|protected|internal|static|sealed|abstract|virtual|override|readonly|required|new)\s+)*([A-Za-z_][A-Za-z0-9_<>,.?[\]]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/u.exec(
      line
    );
  if (autoProperty) {
    return { type: csharpTypeLeaf(autoProperty[1]), name: autoProperty[2] };
  }
  const expressionProperty =
    /^\s*(?:\[[^\]]+\]\s*)*(?:(?:public|private|protected|internal|static|sealed|abstract|virtual|override|readonly|required|new)\s+)*([A-Za-z_][A-Za-z0-9_<>,.?[\]]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=>/u.exec(
      line
    );
  if (expressionProperty) {
    return { type: csharpTypeLeaf(expressionProperty[1]), name: expressionProperty[2] };
  }
  return undefined;
}

function disambiguateOverloadedMethods(items: CSharpItem[]): CSharpItem[] {
  const methodCounts = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== "method" || !item.parameterSignature) {
      continue;
    }
    const key = `${item.parentSymbolName}.${item.name}`;
    methodCounts.set(key, (methodCounts.get(key) ?? 0) + 1);
  }
  return items.map((item) => {
    const key = `${item.parentSymbolName}.${item.name}`;
    if (item.kind !== "method" || !item.parameterSignature || (methodCounts.get(key) ?? 0) <= 1) {
      return item;
    }
    return {
      ...item,
      qualifiedName: `${item.qualifiedName}(${item.parameterSignature})`
    };
  });
}

function primaryConstructorProperties(tail: string): Array<{ name: string; type: string }> {
  const parameters = leadingParameterList(tail);
  if (!parameters) {
    return [];
  }
  return splitTopLevel(parameters)
    .map(parameterParts)
    .filter((parameter): parameter is { name: string; type: string } => parameter !== undefined);
}

function parameterSignatureForLine(line: string): string {
  const open = line.indexOf("(");
  if (open === -1) {
    return "";
  }
  let depth = 0;
  for (let index = open; index < line.length; index += 1) {
    const char = line[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return parameterSignature(line.slice(open + 1, index));
      }
    }
  }
  return "";
}

function parameterSignature(parameters: string): string {
  return splitTopLevel(parameters)
    .map(parameterParts)
    .filter((parameter): parameter is { name: string; type: string } => parameter !== undefined)
    .map((parameter) => parameter.type)
    .join(",");
}

function leadingParameterList(value: string): string | undefined {
  const open = value.indexOf("(");
  if (open === -1) {
    return undefined;
  }
  let angleDepth = 0;
  let parenDepth = 0;
  for (let index = open; index < value.length; index += 1) {
    const char = value[index];
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0 && angleDepth === 0) {
        return value.slice(open + 1, index);
      }
    }
  }
  return undefined;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "," && angleDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) {
    parts.push(last);
  }
  return parts;
}

function parameterParts(parameter: string): { name: string; type: string } | undefined {
  const cleaned = parameter
    .replace(/\[[^\]]+\]\s*/gu, "")
    .replace(/\s*=\s*.+$/u, "")
    .trim();
  const match = /^(?:(?:this|ref|out|in|params|scoped|readonly)\s+)*(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)$/u.exec(cleaned);
  if (!match) {
    return undefined;
  }
  return { type: compactTypeName(match[1]), name: match[2] };
}

function compactTypeName(typeName: string): string {
  return typeName.replace(/\s+/gu, "").replace(/\s*([<>,?[\]])\s*/gu, "$1");
}

function canStartCSharpType(line: string): boolean {
  return /\b(?:class|interface|struct|enum|record)\b/u.test(line) && !line.trim().startsWith("[");
}

function canStartCSharpMethod(line: string): boolean {
  return line.includes("(") && !line.trim().startsWith("[") && !/^\s*(?:if|for|foreach|while|switch|catch|using|lock)\b/u.test(line);
}

function usingEdges(moduleName: string, lines: string[]): CodeEdge[] {
  const modules = new Set<string>();
  for (const rawLine of lines) {
    const imported = csharpUsingModule(stripLineComment(rawLine));
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

function namespaceImportEdges(moduleName: string, items: CSharpItem[]): CodeEdge[] {
  return items
    .filter((item) => item.kind === "module" && item.parentSymbolName === moduleName)
    .map((item) => ({
      sourceSymbolName: moduleName,
      targetName: item.qualifiedName,
      kind: "symbol_imports_module" as const,
      confidence: "name" as const
    }));
}

function csharpUsingModule(line: string): string | undefined {
  const match = /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:(?:[A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?([A-Za-z_][A-Za-z0-9_.]*)\s*;/u.exec(line);
  return match?.[1];
}

function conformanceNames(tail: string): string[] {
  const match = /:\s*([^{};]+)/u.exec(tail);
  if (!match) {
    return [];
  }
  const names = new Set<string>();
  for (const part of match[1].split(",")) {
    const name = csharpTypeLeaf(part.replace(/\([^)]*\)/gu, "").trim());
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function conformanceEdges(item: CSharpItem): CodeEdge[] {
  return (item.conformsTo ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_conforms_to",
    confidence: "name"
  }));
}

function relatedNameEdges(item: CSharpItem): CodeEdge[] {
  return (item.relatedNames ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function callEdges(item: CSharpItem, lines: string[]): CodeEdge[] {
  return calledNames(lines.slice(item.startLine - 1, item.endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|\b)([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]+>)?\s*\(/gu)) {
    const name = match[1];
    if (!csharpCallStopwords.has(name)) {
      names.add(name);
    }
  }
  for (const attribute of text.matchAll(/\[([A-Za-z_][A-Za-z0-9_.]*)/gu)) {
    names.add(csharpTypeLeaf(attribute[1]));
  }
  return [...names].sort();
}

function attributeNames(line: string): string[] {
  return [...line.matchAll(/\[([A-Za-z_][A-Za-z0-9_.]*)/gu)].map((match) => csharpTypeLeaf(match[1]));
}

function extensionReceiver(parameters: string): string | undefined {
  const match = /^\s*this\s+([A-Za-z_][A-Za-z0-9_<>,.?[\]]*)\s+[A-Za-z_][A-Za-z0-9_]*/u.exec(parameters);
  return match?.[1];
}

function roleNamesForType(name: string): string[] {
  const roles = ["Controller", "Service", "Middleware", "HostedService", "Handler", "Command", "Options"];
  return roles.filter((role) => name.endsWith(role));
}

function csharpTypeLeaf(value: string): string {
  const cleaned = value.replace(/[?&]/gu, "").replace(/<.*$/u, "").replace(/\[\]/gu, "").trim();
  const parts = cleaned.split(".");
  return parts[parts.length - 1] || cleaned;
}

function qualifyCSharpName(name: string, owner: string | undefined, namespaceName: string | undefined): string {
  if (owner) {
    return `${owner}.${name}`;
  }
  return namespaceName ? `${namespaceName}.${name}` : name;
}

const csharpCallStopwords = new Set([
  "if",
  "for",
  "foreach",
  "while",
  "switch",
  "catch",
  "return",
  "throw",
  "new",
  "nameof",
  "typeof",
  "sizeof",
  "default",
  "using",
  "lock"
]);
const csharpMethodStopwords = new Set(["if", "for", "foreach", "while", "switch", "catch", "using", "lock"]);

function endLineForType(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 8); index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      return endLineForBlock(lines, index);
    }
    if (line.includes(";")) {
      return index + 1;
    }
    if (index > startIndex && canStartCSharpDeclaration(line)) {
      return index;
    }
  }
  return startIndex + 1;
}

function endLineForMember(lines: string[], startIndex: number): number {
  const firstLine = stripLineComment(lines[startIndex]);
  if (firstLine.includes("{")) {
    return endLineForBlock(lines, startIndex);
  }
  if (firstLine.includes(";") || firstLine.includes("=>")) {
    return startIndex + 1;
  }
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 8); index++) {
    const line = stripLineComment(lines[index]);
    if (line.includes("{")) {
      return endLineForBlock(lines, index);
    }
    if (line.includes(";") || line.includes("=>")) {
      return index + 1;
    }
    if (index > startIndex && canStartCSharpDeclaration(line)) {
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

function canStartCSharpDeclaration(line: string): boolean {
  return canStartCSharpType(line) || canStartCSharpMethod(line);
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
  if (currentLine.trim() === "") {
    return currentLine;
  }
  const parts = [currentLine.trimEnd()];
  let cursor = index + 1;
  while (!parts.join(" ").includes("{") && !parts.join(" ").includes(";") && cursor < Math.min(lines.length, index + 8)) {
    const next = stripLineComment(lines[cursor]).trim();
    if (next === "" || next.startsWith("[")) {
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

function csharpStructureLines(lines: string[]): string[] {
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
