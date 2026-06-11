import Database from "better-sqlite3";
import path from "node:path";
import type { QueryMatch, QueryMode, QueryNeighbor, QueryResponse, SymbolKind } from "./schema.js";

export interface QueryOptions {
  target: string;
  indexPath?: string;
  limit?: number;
  mode?: QueryMode;
}

interface CandidateRow {
  chunk_id: number;
  chunk_text: string;
  chunk_start_line: number;
  chunk_end_line: number;
  symbol_id: number;
  symbol_name: string;
  qualified_name: string;
  kind: SymbolKind;
  symbol_start_line: number;
  symbol_end_line: number;
  file_path: string;
  rank: number;
}

export async function queryIndex(question: string, options: QueryOptions): Promise<QueryResponse> {
  const dbPath = options.indexPath ?? path.join(path.resolve(options.target), ".codeindex", "index.sqlite");
  const db = new Database(dbPath, { readonly: true });
  const mode = options.mode ?? "symbol";
  try {
    const rows = searchCandidates(db, question);
    const matches = rankRows(db, rows, question, mode, options.limit ?? 5);
    return { query: question, mode, matches };
  } finally {
    db.close();
  }
}

function rankRows(
  db: Database.Database,
  rows: CandidateRow[],
  question: string,
  mode: QueryMode,
  limit: number
): QueryMatch[] {
  if (mode === "fts") {
    return rows.map(toPlainFtsMatch).slice(0, limit);
  }

  if (mode === "hybrid") {
    const protectedCount = Math.min(5, limit, rows.length);
    const protectedMatches = rows
      .slice(0, protectedCount)
      .map((row) => toMatch(db, row, question))
      .sort((a, b) => b.score - a.score);
    const remaining = rows
      .slice(protectedCount)
      .map((row) => toMatch(db, row, question))
      .sort((a, b) => b.score - a.score);
    return [...protectedMatches, ...remaining].slice(0, limit);
  }

  return rows
    .map((row) => toMatch(db, row, question))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function searchCandidates(db: Database.Database, question: string): CandidateRow[] {
  const match = ftsMatchQuery(question);
  if (!match) {
    return [];
  }

  return db
    .prepare(
      `
      select
        c.id as chunk_id,
        c.text as chunk_text,
        c.start_line as chunk_start_line,
        c.end_line as chunk_end_line,
        s.id as symbol_id,
        s.name as symbol_name,
        s.qualified_name as qualified_name,
        s.kind as kind,
        s.start_line as symbol_start_line,
        s.end_line as symbol_end_line,
        f.path as file_path,
        bm25(chunk_fts) as rank
      from chunk_fts
      join chunks c on c.id = chunk_fts.chunk_id
      join symbols s on s.id = c.symbol_id
      join files f on f.id = c.file_id
      where chunk_fts match @match
      order by rank
      limit 25
      `
    )
    .all({ match }) as CandidateRow[];
}

function toMatch(db: Database.Database, row: CandidateRow, question: string): QueryMatch {
  const why: string[] = ["matched source text"];
  let score = 1;
  const normalizedQuestion = normalize(question);
  const normalizedSymbol = normalize(row.qualified_name);
  const normalizedFile = normalize(row.file_path);
  const normalizedChunk = normalize(row.chunk_text);

  for (const token of rankedQueryTokens(question)) {
    if (normalizedChunk.includes(token)) {
      score += 1;
    }
    if (normalizedSymbol.includes(token)) {
      score += 2;
      addWhy(why, "symbol name match");
    }
    if (normalizedFile.includes(token)) {
      score += 1;
      addWhy(why, "file path match");
    }
  }

  const symbolTokens = normalizedSymbol.split(/\s+/).filter(Boolean);
  if (symbolTokens.length > 1 && normalizedQuestion.includes(normalizedSymbol)) {
    score += 3;
    addWhy(why, "exact identifier match");
  }

  const neighbors = expandNeighbors(db, row.symbol_id);
  if (neighbors.length > 0) {
    score += 0.5;
    addWhy(why, "nearby graph edge");
  }

  return {
    symbol: row.qualified_name,
    kind: row.kind,
    file: row.file_path,
    lines: [row.symbol_start_line, row.symbol_end_line],
    score: Number(score.toFixed(3)),
    why,
    neighbors
  };
}

function toPlainFtsMatch(row: CandidateRow): QueryMatch {
  return {
    symbol: row.qualified_name,
    kind: row.kind,
    file: row.file_path,
    lines: [row.symbol_start_line, row.symbol_end_line],
    score: Number((-row.rank).toFixed(3)),
    why: ["plain FTS match"],
    neighbors: []
  };
}

function expandNeighbors(db: Database.Database, symbolId: number): QueryNeighbor[] {
  const outgoing = db
    .prepare(
      `
      select e.kind as relation, e.target_name as symbol, f.path as file, s.start_line, s.end_line
      from edges e
      left join symbols s on s.id = e.target_symbol_id
      left join files f on f.id = s.file_id
      where e.source_symbol_id = @symbolId
      order by e.id
      limit 5
      `
    )
    .all({ symbolId }) as Array<Record<string, unknown>>;
  const incoming = db
    .prepare(
      `
      select e.kind as relation, source.qualified_name as symbol, f.path as file, source.start_line, source.end_line
      from edges e
      join symbols current on current.id = @symbolId
      join symbols source on source.id = e.source_symbol_id
      join files f on f.id = source.file_id
      where e.target_symbol_id = @symbolId or e.target_name = current.qualified_name or e.target_name = current.name
      order by e.id
      limit 5
      `
    )
    .all({ symbolId }) as Array<Record<string, unknown>>;

  return [...outgoing.map(rowToNeighbor), ...incoming.map(rowToIncomingNeighbor)].slice(0, 8);
}

function rowToNeighbor(row: Record<string, unknown>): QueryNeighbor {
  return {
    relation: String(row.relation),
    symbol: String(row.symbol),
    file: typeof row.file === "string" ? row.file : undefined,
    lines: lineTuple(row.start_line, row.end_line)
  };
}

function rowToIncomingNeighbor(row: Record<string, unknown>): QueryNeighbor {
  const relation = row.relation === "symbol_calls_name" ? "called_by_name" : `incoming_${String(row.relation)}`;
  return {
    relation,
    symbol: String(row.symbol),
    file: typeof row.file === "string" ? row.file : undefined,
    lines: lineTuple(row.start_line, row.end_line)
  };
}

function lineTuple(start: unknown, end: unknown): [number, number] | undefined {
  return typeof start === "number" && typeof end === "number" ? [start, end] : undefined;
}

function ftsMatchQuery(question: string): string {
  return queryTokens(question)
    .flatMap((token) => [token, stemToken(token)])
    .filter((token, index, tokens) => token.length >= 2 && tokens.indexOf(token) === index)
    .map((token) => `"${token}"`)
    .join(" OR ");
}

function queryTokens(question: string): string[] {
  return normalize(question)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function rankedQueryTokens(question: string): string[] {
  const tokens = queryTokens(question).flatMap((token) => [token, stemToken(token)]);
  return tokens.filter((token, index) => token.length >= 2 && tokens.indexOf(token) === index);
}

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_/.-]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(token: string): string {
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function addWhy(why: string[], reason: string): void {
  if (!why.includes(reason)) {
    why.push(reason);
  }
}
