import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentIndexQueryTraceEvent,
  AgentQuery,
  DogfoodTraceEvent,
  LessonTraceEvent,
  QueryMode,
  QueryResponse
} from "./schema.js";

export interface AppendQueryTraceOptions {
  tracePath: string;
  taskId?: string;
  target: string;
  indexPath?: string;
  mode: QueryMode;
  queryText?: string;
  agentQuery?: AgentQuery;
  response: QueryResponse;
  latencyMs: number;
  excludeSupportCode: boolean;
}

export interface TraceReport {
  events: number;
  queries: number;
  avgQueryLatencyMs: number | null;
  firstUsefulHitRank: number | null;
  rgFallbacks: number;
  badResults: number;
  unreviewedQueries: number;
  codeChanges: number;
  verifications: number;
  lessons: number;
  elapsedWallTimeMs: number | null;
  queryPath: TraceQueryPathEntry[];
  badResultDetails: TraceQueryPathEntry[];
  lessonEvents: LessonTraceEvent[];
}

export interface TraceQueryPathEntry {
  index: number;
  taskId?: string;
  outcome: string;
  usefulRank?: number;
  query: string;
  topMatches: AgentIndexQueryTraceEvent["topMatches"];
}

export interface AppendLessonTraceOptions {
  tracePath: string;
  taskId?: string;
  lesson: string;
  nextStep: string;
  evidence?: string;
}

export async function appendQueryTrace(options: AppendQueryTraceOptions): Promise<void> {
  const event: AgentIndexQueryTraceEvent = {
    type: "agent-index-query",
    timestamp: new Date().toISOString(),
    taskId: options.taskId,
    target: path.resolve(options.target),
    indexPath: resolvedIndexPath(options.target, options.indexPath),
    mode: options.mode,
    query: {
      text: options.queryText,
      normalized: options.response.query,
      agentQuery: options.agentQuery
    },
    latencyMs: Math.max(0, Math.round(options.latencyMs)),
    excludeSupportCode: options.excludeSupportCode,
    outcome: "unreviewed",
    topMatches: options.response.matches.slice(0, 5).map((match, index) => ({
      rank: index + 1,
      symbol: match.symbol,
      kind: match.kind,
      file: match.file,
      lines: match.lines,
      score: match.score,
      why: match.why
    }))
  };

  try {
    await appendFile(options.tracePath, `${JSON.stringify(withoutUndefined(event))}\n`, "utf8");
  } catch (error) {
    throw new Error(`Could not write trace event to ${options.tracePath}: ${errorMessage(error)}`);
  }
}

export async function appendLessonTrace(options: AppendLessonTraceOptions): Promise<void> {
  const event: LessonTraceEvent = {
    type: "lesson",
    timestamp: new Date().toISOString(),
    taskId: options.taskId,
    lesson: options.lesson,
    nextStep: options.nextStep,
    evidence: options.evidence
  };

  try {
    await appendFile(options.tracePath, `${JSON.stringify(withoutUndefined(event))}\n`, "utf8");
  } catch (error) {
    throw new Error(`Could not write lesson trace event to ${options.tracePath}: ${errorMessage(error)}`);
  }
}

export async function readTraceEvents(tracePath: string): Promise<DogfoodTraceEvent[]> {
  const contents = await readFile(tracePath, "utf8");
  const lines = contents.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`Trace file ${tracePath} is empty.`);
  }

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as DogfoodTraceEvent;
    } catch (error) {
      throw new Error(`Could not parse trace file ${tracePath} at line ${index + 1}: ${errorMessage(error)}`);
    }
  });
}

export async function buildTraceReport(tracePath: string): Promise<TraceReport> {
  return summarizeTraceEvents(await readTraceEvents(tracePath));
}

export function summarizeTraceEvents(events: DogfoodTraceEvent[]): TraceReport {
  const queryEvents = events.filter((event): event is AgentIndexQueryTraceEvent => event.type === "agent-index-query");
  const latencies = queryEvents.map((event) => event.latencyMs).filter((latency) => Number.isFinite(latency));
  const usefulQuery = queryEvents.find((event) => event.outcome === "useful" && typeof event.usefulRank === "number");
  const lessonEvents = events.filter((event): event is LessonTraceEvent => event.type === "lesson");
  const timestamps = events.map((event) => Date.parse(event.timestamp)).filter((timestamp) => Number.isFinite(timestamp));
  const queryPath = queryEvents.map((event, index) => ({
    index: index + 1,
    taskId: event.taskId,
    outcome: event.outcome ?? "unreviewed",
    usefulRank: event.usefulRank,
    query: event.query?.normalized ?? event.query?.text ?? "-",
    topMatches: event.topMatches ?? []
  }));

  return {
    events: events.length,
    queries: queryEvents.length,
    avgQueryLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length) : null,
    firstUsefulHitRank: usefulQuery?.usefulRank ?? null,
    rgFallbacks: events.filter((event) => event.type === "rg-fallback").length,
    badResults: queryEvents.filter((event) => event.outcome === "bad-result").length,
    unreviewedQueries: queryEvents.filter((event) => !event.outcome || event.outcome === "unreviewed").length,
    codeChanges: events.filter((event) => event.type === "code-change").length,
    verifications: events.filter((event) => event.type === "verification").length,
    lessons: lessonEvents.length,
    elapsedWallTimeMs: timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : null,
    queryPath,
    badResultDetails: queryPath.filter((entry) => entry.outcome === "bad-result"),
    lessonEvents
  };
}

export function formatTraceReport(report: TraceReport): string {
  const lines = [
    `Trace events: ${report.events}`,
    `Query events: ${report.queries}`,
    `Avg query latency: ${formatNullableMs(report.avgQueryLatencyMs)}`,
    `First useful hit rank: ${report.firstUsefulHitRank ?? "-"}`,
    `rg fallbacks: ${report.rgFallbacks}`,
    `Bad results: ${report.badResults}`,
    `Unreviewed queries: ${report.unreviewedQueries}`,
    `Code changes: ${report.codeChanges}`,
    `Verifications: ${report.verifications}`,
    `Lessons: ${report.lessons}`,
    `Elapsed wall time: ${formatDuration(report.elapsedWallTimeMs)}`
  ];

  if (report.queryPath.length > 0) {
    lines.push("", "Query path:", ...report.queryPath.map(formatQueryPathEntry));
  }

  if (report.badResultDetails.length > 0) {
    lines.push("", "Bad-result details:", ...report.badResultDetails.flatMap(formatBadResultDetail));
  }

  if (report.lessonEvents.length > 0) {
    lines.push("", "Lessons learned:", ...report.lessonEvents.map(formatLesson));
    lines.push("", "Recommended next step:", ...report.lessonEvents.map(formatNextStep));
  }

  return lines.join("\n");
}

function resolvedIndexPath(target: string, indexPath: string | undefined): string {
  return path.resolve(indexPath ?? path.join(path.resolve(target), ".codeindex", "index.sqlite"));
}

function withoutUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatNullableMs(value: number | null): string {
  return value === null ? "-" : `${value}ms`;
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "-";
  }
  if (value % 1000 === 0) {
    return `${value / 1000}s`;
  }
  if (value > 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${value}ms`;
}

function formatQueryPathEntry(entry: TraceQueryPathEntry): string {
  const rank = entry.outcome === "useful" && typeof entry.usefulRank === "number" ? ` rank=${entry.usefulRank}` : "";
  return `#${entry.index} ${entry.outcome}${rank} query=${JSON.stringify(entry.query)} top=${formatTopMatch(entry.topMatches[0])}`;
}

function formatBadResultDetail(entry: TraceQueryPathEntry): string[] {
  const topMatches = entry.topMatches.length > 0
    ? entry.topMatches.map((match) => `  ${match.rank}. ${formatTopMatch(match)}`)
    : ["  - no top matches recorded"];
  return [`#${entry.index} ${entry.query}`, ...topMatches];
}

function formatLesson(event: LessonTraceEvent): string {
  return event.evidence ? `- ${event.lesson} Evidence: ${event.evidence}` : `- ${event.lesson}`;
}

function formatNextStep(event: LessonTraceEvent): string {
  return `- ${event.nextStep}`;
}

function formatTopMatch(match: AgentIndexQueryTraceEvent["topMatches"][number] | undefined): string {
  if (!match) {
    return "-";
  }
  return `${match.symbol} ${match.file}:${match.lines[0]}`;
}
