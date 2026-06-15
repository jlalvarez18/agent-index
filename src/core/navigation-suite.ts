import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NavigationSuiteEntry, NavigationSuiteRepoResult, NavigationSuiteResult, QueryMode } from "./schema.js";
import { indexTarget } from "./indexer.js";
import { runNavigationEval } from "./navigation-eval.js";

export interface NavigationSuiteOptions {
  mode?: QueryMode;
  reindex?: boolean;
  repoRoot?: string;
  indexRoot?: string;
}

export async function runNavigationSuite(
  manifestPath: string,
  options: NavigationSuiteOptions = {}
): Promise<NavigationSuiteResult> {
  const manifestRoot = path.dirname(path.resolve(manifestPath));
  const entries = JSON.parse(await readFile(manifestPath, "utf8")) as NavigationSuiteEntry[];
  const repoResults: NavigationSuiteRepoResult[] = [];

  for (const entry of entries) {
    const resolvedEntry = resolveSuiteEntry(entry, manifestRoot, options);
    const indexStats = options.reindex
      ? await indexTarget(resolvedEntry.target, { indexPath: resolvedEntry.indexPath })
      : undefined;
    const result = await runNavigationEval(resolvedEntry.evalPath, {
      target: resolvedEntry.target,
      indexPath: indexStats?.indexPath ?? resolvedEntry.indexPath,
      mode: options.mode ?? resolvedEntry.mode
    });
    repoResults.push({ ...resolvedEntry, indexPath: indexStats?.indexPath ?? resolvedEntry.indexPath, indexStats, result });
  }

  return summarizeSuite(repoResults);
}

function resolveSuiteEntry(
  entry: NavigationSuiteEntry,
  manifestRoot: string,
  options: NavigationSuiteOptions
): NavigationSuiteEntry {
  return {
    ...entry,
    evalPath: resolveMaybeRelative(entry.evalPath, manifestRoot),
    target: resolveTarget(entry.target, manifestRoot, options.repoRoot),
    indexPath: resolveIndexPath(entry, manifestRoot, options.indexRoot)
  };
}

function summarizeSuite(repoResults: NavigationSuiteRepoResult[]): NavigationSuiteResult {
  const cases = repoResults.reduce((sum, repo) => sum + repo.result.cases, 0);
  return {
    repos: repoResults.length,
    cases,
    agentIndexUsefulRate: weightedRate(repoResults, (result) => result.agentIndexUsefulRate),
    rgUsefulRate: weightedRate(repoResults, (result) => result.rgUsefulRate),
    rgOptimizedUsefulRate: weightedRate(repoResults, (result) => result.rgOptimizedUsefulRate),
    agentIndexCompletionRate: weightedRate(repoResults, (result) => result.agentIndexCompletionRate),
    rgCompletionRate: weightedRate(repoResults, (result) => result.rgCompletionRate),
    rgOptimizedCompletionRate: weightedRate(repoResults, (result) => result.rgOptimizedCompletionRate),
    agentIndexAvgCommands: weightedRate(repoResults, (result) => result.agentIndexAvgCommands),
    rgAvgCommands: weightedRate(repoResults, (result) => result.rgAvgCommands),
    rgOptimizedAvgCommands: weightedRate(repoResults, (result) => result.rgOptimizedAvgCommands),
    agentIndexAvgLatencyMs: weightedRate(repoResults, (result) => result.agentIndexAvgLatencyMs),
    rgAvgLatencyMs: weightedRate(repoResults, (result) => result.rgAvgLatencyMs),
    rgOptimizedAvgLatencyMs: weightedRate(repoResults, (result) => result.rgOptimizedAvgLatencyMs),
    agentIndexAvgContextTokens: weightedRate(repoResults, (result) => result.agentIndexAvgContextTokens),
    rgAvgContextTokens: weightedRate(repoResults, (result) => result.rgAvgContextTokens),
    rgOptimizedAvgContextTokens: weightedRate(repoResults, (result) => result.rgOptimizedAvgContextTokens),
    avgTokenSavings: weightedRate(repoResults, (result) => result.avgTokenSavings),
    avgOptimizedRgTokenSavings: weightedRate(repoResults, (result) => result.avgOptimizedRgTokenSavings),
    agentIndexWins: repoResults.reduce((sum, repo) => sum + repo.result.agentIndexWins, 0),
    rgWins: repoResults.reduce((sum, repo) => sum + repo.result.rgWins, 0),
    ties: repoResults.reduce((sum, repo) => sum + repo.result.ties, 0),
    inconclusive: repoResults.reduce((sum, repo) => sum + repo.result.inconclusive, 0),
    agentIndexWinsVsOptimizedRg: repoResults.reduce((sum, repo) => sum + repo.result.agentIndexWinsVsOptimizedRg, 0),
    rgOptimizedWins: repoResults.reduce((sum, repo) => sum + repo.result.rgOptimizedWins, 0),
    optimizedRgTies: repoResults.reduce((sum, repo) => sum + repo.result.optimizedRgTies, 0),
    optimizedRgInconclusive: repoResults.reduce((sum, repo) => sum + repo.result.optimizedRgInconclusive, 0),
    repoResults
  };
}

function weightedRate(
  repoResults: NavigationSuiteRepoResult[],
  metric: (result: NavigationSuiteRepoResult["result"]) => number
): number {
  const cases = repoResults.reduce((sum, repo) => sum + repo.result.cases, 0);
  if (cases === 0) {
    return 0;
  }
  const weighted = repoResults.reduce((sum, repo) => sum + metric(repo.result) * repo.result.cases, 0);
  return Number((weighted / cases).toFixed(4));
}

function resolveMaybeRelative(value: string, root: string): string {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function resolveTarget(target: string, manifestRoot: string, repoRoot: string | undefined): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  return repoRoot ? path.resolve(repoRoot, target) : path.resolve(manifestRoot, target);
}

function resolveIndexPath(
  entry: NavigationSuiteEntry,
  manifestRoot: string,
  indexRoot: string | undefined
): string | undefined {
  if (entry.indexPath) {
    return resolveMaybeRelative(entry.indexPath, manifestRoot);
  }
  if (!indexRoot) {
    return undefined;
  }
  return path.resolve(indexRoot, `${safeIndexName(entry.name)}.sqlite`);
}

function safeIndexName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]+/gu, "-");
}
