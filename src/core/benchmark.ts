import { readFile } from "node:fs/promises";
import type { BenchmarkCaseResult, BenchmarkQuestion, BenchmarkResult, QueryMatch, QueryMode } from "./schema.js";
import { queryIndex } from "./query.js";

export interface BenchmarkOptions {
  target: string;
  indexPath?: string;
  includeSupportCode?: boolean;
  mode?: QueryMode;
}

export async function runBenchmark(benchmarkPath: string, options: BenchmarkOptions): Promise<BenchmarkResult> {
  const questions = JSON.parse(await readFile(benchmarkPath, "utf8")) as BenchmarkQuestion[];
  const cases: BenchmarkCaseResult[] = [];
  const mode = options.mode ?? "symbol";

  for (const question of questions) {
    const started = performance.now();
    const response = await queryIndex(question.question, { ...options, mode, limit: 5 });
    const latencyMs = performance.now() - started;
    cases.push(scoreCase(question, response.matches, latencyMs));
  }

  return {
    mode,
    questions: questions.length,
    symbolHitAt1: ratio(cases.filter((result) => result.symbolHitAt1).length, questions.length),
    symbolHitAt5: ratio(cases.filter((result) => result.symbolHitAt5).length, questions.length),
    symbolMrr: ratio(
      cases.reduce((sum, result) => sum + result.symbolReciprocalRank, 0),
      questions.length
    ),
    fileHitAt1: ratio(cases.filter((result) => result.fileHitAt1).length, questions.length),
    fileHitAt5: ratio(cases.filter((result) => result.fileHitAt5).length, questions.length),
    fileMrr: ratio(
      cases.reduce((sum, result) => sum + result.fileReciprocalRank, 0),
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

  return {
    id: question.id,
    symbolHitAt1: symbolRank === 1,
    symbolHitAt5: symbolRank !== undefined && symbolRank <= 5,
    symbolReciprocalRank: symbolRank === undefined ? 0 : 1 / symbolRank,
    fileHitAt1: fileRank === 1,
    fileHitAt5: fileRank !== undefined && fileRank <= 5,
    fileReciprocalRank: fileRank === undefined ? 0 : 1 / fileRank,
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
