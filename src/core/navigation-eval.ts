import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentQuery,
  FileClusterMatch,
  NavigationEvalCase,
  NavigationEvalCaseResult,
  NavigationEvalResult,
  NavigationAgentStep,
  NavigationEvalStepResult,
  NavigationEvalWorkflowResult,
  NavigationRgOptimizedPlanStep,
  NavigationRgOptimizedStep,
  QueryMatch,
  QueryMode,
  RelatedTestMatch,
  SourceTestBundle
} from "./schema.js";
import { findFileClusters } from "./file-clusters.js";
import { queryAgentIndex } from "./query.js";
import { findRelatedTests } from "./related-tests.js";
import { findSourceTests } from "./source-tests.js";

export interface NavigationEvalOptions {
  target: string;
  indexPath?: string;
  mode?: QueryMode;
  caseIds?: string[];
}

interface RgMatch {
  file: string;
  line: number;
  text: string;
}

interface RgSnippet {
  file: string;
  startLine: number;
  lines: string[];
}

export async function runNavigationEval(
  navigationEvalPath: string,
  options: NavigationEvalOptions
): Promise<NavigationEvalResult> {
  const cases = filterNavigationCases(JSON.parse(await readFile(navigationEvalPath, "utf8")) as NavigationEvalCase[], options.caseIds);
  validateNavigationEvalCases(cases, navigationEvalPath);
  const caseResults: NavigationEvalCaseResult[] = [];

  for (const navigationCase of cases) {
    const agentIndex = await runAgentIndexWorkflow(navigationCase, options);
    const rg = await runRgWorkflow(navigationCase, options.target);
    const rgOptimized = await runOptimizedRgWorkflow(navigationCase, options.target);
    caseResults.push(scoreNavigationCase(navigationCase, agentIndex, rg, rgOptimized));
  }

  return summarizeNavigationCases(caseResults);
}

function filterNavigationCases(cases: NavigationEvalCase[], caseIds: string[] | undefined): NavigationEvalCase[] {
  if (!caseIds || caseIds.length === 0) {
    return cases;
  }
  const selectedIds = new Set(caseIds);
  return cases.filter((navigationCase) => selectedIds.has(navigationCase.id));
}

export function validateNavigationEvalCases(cases: NavigationEvalCase[], source = "navigation eval"): void {
  const errors: string[] = [];

  for (const navigationCase of cases) {
    if (!isBehaviorOnlyCase(navigationCase)) {
      continue;
    }

    for (const [index, step] of agentSteps(navigationCase).entries()) {
      if (step.type === "related-tests" && step.symbol) {
        errors.push(
          `${navigationCase.id}: behavior-only step ${index + 1} must infer related-tests symbol from prior output, not pass explicit symbol "${step.symbol}"`
        );
      }
      const leakedTerms = exactTargetNameTerms(navigationCase, navigationStepTerms(step));
      if (leakedTerms.length > 0) {
        errors.push(
          `${navigationCase.id}: behavior-only step ${index + 1} must not include exact target symbol term(s): ${leakedTerms.join(", ")}`
        );
      }
    }

    for (const [index, terms] of navigationCase.rgQueries.entries()) {
      const leakedTerms = exactTargetNameTerms(navigationCase, terms);
      if (leakedTerms.length > 0) {
        errors.push(
          `${navigationCase.id}: behavior-only rg query ${index + 1} must not include exact target symbol term(s): ${leakedTerms.join(", ")}`
        );
      }
    }

    for (const [index, step] of optimizedRgStepsForValidation(navigationCase).entries()) {
      const leakedTerms = exactTargetNameTerms(navigationCase, optimizedRgStepTerms(step));
      if (leakedTerms.length > 0) {
        errors.push(
          `${navigationCase.id}: behavior-only optimized rg step ${index + 1} must not include exact target symbol term(s): ${leakedTerms.join(", ")}`
        );
      }
      const leakedPaths = expectedFilePathsInOptimizedRgStep(navigationCase, step);
      if (leakedPaths.length > 0) {
        errors.push(
          `${navigationCase.id}: behavior-only optimized rg step ${index + 1} must not search expected file path(s): ${leakedPaths.join(", ")}`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`${source} has unfair navigation benchmark cases:\n${errors.join("\n")}`);
  }
}

function isBehaviorOnlyCase(navigationCase: NavigationEvalCase): boolean {
  return navigationCase.id.includes("behavior-only") || /\bwithout (?:using|naming)\b/i.test(navigationCase.task);
}

function navigationStepTerms(step: NavigationAgentStep): string[] {
  if (step.type === "query" || step.type === "file-clusters" || step.type === "source-tests") {
    return step.query.terms;
  }
  return step.terms ?? [];
}

function exactTargetNameTerms(navigationCase: NavigationEvalCase, terms: string[]): string[] {
  const exactNames = new Set(
    [
      ...(navigationCase.expected.requiredSymbols ?? navigationCase.expected.symbols ?? []),
      ...(navigationCase.searchTerms?.forbiddenExact ?? [])
    ]
      .flatMap(targetNameVariants)
      .filter((name) => name.length > 0)
  );
  return terms.filter((term) => exactNames.has(normalizeTargetName(term)));
}

function optimizedRgStepsForValidation(navigationCase: NavigationEvalCase): Array<NavigationRgOptimizedStep | NavigationRgOptimizedPlanStep> {
  return navigationCase.rgOptimizedPlan?.steps ?? navigationCase.rgOptimizedSteps ?? [];
}

function optimizedRgStepTerms(step: NavigationRgOptimizedStep | NavigationRgOptimizedPlanStep): string[] {
  if (step.type === "files" || step.type === "snippets" || step.type === "search-files" || step.type === "read-snippets") {
    return step.terms ?? [];
  }
  return step.includeTerms ?? [];
}

function expectedFilePathsInOptimizedRgStep(
  navigationCase: NavigationEvalCase,
  step: NavigationRgOptimizedStep | NavigationRgOptimizedPlanStep
): string[] {
  const paths = "paths" in step ? step.paths ?? [] : [];
  const files = "files" in step ? step.files ?? [] : [];
  const searchedPaths = [...paths, ...files].map(normalizeFilePath);
  const expectedFiles = (navigationCase.expected.requiredFiles ?? navigationCase.expected.files).map(normalizeFilePath);
  return uniqueValues(
    searchedPaths.filter((searchedPath) =>
      expectedFiles.some((expectedFile) => searchedPath === expectedFile || searchedPath.includes(`/${expectedFile}`))
    )
  );
}

function targetNameVariants(symbol: string): string[] {
  const normalized = normalizeTargetName(symbol);
  const parts = symbol.split(".");
  return uniqueValues([normalized, normalizeTargetName(parts[parts.length - 1])]);
}

function normalizeTargetName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeFilePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

async function runAgentIndexWorkflow(
  navigationCase: NavigationEvalCase,
  options: NavigationEvalOptions
): Promise<NavigationEvalWorkflowResult> {
  const steps: NavigationEvalStepResult[] = [];

  for (const step of agentSteps(navigationCase)) {
    const started = performance.now();
    steps.push(await runAgentStep(step, navigationCase, options, started, steps));
  }

  return summarizeWorkflow(steps, navigationCase);
}

async function runAgentStep(
  step: NavigationAgentStep,
  navigationCase: NavigationEvalCase,
  options: NavigationEvalOptions,
  started: number,
  previousSteps: NavigationEvalStepResult[] = []
): Promise<NavigationEvalStepResult> {
  if (step.type === "query") {
    const response = await queryAgentIndex(step.query, {
      target: options.target,
      indexPath: options.indexPath,
      mode: options.mode ?? "hybrid",
      limit: step.query.limit ?? 5
    });
    const context = formatCompactMatches(response.matches);
    const useful = usefulAgentMatch(response.matches, navigationCase);
    return {
      type: "query",
      command: formatAgentCommand(step.query),
      latencyMs: performance.now() - started,
      contextChars: context.length,
      contextTokens: approximateTokens(context.length),
      usefulRank: useful?.rank ?? null,
      usefulFile: useful?.file ?? null,
      usefulSymbol: useful?.symbol ?? null,
      foundFiles: matchingAgentFiles(response.matches, navigationCase),
      foundSymbols: matchingAgentSymbols(response.matches, navigationCase),
      outputFiles: uniqueValues(response.matches.map((match) => match.file)),
      outputSymbols: compactOutputValues(queryOutputSymbols(response.matches))
    };
  }

  if (step.type === "file-clusters") {
    const result = findFileClusters(step.query, {
      target: options.target,
      indexPath: options.indexPath,
      limit: step.limit ?? step.query.limit ?? 8
    });
    const context = formatCompactClusters(result.clusters);
    const useful = usefulFileCluster(result.clusters, navigationCase);
    const outputSymbols = clusterOutputSymbols(result.clusters, options);
    return {
      type: "file-clusters",
      command: formatFileClustersCommand(step.query),
      latencyMs: performance.now() - started,
      contextChars: context.length,
      contextTokens: approximateTokens(context.length),
      usefulRank: useful?.rank ?? null,
      usefulFile: useful?.file ?? null,
      usefulSymbol: useful?.symbol ?? null,
      foundFiles: matchingClusterFiles(result.clusters, navigationCase),
      foundSymbols: matchingSymbols(outputSymbols, navigationCase),
      outputFiles: uniqueValues(result.clusters.map((cluster) => cluster.file)),
      outputSymbols: compactOutputValues(outputSymbols)
    };
  }

  if (step.type === "source-tests") {
    const result = findSourceTests(step.query, {
      target: options.target,
      indexPath: options.indexPath,
      limit: step.limit ?? step.query.limit ?? 5,
      testLimit: step.testLimit ?? 2,
      testFanoutLimit: step.testFanoutLimit
    });
    const context = formatCompactSourceTests(result.bundles);
    const useful = usefulSourceTestBundle(result.bundles, navigationCase);
    return {
      type: "source-tests",
      command: formatSourceTestsCommand(step),
      latencyMs: performance.now() - started,
      contextChars: context.length,
      contextTokens: approximateTokens(context.length),
      usefulRank: useful?.rank ?? null,
      usefulFile: useful?.file ?? null,
      usefulSymbol: useful?.symbol ?? null,
      foundFiles: matchingSourceTestFiles(result.bundles, navigationCase),
      foundSymbols: matchingSourceTestSymbols(result.bundles, navigationCase),
      outputFiles: uniqueValues(result.bundles.flatMap((bundle) => [bundle.source.file, ...bundle.tests.map((test) => test.file)])),
      outputSymbols: compactOutputValues(
        result.bundles.flatMap((bundle) => [
          ...bundle.source.symbols.map((symbol) => symbol.name),
          ...bundle.tests.flatMap((test) => test.symbols)
        ])
      )
    };
  }

  const sourceFiles = resolveRelatedTestsSources(step, previousSteps);
  const symbol = step.symbol ?? resolveRelatedTestsSymbol(previousSteps);
  const result = findRelatedTests({
    target: options.target,
    indexPath: options.indexPath,
    sourceFile: sourceFiles[0],
    sourceFiles,
    symbol,
    terms: step.terms,
    limit: step.limit ?? 5
  });
  const context = formatCompactRelatedTests(result.matches);
  const useful = usefulRelatedTest(result.matches, navigationCase);
  return {
    type: "related-tests",
    command: formatRelatedTestsCommand(step),
    latencyMs: performance.now() - started,
    contextChars: context.length,
    contextTokens: approximateTokens(context.length),
    usefulRank: useful?.rank ?? null,
    usefulFile: useful?.file ?? null,
    foundFiles: matchingRelatedTestFiles(result.matches, navigationCase),
    foundSymbols: matchingRelatedTestSymbols(result.matches, navigationCase),
    outputFiles: uniqueValues(result.matches.map((match) => match.file)),
    outputSymbols: compactOutputValues(result.matches.flatMap((match) => match.symbols))
  };
}

function resolveRelatedTestsSources(
  step: Extract<NavigationAgentStep, { type: "related-tests" }>,
  previousSteps: NavigationEvalStepResult[]
): string[] {
  if (step.sourceFile) {
    return [step.sourceFile];
  }

  const sourceStep = step.sourceFromStep ? previousSteps[step.sourceFromStep - 1] : previousSteps.at(-1);
  const sourceFiles = uniqueValues(sourceStep?.outputFiles ?? []).slice(0, step.sourceLimit ?? 3);
  if (sourceFiles.length === 0) {
    throw new Error("related-tests step needs sourceFile or a previous step with at least one output file");
  }
  return sourceFiles;
}

function resolveRelatedTestsSymbol(previousSteps: NavigationEvalStepResult[]): string | undefined {
  for (const step of [...previousSteps].reverse()) {
    const symbol = step.outputSymbols?.[0];
    if (symbol) {
      return symbol;
    }
  }
  return undefined;
}

function agentSteps(navigationCase: NavigationEvalCase): NavigationAgentStep[] {
  if (navigationCase.agentIndexSteps && navigationCase.agentIndexSteps.length > 0) {
    return navigationCase.agentIndexSteps;
  }
  return (navigationCase.agentIndexQueries ?? []).map((query) => ({ type: "query", query }));
}

async function runRgWorkflow(navigationCase: NavigationEvalCase, target: string): Promise<NavigationEvalWorkflowResult> {
  const steps: NavigationEvalStepResult[] = [];

  for (const terms of navigationCase.rgQueries) {
    const started = performance.now();
    const result = await runRgCommand(terms, target);
    const latencyMs = performance.now() - started;
    const matches = result.stdout.split(/\r?\n/).filter(Boolean).map(parseRgLine).filter((match): match is RgMatch => Boolean(match));
    const useful = usefulRgMatch(matches, navigationCase);
    steps.push({
      type: "rg",
      command: ["rg", "--line-number", "--with-filename", "--color", "never", "-F", ...terms.flatMap((term) => ["-e", term])].join(" "),
      latencyMs,
      contextChars: result.stdout.length,
      contextTokens: approximateTokens(result.stdout.length),
      usefulRank: useful?.rank ?? null,
      usefulFile: useful?.file ?? null,
      foundFiles: matchingRgFiles(matches, navigationCase),
      foundSymbols: matchingRgSymbols(matches, navigationCase)
    });
  }

  return summarizeWorkflow(steps, navigationCase);
}

async function runOptimizedRgWorkflow(navigationCase: NavigationEvalCase, target: string): Promise<NavigationEvalWorkflowResult> {
  if (navigationCase.rgOptimizedPlan?.version === 2) {
    return runOptimizedRgPlanWorkflow(navigationCase, target);
  }

  const steps: NavigationEvalStepResult[] = [];

  for (const step of optimizedRgSteps(navigationCase)) {
    const started = performance.now();
    if (step.type === "files") {
      const result = await runRgFilesCommand(step.terms, target, step.globs, step.paths);
      const candidateFiles = parseRgFileList(result.stdout);
      const visibleFiles = step.limit ? candidateFiles.slice(0, step.limit) : candidateFiles;
      const context = formatRgFileList(visibleFiles);
      const useful = usefulRgFileMatch(visibleFiles, navigationCase);
      steps.push({
        type: "rg-optimized",
        command: formatRgFilesCommand(step),
        latencyMs: performance.now() - started,
        contextChars: context.length,
        contextTokens: approximateTokens(context.length),
        usefulRank: useful?.rank ?? null,
        usefulFile: useful?.file ?? null,
        foundFiles: matchingRgCandidateFiles(visibleFiles, navigationCase),
        foundSymbols: [],
        outputFiles: visibleFiles,
        outputSymbols: []
      });
      continue;
    }

    const sourceFiles = step.files ?? steps[(step.fromStep ?? steps.length) - 1]?.outputFiles ?? [];
    const selectedFiles = sourceFiles.slice(0, step.limit ?? 5);
    const snippets = await readTopRgSnippets(selectedFiles, step.terms, target, step.before ?? 2, step.after ?? 2);
    const context = formatRgSnippets(snippets);
    const useful = usefulRgFileMatch(selectedFiles, navigationCase);
    steps.push({
      type: "rg-optimized",
      command: formatRgSnippetsCommand(step),
      latencyMs: performance.now() - started,
      contextChars: context.length,
      contextTokens: approximateTokens(context.length),
      usefulRank: useful?.rank ?? null,
      usefulFile: useful?.file ?? null,
      foundFiles: matchingRgCandidateFiles(selectedFiles, navigationCase),
      foundSymbols: matchingRgSnippetSymbols(snippets, navigationCase),
      outputFiles: selectedFiles,
      outputSymbols: matchingRgSnippetSymbols(snippets, navigationCase)
    });
  }

  return summarizeWorkflow(steps, navigationCase);
}

async function runOptimizedRgPlanWorkflow(navigationCase: NavigationEvalCase, target: string): Promise<NavigationEvalWorkflowResult> {
  const steps: NavigationEvalStepResult[] = [];

  for (const step of navigationCase.rgOptimizedPlan?.steps ?? []) {
    const started = performance.now();
    if (step.type === "search-files") {
      const result = await runRgFilesCommand(step.terms, target, step.globs, optimizedRgSearchPaths(step));
      const candidateFiles = parseRgFileList(result.stdout);
      const visibleFiles = step.limit ? candidateFiles.slice(0, step.limit) : candidateFiles;
      const context = formatRgFileList(visibleFiles);
      const useful = usefulRgFileMatch(visibleFiles, navigationCase);
      steps.push({
        type: "rg-optimized",
        command: formatRgPlanFilesCommand(step),
        latencyMs: performance.now() - started,
        contextChars: context.length,
        contextTokens: approximateTokens(context.length),
        usefulRank: useful?.rank ?? null,
        usefulFile: useful?.file ?? null,
        foundFiles: matchingRgCandidateFiles(visibleFiles, navigationCase),
        foundSymbols: [],
        outputFiles: visibleFiles,
        outputSymbols: [],
        outputTerms: step.terms
      });
      continue;
    }

    if (step.type === "read-snippets") {
      const sourceFiles = steps[step.fromStep - 1]?.outputFiles ?? [];
      const selectedFiles = sourceFiles.slice(0, step.limit ?? 5);
      const terms = step.terms ?? steps[step.fromStep - 1]?.outputTerms ?? [];
      const snippets = await readTopRgSnippets(selectedFiles, terms, target, step.before ?? 2, step.after ?? 2);
      const context = formatRgSnippets(snippets);
      const useful = usefulRgFileMatch(selectedFiles, navigationCase);
      const foundSymbols = matchingRgSnippetSymbols(snippets, navigationCase);
      steps.push({
        type: "rg-optimized",
        command: formatRgPlanSnippetsCommand(step),
        latencyMs: performance.now() - started,
        contextChars: context.length,
        contextTokens: approximateTokens(context.length),
        usefulRank: useful?.rank ?? null,
        usefulFile: useful?.file ?? null,
        foundFiles: matchingRgCandidateFiles(selectedFiles, navigationCase),
        foundSymbols,
        outputFiles: selectedFiles,
        outputSymbols: foundSymbols,
        outputTerms: extractSnippetTerms(snippets)
      });
      continue;
    }

    const terms = derivedSearchTerms(steps[step.fromStep - 1]?.outputTerms ?? [], step.includeTerms);
    const result = await runRgFilesCommand(terms, target, step.globs, optimizedRgSearchPaths(step));
    const candidateFiles = parseRgFileList(result.stdout);
    const visibleFiles = step.limit ? candidateFiles.slice(0, step.limit) : candidateFiles;
    const context = formatRgFileList(visibleFiles);
    const useful = usefulRgFileMatch(visibleFiles, navigationCase);
    steps.push({
      type: "rg-optimized",
      command: formatRgPlanFilesFromSnippetsCommand(step, terms),
      latencyMs: performance.now() - started,
      contextChars: context.length,
      contextTokens: approximateTokens(context.length),
      usefulRank: useful?.rank ?? null,
      usefulFile: useful?.file ?? null,
      foundFiles: matchingRgCandidateFiles(visibleFiles, navigationCase),
      foundSymbols: [],
      outputFiles: visibleFiles,
      outputSymbols: [],
      outputTerms: terms
    });
  }

  return summarizeWorkflow(steps, navigationCase);
}

function optimizedRgSearchPaths(step: Extract<NavigationRgOptimizedPlanStep, { type: "search-files" | "search-files-from-snippets" }>): string[] {
  if (step.paths && step.paths.length > 0) {
    return step.paths;
  }
  if (step.scope === "test") {
    return ["tests"];
  }
  return ["."];
}

function derivedSearchTerms(outputTerms: string[], includeTerms: string[] | undefined): string[] {
  if (!includeTerms || includeTerms.length === 0) {
    return outputTerms.slice(0, 5);
  }
  const normalizedOutputTerms = new Set(outputTerms.map(normalizeTargetName));
  return includeTerms.filter((term) => normalizedOutputTerms.has(normalizeTargetName(term)));
}

function extractSnippetTerms(snippets: RgSnippet[]): string[] {
  const terms: string[] = [];
  const stopwords = new Set([
    "assert",
    "class",
    "def",
    "false",
    "for",
    "from",
    "import",
    "none",
    "return",
    "self",
    "true"
  ]);
  for (const snippet of snippets) {
    for (const line of snippet.lines) {
      for (const match of line.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/gu)) {
        const term = match[0];
        if (!stopwords.has(term.toLowerCase())) {
          terms.push(term);
        }
      }
    }
  }
  return uniqueValues(terms).slice(0, 25);
}

function optimizedRgSteps(navigationCase: NavigationEvalCase): NavigationRgOptimizedStep[] {
  if (navigationCase.rgOptimizedSteps && navigationCase.rgOptimizedSteps.length > 0) {
    return navigationCase.rgOptimizedSteps;
  }
  return navigationCase.rgQueries.flatMap((terms, index): NavigationRgOptimizedStep[] => [
    { type: "files", terms },
    { type: "snippets", terms, fromStep: index * 2 + 1, limit: 5 }
  ]);
}

function scoreNavigationCase(
  navigationCase: NavigationEvalCase,
  agentIndex: NavigationEvalWorkflowResult,
  rg: NavigationEvalWorkflowResult,
  rgOptimized: NavigationEvalWorkflowResult
): NavigationEvalCaseResult {
  const tokenSavings = rg.contextTokens - agentIndex.contextTokens;
  const optimizedRgTokenSavings = rgOptimized.contextTokens - agentIndex.contextTokens;
  return {
    id: navigationCase.id,
    task: navigationCase.task,
    kind: navigationCase.kind ?? "maintenance",
    expectedFiles: navigationCase.expected.files,
    expectedSymbols: navigationCase.expected.symbols ?? [],
    agentIndex,
    rg,
    rgOptimized,
    tokenSavings,
    tokenSavingsRatio: rg.contextTokens === 0 ? null : Number((tokenSavings / rg.contextTokens).toFixed(4)),
    optimizedRgTokenSavings,
    optimizedRgTokenSavingsRatio:
      rgOptimized.contextTokens === 0 ? null : Number((optimizedRgTokenSavings / rgOptimized.contextTokens).toFixed(4)),
    commandSavings: rg.commands - agentIndex.commands,
    optimizedRgCommandSavings: rgOptimized.commands - agentIndex.commands,
    winner: pickWinner(agentIndex, rg),
    optimizedRgWinner: pickOptimizedRgWinner(agentIndex, rgOptimized)
  };
}

function summarizeNavigationCases(caseResults: NavigationEvalCaseResult[]): NavigationEvalResult {
  return {
    cases: caseResults.length,
    agentIndexUsefulRate: ratio(caseResults.filter((result) => result.agentIndex.foundUseful).length, caseResults.length),
    rgUsefulRate: ratio(caseResults.filter((result) => result.rg.foundUseful).length, caseResults.length),
    rgOptimizedUsefulRate: ratio(caseResults.filter((result) => result.rgOptimized.foundUseful).length, caseResults.length),
    agentIndexCompletionRate: ratio(caseResults.filter((result) => result.agentIndex.taskComplete).length, caseResults.length),
    rgCompletionRate: ratio(caseResults.filter((result) => result.rg.taskComplete).length, caseResults.length),
    rgOptimizedCompletionRate: ratio(caseResults.filter((result) => result.rgOptimized.taskComplete).length, caseResults.length),
    agentIndexAvgCommands: ratio(caseResults.reduce((sum, result) => sum + result.agentIndex.commands, 0), caseResults.length),
    rgAvgCommands: ratio(caseResults.reduce((sum, result) => sum + result.rg.commands, 0), caseResults.length),
    rgOptimizedAvgCommands: ratio(caseResults.reduce((sum, result) => sum + result.rgOptimized.commands, 0), caseResults.length),
    agentIndexAvgLatencyMs: ratio(caseResults.reduce((sum, result) => sum + result.agentIndex.latencyMs, 0), caseResults.length),
    rgAvgLatencyMs: ratio(caseResults.reduce((sum, result) => sum + result.rg.latencyMs, 0), caseResults.length),
    rgOptimizedAvgLatencyMs: ratio(caseResults.reduce((sum, result) => sum + result.rgOptimized.latencyMs, 0), caseResults.length),
    agentIndexAvgFirstUsefulLatencyMs: averagePresent(caseResults.map((result) => result.agentIndex.firstUsefulLatencyMs)),
    rgAvgFirstUsefulLatencyMs: averagePresent(caseResults.map((result) => result.rg.firstUsefulLatencyMs)),
    rgOptimizedAvgFirstUsefulLatencyMs: averagePresent(caseResults.map((result) => result.rgOptimized.firstUsefulLatencyMs)),
    agentIndexAvgCompletionLatencyMs: averagePresent(caseResults.map((result) => result.agentIndex.completionLatencyMs)),
    rgAvgCompletionLatencyMs: averagePresent(caseResults.map((result) => result.rg.completionLatencyMs)),
    rgOptimizedAvgCompletionLatencyMs: averagePresent(caseResults.map((result) => result.rgOptimized.completionLatencyMs)),
    agentIndexAvgContextTokens: ratio(
      caseResults.reduce((sum, result) => sum + result.agentIndex.contextTokens, 0),
      caseResults.length
    ),
    rgAvgContextTokens: ratio(caseResults.reduce((sum, result) => sum + result.rg.contextTokens, 0), caseResults.length),
    rgOptimizedAvgContextTokens: ratio(
      caseResults.reduce((sum, result) => sum + result.rgOptimized.contextTokens, 0),
      caseResults.length
    ),
    agentIndexAvgFirstUsefulContextTokens: averagePresent(caseResults.map((result) => result.agentIndex.firstUsefulContextTokens)),
    rgAvgFirstUsefulContextTokens: averagePresent(caseResults.map((result) => result.rg.firstUsefulContextTokens)),
    rgOptimizedAvgFirstUsefulContextTokens: averagePresent(caseResults.map((result) => result.rgOptimized.firstUsefulContextTokens)),
    agentIndexAvgCompletionContextTokens: averagePresent(caseResults.map((result) => result.agentIndex.completionContextTokens)),
    rgAvgCompletionContextTokens: averagePresent(caseResults.map((result) => result.rg.completionContextTokens)),
    rgOptimizedAvgCompletionContextTokens: averagePresent(caseResults.map((result) => result.rgOptimized.completionContextTokens)),
    avgTokenSavings: ratio(caseResults.reduce((sum, result) => sum + result.tokenSavings, 0), caseResults.length),
    avgOptimizedRgTokenSavings: ratio(
      caseResults.reduce((sum, result) => sum + result.optimizedRgTokenSavings, 0),
      caseResults.length
    ),
    agentIndexWins: caseResults.filter((result) => result.winner === "agent-index").length,
    rgWins: caseResults.filter((result) => result.winner === "rg").length,
    ties: caseResults.filter((result) => result.winner === "tie").length,
    inconclusive: caseResults.filter((result) => result.winner === "inconclusive").length,
    agentIndexWinsVsOptimizedRg: caseResults.filter((result) => result.optimizedRgWinner === "agent-index").length,
    rgOptimizedWins: caseResults.filter((result) => result.optimizedRgWinner === "rg-optimized").length,
    optimizedRgTies: caseResults.filter((result) => result.optimizedRgWinner === "tie").length,
    optimizedRgInconclusive: caseResults.filter((result) => result.optimizedRgWinner === "inconclusive").length,
    caseResults
  };
}

function summarizeWorkflow(steps: NavigationEvalStepResult[], navigationCase?: NavigationEvalCase): NavigationEvalWorkflowResult {
  const usefulIndex = steps.findIndex((step) => step.usefulRank !== null);
  const expectedFiles = navigationCase?.expected.files ?? [];
  const expectedSymbols = navigationCase?.expected.symbols ?? [];
  const requiredFiles = navigationCase?.expected.requiredFiles ?? expectedFiles;
  const requiredSymbols = navigationCase?.expected.requiredSymbols ?? expectedSymbols;
  const foundFiles = uniqueValues(steps.flatMap((step) => step.foundFiles));
  const foundSymbols = uniqueValues(steps.flatMap((step) => step.foundSymbols));
  const missingFiles = requiredFiles.filter((file) => !foundFiles.includes(file));
  const missingSymbols = requiredSymbols.filter((symbol) => !foundSymbols.includes(symbol));
  const firstUsefulLatencyMs = usefulIndex === -1 ? null : steps.slice(0, usefulIndex + 1).reduce((sum, step) => sum + step.latencyMs, 0);
  const firstUsefulContextTokens =
    usefulIndex === -1 ? null : steps.slice(0, usefulIndex + 1).reduce((sum, step) => sum + step.contextTokens, 0);
  const completionIndex = firstCompletionIndex(steps, requiredFiles, requiredSymbols);
  const completionLatencyMs =
    completionIndex === -1 ? null : steps.slice(0, completionIndex + 1).reduce((sum, step) => sum + step.latencyMs, 0);
  const completionContextTokens =
    completionIndex === -1 ? null : steps.slice(0, completionIndex + 1).reduce((sum, step) => sum + step.contextTokens, 0);
  return {
    commands: steps.length,
    foundUseful: usefulIndex !== -1,
    taskComplete: missingFiles.length === 0 && missingSymbols.length === 0,
    firstUsefulCommand: usefulIndex === -1 ? null : usefulIndex + 1,
    firstUsefulRank: usefulIndex === -1 ? null : steps[usefulIndex].usefulRank,
    foundFiles,
    foundSymbols,
    missingFiles,
    missingSymbols,
    firstUsefulLatencyMs,
    firstUsefulContextTokens,
    completionCommand: completionIndex === -1 ? null : completionIndex + 1,
    completionLatencyMs,
    completionContextTokens,
    latencyMs: steps.reduce((sum, step) => sum + step.latencyMs, 0),
    contextChars: steps.reduce((sum, step) => sum + step.contextChars, 0),
    contextTokens: steps.reduce((sum, step) => sum + step.contextTokens, 0),
    steps
  };
}

function firstCompletionIndex(steps: NavigationEvalStepResult[], requiredFiles: string[], requiredSymbols: string[]): number {
  const foundFiles: string[] = [];
  const foundSymbols: string[] = [];
  for (const [index, step] of steps.entries()) {
    foundFiles.push(...step.foundFiles);
    foundSymbols.push(...step.foundSymbols);
    if (
      requiredFiles.every((file) => foundFiles.includes(file)) &&
      requiredSymbols.every((symbol) => foundSymbols.includes(symbol))
    ) {
      return index;
    }
  }
  return -1;
}

function pickWinner(
  agentIndex: NavigationEvalWorkflowResult,
  rg: NavigationEvalWorkflowResult
): NavigationEvalCaseResult["winner"] {
  if (agentIndex.taskComplete && !rg.taskComplete) {
    return "agent-index";
  }
  if (!agentIndex.taskComplete && rg.taskComplete) {
    return "rg";
  }
  if (!agentIndex.foundUseful && !rg.foundUseful) {
    return "inconclusive";
  }
  if (agentIndex.contextTokens < rg.contextTokens && usefulCommand(agentIndex) <= usefulCommand(rg)) {
    return "agent-index";
  }
  if (rg.contextTokens < agentIndex.contextTokens && usefulCommand(rg) <= usefulCommand(agentIndex)) {
    return "rg";
  }
  return "tie";
}

function pickOptimizedRgWinner(
  agentIndex: NavigationEvalWorkflowResult,
  rgOptimized: NavigationEvalWorkflowResult
): NavigationEvalCaseResult["optimizedRgWinner"] {
  if (agentIndex.taskComplete && !rgOptimized.taskComplete) {
    return "agent-index";
  }
  if (!agentIndex.taskComplete && rgOptimized.taskComplete) {
    return "rg-optimized";
  }
  if (!agentIndex.foundUseful && !rgOptimized.foundUseful) {
    return "inconclusive";
  }
  if (agentIndex.contextTokens < rgOptimized.contextTokens && usefulCommand(agentIndex) <= usefulCommand(rgOptimized)) {
    return "agent-index";
  }
  if (rgOptimized.contextTokens < agentIndex.contextTokens && usefulCommand(rgOptimized) <= usefulCommand(agentIndex)) {
    return "rg-optimized";
  }
  return "tie";
}

function usefulCommand(workflow: NavigationEvalWorkflowResult): number {
  return workflow.firstUsefulCommand ?? Number.POSITIVE_INFINITY;
}

function averagePresent(values: Array<number | null>): number {
  const present = values.filter((value): value is number => value !== null);
  return ratio(present.reduce((sum, value) => sum + value, 0), present.length);
}

function usefulAgentMatch(matches: QueryMatch[], navigationCase: NavigationEvalCase): { rank: number; file: string; symbol: string } | undefined {
  const expectedFiles = new Set(navigationCase.expected.files);
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  const index = matches.findIndex((match) => expectedFiles.has(match.file) || matchesExpectedSymbol(match.symbol, expectedSymbols));
  if (index === -1) {
    return undefined;
  }
  return { rank: index + 1, file: matches[index].file, symbol: matches[index].symbol };
}

function matchingAgentFiles(matches: QueryMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedFiles = new Set(navigationCase.expected.files);
  return uniqueValues(matches.map((match) => match.file).filter((file) => expectedFiles.has(file)));
}

function matchingAgentSymbols(matches: QueryMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  return uniqueValues(queryOutputSymbols(matches).map((symbol) => expectedSymbolMatch(symbol, expectedSymbols)).filter((symbol): symbol is string => Boolean(symbol)));
}

function queryOutputSymbols(matches: QueryMatch[]): string[] {
  return matches.flatMap((match) => [
    match.symbol,
    ...match.neighbors.map((neighbor) => neighbor.symbol)
  ]);
}

function usefulFileCluster(
  clusters: FileClusterMatch[],
  navigationCase: NavigationEvalCase
): { rank: number; file: string; symbol: string | null } | undefined {
  const expectedFiles = new Set(navigationCase.expected.files);
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  const index = clusters.findIndex(
    (cluster) => expectedFiles.has(cluster.file) || cluster.symbols.some((symbol) => matchesExpectedSymbol(symbol.name, expectedSymbols))
  );
  if (index === -1) {
    return undefined;
  }
  const symbol = clusters[index].symbols.find((clusterSymbol) => matchesExpectedSymbol(clusterSymbol.name, expectedSymbols));
  return { rank: index + 1, file: clusters[index].file, symbol: symbol ? (expectedSymbolMatch(symbol.name, expectedSymbols) ?? null) : null };
}

function matchingClusterFiles(clusters: FileClusterMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedFiles = new Set(navigationCase.expected.files);
  return uniqueValues(clusters.map((cluster) => cluster.file).filter((file) => expectedFiles.has(file)));
}

function matchingClusterSymbols(clusters: FileClusterMatch[], navigationCase: NavigationEvalCase): string[] {
  return matchingSymbols(clusters.flatMap((cluster) => cluster.symbols.map((symbol) => symbol.name)), navigationCase);
}

function matchingSymbols(symbols: string[], navigationCase: NavigationEvalCase): string[] {
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  return uniqueValues(symbols.map((symbol) => expectedSymbolMatch(symbol, expectedSymbols)).filter((symbol): symbol is string => Boolean(symbol)));
}

function clusterOutputSymbols(clusters: FileClusterMatch[], options: NavigationEvalOptions): string[] {
  return uniqueValues([
    ...clusters.flatMap((cluster) => cluster.symbols.map((symbol) => symbol.name)),
    ...topLevelSymbolsForFiles(options, clusters.map((cluster) => cluster.file))
  ]);
}

function topLevelSymbolsForFiles(options: NavigationEvalOptions, files: string[]): string[] {
  const selectedFiles = uniqueValues(files);
  if (selectedFiles.length === 0) {
    return [];
  }
  const dbPath = options.indexPath ?? path.join(path.resolve(options.target), ".codeindex", "index.sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    const params = Object.fromEntries(selectedFiles.map((file, index) => [`file${index}`, file]));
    const fileList = selectedFiles.map((_, index) => `@file${index}`).join(", ");
    const rows = db
      .prepare(
        `
        select s.qualified_name as symbol
        from symbols s
        join files f on f.id = s.file_id
        left join symbols parent on parent.id = s.parent_symbol_id
        where f.path in (${fileList})
          and (s.parent_symbol_id is null or parent.kind = 'module')
          and s.kind in ('class', 'function', 'method', 'typealias')
        order by f.path, s.start_line
        `
      )
      .all(params) as Array<{ symbol: string }>;
    return rows.map((row) => row.symbol);
  } finally {
    db.close();
  }
}

function usefulRelatedTest(
  matches: RelatedTestMatch[],
  navigationCase: NavigationEvalCase
): { rank: number; file: string } | undefined {
  const expectedFiles = new Set(navigationCase.expected.files);
  const index = matches.findIndex((match) => expectedFiles.has(match.file));
  return index === -1 ? undefined : { rank: index + 1, file: matches[index].file };
}

function matchingRelatedTestFiles(matches: RelatedTestMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedFiles = new Set(navigationCase.expected.files);
  return uniqueValues(matches.map((match) => match.file).filter((file) => expectedFiles.has(file)));
}

function matchingRelatedTestSymbols(matches: RelatedTestMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  return uniqueValues(
    matches
      .flatMap((match) => match.symbols.map((symbol) => expectedSymbolMatch(symbol, expectedSymbols)))
      .filter((symbol): symbol is string => Boolean(symbol))
  );
}

function usefulSourceTestBundle(
  bundles: SourceTestBundle[],
  navigationCase: NavigationEvalCase
): { rank: number; file: string; symbol: string | null } | undefined {
  const expectedFiles = new Set(navigationCase.expected.files);
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  const index = bundles.findIndex(
    (bundle) =>
      expectedFiles.has(bundle.source.file) ||
      bundle.tests.some((test) => expectedFiles.has(test.file)) ||
      bundle.source.symbols.some((symbol) => matchesExpectedSymbol(symbol.name, expectedSymbols)) ||
      bundle.tests.some((test) => test.symbols.some((symbol) => matchesExpectedSymbol(symbol, expectedSymbols)))
  );
  if (index === -1) {
    return undefined;
  }
  const symbol = bundles[index].source.symbols.find((sourceSymbol) => matchesExpectedSymbol(sourceSymbol.name, expectedSymbols));
  return { rank: index + 1, file: bundles[index].source.file, symbol: symbol ? (expectedSymbolMatch(symbol.name, expectedSymbols) ?? null) : null };
}

function matchingSourceTestFiles(bundles: SourceTestBundle[], navigationCase: NavigationEvalCase): string[] {
  const expectedFiles = new Set(navigationCase.expected.files);
  return uniqueValues(
    bundles.flatMap((bundle) => [bundle.source.file, ...bundle.tests.map((test) => test.file)]).filter((file) => expectedFiles.has(file))
  );
}

function matchingSourceTestSymbols(bundles: SourceTestBundle[], navigationCase: NavigationEvalCase): string[] {
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  return uniqueValues(
    bundles
      .flatMap((bundle) => [...bundle.source.symbols.map((symbol) => symbol.name), ...bundle.tests.flatMap((test) => test.symbols)])
      .map((symbol) => expectedSymbolMatch(symbol, expectedSymbols))
      .filter((symbol): symbol is string => Boolean(symbol))
  );
}

function usefulRgMatch(matches: RgMatch[], navigationCase: NavigationEvalCase): { rank: number; file: string } | undefined {
  const expectedFiles = new Set(navigationCase.expected.files);
  const seenFiles: string[] = [];
  for (const match of matches) {
    if (!seenFiles.includes(match.file)) {
      seenFiles.push(match.file);
    }
  }
  const index = seenFiles.findIndex((file) => expectedFiles.has(file));
  return index === -1 ? undefined : { rank: index + 1, file: seenFiles[index] };
}

function matchingRgFiles(matches: RgMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedFiles = new Set(navigationCase.expected.files);
  return uniqueValues(matches.map((match) => match.file).filter((file) => expectedFiles.has(file)));
}

function matchingRgSymbols(matches: RgMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  return expectedSymbols.filter((symbol) => matches.some((match) => match.text.includes(symbol)));
}

function usefulRgFileMatch(files: string[], navigationCase: NavigationEvalCase): { rank: number; file: string } | undefined {
  const expectedFiles = new Set(navigationCase.expected.files);
  const index = files.findIndex((file) => expectedFiles.has(file));
  return index === -1 ? undefined : { rank: index + 1, file: files[index] };
}

function matchingRgCandidateFiles(files: string[], navigationCase: NavigationEvalCase): string[] {
  const expectedFiles = new Set(navigationCase.expected.files);
  return uniqueValues(files.filter((file) => expectedFiles.has(file)));
}

function matchingRgSnippetSymbols(snippets: RgSnippet[], navigationCase: NavigationEvalCase): string[] {
  const expectedSymbols = navigationCase.expected.symbols ?? [];
  const text = snippets.flatMap((snippet) => snippet.lines).join("\n");
  return expectedSymbols.filter((symbol) => text.includes(symbol));
}

function matchesExpectedSymbol(actual: string, expectedSymbols: string[]): boolean {
  return Boolean(expectedSymbolMatch(actual, expectedSymbols));
}

function expectedSymbolMatch(actual: string, expectedSymbols: string[]): string | undefined {
  return expectedSymbols.find((expected) => actual === expected || actual.endsWith(`.${expected}`));
}

function formatCompactMatches(matches: QueryMatch[]): string {
  if (matches.length === 0) {
    return "No matches";
  }
  return matches
    .map(
      (match, index) =>
        `${index + 1} ${match.file}:${match.lines[0]}-${match.lines[1]} ${match.kind} ${match.symbol}${formatEvidence(match.evidence)}`
    )
    .join("\n");
}

function formatCompactClusters(clusters: FileClusterMatch[]): string {
  if (clusters.length === 0) {
    return "No file clusters";
  }
  return clusters
    .map((cluster, index) => {
      const symbols = cluster.symbols.slice(0, 1).map((symbol) => `${symbol.kind} ${symbol.name}:${symbol.lines[0]}`).join("; ");
      return `${index + 1} ${cluster.file} role=${cluster.role} chunks=${cluster.matchedChunks} symbols=${symbols}${formatEvidence(cluster.evidence)}`;
    })
    .join("\n");
}

function formatCompactRelatedTests(matches: RelatedTestMatch[]): string {
  if (matches.length === 0) {
    return "No related tests";
  }
  return matches
    .map((match, index) => `${index + 1} ${match.file}${match.firstLine === null ? "" : `:${match.firstLine}`} score=${match.score}`)
    .join("\n");
}

function formatCompactSourceTests(bundles: SourceTestBundle[]): string {
  if (bundles.length === 0) {
    return "No source/test bundles";
  }
  return bundles
    .map((bundle, index) => {
      const sourceSymbol = bundle.source.symbols[0];
      const source = sourceSymbol ? `${bundle.source.file}:${sourceSymbol.lines[0]} ${sourceSymbol.name}` : bundle.source.file;
      const tests = bundle.tests
        .slice(0, 2)
        .map((test) => `${test.file}${test.firstLine === null ? "" : `:${test.firstLine}`}`)
        .join(", ");
      return `${index + 1} ${source}${tests ? ` -> ${tests}` : ""}`;
    })
    .join("\n");
}

function formatEvidence(evidence: string | undefined): string {
  return evidence ? ` evidence=${JSON.stringify(evidence)}` : "";
}

function formatRgFileList(files: string[]): string {
  return files.length === 0 ? "No matching files" : files.map((file, index) => `${index + 1} ${file}`).join("\n");
}

function formatRgSnippets(snippets: RgSnippet[]): string {
  if (snippets.length === 0) {
    return "No snippets";
  }
  return snippets
    .map((snippet) =>
      [
        `--- ${snippet.file}:${snippet.startLine}`,
        ...snippet.lines.map((line, index) => `${snippet.startLine + index}: ${line}`)
      ].join("\n")
    )
    .join("\n");
}

function formatAgentCommand(agentQuery: AgentQuery): string {
  return `agent-index query ${agentQuery.terms.map(shellQuote).join(" ")}`;
}

function formatFileClustersCommand(agentQuery: AgentQuery): string {
  return `agent-index file-clusters ${agentQuery.terms.map(shellQuote).join(" ")}`;
}

function formatSourceTestsCommand(step: Extract<NavigationAgentStep, { type: "source-tests" }>): string {
  const fanout = step.testFanoutLimit === undefined ? "" : ` --test-fanout-limit ${step.testFanoutLimit}`;
  return `agent-index source-tests ${step.query.terms.map(shellQuote).join(" ")}${fanout}`;
}

function formatRelatedTestsCommand(step: Extract<NavigationAgentStep, { type: "related-tests" }>): string {
  const source = step.sourceFile ?? (step.sourceFromStep ? `step:${step.sourceFromStep}` : "previous-step");
  const symbol = step.symbol ? ` --symbol ${shellQuote(step.symbol)}` : "";
  const terms = step.terms && step.terms.length > 0 ? ` ${step.terms.map((term) => `--term ${shellQuote(term)}`).join(" ")}` : "";
  return `agent-index related-tests --source ${shellQuote(source)}${symbol}${terms}`;
}

function runRgCommand(terms: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const args = ["--line-number", "--with-filename", "--color", "never", "-F", ...terms.flatMap((term) => ["-e", term]), "."];
    const child = spawn("rg", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`rg navigation baseline failed with exit code ${code ?? 1}: ${stderr.trim()}`));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function runRgFilesCommand(
  terms: string[],
  cwd: string,
  globs: string[] = [],
  paths: string[] = ["."]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (terms.length === 0) {
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
  }

  return new Promise((resolve, reject) => {
    const args = [
      "--files-with-matches",
      "--color",
      "never",
      "-F",
      ...globs.flatMap((glob) => ["--glob", glob]),
      ...terms.flatMap((term) => ["-e", term]),
      ...paths
    ];
    const child = spawn("rg", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`rg optimized navigation baseline failed with exit code ${code ?? 1}: ${stderr.trim()}`));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function parseRgFileList(stdout: string): string[] {
  return stdout.split(/\r?\n/).filter(Boolean).map((file) => file.replace(/^\.\//u, ""));
}

async function readTopRgSnippets(
  files: string[],
  terms: string[],
  target: string,
  before: number,
  after: number
): Promise<RgSnippet[]> {
  const snippets: RgSnippet[] = [];
  for (const file of files) {
    const text = await readFile(path.join(target, file), "utf8").catch(() => "");
    if (!text) {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const index = firstTermLineIndex(lines, terms);
    const start = Math.max(0, index - before);
    const end = Math.min(lines.length, index + after + 1);
    snippets.push({
      file,
      startLine: start + 1,
      lines: lines.slice(start, end)
    });
  }
  return snippets;
}

function formatRgFilesCommand(step: Extract<NavigationRgOptimizedStep, { type: "files" }>): string {
  const globs = step.globs?.flatMap((glob) => ["--glob", shellQuote(glob)]).join(" ");
  const paths = step.paths?.map(shellQuote).join(" ") ?? ".";
  const limit = step.limit ? ` | head -${step.limit}` : "";
  return ["rg", "--files-with-matches", "--color", "never", "-F", globs, ...step.terms.flatMap((term) => ["-e", shellQuote(term)]), paths]
    .filter(Boolean)
    .join(" ")
    .concat(limit);
}

function formatRgSnippetsCommand(step: Extract<NavigationRgOptimizedStep, { type: "snippets" }>): string {
  const source = step.files ? step.files.map(shellQuote).join(" ") : `step:${step.fromStep ?? "previous"}`;
  const context = `-C ${Math.max(step.before ?? 2, step.after ?? 2)}`;
  return ["rg", "--line-number", context, "--color", "never", "-F", ...step.terms.flatMap((term) => ["-e", shellQuote(term)]), source]
    .filter(Boolean)
    .join(" ");
}

function formatRgPlanFilesCommand(step: Extract<NavigationRgOptimizedPlanStep, { type: "search-files" }>): string {
  const globs = step.globs?.flatMap((glob) => ["--glob", shellQuote(glob)]).join(" ");
  const paths = optimizedRgSearchPaths(step).map(shellQuote).join(" ");
  const limit = step.limit ? ` | head -${step.limit}` : "";
  return ["rg", "--files-with-matches", "--color", "never", "-F", globs, ...step.terms.flatMap((term) => ["-e", shellQuote(term)]), paths]
    .filter(Boolean)
    .join(" ")
    .concat(limit);
}

function formatRgPlanSnippetsCommand(step: Extract<NavigationRgOptimizedPlanStep, { type: "read-snippets" }>): string {
  const terms = step.terms ?? [];
  const context = `-C ${Math.max(step.before ?? 2, step.after ?? 2)}`;
  return ["rg", "--line-number", context, "--color", "never", "-F", ...terms.flatMap((term) => ["-e", shellQuote(term)]), `step:${step.fromStep}`]
    .filter(Boolean)
    .join(" ");
}

function formatRgPlanFilesFromSnippetsCommand(
  step: Extract<NavigationRgOptimizedPlanStep, { type: "search-files-from-snippets" }>,
  terms: string[]
): string {
  const globs = step.globs?.flatMap((glob) => ["--glob", shellQuote(glob)]).join(" ");
  const paths = optimizedRgSearchPaths(step).map(shellQuote).join(" ");
  const limit = step.limit ? ` | head -${step.limit}` : "";
  return [
    "rg",
    "--files-with-matches",
    "--color",
    "never",
    "-F",
    "--from-snippets",
    `step:${step.fromStep}`,
    globs,
    ...terms.flatMap((term) => ["-e", shellQuote(term)]),
    paths
  ]
    .filter(Boolean)
    .join(" ")
    .concat(limit);
}

function firstTermLineIndex(lines: string[], terms: string[]): number {
  const index = lines.findIndex((line) => terms.some((term) => line.includes(term)));
  return index === -1 ? 0 : index;
}

function parseRgLine(line: string): RgMatch | undefined {
  const match = /^(.*?):(\d+):(.*)$/u.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    file: match[1].replace(/^\.\//u, ""),
    line: Number.parseInt(match[2], 10),
    text: match[3]
  };
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=*-]+$/u.test(value) ? value : JSON.stringify(value);
}

function approximateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function compactOutputValues(values: string[]): string[] {
  return uniqueValues(values).slice(0, 10);
}
