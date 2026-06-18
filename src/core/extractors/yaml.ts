import type { CodeChunk, CodeEdge, CodeSymbol, ExtractionResult, SourceFile } from "../schema.js";
import type { LanguageExtractor } from "./types.js";

export const yamlExtractor: LanguageExtractor = {
  language: "yaml",
  extensions: [".yaml", ".yml"],
  extract: extractYaml
};

interface YamlItem {
  name: string;
  qualifiedName: string;
  kind: "method";
  startLine: number;
  endLine: number;
  parentSymbolName: string;
  relatedNames: string[];
}

export function extractYaml(file: SourceFile): ExtractionResult {
  const lines = normalizedLines(file.text);
  const moduleSymbol: CodeSymbol = {
    name: file.relativePath,
    qualifiedName: file.relativePath,
    kind: "module",
    startLine: 1,
    endLine: Math.max(lines.length, 1)
  };
  const items = collectSymfonyServiceItems(file.relativePath, lines, moduleSymbol.qualifiedName);
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

function collectSymfonyServiceItems(relativePath: string, lines: string[], moduleName: string): YamlItem[] {
  if (!/(^|\/)services[^/]*\.ya?ml$/u.test(relativePath)) {
    return [];
  }
  const servicesLine = lines.findIndex((line) => /^\s*services\s*:\s*(?:#.*)?$/u.test(line));
  if (servicesLine === -1) {
    return [];
  }
  const servicesIndent = leadingSpaces(lines[servicesLine]);
  const itemIndent = yamlChildKeyIndent(lines, servicesLine, servicesIndent);
  if (itemIndent === undefined) {
    return [];
  }
  const items: YamlItem[] = [];
  for (let index = servicesLine + 1; index < lines.length; index++) {
    if (leadingSpaces(lines[index]) !== itemIndent) {
      continue;
    }
    const match = /^\s+(?!\s)(['"]?)([^'"#][^:]*?)\1\s*:\s*(.*)$/u.exec(lines[index]);
    if (!match) {
      continue;
    }
    const serviceId = match[2].trim();
    if (!isSymfonyServiceId(serviceId)) {
      continue;
    }
    const rest = stripYamlComment(match[3]).trim();
    const endLine = yamlBlockEndLine(lines, index, itemIndent);
    const blockText = lines.slice(index, endLine).join("\n");
    const isAlias = rest.startsWith("@") || /^['"]@/u.test(rest) || /^\s+alias\s*:/mu.test(blockText);
    const prefix = isAlias ? "service.alias" : "service";
    const name = `${prefix}.${serviceLeaf(serviceId)}`;
    items.push({
      name,
      qualifiedName: `${moduleName}::${name}`,
      kind: "method",
      startLine: index + 1,
      endLine,
      parentSymbolName: moduleName,
      relatedNames: yamlServiceRelatedNames(serviceId, blockText)
    });
  }
  return items.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));
}

function yamlChildKeyIndent(lines: string[], servicesLine: number, servicesIndent: number): number | undefined {
  let indent: number | undefined;
  for (let index = servicesLine + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || /^\s*#/u.test(line)) {
      continue;
    }
    const currentIndent = leadingSpaces(line);
    if (currentIndent <= servicesIndent) {
      break;
    }
    if (/^\s+['"]?[^'"#][^:]*?['"]?\s*:/u.test(line)) {
      indent = indent === undefined ? currentIndent : Math.min(indent, currentIndent);
    }
  }
  return indent;
}

function yamlBlockEndLine(lines: string[], startIndex: number, itemIndent: number): number {
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (leadingSpaces(lines[index]) === itemIndent && /^\s+['"]?[^'"#][^:]*?['"]?\s*:/u.test(lines[index])) {
      return index;
    }
  }
  return lines.length;
}

function leadingSpaces(line: string): number {
  return /^ */u.exec(line)?.[0].length ?? 0;
}

function yamlServiceRelatedNames(serviceId: string, blockText: string): string[] {
  const names = new Set<string>([serviceId, serviceLeaf(serviceId)]);
  for (const match of blockText.matchAll(/@([A-Za-z_][A-Za-z0-9_\\.]*)/gu)) {
    names.add(match[1]);
  }
  for (const match of blockText.matchAll(/\b(App\\[A-Za-z0-9_\\]+|[A-Za-z_][A-Za-z0-9_]*\\[A-Za-z0-9_\\]+)\b/gu)) {
    names.add(match[1]);
    names.add(serviceLeaf(match[1]));
  }
  for (const match of blockText.matchAll(/\b(?:name|command)\s*:\s*['"]?([^'",}\]\s#]+)['"]?/gu)) {
    names.add(match[1]);
  }
  for (const match of blockText.matchAll(/\balias\s*:\s*['"]?([^'",}\]\s#]+)['"]?/gu)) {
    names.add(match[1]);
    names.add(serviceLeaf(match[1]));
  }
  for (const match of blockText.matchAll(/!tagged_(?:iterator|locator)\s+([A-Za-z0-9_.:-]+)/gu)) {
    names.add("tagged_iterator");
    names.add(match[1]);
  }
  for (const match of blockText.matchAll(/^\s*-\s*([A-Za-z0-9_.:-]+)\s*$/gmu)) {
    names.add(match[1]);
  }
  for (const match of blockText.matchAll(/['"]([A-Za-z0-9_.:-]+)['"]/gu)) {
    if (match[1].includes(".") || match[1].includes(":")) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function isSymfonyServiceId(value: string): boolean {
  return Boolean(value) && !value.endsWith("\\") && !value.startsWith("_") && !/^\d/u.test(value);
}

function serviceLeaf(value: string): string {
  const parts = value.replace(/^@/u, "").split("\\");
  return parts[parts.length - 1] || value;
}

function stripYamlComment(value: string): string {
  return value.replace(/\s+#.*$/u, "");
}

function relatedNameEdges(item: YamlItem): CodeEdge[] {
  return [...new Set(item.relatedNames)].map((targetName) => ({
    sourceSymbolName: item.qualifiedName,
    targetName,
    kind: "symbol_calls_name",
    confidence: "name"
  }));
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
