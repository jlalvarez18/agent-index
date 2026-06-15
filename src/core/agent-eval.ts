import { readFile } from "node:fs/promises";
import { runBenchmark, type BenchmarkOptions } from "./benchmark.js";
import type {
  AgentEvalCaseResult,
  AgentEvalResult,
  BenchmarkCaseResult,
  BenchmarkQuestion,
  GraphifyMentionCaseResult,
  GraphifyQueryTextResult
} from "./schema.js";

export interface AgentEvalOptions extends BenchmarkOptions {
  graphifyResultsPath?: string;
}

export async function runAgentEval(benchmarkPath: string, options: AgentEvalOptions): Promise<AgentEvalResult> {
  const questions = JSON.parse(await readFile(benchmarkPath, "utf8")) as BenchmarkQuestion[];
  const agentIndex = await runBenchmark(benchmarkPath, options);
  const graphify = options.graphifyResultsPath
    ? scoreGraphifyResults(questions, await loadGraphifyResults(options.graphifyResultsPath))
    : undefined;

  return {
    questions: questions.length,
    mode: agentIndex.mode,
    agentIndex,
    graphify,
    cases: agentIndex.cases.map((agentCase) => compareCase(agentCase, graphify?.cases.find((c) => c.id === agentCase.id)))
  };
}

export function scoreGraphifyMentions(
  question: BenchmarkQuestion,
  text: string | undefined
): GraphifyMentionCaseResult {
  const normalized = (text ?? "").toLowerCase();
  return {
    id: question.id,
    question: question.question,
    expectedSymbols: question.expected.symbols,
    expectedFiles: question.expected.files,
    symbolMention: question.expected.symbols.some((symbol) => mentionsSymbol(normalized, symbol)),
    fileMention: question.expected.files.some((file) => normalized.includes(file.toLowerCase()))
  };
}

async function loadGraphifyResults(path: string): Promise<GraphifyQueryTextResult[]> {
  return JSON.parse(await readFile(path, "utf8")) as GraphifyQueryTextResult[];
}

function scoreGraphifyResults(
  questions: BenchmarkQuestion[],
  graphifyResults: GraphifyQueryTextResult[]
): AgentEvalResult["graphify"] {
  const resultsById = new Map(graphifyResults.map((result) => [result.id, result.text]));
  const cases = questions.map((question) => scoreGraphifyMentions(question, resultsById.get(question.id)));

  return {
    symbolMentionRate: ratio(cases.filter((result) => result.symbolMention).length, cases.length),
    fileMentionRate: ratio(cases.filter((result) => result.fileMention).length, cases.length),
    cases
  };
}

function compareCase(
  agentCase: BenchmarkCaseResult,
  graphifyCase: GraphifyMentionCaseResult | undefined
): AgentEvalCaseResult {
  return {
    id: agentCase.id,
    question: agentCase.question,
    agentIndexSymbolRank: agentCase.symbolRank,
    agentIndexFileRank: agentCase.fileRank,
    graphifySymbolMention: graphifyCase?.symbolMention ?? null,
    graphifyFileMention: graphifyCase?.fileMention ?? null,
    winner: pickWinner(agentCase, graphifyCase)
  };
}

function pickWinner(
  agentCase: BenchmarkCaseResult,
  graphifyCase: GraphifyMentionCaseResult | undefined
): AgentEvalCaseResult["winner"] {
  if (!graphifyCase) {
    return "inconclusive";
  }
  if (agentCase.symbolHitAt1 && graphifyCase.symbolMention) {
    return "tie";
  }
  if (agentCase.symbolHitAt1 && !graphifyCase.symbolMention) {
    return "agent-index";
  }
  if (!agentCase.symbolHitAt5 && graphifyCase.symbolMention) {
    return "graphify";
  }
  return "inconclusive";
}

function mentionsSymbol(text: string, symbol: string): boolean {
  const normalized = symbol.toLowerCase();
  return text.includes(normalized) || text.includes(`${normalized}()`);
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}
