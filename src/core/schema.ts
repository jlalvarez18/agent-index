export type Language = "python" | "rust" | "cython" | "typescript";

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
  evidence?: string;
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

export type NavigationTaskKind = "bugfix" | "feature" | "test-discovery" | "maintenance";

export type NavigationAgentStep =
  | {
      type: "query";
      query: AgentQuery;
    }
  | {
      type: "file-clusters";
      query: AgentQuery;
      limit?: number;
    }
  | {
      type: "source-tests";
      query: AgentQuery;
      limit?: number;
      testLimit?: number;
      testFanoutLimit?: number;
    }
  | {
      type: "related-tests";
      sourceFile?: string;
      sourceFromStep?: number;
      sourceLimit?: number;
      symbol?: string;
      terms?: string[];
      limit?: number;
    };

export type NavigationRgOptimizedStep =
  | {
      type: "files";
      terms: string[];
      globs?: string[];
      paths?: string[];
      limit?: number;
    }
  | {
      type: "snippets";
      terms: string[];
      fromStep?: number;
      files?: string[];
      before?: number;
      after?: number;
      limit?: number;
    };

export interface NavigationSearchTerms {
  seed: string[];
  forbiddenExact?: string[];
}

export type NavigationRgOptimizedPlanStep =
  | {
      type: "search-files";
      terms: string[];
      scope?: "source" | "test" | "all";
      paths?: string[];
      globs?: string[];
      limit?: number;
    }
  | {
      type: "read-snippets";
      fromStep: number;
      terms?: string[];
      before?: number;
      after?: number;
      limit?: number;
    }
  | {
      type: "search-files-from-snippets";
      fromStep: number;
      includeTerms?: string[];
      scope?: "source" | "test" | "all";
      paths?: string[];
      globs?: string[];
      limit?: number;
    };

export interface NavigationRgOptimizedPlan {
  version: 2;
  steps: NavigationRgOptimizedPlanStep[];
}

export interface NavigationEvalCase {
  id: string;
  task: string;
  kind?: NavigationTaskKind;
  agentIndexQueries?: AgentQuery[];
  agentIndexSteps?: NavigationAgentStep[];
  rgQueries: string[][];
  rgOptimizedSteps?: NavigationRgOptimizedStep[];
  searchTerms?: NavigationSearchTerms;
  rgOptimizedPlan?: NavigationRgOptimizedPlan;
  expected: {
    files: string[];
    symbols?: string[];
    requiredFiles?: string[];
    requiredSymbols?: string[];
  };
}

export interface NavigationEvalStepResult {
  type: "query" | "file-clusters" | "source-tests" | "related-tests" | "rg" | "rg-optimized";
  command: string;
  latencyMs: number;
  contextChars: number;
  contextTokens: number;
  usefulRank: number | null;
  usefulFile: string | null;
  usefulSymbol?: string | null;
  foundFiles: string[];
  foundSymbols: string[];
  outputFiles?: string[];
  outputSymbols?: string[];
  outputTerms?: string[];
}

export interface NavigationEvalWorkflowResult {
  commands: number;
  foundUseful: boolean;
  taskComplete: boolean;
  firstUsefulCommand: number | null;
  firstUsefulRank: number | null;
  foundFiles: string[];
  foundSymbols: string[];
  missingFiles: string[];
  missingSymbols: string[];
  firstUsefulLatencyMs: number | null;
  firstUsefulContextTokens: number | null;
  completionCommand: number | null;
  completionLatencyMs: number | null;
  completionContextTokens: number | null;
  latencyMs: number;
  contextChars: number;
  contextTokens: number;
  steps: NavigationEvalStepResult[];
}

export interface NavigationEvalCaseResult {
  id: string;
  task: string;
  kind: NavigationTaskKind;
  expectedFiles: string[];
  expectedSymbols: string[];
  agentIndex: NavigationEvalWorkflowResult;
  rg: NavigationEvalWorkflowResult;
  rgOptimized: NavigationEvalWorkflowResult;
  tokenSavings: number;
  tokenSavingsRatio: number | null;
  optimizedRgTokenSavings: number;
  optimizedRgTokenSavingsRatio: number | null;
  commandSavings: number;
  optimizedRgCommandSavings: number;
  winner: "agent-index" | "rg" | "tie" | "inconclusive";
  optimizedRgWinner: "agent-index" | "rg-optimized" | "tie" | "inconclusive";
}

export interface NavigationEvalResult {
  cases: number;
  agentIndexUsefulRate: number;
  rgUsefulRate: number;
  rgOptimizedUsefulRate: number;
  agentIndexCompletionRate: number;
  rgCompletionRate: number;
  rgOptimizedCompletionRate: number;
  agentIndexAvgCommands: number;
  rgAvgCommands: number;
  rgOptimizedAvgCommands: number;
  agentIndexAvgLatencyMs: number;
  rgAvgLatencyMs: number;
  rgOptimizedAvgLatencyMs: number;
  agentIndexAvgFirstUsefulLatencyMs: number;
  rgAvgFirstUsefulLatencyMs: number;
  rgOptimizedAvgFirstUsefulLatencyMs: number;
  agentIndexAvgCompletionLatencyMs: number;
  rgAvgCompletionLatencyMs: number;
  rgOptimizedAvgCompletionLatencyMs: number;
  agentIndexAvgContextTokens: number;
  rgAvgContextTokens: number;
  rgOptimizedAvgContextTokens: number;
  agentIndexAvgFirstUsefulContextTokens: number;
  rgAvgFirstUsefulContextTokens: number;
  rgOptimizedAvgFirstUsefulContextTokens: number;
  agentIndexAvgCompletionContextTokens: number;
  rgAvgCompletionContextTokens: number;
  rgOptimizedAvgCompletionContextTokens: number;
  avgTokenSavings: number;
  avgOptimizedRgTokenSavings: number;
  agentIndexWins: number;
  rgWins: number;
  ties: number;
  inconclusive: number;
  agentIndexWinsVsOptimizedRg: number;
  rgOptimizedWins: number;
  optimizedRgTies: number;
  optimizedRgInconclusive: number;
  caseResults: NavigationEvalCaseResult[];
}

export interface NavigationSuiteEntry {
  name: string;
  evalPath: string;
  target: string;
  indexPath?: string;
  mode?: QueryMode;
}

export interface NavigationSuiteRepoResult extends NavigationSuiteEntry {
  indexStats?: IndexStats;
  runs?: number;
  runResults?: NavigationEvalResult[];
  result: NavigationEvalResult;
}

export interface NavigationSuiteResult {
  runs?: number;
  repos: number;
  cases: number;
  agentIndexUsefulRate: number;
  rgUsefulRate: number;
  rgOptimizedUsefulRate: number;
  agentIndexCompletionRate: number;
  rgCompletionRate: number;
  rgOptimizedCompletionRate: number;
  agentIndexAvgCommands: number;
  rgAvgCommands: number;
  rgOptimizedAvgCommands: number;
  agentIndexAvgLatencyMs: number;
  rgAvgLatencyMs: number;
  rgOptimizedAvgLatencyMs: number;
  agentIndexAvgFirstUsefulLatencyMs: number;
  rgAvgFirstUsefulLatencyMs: number;
  rgOptimizedAvgFirstUsefulLatencyMs: number;
  agentIndexAvgCompletionLatencyMs: number;
  rgAvgCompletionLatencyMs: number;
  rgOptimizedAvgCompletionLatencyMs: number;
  agentIndexAvgContextTokens: number;
  rgAvgContextTokens: number;
  rgOptimizedAvgContextTokens: number;
  agentIndexAvgFirstUsefulContextTokens: number;
  rgAvgFirstUsefulContextTokens: number;
  rgOptimizedAvgFirstUsefulContextTokens: number;
  agentIndexAvgCompletionContextTokens: number;
  rgAvgCompletionContextTokens: number;
  rgOptimizedAvgCompletionContextTokens: number;
  avgTokenSavings: number;
  avgOptimizedRgTokenSavings: number;
  agentIndexWins: number;
  rgWins: number;
  ties: number;
  inconclusive: number;
  agentIndexWinsVsOptimizedRg: number;
  rgOptimizedWins: number;
  optimizedRgTies: number;
  optimizedRgInconclusive: number;
  repoResults: NavigationSuiteRepoResult[];
}

export interface RelatedTestMatch {
  file: string;
  score: number;
  why: string[];
  firstLine: number | null;
  symbols: string[];
}

export interface RelatedTestsResult {
  sourceFile: string;
  sourceFiles?: string[];
  symbol?: string;
  candidateFilesScored: number;
  matches: RelatedTestMatch[];
}

export interface SourceTestBundle {
  source: FileClusterMatch;
  tests: RelatedTestMatch[];
  score: number;
  contextChars: number;
  contextTokens: number;
}

export interface SourceTestsResult {
  query: string;
  bundles: SourceTestBundle[];
}

export interface FileClusterMatch {
  file: string;
  role: FileRole;
  language: Language;
  score: number;
  matchedChunks: number;
  contextChars: number;
  contextTokens: number;
  symbols: Array<{
    name: string;
    kind: SymbolKind;
    lines: [number, number];
  }>;
  why: string[];
  evidence?: string;
}

export interface FileClusterResult {
  query: string;
  clusters: FileClusterMatch[];
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
