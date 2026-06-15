import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const rustExtractor: LanguageExtractor = {
  language: "rust",
  extensions: [".rs"],
  extract: extractRust
};

interface RustItem {
  name: string;
  kind: "class" | "function" | "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
}

export function extractRust(file: SourceFile): ExtractionResult {
  const moduleName = file.relativePath;
  const lines = file.text.replace(/\r\n/g, "\n").split("\n");
  const moduleSymbol: CodeSymbol = {
    name: moduleName,
    qualifiedName: moduleName,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const symbols: CodeSymbol[] = [moduleSymbol];
  const chunks: CodeChunk[] = [chunkForLines(moduleName, lines, 1, moduleSymbol.endLine)];
  const edges: CodeEdge[] = [];

  const items = collectRustItems(lines, moduleName);
  for (const item of items) {
    const qualifiedName = item.kind === "method" ? `${item.parentSymbolName}.${item.name}` : item.name;
    symbols.push({
      name: item.name,
      qualifiedName,
      kind: item.kind,
      startLine: item.startLine,
      endLine: item.endLine,
      parentSymbolName: item.parentSymbolName
    });
    chunks.push(chunkForLines(qualifiedName, lines, item.startLine, item.endLine));
    edges.push({
      sourceSymbolName: item.parentSymbolName,
      targetName: qualifiedName,
      kind: item.parentSymbolName === moduleName ? "file_contains_symbol" : "symbol_contains_symbol",
      confidence: "exact"
    });
  }

  return { file, symbols, chunks, edges };
}

function collectRustItems(lines: string[], moduleName: string): RustItem[] {
  const items: RustItem[] = [];
  const implStack: Array<{ owner: string; depth: number }> = [];
  let depth = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = stripLineComment(lines[index]);
    while (implStack.length > 0 && depth < implStack[implStack.length - 1].depth) {
      implStack.pop();
    }

    const implOwner = implOwnerForLine(line);
    if (implOwner) {
      implStack.push({ owner: implOwner, depth: depth + braceDelta(line) });
    }

    const className = classNameForLine(line);
    if (className) {
      items.push({
        name: className,
        kind: "class",
        startLine: index + 1,
        endLine: endLineForBlock(lines, index),
        parentSymbolName: moduleName
      });
    }

    const functionName = functionNameForLine(line);
    if (functionName) {
      const owner = implStack[implStack.length - 1]?.owner;
      items.push({
        name: functionName,
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
  return /^(?:\s*pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(line)?.[1];
}

function implOwnerForLine(line: string): string | undefined {
  const match = /^\s*impl\b(.*?)(?:\{|$)/u.exec(line);
  if (!match) {
    return undefined;
  }

  let body = match[1].trim().replace(/^<[^>]+>\s*/u, "");
  if (body.includes(" for ")) {
    body = body.slice(body.lastIndexOf(" for ") + " for ".length).trim();
  }

  const owner = body.split(/\s+/)[0]?.split("::").pop()?.replace(/<.*$/u, "");
  return owner || undefined;
}

function functionNameForLine(line: string): string | undefined {
  return /^(?:\s*pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(line)?.[1];
}

function endLineForBlock(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawOpenBrace = false;
  for (let index = startIndex; index < lines.length; index++) {
    const deltaLine = stripLineComment(lines[index]);
    if (deltaLine.includes("{")) {
      sawOpenBrace = true;
    }
    depth += braceDelta(deltaLine);
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

function chunkForLines(symbolName: string, lines: string[], startLine: number, endLine: number): CodeChunk {
  return {
    symbolName,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}
