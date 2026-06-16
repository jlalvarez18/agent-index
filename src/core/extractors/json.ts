import type { CodeChunk, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const jsonExtractor: LanguageExtractor = {
  language: "json",
  extensions: [".json"],
  extract: extractJson
};

export function extractJson(file: SourceFile): ExtractionResult {
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: file.relativePath,
    qualifiedName: file.relativePath,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const moduleChunk: CodeChunk = {
    symbolName: moduleSymbol.qualifiedName,
    startLine: moduleSymbol.startLine,
    endLine: moduleSymbol.endLine,
    text: file.text
  };

  return {
    file,
    symbols: [moduleSymbol],
    chunks: [moduleChunk],
    edges: []
  };
}

function normalizedLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}
