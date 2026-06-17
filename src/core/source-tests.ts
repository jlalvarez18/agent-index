import type { AgentQuery, FileClusterMatch, SourceTestBundle, SourceTestsResult } from "./schema.js";
import { findFileClusters } from "./file-clusters.js";
import { findRelatedTestsBatch } from "./related-tests.js";

export interface SourceTestsOptions {
  target: string;
  indexPath?: string;
  limit?: number;
  testLimit?: number;
  testFanoutLimit?: number;
}

export function findSourceTests(agentQuery: AgentQuery, options: SourceTestsOptions): SourceTestsResult {
  const sourceLimit = options.limit ?? agentQuery.limit ?? 5;
  const testLimit = options.testLimit ?? 2;
  const sourceResult = findFileClusters(sourceCandidateQuery(agentQuery), {
    target: options.target,
    indexPath: options.indexPath,
    limit: sourceLimit
  });

  const testFanoutLimit = Math.min(sourceResult.clusters.length, options.testFanoutLimit ?? 3);
  const relatedResults = findRelatedTestsBatch({
    target: options.target,
    indexPath: options.indexPath,
    sources: sourceResult.clusters.slice(0, testFanoutLimit).map((source) => ({
      sourceFile: source.file,
      symbol: relatedTestSourceSymbol(source, agentQuery.terms)
    })),
    terms: agentQuery.terms,
    limit: testLimit
  });
  const bundles: SourceTestBundle[] = sourceResult.clusters.map((source, index) => {
    const tests = relatedResults[index]?.matches ?? [];
    const contextChars = formatBundleContextChars(source, tests);
    const topTest = tests[0];
    return {
      source,
      tests,
      score: source.score + (topTest?.score ?? 0) / 10 + sourceTestPairScore(topTest),
      contextChars,
      contextTokens: approximateTokens(contextChars)
    };
  });

  return {
    query: sourceResult.query,
    bundles: bundles.sort((a, b) => b.score - a.score || a.source.file.localeCompare(b.source.file))
  };
}

function relatedTestSourceSymbol(source: FileClusterMatch, terms: string[]): string | undefined {
  if (source.symbols.length === 0) {
    return undefined;
  }
  return [...source.symbols]
    .map((symbol, index) => ({
      symbol,
      index,
      score: relatedTestSourceSymbolScore(symbol.name, symbol.kind, terms)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.symbol.name;
}

function relatedTestSourceSymbolScore(symbolName: string, kind: FileClusterMatch["symbols"][number]["kind"], terms: string[]): number {
  const normalizedSymbol = normalize(symbolName);
  const compactSymbol = normalizedSymbol.replace(/\s+/gu, "");
  const leaf = normalize(symbolName.includes(".") ? symbolName.slice(symbolName.lastIndexOf(".") + 1) : symbolName);
  let score = kind === "method" || kind === "function" ? 6 : 0;
  for (const term of terms.flatMap((value) => normalize(value).split(/\s+/u)).filter((value) => value.length >= 3)) {
    const compactTerm = term.replace(/\s+/gu, "");
    if (leaf === term || leaf === compactTerm) {
      score += 24;
    } else if (leaf.includes(term) || leaf.includes(compactTerm)) {
      score += 16;
    } else if (normalizedSymbol.includes(term) || compactSymbol.includes(compactTerm)) {
      score += 8;
    }
  }
  return score;
}

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_/.-]+/gu, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sourceCandidateQuery(agentQuery: AgentQuery): AgentQuery {
  if (!agentQuery.roles?.includes("source")) {
    return agentQuery;
  }
  return {
    ...agentQuery,
    roles: ["source"]
  };
}

function sourceTestPairScore(test: SourceTestBundle["tests"][number] | undefined): number {
  if (!test) {
    return 0;
  }
  let score = 0;
  if (test.why.includes("test imports source module")) {
    score += 35;
  }
  if (test.why.includes("test calls source symbol")) {
    score += 20;
  }
  if (test.why.includes("test body mentions source symbol")) {
    score += 12;
  }
  if (test.why.includes("test path includes source stem")) {
    score += 10;
  }
  if (test.why.includes("test path shares source path tokens")) {
    score += 6;
  }
  return score;
}

function formatBundleContextChars(source: SourceTestBundle["source"], tests: SourceTestBundle["tests"]): number {
  const sourceSymbol = source.symbols[0];
  const sourceLine = sourceSymbol ? `${source.file}:${sourceSymbol.lines[0]}` : source.file;
  const testLines = tests.map((test) => `${test.file}${test.firstLine === null ? "" : `:${test.firstLine}`}`);
  return [sourceLine, ...testLines].join(" -> ").length;
}

function approximateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
