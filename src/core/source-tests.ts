import type { AgentQuery, SourceTestBundle, SourceTestsResult } from "./schema.js";
import { findFileClusters } from "./file-clusters.js";
import { findRelatedTests } from "./related-tests.js";

export interface SourceTestsOptions {
  target: string;
  indexPath?: string;
  limit?: number;
  testLimit?: number;
}

export function findSourceTests(agentQuery: AgentQuery, options: SourceTestsOptions): SourceTestsResult {
  const sourceLimit = options.limit ?? agentQuery.limit ?? 5;
  const testLimit = options.testLimit ?? 2;
  const sourceResult = findFileClusters(agentQuery, {
    target: options.target,
    indexPath: options.indexPath,
    limit: sourceLimit
  });

  const bundles: SourceTestBundle[] = sourceResult.clusters.map((source) => {
    const related = findRelatedTests({
      target: options.target,
      indexPath: options.indexPath,
      sourceFile: source.file,
      symbol: source.symbols[0]?.name,
      terms: agentQuery.terms,
      limit: testLimit
    });
    const contextChars = formatBundleContextChars(source, related.matches);
    return {
      source,
      tests: related.matches,
      score: source.score + (related.matches[0]?.score ?? 0) / 10,
      contextChars,
      contextTokens: approximateTokens(contextChars)
    };
  });

  return {
    query: sourceResult.query,
    bundles: bundles.sort((a, b) => b.score - a.score || a.source.file.localeCompare(b.source.file))
  };
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
