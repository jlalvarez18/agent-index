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
  const items = [...collectVersionCatalogItems(file, lines, moduleSymbol.qualifiedName), ...collectCargoItems(file, lines, moduleSymbol.qualifiedName)];
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

function collectCargoItems(file: SourceFile, lines: string[], moduleName: string): TomlItem[] {
  if (!file.relativePath.endsWith("Cargo.toml")) {
    return [];
  }

  const items: TomlItem[] = [];
  let section = "";
  let currentTarget: { kind: string; name?: string; path?: string; startLine: number; endLine: number } | undefined;

  const flushTarget = () => {
    if (!currentTarget?.name) {
      currentTarget = undefined;
      return;
    }
    items.push({
      name: currentTarget.name,
      qualifiedName: `cargo.${currentTarget.kind}.${slugName(currentTarget.name)}`,
      kind: "method",
      startLine: currentTarget.startLine,
      endLine: currentTarget.endLine,
      parentSymbolName: moduleName,
      relatedNames: uniqueValues([currentTarget.name, currentTarget.path].filter((name): name is string => Boolean(name)))
    });
    currentTarget = undefined;
  };

  for (const [index, rawLine] of lines.entries()) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    const arraySection = /^\[\[([A-Za-z0-9_.-]+)\]\]$/u.exec(line);
    if (arraySection) {
      flushTarget();
      section = arraySection[1];
      if (cargoTargetSections.has(section)) {
        currentTarget = { kind: section, startLine: index + 1, endLine: index + 1 };
      }
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(line);
    if (sectionMatch) {
      flushTarget();
      section = sectionMatch[1];
      continue;
    }

    const entry = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u.exec(line);
    if (!entry) {
      continue;
    }
    const key = entry[1];
    const value = entry[2];

    if (currentTarget) {
      currentTarget.endLine = index + 1;
      const stringValue = tomlStringValue(value);
      if (key === "name" && stringValue) {
        currentTarget.name = stringValue;
      }
      if (key === "path" && stringValue) {
        currentTarget.path = stringValue;
      }
      continue;
    }

    if (section === "package" && key === "name") {
      const packageName = tomlStringValue(value);
      if (packageName) {
        items.push({
          name: packageName,
          qualifiedName: `cargo.package.${slugName(packageName)}`,
          kind: "method",
          startLine: index + 1,
          endLine: index + 1,
          parentSymbolName: moduleName,
          relatedNames: [packageName]
        });
      }
      continue;
    }

    if (section === "features") {
      items.push({
        name: key,
        qualifiedName: `cargo.feature.${slugName(key)}`,
        kind: "method",
        startLine: index + 1,
        endLine: index + 1,
        parentSymbolName: moduleName,
        relatedNames: cargoRelatedNames(key, value)
      });
      continue;
    }

    const dependencyKind = cargoDependencySectionKind(section);
    if (dependencyKind) {
      items.push({
        name: key,
        qualifiedName: `cargo.${dependencyKind}.${slugName(key)}`,
        kind: "method",
        startLine: index + 1,
        endLine: index + 1,
        parentSymbolName: moduleName,
        relatedNames: cargoRelatedNames(key, value)
      });
    }
  }

  flushTarget();
  return items;
}

const cargoTargetSections = new Set(["bin", "test", "bench", "example"]);

function cargoDependencySectionKind(section: string): string | undefined {
  if (section === "dependencies") return "dependency";
  if (section === "dev-dependencies") return "dev_dependency";
  if (section === "build-dependencies") return "build_dependency";
  if (/^target\..+\.dependencies$/u.test(section)) return "dependency";
  if (/^target\..+\.dev-dependencies$/u.test(section)) return "dev_dependency";
  if (/^target\..+\.build-dependencies$/u.test(section)) return "build_dependency";
  return undefined;
}

function cargoRelatedNames(name: string, value: string): string[] {
  const names = new Set<string>([name]);
  for (const match of value.matchAll(/"([^"]+)"/gu)) {
    names.add(match[1]);
  }
  for (const match of value.matchAll(/\b(?:package|path|version|features?)\s*=\s*"([^"]+)"/gu)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function tomlStringValue(value: string): string | undefined {
  return /^"([^"]+)"/u.exec(value.trim())?.[1];
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

function uniqueValues<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
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
