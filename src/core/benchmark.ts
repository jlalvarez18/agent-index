import { readFile } from "node:fs/promises";
import type {
  BenchmarkCaseResult,
  BenchmarkQueryStyle,
  BenchmarkQuestion,
  BenchmarkResult,
  QueryMatch,
  QueryMode,
  RgBaselineCaseResult,
  RgBaselineResult,
  RgBaselineTopFile
} from "./schema.js";
import { queryAgentIndex, queryIndex } from "./query.js";
import { scanPythonFiles } from "./scanner.js";

export interface BenchmarkOptions {
  target: string;
  indexPath?: string;
  includeSupportCode?: boolean;
  mode?: QueryMode;
  debug?: boolean;
  queryStyle?: BenchmarkQueryStyle;
  includeRgBaseline?: boolean;
}

export async function runBenchmark(benchmarkPath: string, options: BenchmarkOptions): Promise<BenchmarkResult> {
  const questions = JSON.parse(await readFile(benchmarkPath, "utf8")) as BenchmarkQuestion[];
  const cases: BenchmarkCaseResult[] = [];
  const mode = options.mode ?? "symbol";
  const queryStyle = options.queryStyle ?? "question";

  for (const question of questions) {
    const started = performance.now();
    const response =
      queryStyle === "agent" && question.agentQuery
        ? await queryAgentIndex(question.agentQuery, { ...options, mode, limit: 5 })
        : await queryIndex(question.question, { ...options, mode, limit: 5 });
    const latencyMs = performance.now() - started;
    cases.push(scoreCase(question, response.matches, latencyMs));
  }

  return {
    mode,
    queryStyle,
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
    cases,
    rgBaseline: options.includeRgBaseline ? await runRgBaseline(questions, options.target) : undefined
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
    question: question.question,
    expectedSymbols: question.expected.symbols,
    expectedFiles: question.expected.files,
    symbolRank: symbolRank ?? null,
    fileRank: fileRank ?? null,
    symbolHitAt1: symbolRank === 1,
    symbolHitAt5: symbolRank !== undefined && symbolRank <= 5,
    symbolReciprocalRank: symbolRank === undefined ? 0 : 1 / symbolRank,
    fileHitAt1: fileRank === 1,
    fileHitAt5: fileRank !== undefined && fileRank <= 5,
    fileReciprocalRank: fileRank === undefined ? 0 : 1 / fileRank,
    partialFileHit: symbolRank === undefined && fileRank !== undefined && fileRank <= 5,
    latencyMs,
    firstMatch: matches[0],
    topMatches: matches.map((match, index) => ({
      ...match,
      rank: index + 1
    }))
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

async function runRgBaseline(questions: BenchmarkQuestion[], target: string): Promise<RgBaselineResult> {
  const cases: RgBaselineCaseResult[] = [];

  for (const question of questions) {
    const started = performance.now();
    const terms = baselineTerms(question);
    const scannedFiles = await scanPythonFiles(target, { includeSupportCode: !question.agentQuery?.excludeSupportCode });
    const files =
      question.agentQuery?.roles && question.agentQuery.roles.length > 0
        ? scannedFiles.filter((file) => question.agentQuery?.roles?.includes(file.role))
        : scannedFiles;
    const topFiles = files
      .map((file): RgBaselineTopFile | undefined => {
        const score = scoreFileForTerms(file.relativePath, file.text, terms);
        if (score === 0) {
          return undefined;
        }
        return {
          rank: 0,
          file: file.relativePath,
          score,
          firstLine: firstMatchingLine(file.text, terms)
        };
      })
      .filter((file): file is RgBaselineTopFile => file !== undefined)
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .slice(0, 5)
      .map((file, index) => ({ ...file, rank: index + 1 }));
    const expectedFiles = new Set(question.expected.files);
    const firstFileRank = topFiles.findIndex((file) => expectedFiles.has(file.file));
    const fileRank = firstFileRank === -1 ? undefined : firstFileRank + 1;

    cases.push({
      id: question.id,
      terms,
      expectedFiles: question.expected.files,
      fileRank: fileRank ?? null,
      fileHitAt1: fileRank === 1,
      fileHitAt5: fileRank !== undefined && fileRank <= 5,
      fileReciprocalRank: fileRank === undefined ? 0 : 1 / fileRank,
      latencyMs: performance.now() - started,
      topFiles
    });
  }

  return {
    questions: questions.length,
    fileHitAt1: ratio(cases.filter((result) => result.fileHitAt1).length, questions.length),
    fileHitAt5: ratio(cases.filter((result) => result.fileHitAt5).length, questions.length),
    fileMrr: ratio(
      cases.reduce((sum, result) => sum + result.fileReciprocalRank, 0),
      questions.length
    ),
    avgLatencyMs: ratio(
      cases.reduce((sum, result) => sum + result.latencyMs, 0),
      questions.length
    ),
    cases
  };
}

function baselineTerms(question: BenchmarkQuestion): string[] {
  const terms = question.agentQuery
    ? [...question.agentQuery.terms, ...(question.agentQuery.pathHints ?? [])]
    : normalize(question.question).split(/\s+/);
  return terms
    .map((term) => normalize(term).trim())
    .filter((term) => term.length >= 2)
    .filter((term, index, allTerms) => allTerms.indexOf(term) === index);
}

function scoreFileForTerms(filePath: string, text: string, terms: string[]): number {
  const normalizedPath = normalize(filePath);
  const normalizedText = normalize(text);
  return terms.reduce((sum, term) => {
    const pathScore = normalizedPath.includes(term) ? 3 : 0;
    return sum + pathScore + countOccurrences(normalizedText, term);
  }, 0);
}

function firstMatchingLine(text: string, terms: string[]): number | null {
  const lines = text.split(/\r?\n/);
  const normalizedTerms = terms.map(normalize);
  const lineIndex = lines.findIndex((line) => {
    const normalizedLine = normalize(line);
    return normalizedTerms.some((term) => normalizedLine.includes(term));
  });
  return lineIndex === -1 ? null : lineIndex + 1;
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const next = text.indexOf(term, offset);
    if (next === -1) {
      break;
    }
    count += 1;
    offset = next + term.length;
  }
  return count;
}

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.\/]+/g, " ")
    .toLowerCase();
}
