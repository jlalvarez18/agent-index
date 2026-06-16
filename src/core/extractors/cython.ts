import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

interface ParsedSymbol {
  name: string;
  qualifiedName: string;
  kind: CodeSymbol["kind"];
  startLine: number;
  indent: number;
  parentSymbolName: string;
}

export const cythonExtractor: LanguageExtractor = {
  language: "cython",
  extensions: [".pyx", ".pxd", ".pxi", ".pyx.tp", ".pxd.tp", ".pxi.tp"],
  extract: extractCython
};

export function extractCython(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const parsed = parseSymbols(lines, moduleName);
  const symbols: CodeSymbol[] = [
    moduleSymbol,
    ...parsed.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      startLine: symbol.startLine,
      endLine: endLineForSymbol(symbol, parsed, lines.length),
      parentSymbolName: symbol.parentSymbolName
    }))
  ];
  const chunks: CodeChunk[] = [
    chunkForLines(moduleName, lines, 1, moduleSymbol.endLine),
    ...symbols.slice(1).map((symbol) => chunkForLines(symbol.qualifiedName, lines, symbol.startLine, symbol.endLine))
  ];
  const edges: CodeEdge[] = [
    ...parsed.map((symbol) => ({
      sourceSymbolName: symbol.parentSymbolName,
      targetName: symbol.qualifiedName,
      kind: symbol.parentSymbolName === moduleName ? "file_contains_symbol" as const : "symbol_contains_symbol" as const,
      confidence: "exact" as const
    })),
    ...parsed.flatMap((symbol) => callEdges(symbol, lines, endLineForSymbol(symbol, parsed, lines.length)))
  ];

  return { file, symbols, chunks, edges };
}

function parseSymbols(lines: string[], moduleName: string): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  const classStack: ParsedSymbol[] = [];

  for (const [index, line] of lines.entries()) {
    const classMatch = line.match(/^(\s*)cdef\s+class\s+([A-Za-z_][A-Za-z0-9_{}]*)/u);
    const functionMatch = line.match(/^(\s*)(?:async\s+)?(?:(?:cdef|cpdef)\s+(?:(?:inline|public|api|void|object|bint|int|float|double|long|unsigned|char|size_t|Py_ssize_t|[A-Za-z_][A-Za-z0-9_{}]*)\s+)*)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/u);
    const cdefFunctionMatch = line.match(/^(\s*)(?:cdef|cpdef)\s+(?:(?:inline|public|api|void|object|bint|int|float|double|long|unsigned|char|size_t|Py_ssize_t|[A-Za-z_][A-Za-z0-9_{}]*)\s+)*([A-Za-z_][A-Za-z0-9_]*)\s*\(/u);
    const match = classMatch ?? functionMatch ?? cdefFunctionMatch;
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    while (classStack.length > 0 && indent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }

    if (classMatch) {
      const name = cleanTemplateName(classMatch[2]);
      const symbol: ParsedSymbol = {
        name,
        qualifiedName: name,
        kind: "class",
        startLine: index + 1,
        indent,
        parentSymbolName: moduleName
      };
      symbols.push(symbol);
      classStack.push(symbol);
      continue;
    }

    const name = match[2];
    const parentClass = classStack[classStack.length - 1];
    symbols.push({
      name,
      qualifiedName: parentClass ? `${parentClass.name}.${name}` : name,
      kind: parentClass ? "method" : "function",
      startLine: index + 1,
      indent,
      parentSymbolName: parentClass?.name ?? moduleName
    });
  }

  return symbols;
}

function endLineForSymbol(symbol: ParsedSymbol | CodeSymbol, symbols: ParsedSymbol[], lineCount: number): number {
  const parsedSymbol = "indent" in symbol ? symbol : symbols.find((candidate) => candidate.qualifiedName === symbol.qualifiedName);
  if (!parsedSymbol) {
    return "endLine" in symbol ? symbol.endLine : lineCount;
  }
  const next = symbols.find((candidate) => candidate.startLine > parsedSymbol.startLine && candidate.indent <= parsedSymbol.indent);
  return next ? next.startLine - 1 : lineCount;
}

function callEdges(symbol: ParsedSymbol, lines: string[], endLine: number): CodeEdge[] {
  return calledNames(lines.slice(symbol.startLine - 1, endLine).join("\n")).map((targetName) => ({
    sourceSymbolName: symbol.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|\b)([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
    const name = match[1];
    if (!cythonCallStopwords.has(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

const cythonCallStopwords = new Set(["cdef", "cpdef", "def", "if", "for", "while", "with", "return"]);

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}

function cleanTemplateName(name: string): string {
  return name.replace(/\{\{.*?\}\}/gu, "");
}

function normalizedLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}
