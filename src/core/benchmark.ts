import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type {
  BenchmarkCaseResult,
  BenchmarkQueryStyle,
  BenchmarkQuestion,
  BenchmarkResult,
  QueryMatch,
  QueryMode,
  RgBaselineKind,
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
  rgBaselineKind?: RgBaselineKind;
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
    avgContextTokens: ratio(
      cases.reduce((sum, result) => sum + result.contextTokens, 0),
      questions.length
    ),
    cases,
    rgBaseline: options.includeRgBaseline
      ? await runRgBaseline(questions, options.target, options.rgBaselineKind ?? "lexical")
      : undefined
  };
}

function scoreCase(question: BenchmarkQuestion, matches: QueryMatch[], latencyMs: number): BenchmarkCaseResult {
  const expectedSymbols = new Set(question.expected.symbols);
  const expectedFiles = new Set(question.expected.files);
  const firstSymbolRank = matches.findIndex((match) => expectedSymbols.has(match.symbol));
  const firstFileRank = matches.findIndex((match) => expectedFiles.has(match.file));
  const symbolRank = firstSymbolRank === -1 ? undefined : firstSymbolRank + 1;
  const fileRank = firstFileRank === -1 ? undefined : firstFileRank + 1;

  const topMatches = matches.map((match, index) => ({
    ...match,
    rank: index + 1
  }));
  const contextChars = JSON.stringify(topMatches).length;

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
    contextChars,
    contextTokens: approximateTokens(contextChars),
    firstMatch: matches[0],
    topMatches
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

async function runRgBaseline(
  questions: BenchmarkQuestion[],
  target: string,
  baselineKind: RgBaselineKind
): Promise<RgBaselineResult> {
  const cases: RgBaselineCaseResult[] = [];

  for (const question of questions) {
    const baselineCase =
      baselineKind === "command" ? await runRgCommandBaselineCase(question, target) : await runLexicalBaselineCase(question, target);
    const topFiles = baselineCase.topFiles;
    const expectedFiles = new Set(question.expected.files);
    const firstFileRank = topFiles.findIndex((file) => expectedFiles.has(file.file));
    const fileRank = firstFileRank === -1 ? undefined : firstFileRank + 1;

    cases.push({
      id: question.id,
      terms: baselineCase.terms,
      expectedFiles: question.expected.files,
      fileRank: fileRank ?? null,
      fileHitAt1: fileRank === 1,
      fileHitAt5: fileRank !== undefined && fileRank <= 5,
      fileReciprocalRank: fileRank === undefined ? 0 : 1 / fileRank,
      latencyMs: baselineCase.latencyMs,
      matchedLineCount: baselineCase.matchedLineCount,
      contextChars: baselineCase.contextChars,
      contextTokens: approximateTokens(baselineCase.contextChars),
      command: baselineCase.command,
      exitCode: baselineCase.exitCode,
      topFiles
    });
  }

  return {
    baselineKind,
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
    avgContextTokens: ratio(
      cases.reduce((sum, result) => sum + result.contextTokens, 0),
      questions.length
    ),
    cases
  };
}

interface RgBaselineCaseWork {
  terms: string[];
  latencyMs: number;
  matchedLineCount: number;
  contextChars: number;
  command?: string;
  exitCode?: number;
  topFiles: RgBaselineTopFile[];
}

async function runLexicalBaselineCase(question: BenchmarkQuestion, target: string): Promise<RgBaselineCaseWork> {
  const started = performance.now();
  const terms = baselineTerms(question);
  const scannedFiles = await scanPythonFiles(target, { includeSupportCode: !question.agentQuery?.excludeSupportCode });
  const files =
    question.agentQuery?.roles && question.agentQuery.roles.length > 0
      ? scannedFiles.filter((file) => question.agentQuery?.roles?.includes(file.role))
      : scannedFiles;
  const scoredFiles = files
    .map((file): (RgBaselineTopFile & { contextChars: number; matchedLineCount: number }) | undefined => {
      const score = scoreFileForTerms(file.relativePath, file.text, terms);
      if (score === 0) {
        return undefined;
      }
      const matchedLines = matchingLines(file.relativePath, file.text, terms);
      return {
        rank: 0,
        file: file.relativePath,
        score,
        firstLine: firstMatchingLine(file.text, terms),
        matchedLineCount: matchedLines.length,
        contextChars: matchedLines.join("\n").length
      };
    })
    .filter((file): file is RgBaselineTopFile & { contextChars: number; matchedLineCount: number } => file !== undefined)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const topFiles = scoredFiles.slice(0, 5).map((file, index) => ({ ...file, rank: index + 1 }));

  return {
    terms,
    latencyMs: performance.now() - started,
    matchedLineCount: scoredFiles.reduce((sum, file) => sum + file.matchedLineCount, 0),
    contextChars: scoredFiles.reduce((sum, file) => sum + file.contextChars, 0),
    topFiles
  };
}

async function runRgCommandBaselineCase(question: BenchmarkQuestion, target: string): Promise<RgBaselineCaseWork> {
  const commandTerms = baselineCommandTerms(question);
  const scoringTerms = baselineTerms(question);
  if (commandTerms.length === 0) {
    return { terms: commandTerms, latencyMs: 0, matchedLineCount: 0, contextChars: 0, command: "rg", exitCode: 1, topFiles: [] };
  }

  const allowedFiles = await allowedBaselineFiles(question, target);
  const args = [
    "--line-number",
    "--with-filename",
    "--color",
    "never",
    "--glob",
    "*.py",
    "-F",
    ...commandTerms.flatMap((term) => ["-e", term]),
    "."
  ];
  const started = performance.now();
  const result = await runCommand("rg", args, target);
  const latencyMs = performance.now() - started;

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`rg baseline failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
  }

  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const fileStats = new Map<string, { score: number; firstLine: number | null; matchedLineCount: number; contextChars: number }>();
  for (const line of lines) {
    const parsed = parseRgLine(line);
    if (!parsed || !allowedFiles.has(parsed.file)) {
      continue;
    }
    const existing = fileStats.get(parsed.file) ?? { score: 0, firstLine: null, matchedLineCount: 0, contextChars: 0 };
    existing.score += scoreFileForTerms(parsed.file, parsed.text, scoringTerms);
    existing.firstLine = existing.firstLine === null ? parsed.line : Math.min(existing.firstLine, parsed.line);
    existing.matchedLineCount += 1;
    existing.contextChars += line.length + 1;
    fileStats.set(parsed.file, existing);
  }

  const topFiles = [...fileStats.entries()]
    .map(([file, stats]) => ({ rank: 0, file, score: stats.score, firstLine: stats.firstLine }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, 5)
    .map((file, index) => ({ ...file, rank: index + 1 }));

  return {
    terms: commandTerms,
    latencyMs,
    matchedLineCount: [...fileStats.values()].reduce((sum, stats) => sum + stats.matchedLineCount, 0),
    contextChars: [...fileStats.values()].reduce((sum, stats) => sum + stats.contextChars, 0),
    command: ["rg", ...args.map(shellQuote)].join(" "),
    exitCode: result.exitCode,
    topFiles
  };
}

async function allowedBaselineFiles(question: BenchmarkQuestion, target: string): Promise<Set<string>> {
  const scannedFiles = await scanPythonFiles(target, { includeSupportCode: !question.agentQuery?.excludeSupportCode });
  const files =
    question.agentQuery?.roles && question.agentQuery.roles.length > 0
      ? scannedFiles.filter((file) => question.agentQuery?.roles?.includes(file.role))
      : scannedFiles;
  return new Set(files.map((file) => file.relativePath));
}

function runCommand(
  executable: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true });
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
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function parseRgLine(line: string): { file: string; line: number; text: string } | undefined {
  const match = /^(.*?):(\d+):(.*)$/u.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    file: normalizeRelativeFile(match[1]),
    line: Number.parseInt(match[2], 10),
    text: match[3]
  };
}

function normalizeRelativeFile(file: string): string {
  return file.replace(/^\.\//u, "");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=*-]+$/u.test(value) ? value : JSON.stringify(value);
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

function baselineCommandTerms(question: BenchmarkQuestion): string[] {
  const terms = question.agentQuery
    ? [...question.agentQuery.terms, ...(question.agentQuery.pathHints ?? [])]
    : normalize(question.question).split(/\s+/);
  return terms
    .map((term) => term.trim())
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

function matchingLines(filePath: string, text: string, terms: string[]): string[] {
  const normalizedTerms = terms.map(normalize);
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1, normalizedLine: normalize(line) }))
    .filter(({ normalizedLine }) => normalizedTerms.some((term) => normalizedLine.includes(term)))
    .map(({ line, lineNumber }) => `${filePath}:${lineNumber}:${line}`);
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

function approximateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.\/]+/g, " ")
    .toLowerCase();
}
