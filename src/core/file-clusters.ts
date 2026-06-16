import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { compactEvidenceLine } from "./evidence.js";
import type { AgentQuery, FileClusterMatch, FileClusterResult, FileRole, Language, SymbolKind } from "./schema.js";

export interface FileClusterOptions {
  target: string;
  indexPath?: string;
  limit?: number;
}

interface ClusterRow {
  chunk_text: string;
  symbol_name: string;
  kind: SymbolKind;
  start_line: number;
  end_line: number;
  file_path: string;
  file_role: FileRole;
  language: Language;
  rank: number;
}

interface MutableCluster {
  file: string;
  role: FileRole;
  language: Language;
  score: number;
  matchedChunks: number;
  matchedTerms: Set<string>;
  contextChars: number;
  evidence?: string;
  symbols: FileClusterMatch["symbols"];
  symbolScores: Map<string, number>;
  why: Set<string>;
}

interface FileClusterSqlPlan {
  kind: "fts" | "path-filter" | "path-hint-prefilter";
  sql: string;
  params: Record<string, unknown>;
  fallback?: FileClusterSqlPlan;
}

export function findFileClusters(agentQuery: AgentQuery, options: FileClusterOptions): FileClusterResult {
  const dbPath = options.indexPath ?? path.join(path.resolve(options.target), ".codeindex", "index.sqlite");
  if (!existsSync(dbPath)) {
    throw new Error(
      `No agent-index database found at ${dbPath}. Run "agent-index index ${path.resolve(options.target)} --index-path ${dbPath}" first.`
    );
  }

  const queryText = agentQuery.terms.map((term) => term.trim()).filter(Boolean).join(" ");
  const match = ftsMatchQuery(queryText);
  if (!match) {
    return { query: queryText, clusters: [] };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const plan = fileClusterSqlPlan(agentQuery, match);
    let rows = db.prepare(plan.sql).all(plan.params) as ClusterRow[];
    let clusters = clusterRows(rows, agentQuery);
    if (plan.fallback && clusters.length < (options.limit ?? 8)) {
      rows = db.prepare(plan.fallback.sql).all(plan.fallback.params) as ClusterRow[];
      clusters = clusterRows(rows, agentQuery);
    }

    return {
      query: queryText,
      clusters: clusters.slice(0, options.limit ?? 8)
    };
  } finally {
    db.close();
  }
}

export function fileClusterSqlForTesting(agentQuery: AgentQuery): FileClusterSqlPlan {
  return fileClusterSqlPlan(agentQuery, ftsMatchQuery(agentQuery.terms.join(" ")) ?? "");
}

function fileClusterSqlPlan(agentQuery: AgentQuery, match: string): FileClusterSqlPlan {
  if (usesHardPathFilter(agentQuery)) {
    const filter = clusterSqlFilter(agentQuery);
    const termFilter = pathFilteredTermFilter(agentQuery);
    return {
      kind: "path-filter",
      sql: `
        select
          c.text as chunk_text,
          s.qualified_name as symbol_name,
          s.kind as kind,
          s.start_line as start_line,
          s.end_line as end_line,
          f.path as file_path,
          f.role as file_role,
          f.language as language,
          0 as rank
        from files f indexed by idx_files_role_path
        join chunks c on c.file_id = f.id
        join symbols s on s.id = c.symbol_id
        where 1 = 1
          ${filter.sql}
          ${termFilter.sql}
        order by f.path, s.start_line
        limit 1000
        `,
      params: { ...filter.params, ...termFilter.params }
    };
  }

  const filter = clusterSqlFilter(agentQuery);
  const ftsPlan: FileClusterSqlPlan = {
    kind: "fts",
    sql: ftsClusterSql(filter.sql),
    params: { match, ...filter.params }
  };
  const pathHintFilter = softPathHintSqlFilter(agentQuery);
  if (pathHintFilter.sql) {
    return {
      kind: "path-hint-prefilter",
      sql: ftsClusterSql([filter.sql, pathHintFilter.sql].filter(Boolean).join("\n          ")),
      params: { match, ...filter.params, ...pathHintFilter.params },
      fallback: ftsPlan
    };
  }

  return ftsPlan;
}

function ftsClusterSql(filterSql: string): string {
  return `
        select
          c.text as chunk_text,
          s.qualified_name as symbol_name,
          s.kind as kind,
          s.start_line as start_line,
          s.end_line as end_line,
          f.path as file_path,
          f.role as file_role,
          f.language as language,
          bm25(chunk_fts) as rank
        from chunk_fts
        join chunks c on c.id = chunk_fts.chunk_id
        join symbols s on s.id = c.symbol_id
        join files f on f.id = c.file_id
        where chunk_fts match @match
          ${filterSql}
        order by rank
        limit 250
        `;
}

function clusterRows(rows: ClusterRow[], agentQuery: AgentQuery): FileClusterMatch[] {
  const clusters = new Map<string, MutableCluster>();
  for (const row of rows) {
    const cluster = clusters.get(row.file_path) ?? {
      file: row.file_path,
      role: row.file_role,
      language: row.language,
      score: 0,
      matchedChunks: 0,
      matchedTerms: new Set<string>(),
      contextChars: 0,
      evidence: undefined,
      symbols: [] as FileClusterMatch["symbols"],
      symbolScores: new Map(),
      why: new Set<string>()
    };
    const rowScore = scoreRow(row, agentQuery);
    const rowEvidence = compactEvidenceLine(row.chunk_text, normalizedQueryTerms(agentQuery));
    if (rowScore > cluster.score || !cluster.evidence) {
      cluster.evidence = rowEvidence;
    }
    cluster.score = Math.max(cluster.score, rowScore);
    cluster.matchedChunks += 1;
    rowMatchedTerms(row, agentQuery).forEach((term) => cluster.matchedTerms.add(term));
    cluster.contextChars += compactSymbolLine(row).length + 1;
    if (!cluster.symbols.some((symbol) => symbol.name === row.symbol_name)) {
      cluster.symbols.push({
        name: row.symbol_name,
        kind: row.kind,
        lines: [row.start_line, row.end_line]
      });
    }
    cluster.symbolScores.set(
      row.symbol_name,
      Math.max(
        cluster.symbolScores.get(row.symbol_name) ?? 0,
        rowScore + symbolNameTermBoost(row.symbol_name, agentQuery) + rowMatchedTerms(row, agentQuery).length * 12
      )
    );
    reasonsForRow(row, agentQuery).forEach((reason) => cluster.why.add(reason));
    clusters.set(row.file_path, cluster);
  }

  const queryTerms = normalizedQueryTerms(agentQuery);
  return [...clusters.values()]
    .map((cluster) => {
      const coverageBoost = taskTermCoverageBoost(cluster, queryTerms);
      if (coverageBoost > 0) {
        cluster.why.add("broader task-term coverage");
      }
      const fileNameBoost = fileNameTermBoost(cluster.file, queryTerms);
      if (fileNameBoost > 0) {
        cluster.why.add("file name matches task terms");
      }
      return {
        file: cluster.file,
        role: cluster.role,
        language: cluster.language,
        score: Number((cluster.score + Math.min(cluster.matchedChunks, 5) + coverageBoost + fileNameBoost).toFixed(2)),
        matchedChunks: cluster.matchedChunks,
        contextChars: cluster.contextChars + (cluster.evidence ? cluster.evidence.length + 1 : 0),
        contextTokens: approximateTokens(cluster.contextChars + (cluster.evidence ? cluster.evidence.length + 1 : 0)),
        symbols: rankedClusterSymbols(cluster, agentQuery).slice(0, 12),
        why: [...cluster.why],
        evidence: cluster.evidence
      };
    })
    .sort((a, b) => b.score - a.score || b.matchedChunks - a.matchedChunks || a.file.localeCompare(b.file));
}

function rankedClusterSymbols(cluster: MutableCluster, agentQuery: AgentQuery): FileClusterMatch["symbols"] {
  if (!usesHardPathFilter(agentQuery)) {
    return cluster.symbols;
  }

  return [...cluster.symbols].sort(
    (a, b) =>
      (cluster.symbolScores.get(b.name) ?? 0) - (cluster.symbolScores.get(a.name) ?? 0) ||
      a.lines[0] - b.lines[0] ||
      a.name.localeCompare(b.name)
  );
}

function scoreRow(row: ClusterRow, agentQuery: AgentQuery): number {
  let score = Math.max(1, -row.rank * 10);
  const normalizedFile = normalize(row.file_path);
  const normalizedSymbol = normalize(row.symbol_name);
  const normalizedText = normalize(row.chunk_text);
  for (const term of agentQuery.terms.map(normalize).filter(Boolean)) {
    if (normalizedSymbol.includes(term)) score += 8;
    if (normalizedFile.includes(term)) score += 4;
    if (normalizedText.includes(term)) score += 2;
  }
  for (const hint of agentQuery.pathHints ?? []) {
    if (normalizedFile.includes(normalize(hint))) score += 10;
  }
  return score;
}

function symbolNameTermBoost(symbolName: string, agentQuery: AgentQuery): number {
  const normalizedSymbol = normalize(symbolName);
  const compactSymbol = normalizedSymbol.replace(/\s+/g, "");
  return normalizedQueryTerms(agentQuery).reduce((score, term) => {
    const compactTerm = term.replace(/\s+/g, "");
    return normalizedSymbol.includes(term) || compactSymbol.includes(compactTerm) ? score + 20 : score;
  }, 0);
}

function reasonsForRow(row: ClusterRow, agentQuery: AgentQuery): string[] {
  const reasons = new Set<string>(["matched query terms"]);
  const normalizedFile = normalize(row.file_path);
  const normalizedSymbol = normalize(row.symbol_name);
  if ((agentQuery.pathHints ?? []).some((hint) => normalizedFile.includes(normalize(hint)))) {
    reasons.add("path hint match");
  }
  if (agentQuery.terms.map(normalize).some((term) => normalizedSymbol.includes(term))) {
    reasons.add("symbol name match");
  }
  if (agentQuery.roles?.includes(row.file_role)) {
    reasons.add("role match");
  }
  return [...reasons];
}

function rowMatchedTerms(row: ClusterRow, agentQuery: AgentQuery): string[] {
  const haystack = normalize([row.file_path, row.symbol_name, row.chunk_text].join(" "));
  return normalizedQueryTerms(agentQuery).filter((term) => haystack.includes(term));
}

function normalizedQueryTerms(agentQuery: AgentQuery): string[] {
  return uniqueValues(agentQuery.terms.flatMap((term) => normalize(term).split(/\s+/)).filter((term) => term.length >= 3));
}

function taskTermCoverageBoost(cluster: MutableCluster, queryTerms: string[]): number {
  if (queryTerms.length < 2) {
    return 0;
  }

  const coverage = [...cluster.matchedTerms].filter((term) => queryTerms.includes(term)).length;
  if (coverage < 2) {
    return 0;
  }

  const completeCoverageBonus = coverage === queryTerms.length ? 4 : 0;
  return Math.min(coverage * 3 + completeCoverageBonus, 16);
}

function fileNameTermBoost(file: string, queryTerms: string[]): number {
  const basename = normalize(path.posix.basename(file).replace(/\.[^.]+$/u, ""));
  const matches = queryTerms.filter((term) => basename.includes(term)).length;
  return Math.min(matches * 6, 12);
}

function clusterSqlFilter(agentQuery: AgentQuery): { sql: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (agentQuery.symbolKinds && agentQuery.symbolKinds.length > 0) {
    const placeholders = agentQuery.symbolKinds.map((kind, index) => {
      const key = `kind${index}`;
      params[key] = kind;
      return `@${key}`;
    });
    clauses.push(`and s.kind in (${placeholders.join(", ")})`);
  }

  if (agentQuery.roles && agentQuery.roles.length > 0) {
    const placeholders = agentQuery.roles.map((role, index) => {
      const key = `role${index}`;
      params[key] = role;
      return `@${key}`;
    });
    clauses.push(`and f.role in (${placeholders.join(", ")})`);
  }

  if (agentQuery.excludeSupportCode) {
    clauses.push("and f.role = @sourceRole");
    params.sourceRole = "source";
  }

  if (agentQuery.pathMode === "filter" && agentQuery.pathHints && agentQuery.pathHints.length > 0) {
    const hintClauses = agentQuery.pathHints.flatMap((hint, hintIndex) => {
      const tokens = normalizePathHintTokens(hint);
      if (tokens.length === 0) {
        return [];
      }
      return [
        `(${tokens
          .map((token, tokenIndex) => {
            const key = `pathHint${hintIndex}_${tokenIndex}`;
            params[key] = `%${token}%`;
            return `lower(f.path) like @${key}`;
          })
          .join(" and ")})`
      ];
    });
    if (hintClauses.length > 0) {
      clauses.push(`and (${hintClauses.join(" or ")})`);
    }
  }

  return { sql: clauses.length > 0 ? clauses.join("\n          ") : "", params };
}

function usesHardPathFilter(agentQuery: AgentQuery): boolean {
  return agentQuery.pathMode === "filter" && Boolean(agentQuery.pathHints && agentQuery.pathHints.length > 0);
}

function softPathHintSqlFilter(agentQuery: AgentQuery): { sql: string; params: Record<string, unknown> } {
  if (!agentQuery.pathHints || agentQuery.pathHints.length === 0 || agentQuery.pathMode === "filter") {
    return { sql: "", params: {} };
  }

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  for (const [hintIndex, hint] of agentQuery.pathHints.entries()) {
    const tokens = normalizePathHintTokens(hint);
    if (tokens.length === 0) {
      continue;
    }
    clauses.push(
      `(${tokens
        .map((token, tokenIndex) => {
          const key = `softPathHint${hintIndex}_${tokenIndex}`;
          params[key] = `%${token}%`;
          return `lower(f.path) like @${key}`;
        })
        .join(" and ")})`
    );
  }

  return {
    sql: clauses.length > 0 ? `and (${clauses.join(" or ")})` : "",
    params
  };
}

function pathFilteredTermFilter(agentQuery: AgentQuery): { sql: string; params: Record<string, unknown> } {
  const terms = normalizedQueryTerms(agentQuery);
  if (terms.length === 0) {
    return { sql: "", params: {} };
  }

  const params = Object.fromEntries(terms.map((term, index) => [`pathFilteredTerm${index}`, `%${term}%`]));
  const clauses = terms.map(
    (_, index) => `lower(c.text || ' ' || s.qualified_name || ' ' || f.path) like @pathFilteredTerm${index}`
  );
  return {
    sql: `and (${clauses.join(" or ")})`,
    params
  };
}

function ftsMatchQuery(question: string): string | undefined {
  const terms = question
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .map((term) => `"${term.replace(/"/gu, '""')}"`);
  return terms.length === 0 ? undefined : terms.join(" OR ");
}

function compactSymbolLine(row: ClusterRow): string {
  return `${row.file_path}:${row.start_line}-${row.end_line} ${row.kind} ${row.symbol_name}`;
}

function normalizePathHintTokens(hint: string): string[] {
  return hint
    .trim()
    .toLowerCase()
    .replace(/\\/gu, "/")
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);
}

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.\/]+/g, " ")
    .toLowerCase();
}

function uniqueValues<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function approximateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
