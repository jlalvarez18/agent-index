import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const xmlExtractor: LanguageExtractor = {
  language: "xml",
  extensions: [".xml"],
  extract: extractXml
};

interface XmlItem {
  name: string;
  qualifiedName: string;
  kind: "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  relatedNames?: string[];
}

export function extractXml(file: SourceFile): ExtractionResult {
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: file.relativePath,
    qualifiedName: file.relativePath,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = collectMavenPomItems(file, lines, moduleSymbol.qualifiedName);
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

function collectMavenPomItems(file: SourceFile, lines: string[], moduleName: string): XmlItem[] {
  if (!file.relativePath.endsWith("pom.xml")) {
    return [];
  }
  const items: XmlItem[] = [];
  const text = lines.join("\n");
  const projectHeader = mavenProjectHeaderText(lines);
  const artifactId = firstTagValue(projectHeader, "artifactId") ?? firstTagValue(text, "artifactId");
  if (artifactId) {
    items.push({
      name: artifactId,
      qualifiedName: `maven.project.${slugName(artifactId)}`,
      kind: "method",
      startLine: tagLine(lines, "artifactId", artifactId),
      endLine: tagLine(lines, "artifactId", artifactId),
      parentSymbolName: moduleName,
      relatedNames: [artifactId, firstTagValue(projectHeader, "groupId") ?? firstTagValue(text, "groupId") ?? ""].filter(Boolean)
    });
  }

  for (const dependency of blockItems(lines, "dependency")) {
    const coords = mavenCoordinates(dependency.text);
    if (!coords.artifactId) {
      continue;
    }
    const name = [coords.groupId, coords.artifactId].filter(Boolean).join(":");
    items.push({
      name,
      qualifiedName: `maven.dependency.${slugName(name)}`,
      kind: "method",
      startLine: dependency.startLine,
      endLine: dependency.endLine,
      parentSymbolName: moduleName,
      relatedNames: compactStrings([coords.groupId, coords.artifactId, coords.version])
    });
  }

  for (const plugin of blockItems(lines, "plugin")) {
    const coords = mavenCoordinates(plugin.text);
    if (!coords.artifactId) {
      continue;
    }
    const name = [coords.groupId, coords.artifactId].filter(Boolean).join(":");
    items.push({
      name,
      qualifiedName: `maven.plugin.${slugName(name)}`,
      kind: "method",
      startLine: plugin.startLine,
      endLine: plugin.endLine,
      parentSymbolName: moduleName,
      relatedNames: compactStrings([coords.groupId, coords.artifactId, coords.version])
    });
  }

  for (const moduleEntry of tagValues(text, "module")) {
    items.push({
      name: moduleEntry.value,
      qualifiedName: `maven.module.${slugName(moduleEntry.value)}`,
      kind: "method",
      startLine: tagLine(lines, "module", moduleEntry.value),
      endLine: tagLine(lines, "module", moduleEntry.value),
      parentSymbolName: moduleName,
      relatedNames: [moduleEntry.value]
    });
  }

  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function mavenProjectHeaderText(lines: string[]): string {
  const headerLines: string[] = [];
  let skippingParent = false;
  for (const line of lines) {
    if (/<(?:dependencies|dependencyManagement|build|modules|profiles|properties|repositories|pluginRepositories)\b/u.test(line)) {
      break;
    }
    if (/<parent\b/u.test(line)) {
      skippingParent = true;
      continue;
    }
    if (skippingParent) {
      if (/<\/parent>/u.test(line)) {
        skippingParent = false;
      }
      continue;
    }
    headerLines.push(line);
  }
  return headerLines.join("\n");
}

function blockItems(lines: string[], tag: string): Array<{ text: string; startLine: number; endLine: number }> {
  const blocks: Array<{ text: string; startLine: number; endLine: number }> = [];
  const startPattern = new RegExp(`<${tag}\\b[^>]*>`, "u");
  const endPattern = new RegExp(`</${tag}>`, "u");
  for (let index = 0; index < lines.length; index++) {
    if (!startPattern.test(lines[index])) {
      continue;
    }
    for (let cursor = index; cursor < lines.length; cursor++) {
      if (endPattern.test(lines[cursor])) {
        blocks.push({ text: lines.slice(index, cursor + 1).join("\n"), startLine: index + 1, endLine: cursor + 1 });
        index = cursor;
        break;
      }
    }
  }
  return blocks;
}

function mavenCoordinates(text: string): { groupId?: string; artifactId?: string; version?: string } {
  return {
    groupId: firstTagValue(text, "groupId"),
    artifactId: firstTagValue(text, "artifactId"),
    version: firstTagValue(text, "version")
  };
}

function compactStrings(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function relatedNameEdges(item: XmlItem): CodeEdge[] {
  return (item.relatedNames ?? []).map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
}

function firstTagValue(text: string, tag: string): string | undefined {
  return tagValues(text, tag)[0]?.value;
}

function tagValues(text: string, tag: string): Array<{ value: string }> {
  const pattern = new RegExp(`<${tag}\\b[^>]*>\\s*([^<]+?)\\s*</${tag}>`, "gu");
  return [...text.matchAll(pattern)].map((match) => ({ value: match[1].trim() }));
}

function tagLine(lines: string[], tag: string, value: string): number {
  const pattern = new RegExp(`<${tag}\\b[^>]*>\\s*${escapeRegExp(value)}\\s*</${tag}>`, "u");
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
