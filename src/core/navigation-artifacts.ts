import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { NavigationEvalCaseResult, NavigationSuiteRepoResult, NavigationSuiteResult } from "./schema.js";

export interface NavigationArtifactCompareOptions {
  maxAgentTokenIncrease?: number;
  maxAgentTokenIncreasePercent?: number;
  maxAgentLatencyIncreaseMs?: number;
  maxAgentLatencyIncreasePercent?: number;
  requireAgentDominance?: boolean;
  requireAgentToolUse?: boolean;
}

export interface NavigationArtifactRegression {
  metric: string;
  baseline: number;
  current: number;
  message: string;
}

export interface NavigationArtifactCompareResult {
  passed: boolean;
  baselinePath: string;
  currentPath: string;
  regressions: NavigationArtifactRegression[];
}

export async function compareNavigationArtifacts(
  baselinePath: string,
  currentPath: string,
  options: NavigationArtifactCompareOptions = {}
): Promise<NavigationArtifactCompareResult> {
  const resolvedBaselinePath = await resolveSummaryPath(baselinePath);
  const resolvedCurrentPath = await resolveSummaryPath(currentPath);
  const baseline = await readSuiteResult(resolvedBaselinePath);
  const current = await readSuiteResult(resolvedCurrentPath);
  const regressions = findNavigationRegressions(baseline, current, options);

  return {
    passed: regressions.length === 0,
    baselinePath: resolvedBaselinePath,
    currentPath: resolvedCurrentPath,
    regressions
  };
}

async function resolveSummaryPath(inputPath: string): Promise<string> {
  const stats = await stat(inputPath);
  return stats.isDirectory() ? path.join(inputPath, "summary.json") : inputPath;
}

async function readSuiteResult(filePath: string): Promise<NavigationSuiteResult> {
  return JSON.parse(await readFile(filePath, "utf8")) as NavigationSuiteResult;
}

function findNavigationRegressions(
  baseline: NavigationSuiteResult,
  current: NavigationSuiteResult,
  options: NavigationArtifactCompareOptions
): NavigationArtifactRegression[] {
  const regressions: NavigationArtifactRegression[] = [];
  compareNonDecreasing(regressions, "cases", baseline.cases, current.cases);
  compareNonDecreasing(regressions, "agentIndexCompletionRate", baseline.agentIndexCompletionRate, current.agentIndexCompletionRate);
  compareNonDecreasing(regressions, "agentIndexWins", baseline.agentIndexWins, current.agentIndexWins);
  compareNonDecreasing(
    regressions,
    "agentIndexWinsVsOptimizedRg",
    baseline.agentIndexWinsVsOptimizedRg,
    current.agentIndexWinsVsOptimizedRg
  );
  compareTokenBudget(regressions, baseline.agentIndexAvgContextTokens, current.agentIndexAvgContextTokens, options);
  compareTokenBudget(
    regressions,
    baseline.agentIndexAvgFirstUsefulContextTokens,
    current.agentIndexAvgFirstUsefulContextTokens,
    options,
    "agentIndexAvgFirstUsefulContextTokens"
  );
  compareLatencyBudget(regressions, baseline.agentIndexAvgLatencyMs, current.agentIndexAvgLatencyMs, options);
  compareLatencyBudget(
    regressions,
    baseline.agentIndexAvgFirstUsefulLatencyMs,
    current.agentIndexAvgFirstUsefulLatencyMs,
    options,
    "agentIndexAvgFirstUsefulLatencyMs"
  );
  compareAgentToolUse(regressions, baseline, current, options);
  if (options.requireAgentDominance) {
    compareAgentDominance(regressions, current);
  }
  compareRepoResults(regressions, baseline.repoResults, current.repoResults, options);
  return regressions;
}

function compareRepoResults(
  regressions: NavigationArtifactRegression[],
  baselineRepos: NavigationSuiteRepoResult[],
  currentRepos: NavigationSuiteRepoResult[],
  options: NavigationArtifactCompareOptions
): void {
  const currentByName = new Map(currentRepos.map((repo) => [repo.name, repo]));
  for (const baselineRepo of baselineRepos) {
    const currentRepo = currentByName.get(baselineRepo.name);
    if (!currentRepo) {
      regressions.push({
        metric: `repo.${baselineRepo.name}`,
        baseline: 1,
        current: 0,
        message: `repository ${baselineRepo.name} is missing from current artifact`
      });
      continue;
    }

    compareNonDecreasing(
      regressions,
      `repo.${baselineRepo.name}.agentIndexCompletionRate`,
      baselineRepo.result.agentIndexCompletionRate,
      currentRepo.result.agentIndexCompletionRate
    );
    compareNonDecreasing(
      regressions,
      `repo.${baselineRepo.name}.agentIndexWinsVsOptimizedRg`,
      baselineRepo.result.agentIndexWinsVsOptimizedRg,
      currentRepo.result.agentIndexWinsVsOptimizedRg
    );
    compareTokenBudget(
      regressions,
      baselineRepo.result.agentIndexAvgContextTokens,
      currentRepo.result.agentIndexAvgContextTokens,
      options,
      `repo.${baselineRepo.name}.agentIndexAvgContextTokens`
    );
    compareTokenBudget(
      regressions,
      baselineRepo.result.agentIndexAvgFirstUsefulContextTokens,
      currentRepo.result.agentIndexAvgFirstUsefulContextTokens,
      options,
      `repo.${baselineRepo.name}.agentIndexAvgFirstUsefulContextTokens`
    );
    compareLatencyBudget(
      regressions,
      baselineRepo.result.agentIndexAvgLatencyMs,
      currentRepo.result.agentIndexAvgLatencyMs,
      options,
      `repo.${baselineRepo.name}.agentIndexAvgLatencyMs`
    );
    compareLatencyBudget(
      regressions,
      baselineRepo.result.agentIndexAvgFirstUsefulLatencyMs,
      currentRepo.result.agentIndexAvgFirstUsefulLatencyMs,
      options,
      `repo.${baselineRepo.name}.agentIndexAvgFirstUsefulLatencyMs`
    );
    compareAgentToolUse(
      regressions,
      baselineRepo.result,
      currentRepo.result,
      { ...options, requireAgentToolUse: false },
      `repo.${baselineRepo.name}.`
    );
    if (options.requireAgentDominance) {
      compareAgentDominance(regressions, currentRepo.result, `repo.${baselineRepo.name}.`);
    }
  }
}

function compareAgentToolUse(
  regressions: NavigationArtifactRegression[],
  baseline: NavigationSuiteResult | NavigationSuiteRepoResult["result"],
  current: NavigationSuiteResult | NavigationSuiteRepoResult["result"],
  options: NavigationArtifactCompareOptions,
  prefix = ""
): void {
  const baselineCases = metricNumber(baseline.agentToolUseCases);
  const currentCases = metricNumber(current.agentToolUseCases);
  if (options.requireAgentToolUse && currentCases <= 0) {
    regressions.push({
      metric: `${prefix}agentToolUseCases`,
      baseline: 1,
      current: currentCases,
      message: `${prefix}agentToolUseCases is ${currentCases}, below required authored tool-use case count 1`
    });
    return;
  }

  if (baselineCases === 0 && currentCases === 0) {
    return;
  }

  compareNonDecreasing(regressions, `${prefix}agentToolUseCases`, baselineCases, currentCases);
  compareNonDecreasing(
    regressions,
    `${prefix}agentToolUseSatisfiedRate`,
    metricNumber(baseline.agentToolUseSatisfiedRate),
    metricNumber(current.agentToolUseSatisfiedRate)
  );
  if (options.requireAgentToolUse) {
    compareAtLeast(
      regressions,
      `${prefix}agentToolUseSatisfiedRate`,
      1,
      metricNumber(current.agentToolUseSatisfiedRate),
      "fully satisfied tool-use rate"
    );
  }
  compareTokenBudget(
    regressions,
    baseline.agentToolUseAvgFirstUsefulContextTokens,
    current.agentToolUseAvgFirstUsefulContextTokens,
    options,
    `${prefix}agentToolUseAvgFirstUsefulContextTokens`
  );
  compareTokenBudget(
    regressions,
    baseline.agentToolUseAvgCompletionContextTokens,
    current.agentToolUseAvgCompletionContextTokens,
    options,
    `${prefix}agentToolUseAvgCompletionContextTokens`
  );
  compareLatencyBudget(
    regressions,
    baseline.agentToolUseAvgFirstUsefulLatencyMs,
    current.agentToolUseAvgFirstUsefulLatencyMs,
    options,
    `${prefix}agentToolUseAvgFirstUsefulLatencyMs`
  );
  compareLatencyBudget(
    regressions,
    baseline.agentToolUseAvgCompletionLatencyMs,
    current.agentToolUseAvgCompletionLatencyMs,
    options,
    `${prefix}agentToolUseAvgCompletionLatencyMs`
  );
}

function compareAgentDominance(
  regressions: NavigationArtifactRegression[],
  current: NavigationSuiteResult | NavigationSuiteRepoResult["result"],
  prefix = ""
): void {
  compareAtLeast(
    regressions,
    `${prefix}dominance.agentIndexCompletionRate`,
    current.rgCompletionRate,
    current.agentIndexCompletionRate,
    "broad rg completion"
  );
  compareAtLeast(
    regressions,
    `${prefix}dominance.agentIndexCompletionRate`,
    current.rgOptimizedCompletionRate,
    current.agentIndexCompletionRate,
    "optimized rg completion"
  );
  const dominanceCaseStats = agentDominanceCaseStats(current);
  compareAtLeast(
    regressions,
    `${prefix}dominance.agentIndexWins`,
    dominanceCaseStats.eligibleCases,
    dominanceCaseStats.agentIndexWins,
    "non-exact-string case count"
  );
  compareAtLeast(
    regressions,
    `${prefix}dominance.agentIndexWinsVsOptimizedRg`,
    dominanceCaseStats.eligibleCases,
    dominanceCaseStats.agentIndexWinsVsOptimizedRg,
    "non-exact-string case count"
  );
  compareLessThan(
    regressions,
    `${prefix}dominance.agentIndexAvgContextTokens`,
    current.rgAvgContextTokens,
    current.agentIndexAvgContextTokens,
    "broad rg average context tokens"
  );
  compareLessThan(
    regressions,
    `${prefix}dominance.agentIndexAvgContextTokens`,
    current.rgOptimizedAvgContextTokens,
    current.agentIndexAvgContextTokens,
    "optimized rg average context tokens"
  );
}

function agentDominanceCaseStats(current: NavigationSuiteResult | NavigationSuiteRepoResult["result"]): {
  eligibleCases: number;
  agentIndexWins: number;
  agentIndexWinsVsOptimizedRg: number;
} {
  const caseResults = navigationCaseResults(current);
  if (caseResults.length === 0) {
    return {
      eligibleCases: current.cases,
      agentIndexWins: current.agentIndexWins,
      agentIndexWinsVsOptimizedRg: current.agentIndexWinsVsOptimizedRg
    };
  }

  const eligibleCases = caseResults.filter((caseResult) => caseResult.kind !== "exact-string-audit");
  return {
    eligibleCases: eligibleCases.length,
    agentIndexWins: eligibleCases.filter((caseResult) => caseResult.winner === "agent-index").length,
    agentIndexWinsVsOptimizedRg: eligibleCases.filter((caseResult) => caseResult.optimizedRgWinner === "agent-index").length
  };
}

function navigationCaseResults(current: NavigationSuiteResult | NavigationSuiteRepoResult["result"]): NavigationEvalCaseResult[] {
  if ("caseResults" in current) {
    return current.caseResults;
  }
  return current.repoResults.flatMap((repo) => repo.result.caseResults);
}

function metricNumber(value: number | undefined): number {
  return typeof value === "number" ? value : 0;
}

function compareAtLeast(
  regressions: NavigationArtifactRegression[],
  metric: string,
  baseline: number,
  current: number,
  baselineLabel: string
): void {
  if (current < baseline) {
    regressions.push({
      metric,
      baseline,
      current,
      message: `${metric} is ${current}, below ${baselineLabel} ${baseline}`
    });
  }
}

function compareLessThan(
  regressions: NavigationArtifactRegression[],
  metric: string,
  baseline: number,
  current: number,
  baselineLabel: string
): void {
  if (current >= baseline) {
    regressions.push({
      metric,
      baseline,
      current,
      message: `${metric} is ${current}, not below ${baselineLabel} ${baseline}`
    });
  }
}

function compareNonDecreasing(
  regressions: NavigationArtifactRegression[],
  metric: string,
  baseline: number,
  current: number
): void {
  if (current < baseline) {
    regressions.push({
      metric,
      baseline,
      current,
      message: `${metric} dropped from ${baseline} to ${current}`
    });
  }
}

function compareTokenBudget(
  regressions: NavigationArtifactRegression[],
  baseline: number | undefined,
  current: number | undefined,
  options: NavigationArtifactCompareOptions,
  metric = "agentIndexAvgContextTokens"
): void {
  if (typeof baseline !== "number" || typeof current !== "number") {
    return;
  }

  const absoluteAllowance = options.maxAgentTokenIncrease ?? 0;
  const percentAllowance = baseline * ((options.maxAgentTokenIncreasePercent ?? 0) / 100);
  const allowedCurrent = baseline + Math.max(absoluteAllowance, percentAllowance);
  if (current > allowedCurrent) {
    regressions.push({
      metric,
      baseline,
      current,
      message: `${metric} increased from ${baseline} to ${current} above allowed ${Number(allowedCurrent.toFixed(4))}`
    });
  }
}

function compareLatencyBudget(
  regressions: NavigationArtifactRegression[],
  baseline: number | undefined,
  current: number | undefined,
  options: NavigationArtifactCompareOptions,
  metric = "agentIndexAvgLatencyMs"
): void {
  if (options.maxAgentLatencyIncreaseMs === undefined && options.maxAgentLatencyIncreasePercent === undefined) {
    return;
  }
  if (typeof baseline !== "number" || typeof current !== "number") {
    return;
  }

  const absoluteAllowance = options.maxAgentLatencyIncreaseMs ?? 0;
  const percentAllowance = baseline * ((options.maxAgentLatencyIncreasePercent ?? 0) / 100);
  const allowedCurrent = baseline + Math.max(absoluteAllowance, percentAllowance);
  if (current > allowedCurrent) {
    regressions.push({
      metric,
      baseline,
      current,
      message: `${metric} increased from ${baseline}ms to ${current}ms above allowed ${Number(allowedCurrent.toFixed(4))}ms`
    });
  }
}
