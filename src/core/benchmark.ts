import { readFile } from "node:fs/promises";
import type { BenchmarkCaseResult, BenchmarkQuestion, BenchmarkResult, QueryMatch } from "./schema.js";
import { queryIndex } from "./query.js";

export interface BenchmarkOptions {
  target: string;
  indexPath?: string;
}

export async function runBenchmark(benchmarkPath: string, options: BenchmarkOptions): Promise<BenchmarkResult> {
  const questions = JSON.parse(await readFile(benchmarkPath, "utf8")) as BenchmarkQuestion[];
  const cases: BenchmarkCaseResult[] = [];

  for (const question of questions) {
    const started = performance.now();
    const response = await queryIndex(question.question, { ...options, limit: 5 });
    const latencyMs = performance.now() - started;
    cases.push(scoreCase(question, response.matches, latencyMs));
  }

  return {
    questions: questions.length,
    hitAt1: ratio(cases.filter((result) => result.hitAt1).length, questions.length),
    hitAt5: ratio(cases.filter((result) => result.hitAt5).length, questions.length),
    mrr: ratio(
      cases.reduce((sum, result) => sum + result.reciprocalRank, 0),
      questions.length
    ),
    partialFileHits: ratio(cases.filter((result) => result.partialFileHit).length, questions.length),
    avgLatencyMs: ratio(
      cases.reduce((sum, result) => sum + result.latencyMs, 0),
      questions.length
    ),
    cases
  };
}

function scoreCase(question: BenchmarkQuestion, matches: QueryMatch[], latencyMs: number): BenchmarkCaseResult {
  const expectedSymbols = new Set(question.expected.symbols);
  const expectedFiles = new Set(question.expected.files);
  const firstSymbolRank = matches.findIndex((match) => expectedSymbols.has(match.symbol));
  const firstFileRank = matches.findIndex((match) => expectedFiles.has(match.file));
  const symbolRank = firstSymbolRank === -1 ? undefined : firstSymbolRank + 1;
  const fileRank = firstFileRank === -1 ? undefined : firstFileRank + 1;
  const bestRank = Math.min(symbolRank ?? Number.POSITIVE_INFINITY, fileRank ?? Number.POSITIVE_INFINITY);
  const hasAnyRank = Number.isFinite(bestRank);

  return {
    id: question.id,
    hitAt1: bestRank === 1,
    hitAt5: hasAnyRank && bestRank <= 5,
    reciprocalRank: hasAnyRank ? 1 / bestRank : 0,
    partialFileHit: symbolRank === undefined && fileRank !== undefined && fileRank <= 5,
    latencyMs,
    firstMatch: matches[0]
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}
