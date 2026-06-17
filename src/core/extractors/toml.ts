import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const tomlExtractor: LanguageExtractor = {
  language: "toml",
  extensions: [".toml"],
  extract: extractToml
};

interface TomlItem {
  name: string;
  qualifiedName: string;
  kind: "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  relatedNames?: string[];
}

export function extractToml(file: SourceFile): ExtractionResult {
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: file.relativePath,
    qualifiedName: file.relativePath,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = collectVersionCatalogItems(file, lines, moduleSymbol.qualifiedName);
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
    chunkForLines(moduleSymbol.qualifiedName, lines, 1, moduleSymbol.endLine),
    ...items.map((item) => chunkForLines(item.qualifiedName, lines, item.startLine, item.endLine))
  ];
  const edges: CodeEdge[] = [
    ...items.map((item) => ({
      sourceSymbolName: item.parentSymbolName,
      targetName: item.qualifiedName,
      kind: "file_contains_symbol" as const,
      confidence: "exact" as const
    })),
    ...items.flatMap((item) => relatedNameEdges(item))
  ];
  return { file, symbols, chunks, edges };
}

function collectVersionCatalogItems(file: SourceFile, lines: string[], moduleName: string): TomlItem[] {
  if (!file.relativePath.endsWith("libs.versions.toml")) {
    return [];
  }
  const items: TomlItem[] = [];
  let section = "";
  for (const [index, rawLine] of lines.entries()) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const entry = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u.exec(line);
    if (!entry || !["versions", "libraries", "plugins", "bundles"].includes(section)) {
      continue;
    }
    const alias = entry[1];
    const value = entry[2];
    const kind = catalogSectionKind(section);
    items.push({
      name: alias,
      qualifiedName: `gradle.catalog.${kind}.${slugName(alias)}`,
      kind: "method",
      startLine: index + 1,
      endLine: index + 1,
      parentSymbolName: moduleName,
      relatedNames: catalogRelatedNames(alias, value)
    });
  }
  return items;
}

function catalogSectionKind(section: string): string {
  if (section === "versions") return "version";
  if (section === "libraries") return "library";
  if (section === "plugins") return "plugin";
  if (section === "bundles") return "bundle";
  return section;
}

function catalogRelatedNames(alias: string, value: string): string[] {
  const names = new Set<string>([alias]);
  for (const match of value.matchAll(/"([^"]+)"/gu)) {
    names.add(match[1]);
  }
  for (const match of value.matchAll(/\b(?:module|group|name|id|version\.ref)\s*=\s*"([^"]+)"/gu)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function relatedNameEdges(item: TomlItem): CodeEdge[] {
  return (item.relatedNames ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function stripTomlComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\"" && line[index - 1] !== "\\") {
      inString = !inString;
    }
    if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }
  return line;
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
