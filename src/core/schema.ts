export type Language = "python" | "rust";

export type FileRole = "source" | "test" | "docs" | "example" | "fixture" | "tool" | "benchmark";

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
  language: Language;
  role: FileRole;
  text: string;
}

export type SymbolKind = "module" | "class" | "function" | "method";

export interface CodeSymbol {
  id?: number;
  fileId?: number;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  parentSymbolName?: string;
}

export interface CodeChunk {
  id?: number;
  fileId?: number;
  symbolName?: string;
  startLine: number;
  endLine: number;
  text: string;
}

export type EdgeKind =
  | "file_contains_symbol"
  | "symbol_contains_symbol"
  | "symbol_imports_module"
  | "symbol_calls_name";

export interface CodeEdge {
  sourceSymbolName: string;
  targetName: string;
  kind: EdgeKind;
  confidence: "exact" | "name";
}

export interface ExtractionResult {
  file: SourceFile;
  symbols: CodeSymbol[];
  chunks: CodeChunk[];
  edges: CodeEdge[];
}

export interface IndexStats {
  files: number;
  symbols: number;
  chunks: number;
  edges: number;
  indexPath: string;
}

export interface QueryNeighbor {
  relation: string;
  symbol: string;
  file?: string;
  lines?: [number, number];
}

export interface QueryMatchDebug {
  candidateSources: Array<"fts" | "intent">;
  ftsPosition?: number;
  intentBoost?: number;
  intentReasons?: string[];
  inputIndex?: number;
  hybrid?: {
    lexicalBoost: number;
    specificityBoost: number;
    containerAdjustment: number;
    adjustedScore: number;
  };
}

export interface QueryMatch {
  symbol: string;
  kind: SymbolKind;
  file: string;
  lines: [number, number];
  score: number;
  why: string[];
  neighbors: QueryNeighbor[];
  debug?: QueryMatchDebug;
}

export interface QueryResponse {
  query: string;
  mode: QueryMode;
  matches: QueryMatch[];
}

export type QueryMode = "symbol" | "fts" | "hybrid";

export type QueryExpansion = "callers" | "callees" | "imports" | "parents" | "children";

export interface AgentQuery {
  terms: string[];
  symbolKinds?: SymbolKind[];
  pathHints?: string[];
  pathMode?: "hint" | "filter";
  roles?: FileRole[];
  excludeSupportCode?: boolean;
  expand?: QueryExpansion[];
  limit?: number;
}

export type BenchmarkQueryStyle = "question" | "agent";
export type RgBaselineKind = "lexical" | "command";

export interface BenchmarkQuestion {
  id: string;
  question: string;
  agentQuery?: AgentQuery;
  expected: {
    files: string[];
    symbols: string[];
  };
}

export interface BenchmarkCaseResult {
  id: string;
  question: string;
  expectedSymbols: string[];
  expectedFiles: string[];
  symbolRank: number | null;
  fileRank: number | null;
  symbolHitAt1: boolean;
  symbolHitAt5: boolean;
  symbolReciprocalRank: number;
  fileHitAt1: boolean;
  fileHitAt5: boolean;
  fileReciprocalRank: number;
  partialFileHit: boolean;
  latencyMs: number;
  contextChars: number;
  contextTokens: number;
  firstMatch?: QueryMatch;
  topMatches: BenchmarkTopMatch[];
}

export interface BenchmarkTopMatch extends QueryMatch {
  rank: number;
}

export interface BenchmarkResult {
  mode: QueryMode;
  queryStyle: BenchmarkQueryStyle;
  questions: number;
  symbolHitAt1: number;
  symbolHitAt5: number;
  symbolMrr: number;
  fileHitAt1: number;
  fileHitAt5: number;
  fileMrr: number;
  partialFileHits: number;
  avgLatencyMs: number;
  avgContextTokens: number;
  cases: BenchmarkCaseResult[];
  rgBaseline?: RgBaselineResult;
}

export interface RgBaselineTopFile {
  rank: number;
  file: string;
  score: number;
  firstLine: number | null;
}

export interface RgBaselineCaseResult {
  id: string;
  terms: string[];
  expectedFiles: string[];
  fileRank: number | null;
  fileHitAt1: boolean;
  fileHitAt5: boolean;
  fileReciprocalRank: number;
  latencyMs: number;
  matchedLineCount: number;
  contextChars: number;
  contextTokens: number;
  command?: string;
  exitCode?: number;
  topFiles: RgBaselineTopFile[];
}

export interface RgBaselineResult {
  baselineKind: RgBaselineKind;
  questions: number;
  fileHitAt1: number;
  fileHitAt5: number;
  fileMrr: number;
  avgLatencyMs: number;
  avgContextTokens: number;
  cases: RgBaselineCaseResult[];
}

export interface GraphifyQueryTextResult {
  id: string;
  text: string;
}

export interface GraphifyMentionCaseResult {
  id: string;
  question: string;
  expectedSymbols: string[];
  expectedFiles: string[];
  symbolMention: boolean;
  fileMention: boolean;
}

export interface AgentEvalCaseResult {
  id: string;
  question: string;
  agentIndexSymbolRank: number | null;
  agentIndexFileRank: number | null;
  graphifySymbolMention: boolean | null;
  graphifyFileMention: boolean | null;
  winner: "agent-index" | "graphify" | "tie" | "inconclusive";
}

export interface AgentEvalResult {
  questions: number;
  mode: QueryMode;
  agentIndex: BenchmarkResult;
  graphify?: {
    symbolMentionRate: number;
    fileMentionRate: number;
    cases: GraphifyMentionCaseResult[];
  };
  cases: AgentEvalCaseResult[];
}

export type DogfoodTraceEventType = "agent-index-query" | "rg-fallback" | "code-change" | "verification" | "lesson";

export type QueryTraceOutcome = "unreviewed" | "useful" | "bad-result";

export interface QueryTraceTopMatch {
  rank: number;
  symbol: string;
  kind: SymbolKind;
  file: string;
  lines: [number, number];
  score: number;
  why: string[];
}

export interface AgentIndexQueryTraceEvent {
  type: "agent-index-query";
  timestamp: string;
  taskId?: string;
  target: string;
  indexPath: string;
  mode: QueryMode;
  query: {
    text?: string;
    normalized: string;
    agentQuery?: AgentQuery;
  };
  latencyMs: number;
  excludeSupportCode: boolean;
  outcome: QueryTraceOutcome;
  usefulRank?: number;
  topMatches: QueryTraceTopMatch[];
}

export interface RgFallbackTraceEvent {
  type: "rg-fallback";
  timestamp: string;
  taskId?: string;
  command: string;
  reason?: string;
}

export interface CodeChangeTraceEvent {
  type: "code-change";
  timestamp: string;
  taskId?: string;
  files: string[];
  summary?: string;
}

export interface VerificationTraceEvent {
  type: "verification";
  timestamp: string;
  taskId?: string;
  command: string;
  result: "passed" | "failed" | "skipped";
}

export interface LessonTraceEvent {
  type: "lesson";
  timestamp: string;
  taskId?: string;
  lesson: string;
  nextStep: string;
  evidence?: string;
}

export type DogfoodTraceEvent =
  | AgentIndexQueryTraceEvent
  | RgFallbackTraceEvent
  | CodeChangeTraceEvent
  | VerificationTraceEvent
  | LessonTraceEvent;
