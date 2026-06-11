export type Language = "python";

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
  language: Language;
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

export interface QueryMatch {
  symbol: string;
  kind: SymbolKind;
  file: string;
  lines: [number, number];
  score: number;
  why: string[];
  neighbors: QueryNeighbor[];
}

export interface QueryResponse {
  query: string;
  mode: QueryMode;
  matches: QueryMatch[];
}

export type QueryMode = "symbol" | "fts";

export interface BenchmarkQuestion {
  id: string;
  question: string;
  expected: {
    files: string[];
    symbols: string[];
  };
}

export interface BenchmarkCaseResult {
  id: string;
  symbolHitAt1: boolean;
  symbolHitAt5: boolean;
  symbolReciprocalRank: number;
  fileHitAt1: boolean;
  fileHitAt5: boolean;
  fileReciprocalRank: number;
  partialFileHit: boolean;
  latencyMs: number;
  firstMatch?: QueryMatch;
}

export interface BenchmarkResult {
  mode: QueryMode;
  questions: number;
  symbolHitAt1: number;
  symbolHitAt5: number;
  symbolMrr: number;
  fileHitAt1: number;
  fileHitAt5: number;
  fileMrr: number;
  partialFileHits: number;
  avgLatencyMs: number;
  cases: BenchmarkCaseResult[];
}
