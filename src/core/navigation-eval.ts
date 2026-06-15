import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type {
  AgentQuery,
  FileClusterMatch,
  NavigationEvalCase,
  NavigationEvalCaseResult,
  NavigationEvalResult,
  NavigationAgentStep,
  NavigationEvalStepResult,
  NavigationEvalWorkflowResult,
  QueryMatch,
  QueryMode,
  RelatedTestMatch
} from "./schema.js";
import { findFileClusters } from "./file-clusters.js";
import { queryAgentIndex } from "./query.js";
import { findRelatedTests } from "./related-tests.js";

export interface NavigationEvalOptions {
  target: string;
  indexPath?: string;
  mode?: QueryMode;
}

interface RgMatch {
  file: string;
  line: number;
  text: string;
}

export async function runNavigationEval(
  navigationEvalPath: string,
  options: NavigationEvalOptions
): Promise<NavigationEvalResult> {
  const cases = JSON.parse(await readFile(navigationEvalPath, "utf8")) as NavigationEvalCase[];
  const caseResults: NavigationEvalCaseResult[] = [];

  for (const navigationCase of cases) {
    const agentIndex = await runAgentIndexWorkflow(navigationCase, options);
    const rg = await runRgWorkflow(navigationCase, options.target);
    caseResults.push(scoreNavigationCase(navigationCase, agentIndex, rg));
  }

  return summarizeNavigationCases(caseResults);
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
      outputSymbols: compactOutputValues(response.matches.map((match) => match.symbol))
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
      foundSymbols: matchingClusterSymbols(result.clusters, navigationCase),
      outputFiles: uniqueValues(result.clusters.map((cluster) => cluster.file)),
      outputSymbols: compactOutputValues(result.clusters.flatMap((cluster) => cluster.symbols.map((symbol) => symbol.name)))
    };
  }

  const sourceFile = resolveRelatedTestsSource(step, previousSteps);
  const symbol = step.symbol ?? resolveRelatedTestsSymbol(previousSteps);
  const result = findRelatedTests({
    target: options.target,
    indexPath: options.indexPath,
    sourceFile,
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

function resolveRelatedTestsSource(
  step: Extract<NavigationAgentStep, { type: "related-tests" }>,
  previousSteps: NavigationEvalStepResult[]
): string {
  if (step.sourceFile) {
    return step.sourceFile;
  }

  const sourceStep = step.sourceFromStep ? previousSteps[step.sourceFromStep - 1] : previousSteps.at(-1);
  const sourceFile = sourceStep?.outputFiles?.[0];
  if (!sourceFile) {
    throw new Error("related-tests step needs sourceFile or a previous step with at least one output file");
  }
  return sourceFile;
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

function scoreNavigationCase(
  navigationCase: NavigationEvalCase,
  agentIndex: NavigationEvalWorkflowResult,
  rg: NavigationEvalWorkflowResult
): NavigationEvalCaseResult {
  const tokenSavings = rg.contextTokens - agentIndex.contextTokens;
  return {
    id: navigationCase.id,
    task: navigationCase.task,
    kind: navigationCase.kind ?? "maintenance",
    expectedFiles: navigationCase.expected.files,
    expectedSymbols: navigationCase.expected.symbols ?? [],
    agentIndex,
    rg,
    tokenSavings,
    tokenSavingsRatio: rg.contextTokens === 0 ? null : Number((tokenSavings / rg.contextTokens).toFixed(4)),
    commandSavings: rg.commands - agentIndex.commands,
    winner: pickWinner(agentIndex, rg)
  };
}

function summarizeNavigationCases(caseResults: NavigationEvalCaseResult[]): NavigationEvalResult {
  return {
    cases: caseResults.length,
    agentIndexUsefulRate: ratio(caseResults.filter((result) => result.agentIndex.foundUseful).length, caseResults.length),
    rgUsefulRate: ratio(caseResults.filter((result) => result.rg.foundUseful).length, caseResults.length),
    agentIndexCompletionRate: ratio(caseResults.filter((result) => result.agentIndex.taskComplete).length, caseResults.length),
    rgCompletionRate: ratio(caseResults.filter((result) => result.rg.taskComplete).length, caseResults.length),
    agentIndexAvgCommands: ratio(caseResults.reduce((sum, result) => sum + result.agentIndex.commands, 0), caseResults.length),
    rgAvgCommands: ratio(caseResults.reduce((sum, result) => sum + result.rg.commands, 0), caseResults.length),
    agentIndexAvgLatencyMs: ratio(caseResults.reduce((sum, result) => sum + result.agentIndex.latencyMs, 0), caseResults.length),
    rgAvgLatencyMs: ratio(caseResults.reduce((sum, result) => sum + result.rg.latencyMs, 0), caseResults.length),
    agentIndexAvgContextTokens: ratio(
      caseResults.reduce((sum, result) => sum + result.agentIndex.contextTokens, 0),
      caseResults.length
    ),
    rgAvgContextTokens: ratio(caseResults.reduce((sum, result) => sum + result.rg.contextTokens, 0), caseResults.length),
    avgTokenSavings: ratio(caseResults.reduce((sum, result) => sum + result.tokenSavings, 0), caseResults.length),
    agentIndexWins: caseResults.filter((result) => result.winner === "agent-index").length,
    rgWins: caseResults.filter((result) => result.winner === "rg").length,
    ties: caseResults.filter((result) => result.winner === "tie").length,
    inconclusive: caseResults.filter((result) => result.winner === "inconclusive").length,
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
    latencyMs: steps.reduce((sum, step) => sum + step.latencyMs, 0),
    contextChars: steps.reduce((sum, step) => sum + step.contextChars, 0),
    contextTokens: steps.reduce((sum, step) => sum + step.contextTokens, 0),
    steps
  };
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

function usefulCommand(workflow: NavigationEvalWorkflowResult): number {
  return workflow.firstUsefulCommand ?? Number.POSITIVE_INFINITY;
}

function usefulAgentMatch(matches: QueryMatch[], navigationCase: NavigationEvalCase): { rank: number; file: string; symbol: string } | undefined {
  const expectedFiles = new Set(navigationCase.expected.files);
  const expectedSymbols = new Set(navigationCase.expected.symbols ?? []);
  const index = matches.findIndex((match) => expectedFiles.has(match.file) || expectedSymbols.has(match.symbol));
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
  const expectedSymbols = new Set(navigationCase.expected.symbols ?? []);
  return uniqueValues(matches.map((match) => match.symbol).filter((symbol) => expectedSymbols.has(symbol)));
}

function usefulFileCluster(
  clusters: FileClusterMatch[],
  navigationCase: NavigationEvalCase
): { rank: number; file: string; symbol: string | null } | undefined {
  const expectedFiles = new Set(navigationCase.expected.files);
  const expectedSymbols = new Set(navigationCase.expected.symbols ?? []);
  const index = clusters.findIndex(
    (cluster) => expectedFiles.has(cluster.file) || cluster.symbols.some((symbol) => expectedSymbols.has(symbol.name))
  );
  if (index === -1) {
    return undefined;
  }
  const symbol = clusters[index].symbols.find((clusterSymbol) => expectedSymbols.has(clusterSymbol.name));
  return { rank: index + 1, file: clusters[index].file, symbol: symbol?.name ?? null };
}

function matchingClusterFiles(clusters: FileClusterMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedFiles = new Set(navigationCase.expected.files);
  return uniqueValues(clusters.map((cluster) => cluster.file).filter((file) => expectedFiles.has(file)));
}

function matchingClusterSymbols(clusters: FileClusterMatch[], navigationCase: NavigationEvalCase): string[] {
  const expectedSymbols = new Set(navigationCase.expected.symbols ?? []);
  return uniqueValues(clusters.flatMap((cluster) => cluster.symbols.map((symbol) => symbol.name)).filter((symbol) => expectedSymbols.has(symbol)));
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
  const expectedSymbols = new Set(navigationCase.expected.symbols ?? []);
  return uniqueValues(matches.flatMap((match) => match.symbols).filter((symbol) => expectedSymbols.has(symbol)));
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

function formatCompactMatches(matches: QueryMatch[]): string {
  if (matches.length === 0) {
    return "No matches";
  }
  return matches
    .map((match, index) => `${index + 1} ${match.file}:${match.lines[0]}-${match.lines[1]} ${match.kind} ${match.symbol}`)
    .join("\n");
}

function formatCompactClusters(clusters: FileClusterMatch[]): string {
  if (clusters.length === 0) {
    return "No file clusters";
  }
  return clusters
    .map((cluster, index) => {
      const symbols = cluster.symbols.map((symbol) => `${symbol.kind} ${symbol.name}:${symbol.lines[0]}`).join("; ");
      return `${index + 1} ${cluster.file} role=${cluster.role} chunks=${cluster.matchedChunks} symbols=${symbols}`;
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

function formatAgentCommand(agentQuery: AgentQuery): string {
  return `agent-index query ${agentQuery.terms.map(shellQuote).join(" ")}`;
}

function formatFileClustersCommand(agentQuery: AgentQuery): string {
  return `agent-index file-clusters ${agentQuery.terms.map(shellQuote).join(" ")}`;
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
