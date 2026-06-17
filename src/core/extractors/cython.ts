import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

interface ParsedSymbol {
  name: string;
  qualifiedName: string;
  kind: CodeSymbol["kind"];
  startLine: number;
  indent: number;
  parentSymbolName: string;
  bases?: string[];
}

export const cythonExtractor: LanguageExtractor = {
  language: "cython",
  extensions: [".pyx", ".pxd", ".pxi", ".pyx.tp", ".pxd.tp", ".pxi.tp", ".pyx.in", ".pxd.in", ".pxi.in"],
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
    ...importEdges(lines, moduleName),
    ...parsed.map((symbol) => ({
      sourceSymbolName: symbol.parentSymbolName,
      targetName: symbol.qualifiedName,
      kind: symbol.parentSymbolName === moduleName ? "file_contains_symbol" as const : "symbol_contains_symbol" as const,
      confidence: "exact" as const
    })),
    ...parsed.flatMap((symbol) =>
      (symbol.bases ?? []).map((base) => ({
        sourceSymbolName: symbol.qualifiedName,
        targetName: base,
        kind: "symbol_conforms_to" as const,
        confidence: "name" as const
      }))
    ),
    ...parsed.flatMap((symbol) => callEdges(symbol, lines, endLineForSymbol(symbol, parsed, lines.length)))
  ];

  return { file, symbols, chunks, edges };
}

function parseSymbols(lines: string[], moduleName: string): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  const classStack: ParsedSymbol[] = [];

  for (const [index, line] of lines.entries()) {
    const classMatch = classDeclaration(line);
    const functionMatch = functionDeclaration(line);
    const declarationMatch = declarationSymbol(line);
    const match = classMatch ?? functionMatch ?? declarationMatch;
    if (!match || isCommentOnly(line)) {
      continue;
    }

    const indent = match.indent;
    while (classStack.length > 0 && indent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }

    if (classMatch) {
      const name = classMatch.name;
      const symbol: ParsedSymbol = {
        name,
        qualifiedName: name,
        kind: "class",
        startLine: index + 1,
        indent,
        parentSymbolName: moduleName,
        bases: classMatch.bases
      };
      symbols.push(symbol);
      classStack.push(symbol);
      continue;
    }

    const name = match.name;
    const parentClass = classStack[classStack.length - 1];
    symbols.push({
      name,
      qualifiedName: parentClass ? `${parentClass.name}.${name}` : name,
      kind: functionMatch ? (parentClass ? "method" : "function") : "typealias",
      startLine: index + 1,
      indent,
      parentSymbolName: parentClass?.name ?? moduleName
    });
  }

  return symbols;
}

interface ParsedDeclaration {
  name: string;
  indent: number;
  bases?: string[];
}

function classDeclaration(line: string): ParsedDeclaration | undefined {
  const match = line.match(/^(\s*)cdef\s+(?:public\s+|api\s+)?class\s+([A-Za-z_][A-Za-z0-9_{}]*)(?:\(([^)]*)\))?/u);
  if (!match) {
    return undefined;
  }
  return {
    indent: match[1].length,
    name: cleanTemplateName(match[2]),
    bases: splitBaseNames(match[3] ?? "")
  };
}

function functionDeclaration(line: string): ParsedDeclaration | undefined {
  const pythonDef = line.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/u);
  if (pythonDef) {
    return { indent: pythonDef[1].length, name: pythonDef[2] };
  }

  if (/^\s*cdef\s+(?:class|enum|extern|struct|union)\b/u.test(line)) {
    return undefined;
  }

  const cdef = line.match(/^(\s*)(?:cdef|cpdef)\b([^(]*)\(/u);
  if (!cdef) {
    return undefined;
  }
  const nameMatch = cdef[2].match(/([A-Za-z_][A-Za-z0-9_{}]*)\s*$/u);
  if (!nameMatch || cythonDeclarationModifiers.has(nameMatch[1])) {
    return undefined;
  }
  return { indent: cdef[1].length, name: cleanTemplateName(nameMatch[1]) };
}

function declarationSymbol(line: string): ParsedDeclaration | undefined {
  const typedef = ctypedefDeclaration(line);
  if (typedef) {
    return typedef;
  }

  const enumOrStruct = line.match(/^(\s*)(?:cdef|cpdef)\s+(?:packed\s+)?(?:enum|struct|union)\s+([A-Za-z_][A-Za-z0-9_{}]*)\b/u);
  if (enumOrStruct) {
    return { indent: enumOrStruct[1].length, name: cleanTemplateName(enumOrStruct[2]) };
  }

  const variable = line.match(/^(\s*)cdef\s+(?!class\b|enum\b|extern\b|struct\b|union\b)(?:public\s+|readonly\s+|api\s+)?[^#=()]+\s+([A-Z][A-Za-z0-9_{}]*)\s*(?:=|$)/u);
  if (variable) {
    return { indent: variable[1].length, name: cleanTemplateName(variable[2]) };
  }

  return undefined;
}

function ctypedefDeclaration(line: string): ParsedDeclaration | undefined {
  const typedef = line.match(/^(\s*)ctypedef\s+(.+)$/u);
  if (!typedef) {
    return undefined;
  }

  const body = typedef[2].replace(/#.*$/u, "").trim();
  const functionPointer = body.match(/\(\s*\*\s*([A-Za-z_][A-Za-z0-9_{}]*)\s*\)/u);
  if (functionPointer) {
    return { indent: typedef[1].length, name: cleanTemplateName(functionPointer[1]) };
  }

  const namedType = body.match(/^(?:fused|class|(?:packed\s+)?(?:struct|enum|union))\s+([A-Za-z_][A-Za-z0-9_{}]*)\b/u);
  if (namedType) {
    return { indent: typedef[1].length, name: cleanTemplateName(namedType[1]) };
  }

  const aliasBody = body
    .replace(/"[^"]*"\s*$/u, "")
    .replace(/:\s*$/u, "")
    .trim();
  const alias = aliasBody.match(/([A-Za-z_][A-Za-z0-9_{}]*)\s*$/u);
  return alias ? { indent: typedef[1].length, name: cleanTemplateName(alias[1]) } : undefined;
}

function splitBaseNames(text: string): string[] {
  return text
    .split(",")
    .map((base) => cleanTemplateName(base.trim().replace(/\[.*$/u, "").replace(/\(.*$/u, "")))
    .map((base) => (base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : base))
    .filter((base) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(base))
    .filter((base, index, bases) => bases.indexOf(base) === index);
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
  return calledNames(lines.slice(symbol.startLine - 1, endLine).join("\n"), symbol.name).map((targetName) => ({
    sourceSymbolName: symbol.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function calledNames(text: string, selfName: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.|\b)([A-Za-z_][A-Za-z0-9_{}]*)\s*\(/gu)) {
    const name = cleanTemplateName(match[1]);
    if (!cythonCallStopwords.has(name) && name !== selfName) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function importEdges(lines: string[], moduleName: string): CodeEdge[] {
  const imports = new Set<string>();
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith("#")) {
      continue;
    }
    const fromImport = stripped.match(/^from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(?:cimport|import)\b/u);
    if (fromImport) {
      imports.add(fromImport[1]);
      continue;
    }
    const cimport = stripped.match(/^cimport\s+([A-Za-z_][A-Za-z0-9_.]*)/u);
    if (cimport) {
      imports.add(cimport[1]);
      continue;
    }
    const plainImport = stripped.match(/^import\s+([A-Za-z_][A-Za-z0-9_.]*)/u);
    if (plainImport) {
      imports.add(plainImport[1]);
    }
  }
  return [...imports].sort().map((targetName) => ({
    sourceSymbolName: moduleName,
    targetName,
    kind: "symbol_imports_module" as const,
    confidence: "name" as const
  }));
}

const cythonCallStopwords = new Set(["cdef", "cpdef", "def", "if", "for", "while", "with", "return", "sizeof"]);
const cythonDeclarationModifiers = new Set(["api", "except", "inline", "nogil", "noexcept", "public", "readonly"]);

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

function isCommentOnly(line: string): boolean {
  return line.trimStart().startsWith("#");
}

function normalizedLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}
