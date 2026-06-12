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
  ftsPosition?: number;
  intentReasons?: string[];
  intentBoost?: number;
}

interface IntentRule {
  reason: string;
  boost: number;
  score: (row: CandidateRow) => number;
}

export async function queryIndex(question: string, options: QueryOptions): Promise<QueryResponse> {
  const dbPath = options.indexPath ?? path.join(path.resolve(options.target), ".codeindex", "index.sqlite");
  const db = new Database(dbPath, { readonly: true });
  const mode = options.mode ?? "symbol";
  try {
    const ftsRows = searchCandidates(db, question);
    const rows = mode === "fts" ? ftsRows : mergeCandidateRows([...searchIntentCandidates(db, question), ...ftsRows]);
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
    return rankHybridMatches(
      rows.map((row, index) => ({
        match: toMatch(db, row, question),
        ftsPosition: row.ftsPosition,
        inputIndex: index
      })),
      limit
    );
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

  const rows = db
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
  return rows.map((row, index) => ({ ...row, ftsPosition: index + 1 }));
}

function searchIntentCandidates(db: Database.Database, question: string): CandidateRow[] {
  const rules = intentRulesForQuestion(question);
  if (rules.length === 0) {
    return [];
  }

  const rows = db
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
        0 as rank
      from chunks c
      join symbols s on s.id = c.symbol_id
      join files f on f.id = c.file_id
      order by f.path, s.start_line
      `
    )
    .all() as CandidateRow[];

  return rows
    .filter((row) => row.kind !== "module")
    .map((row) => scoreIntentRow(row, rules))
    .filter((row): row is CandidateRow => row !== undefined)
    .sort((a, b) => (b.intentBoost ?? 0) - (a.intentBoost ?? 0))
    .slice(0, 12);
}

function scoreIntentRow(row: CandidateRow, rules: IntentRule[]): CandidateRow | undefined {
  let boost = 0;
  const reasons: string[] = [];

  for (const rule of rules) {
    const score = rule.score(row);
    if (score > 0) {
      boost = Math.max(boost, rule.boost + score);
      reasons.push(rule.reason);
    }
  }

  if (boost === 0) {
    return undefined;
  }

  return { ...row, intentBoost: boost, intentReasons: reasons };
}

function mergeCandidateRows(rows: CandidateRow[]): CandidateRow[] {
  const byChunk = new Map<number, CandidateRow>();
  for (const row of rows) {
    const existing = byChunk.get(row.chunk_id);
    if (!existing) {
      byChunk.set(row.chunk_id, row);
      continue;
    }

    const intentReasons = [...(existing.intentReasons ?? []), ...(row.intentReasons ?? [])];
    const ftsPosition = minDefined(existing.ftsPosition, row.ftsPosition);
    byChunk.set(row.chunk_id, {
      ...existing,
      intentReasons: intentReasons.filter((reason, index) => intentReasons.indexOf(reason) === index),
      intentBoost: Math.max(existing.intentBoost ?? 0, row.intentBoost ?? 0),
      ftsPosition,
      rank: Math.min(existing.rank, row.rank)
    });
  }
  return [...byChunk.values()];
}

export interface HybridRankInput {
  match: QueryMatch;
  ftsPosition?: number;
  inputIndex: number;
}

export function rankHybridMatches(items: HybridRankInput[], limit: number): QueryMatch[] {
  return items
    .map((item) => ({
      ...item,
      adjustedScore: item.match.score + hybridLexicalBoost(item)
    }))
    .sort((a, b) => b.adjustedScore - a.adjustedScore || a.inputIndex - b.inputIndex)
    .slice(0, limit)
    .map((item) => item.match);
}

function hybridLexicalBoost(item: HybridRankInput): number {
  if (
    item.ftsPosition !== undefined &&
    item.ftsPosition <= 5 &&
    (item.match.kind === "function" || item.match.kind === "method")
  ) {
    return 4;
  }
  return 0;
}

function minDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
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

  if (row.intentBoost && row.intentReasons) {
    score += row.intentBoost;
    for (const reason of row.intentReasons) {
      addWhy(why, reason);
    }
  }

  const coreAdjustment = coreSymbolAdjustment(row);
  score += coreAdjustment.score;
  if (coreAdjustment.score > 0) {
    addWhy(why, coreAdjustment.reason);
  }

  const ownerNameAdjustment = methodOwnerNameAdjustment(row, question);
  score += ownerNameAdjustment.score;
  if (ownerNameAdjustment.score > 0) {
    addWhy(why, ownerNameAdjustment.reason);
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

function coreSymbolAdjustment(row: CandidateRow): { score: number; reason: string } {
  let score = 0;
  const fileStem = normalize(path.basename(row.file_path, ".py"));
  const symbolName = normalize(row.symbol_name.replace(/^_+/, ""));
  const symbolTokens = new Set(symbolName.split(/\s+/).filter(Boolean));

  if (fileStem && symbolName === fileStem && (row.kind === "function" || row.kind === "method")) {
    score += 6;
  }

  for (const supportToken of ["rationale", "note", "notes", "doc", "docs", "describe", "description", "explain"]) {
    if (symbolTokens.has(supportToken)) {
      score -= 8;
    }
  }

  return { score, reason: "core symbol match" };
}

function methodOwnerNameAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (row.kind !== "method") {
    return { score: 0, reason: "method owner/name match" };
  }

  const queryTokenSet = new Set(rankedQueryTokens(question));
  const ownerName = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
  const ownerTokens = normalize(ownerName)
    .split(/\s+/)
    .filter(Boolean);
  const methodTokens = normalize(row.symbol_name)
    .split(/\s+/)
    .filter(Boolean);

  if (
    ownerTokens.length > 0 &&
    methodTokens.length > 0 &&
    ownerTokens.some((token) => queryTokenSet.has(token)) &&
    methodTokens.some((token) => queryTokenSet.has(token))
  ) {
    return { score: 3, reason: "method owner/name match" };
  }

  return { score: 0, reason: "method owner/name match" };
}

function intentRulesForQuestion(question: string): IntentRule[] {
  const normalizedQuestion = normalize(question);
  const tokens = new Set(queryTokens(question).flatMap((token) => [token, stemToken(token)]));
  const rules: IntentRule[] = [];
  const dottedReferences = dottedApiReferences(question);

  for (const reference of dottedReferences) {
    rules.push({
      reason: "dotted API reference match",
      boost: 12,
      score: (row) => {
        if (row.symbol_name !== reference.member) {
          return 0;
        }

        let score = 18;
        if (row.file_path.startsWith(`${reference.packageName}/`)) score += 8;
        if (normalizedQuestion.includes("module level") && row.kind === "function") score += 8;
        if (tokens.has("function") && row.kind === "function") score += 6;
        if (tokens.has("defined") || tokens.has("definition")) score += 4;
        if (row.kind === "method" && normalizedQuestion.includes("module level")) score -= 10;
        return score;
      }
    });
  }

  if (isEntrypointQuestion(normalizedQuestion, tokens)) {
    rules.push({
      reason: "entrypoint intent match",
      boost: 12,
      score: (row) => {
        let score = 0;
        if (row.file_path.endsWith("__main__.py")) score += 20;
        if (row.symbol_name === "main") score += 12;
        if (row.symbol_name === "_main") score += 10;
        if (normalize(row.qualified_name).includes(" cli ")) score += 6;
        return score;
      }
    });
  }

  if (tokens.has("export") && tokens.has("json")) {
    rules.push({
      reason: "query intent match",
      boost: 12,
      score: (row) => {
        let score = 0;
        if (row.symbol_name === "to_json") score += 20;
        if (normalize(row.qualified_name).includes("to json")) score += 16;
        if (row.file_path.endsWith("export.py")) score += 10;
        if (normalize(row.qualified_name).includes("json")) score += 8;
        return score;
      }
    });
  }

  if (tokens.has("report")) {
    rules.push({
      reason: "query intent match",
      boost: 12,
      score: (row) => {
        let score = 0;
        if (row.symbol_name === "generate") score += 18;
        if (row.file_path.endsWith("report.py")) score += 12;
        if (normalize(row.qualified_name).includes("report")) score += 8;
        return score;
      }
    });
  }

  if (tokens.has("community") && (tokens.has("detection") || tokens.has("detect") || tokens.has("cluster"))) {
    rules.push({
      reason: "query intent match",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.file_path.endsWith("cluster.py")) score += 12;
        if (symbol.includes("community")) score += 12;
        if (symbol.includes("cluster")) score += 10;
        if (symbol.includes("partition")) score += 8;
        return score;
      }
    });
  }

  if (tokens.has("mcp") && tokens.has("server")) {
    rules.push({
      reason: "query intent match",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "serve") score += 18;
        if (row.file_path.endsWith("serve.py")) score += 12;
        if (symbol.includes("server")) score += 8;
        return score;
      }
    });
  }

  if (tokens.has("extract") || tokens.has("extraction")) {
    rules.push({
      reason: "query intent match",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.file_path.endsWith("extract.py")) score += 12;
        if (symbol.includes("extract")) score += 14;
        if (symbol.includes("python") && (tokens.has("code") || tokens.has("source"))) score += 4;
        return score;
      }
    });
  }

  if (tokens.has("build") || tokens.has("built") || tokens.has("construct")) {
    rules.push({
      reason: "query intent match",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.file_path.endsWith("build.py")) score += 12;
        if (row.symbol_name === "build") score += 16;
        if (symbol.includes("build")) score += 10;
        if (symbol.includes("from json") && tokens.has("graph")) score += 6;
        return score;
      }
    });
  }

  if ((tokens.has("seed") || tokens.has("seeds")) && (tokens.has("query") || tokens.has("select") || tokens.has("selected"))) {
    rules.push({
      reason: "query intent match",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "_pick_seeds") score += 18;
        if (row.symbol_name === "_score_nodes") score += 12;
        if (symbol.includes("seed")) score += 12;
        if (row.file_path.endsWith("serve.py")) score += 8;
        return score;
      }
    });
  }

  if (
    tokens.has("incremental") &&
    (tokens.has("changed") || tokens.has("change") || tokens.has("indexing") || tokens.has("index"))
  ) {
    rules.push({
      reason: "query intent match",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "detect_incremental") score += 22;
        if (symbol.includes("incremental")) score += 12;
        if (symbol.includes("manifest")) score += 10;
        if (row.file_path.endsWith("detect.py")) score += 8;
        return score;
      }
    });
  }

  return rules;
}

function isEntrypointQuestion(normalizedQuestion: string, tokens: Set<string>): boolean {
  return normalizedQuestion.includes("entry point") || tokens.has("entrypoint") || tokens.has("cli");
}

function dottedApiReferences(question: string): Array<{ packageName: string; member: string }> {
  const references = new Map<string, { packageName: string; member: string }>();
  for (const match of question.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const packageName = match[1];
    const member = match[2];
    if (packageName && member) {
      references.set(`${packageName}.${member}`, { packageName, member });
    }
  }
  return [...references.values()];
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
