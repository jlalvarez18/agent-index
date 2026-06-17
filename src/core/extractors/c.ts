import path from "node:path";
import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const cExtractor: LanguageExtractor = {
  language: "c",
  extensions: [".c", ".h", ".mk", "Makefile", "CMakeLists.txt", "meson.build"],
  extract: extractC
};

interface CItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "typealias" | "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  relatedNames?: string[];
  hasBody?: boolean;
}

export function extractC(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const structureLines = cStructureLines(lines);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = isCBuildFile(file.relativePath) ? collectCBuildItems(lines, moduleName) : collectCItems(structureLines, moduleName);
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
    ...includeEdges(file.relativePath, moduleName, structureLines),
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName ? ("file_contains_symbol" as const) : ("symbol_contains_symbol" as const),
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => relatedNameEdges(item)),
    ...items.filter((item) => item.hasBody).flatMap((item) => callEdges(item, structureLines))
  ];

  return { file, symbols, chunks, edges };
}

function collectCItems(lines: string[], moduleName: string): CItem[] {
  const rawItems: CItem[] = [];
  let depth = 0;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trimEnd();
    const topLevel = depth === 0;

    const macro = macroForLine(line);
    if (macro) {
      rawItems.push({
        name: macro.name,
        qualifiedName: uniqueQualifiedName(rawItems, macro.name),
        kind: "typealias",
        startLine: index + 1,
        endLine: macroEndLine(lines, index),
        parentSymbolName: moduleName,
        relatedNames: macro.relatedNames
      });
      depth += braceDelta(line);
      continue;
    }

    if (topLevel) {
      const signature = backwardSignatureWindow(lines, index, line);
      const typedefFunction = typedefFunctionPointerForLine(signature);
      if (typedefFunction) {
        rawItems.push(item(typedefFunction, "typealias", index + 1, index + 1, moduleName, rawItems));
      } else {
        const aggregate = aggregateForLine(lines, index);
        if (aggregate) {
          rawItems.push(item(aggregate.name, "class", index + 1, aggregate.endLine, moduleName, rawItems, aggregate.relatedNames));
        }

        const alias = typedefAliasForLine(signature, aggregate?.name);
        if (alias && !rawItems.some((current) => current.startLine === index + 1 && current.name === alias)) {
          rawItems.push(item(alias, "typealias", index + 1, index + 1, moduleName, rawItems));
        }

        const declaration = isLikelyDeclarationStart(line) ? functionDeclarationForLine(signatureWindow(lines, index, line)) : undefined;
        if (declaration && !aggregate) {
          const endLine = declaration.hasBody ? endLineForBlock(lines, index) : index + 1;
          rawItems.push(item(declaration.name, "function", index + 1, endLine, moduleName, rawItems, undefined, declaration.hasBody));
        }
      }
    }

    depth += braceDelta(line);
  }

  return normalizeQualifiedNames(preferDefinitions(rawItems)).sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function collectCBuildItems(lines: string[], moduleName: string): CItem[] {
  const items: CItem[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    const cmake = cmakeDeclaration(line);
    if (cmake) {
      items.push(item(cmake.name, "method", index + 1, buildCallEndLine(lines, index), moduleName, items, cmake.relatedNames, false, cmake.qualifiedName));
      continue;
    }
    const meson = mesonDeclaration(line);
    if (meson) {
      items.push(item(meson.name, "method", index + 1, buildCallEndLine(lines, index), moduleName, items, meson.relatedNames, false, meson.qualifiedName));
      continue;
    }
    const makeTarget = makeTargetForLine(line);
    if (makeTarget) {
      items.push(item(makeTarget, "method", index + 1, index + 1, moduleName, items, buildRelatedNames(line), false, `make.target.${slugName(makeTarget)}`));
    }
  }
  return items;
}

function macroForLine(line: string): { name: string; relatedNames: string[] } | undefined {
  const match = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?/u.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    name: match[1],
    relatedNames: match[2] ? splitMacroArgs(match[2]) : []
  };
}

function aggregateForLine(lines: string[], index: number): { name: string; endLine: number; relatedNames: string[] } | undefined {
  const signature = backwardSignatureWindow(lines, index, lines[index]);
  const match = /^\s*(?:typedef\s+)?(?:struct|enum|union)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/u.exec(signature);
  if (!match || !signature.includes("{")) {
    return undefined;
  }
  const endLine = endLineForBlock(lines, index);
  const closingLine = lines[endLine - 1] ?? "";
  const alias = /\}\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/u.exec(closingLine)?.[1];
  const name = alias ?? match[1];
  if (!name) {
    return undefined;
  }
  return {
    name,
    endLine,
    relatedNames: aggregateFieldTypes(lines.slice(index, endLine).join("\n"))
  };
}

function typedefFunctionPointerForLine(line: string): string | undefined {
  return /^\s*typedef\b.*\(\s*\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*\(/u.exec(line)?.[1];
}

function typedefAliasForLine(line: string, aggregateName?: string): string | undefined {
  if (!/^\s*typedef\b/u.test(line) || typedefFunctionPointerForLine(line)) {
    return undefined;
  }
  const alias = /([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$/u.exec(line)?.[1];
  return alias && alias !== aggregateName ? alias : undefined;
}

function functionDeclarationForLine(line: string): { name: string; hasBody: boolean } | undefined {
  const trimmed = line.trim();
  if (!trimmed.includes("(") || trimmed.startsWith("#") || trimmed.startsWith("typedef ")) {
    return undefined;
  }
  if (!/[{;]\s*$/u.test(trimmed) && !trimmed.includes("{")) {
    return undefined;
  }
  const beforeParen = trimmed.slice(0, trimmed.indexOf("(")).trim();
  const name = /([A-Za-z_][A-Za-z0-9_]*)\s*$/u.exec(beforeParen)?.[1];
  if (!name || cDeclarationStopwords.has(name)) {
    return undefined;
  }
  if (!/[A-Za-z_][A-Za-z0-9_*\s]+\b[A-Za-z_][A-Za-z0-9_]*\s*\(/u.test(trimmed)) {
    return undefined;
  }
  return { name, hasBody: trimmed.includes("{") };
}

function isLikelyDeclarationStart(line: string): boolean {
  const trimmed = line.trim();
  return /^(?:[A-Za-z_][A-Za-z0-9_]*\s+|[*\s])*(?:[A-Za-z_][A-Za-z0-9_]*|\*)\s+\*?[A-Za-z_][A-Za-z0-9_]*\s*\(/u.test(trimmed);
}

function includeEdges(relativePath: string, moduleName: string, lines: string[]): CodeEdge[] {
  const imports = new Set<string>();
  for (const rawLine of lines) {
    const included = includeTarget(rawLine);
    if (included) {
      imports.add(included);
      if (!included.includes("/") && /^[A-Za-z0-9_.-]+\.h$/u.test(included)) {
        imports.add(path.posix.join(path.posix.dirname(relativePath), included));
      }
    }
  }
  companionHeaderSourceTargets(relativePath).forEach((target) => imports.add(target));
  return [...imports].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module",
    confidence: "name"
  }));
}

function includeTarget(line: string): string | undefined {
  const match = /^\s*#\s*include\s+(?:"([^"]+)"|<([^>]+)>)/u.exec(line);
  return match?.[1] ?? match?.[2];
}

function companionHeaderSourceTargets(relativePath: string): string[] {
  const extension = path.posix.extname(relativePath);
  if (extension !== ".c" && extension !== ".h") {
    return [];
  }
  const stem = relativePath.slice(0, -extension.length);
  return extension === ".c" ? [`${stem}.h`] : [`${stem}.c`];
}

function callEdges(item: CItem, lines: string[]): CodeEdge[] {
  const text = lines.slice(item.startLine - 1, item.endLine).join("\n");
  return calledNames(text, item.name).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function relatedNameEdges(item: CItem): CodeEdge[] {
  return (item.relatedNames ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string, selfName: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
    const name = match[1];
    if (name !== selfName && !cCallStopwords.has(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function aggregateFieldTypes(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/\b(?:struct|enum|union)\s+([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function cmakeDeclaration(line: string): { name: string; qualifiedName: string; relatedNames: string[] } | undefined {
  const match = /^\s*(add_library|add_executable|target_sources|target_link_libraries|target_include_directories|project)\s*\(\s*"?([A-Za-z0-9_.+-]+)"?/iu.exec(
    line
  );
  if (!match) {
    return undefined;
  }
  const kind = match[1].toLowerCase();
  const name = match[2];
  return {
    name,
    qualifiedName: `cmake.${kind}.${slugName(name)}`,
    relatedNames: buildRelatedNames(line)
  };
}

function mesonDeclaration(line: string): { name: string; qualifiedName: string; relatedNames: string[] } | undefined {
  const match = /^\s*(project|executable|library|static_library|shared_library|test)\s*\(\s*["']([^"']+)["']/u.exec(line);
  if (!match) {
    return undefined;
  }
  const kind = match[1];
  const name = match[2];
  return {
    name,
    qualifiedName: `meson.${kind}.${slugName(name)}`,
    relatedNames: buildRelatedNames(line)
  };
}

function makeTargetForLine(line: string): string | undefined {
  const match = /^([A-Za-z0-9_.\/+-]+)\s*:(?![=])/u.exec(line);
  if (!match || makeTargetStopwords.has(match[1])) {
    return undefined;
  }
  return match[1];
}

function buildRelatedNames(line: string): string[] {
  return uniqueValues([...line.matchAll(/[A-Za-z0-9_./+-]+\.(?:c|h|o|a|so)\b/gu)].map((match) => match[0]));
}

function item(
  name: string,
  kind: CItem["kind"],
  startLine: number,
  endLine: number,
  parentSymbolName: string,
  existing: CItem[],
  relatedNames?: string[],
  hasBody?: boolean,
  qualifiedName = name
): CItem {
  return {
    name,
    qualifiedName: uniqueQualifiedName(existing, qualifiedName),
    kind,
    startLine,
    endLine,
    parentSymbolName,
    relatedNames,
    hasBody
  };
}

function preferDefinitions(items: CItem[]): CItem[] {
  const definitionNames = new Set(items.filter((current) => current.kind === "function" && current.hasBody).map((current) => current.name));
  return items.filter((current) => current.kind !== "function" || current.hasBody || !definitionNames.has(current.name));
}

function normalizeQualifiedNames(items: CItem[]): CItem[] {
  const normalized: CItem[] = [];
  for (const current of items) {
    normalized.push({
      ...current,
      qualifiedName: uniqueQualifiedName(normalized, current.qualifiedName.replace(/#\d+$/u, ""))
    });
  }
  return normalized;
}

function uniqueQualifiedName(existing: CItem[], qualifiedName: string): string {
  if (!existing.some((current) => current.qualifiedName === qualifiedName)) {
    return qualifiedName;
  }
  let suffix = 2;
  while (existing.some((current) => current.qualifiedName === `${qualifiedName}#${suffix}`)) {
    suffix += 1;
  }
  return `${qualifiedName}#${suffix}`;
}

function signatureWindow(lines: string[], index: number, line: string): string {
  const parts = [line.trim()];
  for (let cursor = index + 1; cursor < lines.length && parts.join(" ").length < 600; cursor += 1) {
    const next = lines[cursor].trim();
    if (next === "" || next.startsWith("#")) {
      break;
    }
    parts.push(next);
    if (/[{;]\s*$/u.test(next) || next.includes("{")) {
      break;
    }
  }
  for (let cursor = index - 1; cursor >= 0 && parts.join(" ").length < 600; cursor -= 1) {
    const previous = lines[cursor].trim();
    if (previous === "" || previous.startsWith("#") || /[;}]\s*$/u.test(previous)) {
      break;
    }
    parts.unshift(previous);
    if (/^\s*(?:static|extern|inline|typedef|struct|enum|union|[A-Za-z_])/u.test(previous)) {
      break;
    }
  }
  return parts.join(" ").replace(/\s+/gu, " ");
}

function backwardSignatureWindow(lines: string[], index: number, line: string): string {
  const parts = [line.trim()];
  for (let cursor = index - 1; cursor >= 0 && parts.join(" ").length < 600; cursor -= 1) {
    const previous = lines[cursor].trim();
    if (previous === "" || previous.startsWith("#") || /[;}]\s*$/u.test(previous)) {
      break;
    }
    parts.unshift(previous);
    if (/^\s*(?:static|extern|inline|typedef|struct|enum|union|[A-Za-z_])/u.test(previous)) {
      break;
    }
  }
  return parts.join(" ").replace(/\s+/gu, " ");
}

function cStructureLines(lines: string[]): string[] {
  let inBlock = false;
  return lines.map((line) => {
    let output = "";
    for (let index = 0; index < line.length; index += 1) {
      if (inBlock) {
        if (line[index] === "*" && line[index + 1] === "/") {
          inBlock = false;
          index += 1;
        }
        output += " ";
        continue;
      }
      if (line[index] === "/" && line[index + 1] === "*") {
        inBlock = true;
        output += "  ";
        index += 1;
        continue;
      }
      if (line[index] === "/" && line[index + 1] === "/") {
        break;
      }
      output += line[index];
    }
    return output;
  });
}

function macroEndLine(lines: string[], startIndex: number): number {
  let index = startIndex;
  while (index + 1 < lines.length && /\\\s*$/u.test(lines[index])) {
    index += 1;
  }
  return index + 1;
}

function buildCallEndLine(lines: string[], startIndex: number): number {
  let depth = 0;
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 12); index += 1) {
    depth += countChar(lines[index], "(") - countChar(lines[index], ")");
    if (depth <= 0 && lines[index].includes(")")) {
      return index + 1;
    }
  }
  return startIndex + 1;
}

function endLineForBlock(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawOpenBrace = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
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

function splitMacroArgs(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isCBuildFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return basename === "CMakeLists.txt" || basename === "meson.build" || basename === "Makefile" || basename.endsWith(".mk");
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

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

const cDeclarationStopwords = new Set(["if", "for", "while", "switch", "return", "sizeof", "defined"]);
const cCallStopwords = new Set([...cDeclarationStopwords, "case", "do", "else", "typedef", "struct", "enum", "union"]);
const makeTargetStopwords = new Set([".PHONY", ".SUFFIXES", ".DEFAULT", ".PRECIOUS"]);
