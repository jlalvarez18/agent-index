import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const goExtractor: LanguageExtractor = {
  language: "go",
  extensions: [".go"],
  extract: extractGo
};

interface GoItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
}

export function extractGo(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = collectGoItems(lines, moduleName);
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
    ...items.flatMap((item) => callEdges(item, lines))
  ];

  return { file, symbols, chunks, edges };
}

function collectGoItems(lines: string[], moduleName: string): GoItem[] {
  const items: GoItem[] = [];
  const functionItems: GoItem[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const typeName = typeNameForLine(line);
    if (typeName) {
      items.push({
        name: typeName,
        qualifiedName: typeName,
        kind: "class",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: moduleName
      });
      continue;
    }

    const fn = functionForLine(line);
    if (fn) {
      const qualifiedName = fn.receiver ? `${fn.receiver}.${fn.name}` : fn.name;
      const item: GoItem = {
        name: fn.name,
        qualifiedName,
        kind: fn.receiver ? "method" : "function",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: fn.receiver ?? moduleName
      };
      items.push(item);
      functionItems.push(item);
    }
  }

  for (const item of functionItems.filter((fn) => fn.name.startsWith("Test"))) {
    for (const subtest of subtestItems(item, lines)) {
      items.push(subtest);
    }
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function typeNameForLine(line: string): string | undefined {
  return /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:interface|struct)\b/u.exec(line)?.[1];
}

function functionForLine(line: string): { name: string; receiver?: string } | undefined {
  const method = /^\s*func\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*?([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(
    line
  );
  if (method) {
    return { receiver: method[1], name: method[2] };
  }

  const fn = /^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(line);
  return fn ? { name: fn[1] } : undefined;
}

function subtestItems(parent: GoItem, lines: string[]): GoItem[] {
  const text = lines.slice(parent.startLine - 1, parent.endLine).join("\n");
  const names = new Set<string>();
  for (const match of text.matchAll(/\bt\.Run\s*\(\s*(["'`])([^"'`]+)\1/gu)) {
    names.add(match[2]);
  }
  for (const match of text.matchAll(/\bname\s*:\s*(["'`])([^"'`]+)\1/gu)) {
    names.add(match[2]);
  }

  return [...names].map((name) => {
    const symbolName = `subtest_${slugName(name)}`;
    return {
      name: symbolName,
      qualifiedName: `${parent.qualifiedName}.${symbolName}`,
      kind: "function" as const,
      startLine: parent.startLine,
      endLine: parent.endLine,
      parentSymbolName: parent.qualifiedName
    };
  });
}

function importEdges(moduleName: string, lines: string[]): CodeEdge[] {
  const imports = new Set<string>();
  let inBlock = false;

  for (const rawLine of lines) {
    const line = stripLineComment(rawLine).trim();
    if (/^import\s*\(/u.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    const imported = importedPath(line, inBlock);
    if (imported) {
      imports.add(imported);
    }
  }

  return [...imports].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module",
    confidence: "name"
  }));
}

function importedPath(line: string, inBlock: boolean): string | undefined {
  const match = (inBlock ? /^(?:[._A-Za-z][A-Za-z0-9_]*\s+)?["`]([^"`]+)["`]/u : /^import\s+(?:[._A-Za-z][A-Za-z0-9_]*\s+)?["`]([^"`]+)["`]/u).exec(
    line
  );
  return match?.[1];
}

function callEdges(item: GoItem, lines: string[]): CodeEdge[] {
  const text = lines.slice(item.startLine - 1, item.endLine).join("\n");
  return calledNames(text).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|\b)([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
    const name = match[1];
    if (!goCallStopwords.has(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

const goCallStopwords = new Set(["if", "for", "switch", "select", "return", "func", "go", "defer"]);

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

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/u, "");
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
