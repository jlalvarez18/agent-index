import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NavigationSuiteEntry, NavigationSuiteRepoResult, NavigationSuiteResult, QueryMode } from "./schema.js";
import { indexTarget } from "./indexer.js";
import { runNavigationEval } from "./navigation-eval.js";

export interface NavigationSuiteOptions {
  mode?: QueryMode;
  reindex?: boolean;
  repoRoot?: string;
  indexRoot?: string;
  artifactsDir?: string;
  runs?: number;
}

export async function runNavigationSuite(
  manifestPath: string,
  options: NavigationSuiteOptions = {}
): Promise<NavigationSuiteResult> {
  const manifestRoot = path.dirname(path.resolve(manifestPath));
  const entries = JSON.parse(await readFile(manifestPath, "utf8")) as NavigationSuiteEntry[];
  const repoResults: NavigationSuiteRepoResult[] = [];
  const runs = normalizeRuns(options.runs);

  for (const entry of entries) {
    const resolvedEntry = resolveSuiteEntry(entry, manifestRoot, options);
    const indexStats = options.reindex
      ? await indexTarget(resolvedEntry.target, { indexPath: resolvedEntry.indexPath })
      : undefined;
    const runResults: NavigationSuiteRepoResult["runResults"] = [];
    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
      runResults.push(
        await runNavigationEval(resolvedEntry.evalPath, {
          target: resolvedEntry.target,
          indexPath: indexStats?.indexPath ?? resolvedEntry.indexPath,
          mode: options.mode ?? resolvedEntry.mode
        })
      );
    }
    const result = medianLatencyResult(runResults);
    repoResults.push({
      ...resolvedEntry,
      indexPath: indexStats?.indexPath ?? resolvedEntry.indexPath,
      indexStats,
      ...(runs > 1 ? { runs, runResults } : {}),
      result
    });
  }

  const suiteResult = summarizeSuite(repoResults, runs);
  if (options.artifactsDir) {
    await writeNavigationSuiteArtifacts(suiteResult, options.artifactsDir);
  }
  return suiteResult;
}

async function writeNavigationSuiteArtifacts(result: NavigationSuiteResult, artifactsDir: string): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  await writeJsonArtifact(path.join(artifactsDir, "summary.json"), result);

  const reposDir = path.join(artifactsDir, "repos");
  await mkdir(reposDir, { recursive: true });
  for (const repo of result.repoResults) {
    await writeJsonArtifact(path.join(reposDir, `${safeIndexName(repo.name)}.json`), repo);
  }
}

async function writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function medianLatencyResult(results: NavigationSuiteRepoResult["runResults"]): NavigationSuiteRepoResult["result"] {
  const sorted = [...(results ?? [])].sort((a, b) => a.agentIndexAvgLatencyMs - b.agentIndexAvgLatencyMs);
  return sorted[Math.floor(sorted.length / 2)];
}

function normalizeRuns(value: number | undefined): number {
  const runs = Math.floor(value ?? 1);
  if (!Number.isFinite(runs) || runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  return runs;
}

function summarizeSuite(repoResults: NavigationSuiteRepoResult[], runs = 1): NavigationSuiteResult {
  const cases = repoResults.reduce((sum, repo) => sum + repo.result.cases, 0);
  return {
    ...(runs > 1 ? { runs } : {}),
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
    agentIndexAvgFirstUsefulLatencyMs: weightedRate(repoResults, (result) => result.agentIndexAvgFirstUsefulLatencyMs),
    rgAvgFirstUsefulLatencyMs: weightedRate(repoResults, (result) => result.rgAvgFirstUsefulLatencyMs),
    rgOptimizedAvgFirstUsefulLatencyMs: weightedRate(repoResults, (result) => result.rgOptimizedAvgFirstUsefulLatencyMs),
    agentIndexAvgCompletionLatencyMs: weightedRate(repoResults, (result) => result.agentIndexAvgCompletionLatencyMs),
    rgAvgCompletionLatencyMs: weightedRate(repoResults, (result) => result.rgAvgCompletionLatencyMs),
    rgOptimizedAvgCompletionLatencyMs: weightedRate(repoResults, (result) => result.rgOptimizedAvgCompletionLatencyMs),
    agentIndexAvgContextTokens: weightedRate(repoResults, (result) => result.agentIndexAvgContextTokens),
    rgAvgContextTokens: weightedRate(repoResults, (result) => result.rgAvgContextTokens),
    rgOptimizedAvgContextTokens: weightedRate(repoResults, (result) => result.rgOptimizedAvgContextTokens),
    agentIndexAvgFirstUsefulContextTokens: weightedRate(repoResults, (result) => result.agentIndexAvgFirstUsefulContextTokens),
    rgAvgFirstUsefulContextTokens: weightedRate(repoResults, (result) => result.rgAvgFirstUsefulContextTokens),
    rgOptimizedAvgFirstUsefulContextTokens: weightedRate(repoResults, (result) => result.rgOptimizedAvgFirstUsefulContextTokens),
    agentIndexAvgCompletionContextTokens: weightedRate(repoResults, (result) => result.agentIndexAvgCompletionContextTokens),
    rgAvgCompletionContextTokens: weightedRate(repoResults, (result) => result.rgAvgCompletionContextTokens),
    rgOptimizedAvgCompletionContextTokens: weightedRate(repoResults, (result) => result.rgOptimizedAvgCompletionContextTokens),
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
