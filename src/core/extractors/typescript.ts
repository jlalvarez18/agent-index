import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const typeScriptExtractor: LanguageExtractor = {
  language: "typescript",
  extensions: [".ts", ".tsx"],
  extract: extractTypeScript
};

interface TypeScriptItem {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
}

export function extractTypeScript(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = collectTypeScriptItems(lines, moduleName);
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
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: item.parentSymbolName === moduleName ? "file_contains_symbol" as const : "symbol_contains_symbol" as const,
      confidence: "exact" as const
    })),
    ...importEdges(moduleName, file.text),
    ...items.flatMap((item) => callEdges(item, lines))
  ];

  return { file, symbols, chunks, edges };
}

function collectTypeScriptItems(lines: string[], moduleName: string): TypeScriptItem[] {
  const items: TypeScriptItem[] = [];
  const classStack: Array<{ name: string; depth: number }> = [];
  let depth = 0;

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    while (classStack.length > 0 && depth < classStack[classStack.length - 1].depth) {
      classStack.pop();
    }

    const className = classNameForLine(line);
    if (className) {
      items.push({
        name: className,
        qualifiedName: className,
        kind: "class",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: moduleName
      });
      if (line.includes("{")) {
        classStack.push({ name: className, depth: depth + braceDelta(line) });
      }
    }

    const owner = classStack[classStack.length - 1]?.name;
    const functionName = owner ? methodNameForLine(line) : functionNameForLine(line);
    if (functionName && !className) {
      items.push({
        name: functionName,
        qualifiedName: owner ? `${owner}.${functionName}` : functionName,
        kind: owner ? "method" : "function",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: owner ?? moduleName
      });
    }

    depth += braceDelta(line);
  }

  return items;
}

function classNameForLine(line: string): string | undefined {
  return /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(line)?.[1];
}

function functionNameForLine(line: string): string | undefined {
  return (
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/u.exec(line)?.[1] ??
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:<[^>]+>\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/u.exec(line)?.[1] ??
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?function\b/u.exec(line)?.[1]
  );
}

function methodNameForLine(line: string): string | undefined {
  return /^\s*(?:public|private|protected|static|async|readonly|\s)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?::\s*[^={]+)?[{;]/u.exec(line)?.[1];
}

function importEdges(moduleName: string, text: string): CodeEdge[] {
  const modules = new Set<string>();
  for (const match of text.matchAll(/\bimport\b(?:[^'"]*\bfrom\s*)?["']([^"']+)["']/gu)) {
    modules.add(match[1]);
  }
  for (const match of text.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
    modules.add(match[1]);
  }
  return [...modules].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module",
    confidence: "name"
  }));
}

function callEdges(item: TypeScriptItem, lines: string[]): CodeEdge[] {
  return calledNames(lines.slice(item.startLine - 1, item.endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|\b)([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gu)) {
    const name = match[1];
    if (!typeScriptCallStopwords.has(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

const typeScriptCallStopwords = new Set(["if", "for", "while", "switch", "catch", "function", "return", "import", "require"]);

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
    if (!sawOpenBrace && line.trim().endsWith(";")) {
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

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}

function normalizedLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}
