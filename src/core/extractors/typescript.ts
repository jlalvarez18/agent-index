import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const typeScriptExtractor: LanguageExtractor = {
  language: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
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
  const items = collectTypeScriptItems(lines, moduleName, file.role === "test");
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

function collectTypeScriptItems(lines: string[], moduleName: string, isTestFile: boolean): TypeScriptItem[] {
  const items: TypeScriptItem[] = [];
  const classStack: Array<{ name: string; depth: number }> = [];
  const objectStack: Array<{ name: string; depth: number }> = [];
  let depth = 0;

  for (const [index, rawLine] of lines.entries()) {
    const line = stripLineComment(rawLine);
    const signatureLine = signatureWindow(lines, index, line);
    while (classStack.length > 0 && depth < classStack[classStack.length - 1].depth) {
      classStack.pop();
    }
    while (objectStack.length > 0 && depth < objectStack[objectStack.length - 1].depth) {
      objectStack.pop();
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

    const objectName = objectNameForLine(line);
    if (!className && objectName && line.includes("{")) {
      items.push({
        name: objectName,
        qualifiedName: objectName,
        kind: "class",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: moduleName
      });
      objectStack.push({ name: objectName, depth: depth + braceDelta(line) });
    }

    const owner = classStack[classStack.length - 1]?.name;
    const objectOwner = owner ? undefined : objectStack[objectStack.length - 1]?.name;
    const prototypeAssignment = owner || objectOwner ? undefined : prototypeMethodForLine(signatureLine);
    const functionName = owner
      ? methodNameForLine(signatureLine)
      : objectOwner
        ? objectMethodNameForLine(signatureLine)
        : prototypeAssignment?.methodName ?? functionNameForLine(signatureLine);
    const testCaseName = functionName || owner || objectOwner || prototypeAssignment || !isTestFile ? undefined : testCaseNameForLine(signatureLine);
    if (functionName && !className) {
      items.push({
        name: functionName,
        qualifiedName: owner
          ? `${owner}.${functionName}`
          : objectOwner
            ? `${objectOwner}.${functionName}`
            : prototypeAssignment
              ? `${prototypeAssignment.owner}.${prototypeAssignment.methodName}`
              : functionName,
        kind: owner || objectOwner || prototypeAssignment ? "method" : "function",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: owner ?? objectOwner ?? prototypeAssignment?.owner ?? moduleName
      });
    }
    if (testCaseName && !className) {
      items.push({
        name: testCaseName,
        qualifiedName: testCaseName,
        kind: "function",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: moduleName
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
  return firstMatch([
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>{}]+>)?\s*\(/u.exec(line)?.[1],
    /^\s*export\s+default\s+(?:async\s+)?function\s*\(/u.test(line) ? "default" : undefined,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s*)?(?:<[^>{}]+>\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=>/u.exec(line)?.[1],
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s+)?function\b/u.exec(line)?.[1],
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:React\.)?(?:memo|forwardRef|useCallback|useMemo)\s*\(/u.exec(line)?.[1],
    /^\s*export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=\s*(?:\/\*.*?\*\/\s*)*[A-Za-z_$][A-Za-z0-9_$]*\s*\(/u.exec(line)?.[1],
    /^\s*export\s+default\s+(?:async\s*)?(?:<[^>{}]+>\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=>/u.test(line)
      ? "default"
      : undefined,
    /^\s*export\s+default\s+(?:defineConfig|createConfig|withConfig|memo|forwardRef)\s*\(/u.test(line) ? "default" : undefined,
    /^\s*(?:module\.)?exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/u.exec(line)?.[1],
    /^\s*module\.exports\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/u.test(line)
      ? "default"
      : undefined
  ]);
}

function methodNameForLine(line: string): string | undefined {
  return (
    /^\s*(?:public|private|protected|static|async|readonly|override|abstract|accessor|get|set|\s)*([#A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>{}]+>)?\s*\([^)]*\)\s*(?::\s*[^={]+)?[{;]/u.exec(line)?.[1]?.replace(/^#/u, "") ??
    /^\s*(?:public|private|protected|static|readonly|override|\s)*([#A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s*)?(?:<[^>{}]+>\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=>/u.exec(line)?.[1]?.replace(/^#/u, "")
  );
}

function objectNameForLine(line: string): string | undefined {
  return /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{/u.exec(line)?.[1];
}

function objectMethodNameForLine(line: string): string | undefined {
  return (
    /^\s*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>{}]+>)?\s*\([^)]*\)\s*(?::\s*[^={]+)?\{/u.exec(line)?.[1] ??
    /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:async\s*)?(?:function\b|(?:<[^>{}]+>\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>|(?:<[^>{}]+>\s*)?[A-Za-z_$][A-Za-z0-9_$]*\s*(?::\s*[^=]+)?=>)/u.exec(line)?.[1]
  );
}

function prototypeMethodForLine(line: string): { owner: string; methodName: string } | undefined {
  const match = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\.prototype\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/u.exec(
    line
  );
  return match ? { owner: match[1], methodName: match[2] } : undefined;
}

function testCaseNameForLine(line: string): string | undefined {
  const match = /^\s*(?:test|it)(?:\.(?:only|skip|todo|concurrent|each\s*\([^)]*\)))?(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(["'`])([^"'`]+)\1/u.exec(
    line
  );
  if (!match) {
    return undefined;
  }
  const name = match[2]
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_");
  return name ? `test_${name}` : undefined;
}

function firstMatch(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}

function signatureWindow(lines: string[], index: number, line: string): string {
  if (!canStartTypeScriptItem(line)) {
    return line;
  }
  return stripLineComment(lines.slice(index, index + 4).join(" "));
}

function canStartTypeScriptItem(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "}" || trimmed === "};" || trimmed.startsWith("return ")) {
    return false;
  }
  return (
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b/u.test(trimmed) ||
    /^(?:export\s+)?(?:const|let|var)\b/u.test(trimmed) ||
    /^(?:module\.)?exports(?:\.|\s*=)/u.test(trimmed) ||
    /^(?:test|it)(?:\.(?:only|skip|todo|concurrent|each\b))?\s*\(/u.test(trimmed) ||
    /^[A-Za-z_$#][A-Za-z0-9_$#]*(?:\s*[:=(<]|\s*$)/u.test(trimmed) ||
    /^(?:public|private|protected|static|async|readonly|override|abstract|accessor|get|set)\b/u.test(trimmed)
  );
}

function importEdges(moduleName: string, text: string): CodeEdge[] {
  const modules = new Set<string>();
  for (const match of text.matchAll(/\bimport\b(?:[^'"]*\bfrom\s*)?["']([^"']+)["']/gu)) {
    modules.add(match[1]);
  }
  for (const match of text.matchAll(/\bexport\b[^'"]*\bfrom\s*["']([^"']+)["']/gu)) {
    modules.add(match[1]);
  }
  for (const match of text.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
    modules.add(match[1]);
  }
  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
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
