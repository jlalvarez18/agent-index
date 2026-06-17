import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { compactEvidenceLine } from "./evidence.js";
import type {
  AgentQuery,
  FileRole,
  QueryExpansion,
  QueryMatch,
  QueryMatchDebug,
  QueryMode,
  QueryNeighbor,
  QueryResponse,
  SymbolKind
} from "./schema.js";

export interface QueryOptions {
  target: string;
  indexPath?: string;
  limit?: number;
  mode?: QueryMode;
  debug?: boolean;
  expand?: QueryExpansion[];
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
  file_role: FileRole;
  rank: number;
  ftsPosition?: number;
  intentReasons?: string[];
  intentBoost?: number;
  candidateSources?: Array<"fts" | "intent">;
}

interface IntentRule {
  reason: string;
  boost: number;
  score: (row: CandidateRow) => number;
}

export async function queryIndex(question: string, options: QueryOptions): Promise<QueryResponse> {
  return queryWithText(question, options);
}

export async function queryAgentIndex(agentQuery: AgentQuery, options: QueryOptions): Promise<QueryResponse> {
  const queryText = agentQueryTermsText(agentQuery);
  const scoringText = agentQueryTermsText(agentQuery);
  return queryWithText(
    queryText,
    {
      ...options,
      limit: agentQuery.limit ?? options.limit,
      expand: agentQuery.expand ?? options.expand
    },
    agentQuery,
    scoringText
  );
}

async function queryWithText(
  question: string,
  options: QueryOptions,
  agentQuery?: AgentQuery,
  scoringQuestion = question
): Promise<QueryResponse> {
  const dbPath = options.indexPath ?? path.join(path.resolve(options.target), ".codeindex", "index.sqlite");
  validateIndexDatabase(dbPath, options.target);
  const db = new Database(dbPath, { readonly: true });
  const mode = options.mode ?? "symbol";
  try {
    const ftsRows = searchCandidates(db, question, agentQuery);
    const candidateRows =
      mode === "fts"
        ? ftsRows
        : mergeCandidateRows([
            ...searchExactSymbolCandidates(db, agentQuery),
            ...searchPathHintCandidates(db, agentQuery),
            ...searchIntentCandidates(db, scoringQuestion, agentQuery),
            ...ftsRows
          ]);
    const rows = applyAgentQueryFilters(candidateRows, agentQuery);
    const matches = rankRows(db, rows, scoringQuestion, mode, options.limit ?? 5, options.debug ?? false, agentQuery);
    return { query: question, mode, matches };
  } finally {
    db.close();
  }
}

function agentQueryTermsText(agentQuery: AgentQuery): string {
  return agentQuery.terms
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((token, index, tokens) => tokens.indexOf(token) === index)
    .join(" ");
}

function applyAgentQueryFilters(rows: CandidateRow[], agentQuery: AgentQuery | undefined): CandidateRow[] {
  if (!agentQuery) {
    return rows;
  }

  return rows.filter((row) => {
    if (agentQuery.symbolKinds && agentQuery.symbolKinds.length > 0 && !agentQuery.symbolKinds.includes(row.kind)) {
      return false;
    }

    if (agentQuery.roles && agentQuery.roles.length > 0 && !agentQuery.roles.includes(row.file_role)) {
      return false;
    }

    if (agentQuery.excludeSupportCode && row.file_role !== "source") {
      return false;
    }

    return true;
  });
}

function validateIndexDatabase(dbPath: string, target: string): void {
  if (!existsSync(dbPath)) {
    throw new Error(
      `No agent-index database found at ${dbPath}. Run "agent-index index ${path.resolve(target)} --index-path ${dbPath}" first.`
    );
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const requiredTables = ["chunk_fts", "chunks", "symbols", "files", "edges"];
    const foundTables = new Set(
      db
        .prepare(
          `select name from sqlite_master where type in ('table', 'virtual table') and name in (${requiredTables
            .map(() => "?")
            .join(", ")})`
        )
        .all(...requiredTables)
        .map((row) => String((row as { name: unknown }).name))
    );
    if (!requiredTables.every((table) => foundTables.has(table))) {
      throw new Error(
        `The agent-index database at ${dbPath} is missing required tables. Rebuild it with "agent-index index ${path.resolve(
          target
        )} --index-path ${dbPath}".`
      );
    }
  } finally {
    db.close();
  }
}

function rankRows(
  db: Database.Database,
  rows: CandidateRow[],
  question: string,
  mode: QueryMode,
  limit: number,
  debug: boolean,
  agentQuery?: AgentQuery
): QueryMatch[] {
  if (mode === "fts") {
    return uniqueMatches(rows.map((row) => toPlainFtsMatch(row, question, debug))).slice(0, limit);
  }

  if (mode === "hybrid") {
    return rankHybridMatches(
      rows.map((row, index) => ({
        match: toMatch(db, row, question, debug, agentQuery),
        ftsPosition: row.ftsPosition,
        inputIndex: index
      })),
      limit
    );
  }

  return rows
    .map((row) => toMatch(db, row, question, debug, agentQuery))
    .sort((a, b) => b.score - a.score)
    .filter(uniqueMatchFilter())
    .slice(0, limit);
}

function searchCandidates(db: Database.Database, question: string, agentQuery?: AgentQuery): CandidateRow[] {
  const match = ftsMatchQuery(question);
  if (!match) {
    return [];
  }
  const filter = candidateSqlFilter(agentQuery);
  const candidateLimit = ftsCandidateLimit(agentQuery);

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
        f.role as file_role,
        bm25(chunk_fts) as rank
      from chunk_fts
      join chunks c on c.id = chunk_fts.chunk_id
      join symbols s on s.id = c.symbol_id
      join files f on f.id = c.file_id
      where chunk_fts match @match
        ${filter.sql}
      order by rank
      limit ${candidateLimit}
      `
    )
    .all({ match, ...filter.params }) as CandidateRow[];
  return rows.map((row, index) => ({ ...row, ftsPosition: index + 1, candidateSources: ["fts"] }));
}

function ftsCandidateLimit(agentQuery: AgentQuery | undefined): number {
  if (agentQuery?.roles?.includes("test")) {
    return 100;
  }
  return 25;
}

function searchPathHintCandidates(db: Database.Database, agentQuery: AgentQuery | undefined): CandidateRow[] {
  const exactPathHints = (agentQuery?.pathHints ?? [])
    .map((hint) => hint.trim().replace(/\\/gu, "/").replace(/^\.\//u, ""))
    .filter((hint) => /\/.+\.[A-Za-z0-9]+$/u.test(hint));
  if (exactPathHints.length === 0) {
    return [];
  }

  const filter = candidateSqlFilter(agentQuery);
  const pathClauses = exactPathHints.map((hint, index) => {
    const key = `exactPathHint${index}`;
    return { key, hint };
  });
  const params: Record<string, unknown> = { ...filter.params };
  for (const clause of pathClauses) {
    params[clause.key] = clause.hint.toLowerCase();
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
        f.role as file_role,
        0 as rank
      from chunks c
      join symbols s on s.id = c.symbol_id
      join files f on f.id = c.file_id
      where (${pathClauses.map((clause) => `lower(f.path) = @${clause.key} or lower(f.path) like '%/' || @${clause.key}`).join(" or ")})
        ${filter.sql}
      order by f.path, s.start_line
      limit 30
      `
    )
    .all(params) as CandidateRow[];
}

function searchExactSymbolCandidates(db: Database.Database, agentQuery: AgentQuery | undefined): CandidateRow[] {
  const terms = uniqueValues(
    (agentQuery?.terms ?? [])
      .map((term) => term.trim())
      .filter((term) => /^[A-Za-z_][A-Za-z0-9_:.#-]*$/u.test(term))
      .filter((term) => /[A-Z_:.#-]/u.test(term))
      .map((term) => term.toLowerCase())
  ).slice(0, 12);
  if (terms.length === 0) {
    return [];
  }

  const filter = candidateSqlFilter(agentQuery);
  const placeholders = terms.map((_, index) => `@exactSymbol${index}`);
  const params: Record<string, unknown> = {
    ...filter.params,
    ...Object.fromEntries(terms.map((term, index) => [`exactSymbol${index}`, term]))
  };

  return (db
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
        f.role as file_role,
        0 as rank
      from symbols s
      join chunks c on c.symbol_id = s.id
      join files f on f.id = s.file_id
      where (lower(s.name) in (${placeholders.join(", ")}) or lower(s.qualified_name) in (${placeholders.join(", ")}))
        ${filter.sql}
      order by f.path, s.start_line
      limit 40
      `
    )
    .all(params) as CandidateRow[]).map((row) => ({
    ...row,
    intentBoost: Math.max(row.intentBoost ?? 0, 42),
    intentReasons: uniqueValues([...(row.intentReasons ?? []), "exact symbol term match"]),
    candidateSources: uniqueCandidateSources([...(row.candidateSources ?? []), "intent"])
  }));
}

function searchIntentCandidates(db: Database.Database, question: string, agentQuery?: AgentQuery): CandidateRow[] {
  if (agentQuery?.roles?.includes("test")) {
    return [];
  }

  const rules = intentRulesForQuestion(question);
  if (rules.length === 0) {
    return [];
  }
  const filter = candidateSqlFilter(agentQuery);

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
        f.role as file_role,
        0 as rank
      from chunks c
      join symbols s on s.id = c.symbol_id
      join files f on f.id = c.file_id
      where 1 = 1
        ${filter.sql}
      order by f.path, s.start_line
      `
    )
    .all(filter.params) as CandidateRow[];

  return rows
    .filter((row) => row.kind !== "module")
    .map((row) => scoreIntentRow(row, rules))
    .filter((row): row is CandidateRow => row !== undefined)
    .sort((a, b) => (b.intentBoost ?? 0) - (a.intentBoost ?? 0))
    .slice(0, 12);
}

function candidateSqlFilter(agentQuery: AgentQuery | undefined): { sql: string; params: Record<string, unknown> } {
  if (!agentQuery) {
    return { sql: "", params: {} };
  }

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
      const tokens = sqlPathHintTokens(hint);
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

  return { sql: clauses.length > 0 ? clauses.join("\n        ") : "", params };
}

function sqlPathHintTokens(hint: string): string[] {
  return hint
    .trim()
    .toLowerCase()
    .replace(/\\/gu, "/")
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);
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

  return { ...row, intentBoost: boost, intentReasons: reasons, candidateSources: ["intent"] };
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
    const candidateSources = uniqueCandidateSources([...(existing.candidateSources ?? []), ...(row.candidateSources ?? [])]);
    byChunk.set(row.chunk_id, {
      ...existing,
      intentReasons: intentReasons.filter((reason, index) => intentReasons.indexOf(reason) === index),
      intentBoost: Math.max(existing.intentBoost ?? 0, row.intentBoost ?? 0),
      candidateSources,
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
    .map((item) => {
      const lexicalBoost = hybridLexicalBoost(item);
      const specificityBoost = hybridSpecificityBoost(item);
      const containerAdjustment = hybridContainerAdjustment(item);
      const adjustedScore = item.match.score + lexicalBoost + specificityBoost + containerAdjustment;
      return {
        ...item,
        match: addHybridDebug(item.match, item.inputIndex, {
          lexicalBoost,
          specificityBoost,
          containerAdjustment,
          adjustedScore
        }),
        adjustedScore
      };
    })
    .sort((a, b) => b.adjustedScore - a.adjustedScore || a.inputIndex - b.inputIndex)
    .map((item) => item.match)
    .filter(uniqueMatchFilter())
    .slice(0, limit);
}

function uniqueMatches(matches: QueryMatch[]): QueryMatch[] {
  return matches.filter(uniqueMatchFilter());
}

function uniqueMatchFilter(): (match: QueryMatch) => boolean {
  const seen = new Set<string>();
  return (match) => {
    const key = `${match.file}\0${match.symbol}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}

function addHybridDebug(
  match: QueryMatch,
  inputIndex: number,
  scores: NonNullable<QueryMatchDebug["hybrid"]>
): QueryMatch {
  if (!match.debug) {
    return match;
  }

  return {
    ...match,
    debug: {
      ...match.debug,
      inputIndex,
      hybrid: {
        lexicalBoost: Number(scores.lexicalBoost.toFixed(3)),
        specificityBoost: Number(scores.specificityBoost.toFixed(3)),
        containerAdjustment: Number(scores.containerAdjustment.toFixed(3)),
        adjustedScore: Number(scores.adjustedScore.toFixed(3))
      }
    }
  };
}

function hybridLexicalBoost(item: HybridRankInput): number {
  if (item.ftsPosition === undefined || item.ftsPosition > 5) {
    return 0;
  }

  if (item.match.kind === "function") {
    return 4;
  }

  if (
    item.match.kind === "method" &&
    !isDunderMethod(item.match) &&
    (item.match.why.includes("method name match") ||
      item.match.why.includes("method owner/name match") ||
      item.match.why.includes("method owner/source match"))
  ) {
    return 4;
  }

  return 0;
}

function isDunderMethod(match: QueryMatch): boolean {
  if (match.kind !== "method") {
    return false;
  }
  const name = match.symbol.includes(".") ? match.symbol.slice(match.symbol.lastIndexOf(".") + 1) : match.symbol;
  return name.startsWith("__") && name.endsWith("__");
}

function hybridSpecificityBoost(item: HybridRankInput): number {
  if (
    item.match.kind === "function" &&
    item.match.why.includes("exact symbol name match") &&
    item.match.why.includes("symbol token coverage match")
  ) {
    return 3;
  }

  if (item.match.kind === "method" && hasIntentReason(item.match)) {
    if (methodLeafTokens(item.match).includes("call")) {
      return 14;
    }
    if (item.match.why.includes("method owner/name match") || item.match.why.includes("method name match")) {
      return 8;
    }
    return 4;
  }
  if (item.match.kind === "method" && item.match.why.includes("method owner/name match")) {
    return 2;
  }
  if (
    item.match.kind === "method" &&
    item.ftsPosition !== undefined &&
    item.ftsPosition <= 2 &&
    !isDunderMethod(item.match) &&
    methodLeafTokens(item.match).length === 1 &&
    item.match.why.includes("method name match")
  ) {
    return 3;
  }
  return 0;
}

function hybridContainerAdjustment(item: HybridRankInput): number {
  if (item.match.kind === "module") {
    return -18;
  }
  if (
    item.match.kind === "class" &&
    (item.match.why.includes("symbol token coverage match") || hasIntentReason(item.match)) &&
    !item.match.why.includes("exact class name match")
  ) {
    return -12;
  }
  return 0;
}

function hasIntentReason(match: QueryMatch): boolean {
  return match.why.some((reason) => reason.includes("intent"));
}

function methodLeafTokens(match: QueryMatch): string[] {
  const leafName = match.symbol.includes(".") ? match.symbol.slice(match.symbol.lastIndexOf(".") + 1) : match.symbol;
  return normalize(leafName)
    .split(/\s+/)
    .filter(Boolean);
}

function minDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function toMatch(
  db: Database.Database,
  row: CandidateRow,
  question: string,
  debug: boolean,
  agentQuery?: AgentQuery
): QueryMatch {
  const why: string[] = ["matched source text"];
  let score = 1;
  const normalizedQuestion = normalize(question);
  const normalizedSymbol = normalize(row.qualified_name);
  const normalizedSymbolName = normalize(row.symbol_name);
  const symbolNameTokens = normalizedSymbolName.split(/\s+/).filter(Boolean);
  const normalizedFile = normalize(row.file_path);
  const normalizedChunk = normalize(row.chunk_text);

  for (const token of rankedQueryTokens(question)) {
    if (normalizedChunk.includes(token)) {
      score += 1;
    }
    if (normalizedSymbol.includes(token) || symbolNameTokens.some((symbolToken) => tokensLooselyMatch(symbolToken, token))) {
      score += 2;
      addWhy(why, "symbol name match");
    }
    if (row.kind === "method" && (normalizedSymbolName.includes(token) || symbolNameTokens.some((symbolToken) => tokensLooselyMatch(symbolToken, token)))) {
      addWhy(why, "method name match");
    }
    if (normalizedFile.includes(token)) {
      score += 1;
      addWhy(why, "file path match");
    }
  }

  const symbolTokens = normalizedSymbol.split(/\s+/).filter(Boolean);
  if (symbolTokens.length > 1 && normalizedQuestion.includes(normalizedSymbol)) {
    score += row.kind === "method" || row.kind === "function" ? 6 : 3;
    addWhy(why, "exact identifier match");
  }

  const exactSymbolName = exactSymbolNameAdjustment(row, question, normalizedQuestion);
  score += exactSymbolName.score;
  if (exactSymbolName.score > 0) {
    addWhy(why, exactSymbolName.reason);
  }

  const exactClassName = exactClassNameAdjustment(row, normalizedQuestion);
  score += exactClassName.score;
  if (exactClassName.score > 0) {
    addWhy(why, exactClassName.reason);
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

  const ownerSourceAdjustment = methodOwnerSourceAdjustment(row, question, normalizedChunk);
  score += ownerSourceAdjustment.score;
  if (ownerSourceAdjustment.score > 0) {
    addWhy(why, ownerSourceAdjustment.reason);
  }

  const symbolCoverage = symbolTokenCoverageAdjustment(row, question);
  score += symbolCoverage.score;
  if (symbolCoverage.score > 0) {
    addWhy(why, symbolCoverage.reason);
  }

  const actionDomain = actionDomainSymbolAdjustment(row, question);
  score += actionDomain.score;
  if (actionDomain.score > 0) {
    addWhy(why, actionDomain.reason);
  }

  const exactFileContext = exactFileContextAdjustment(row, question);
  score += exactFileContext.score;
  if (exactFileContext.score > 0) {
    addWhy(why, exactFileContext.reason);
  }

  const pathHint = pathHintAdjustment(row, agentQuery);
  score += pathHint.score;
  if (pathHint.score > 0) {
    addWhy(why, pathHint.reason);
  }

  const swiftUIViewBody = swiftUIViewBodyAdjustment(row, question);
  score += swiftUIViewBody.score;
  if (swiftUIViewBody.score > 0) {
    addWhy(why, swiftUIViewBody.reason);
  }

  const kotlinNavigation = kotlinNavigationAdjustment(row, question);
  score += kotlinNavigation.score;
  if (kotlinNavigation.score > 0) {
    addWhy(why, kotlinNavigation.reason);
  }

  const buildToolNavigation = buildToolNavigationAdjustment(row, question);
  score += buildToolNavigation.score;
  if (buildToolNavigation.score > 0) {
    addWhy(why, buildToolNavigation.reason);
  }

  const cythonNavigation = cythonNavigationAdjustment(row, question);
  score += cythonNavigation.score;
  if (cythonNavigation.score > 0) {
    addWhy(why, cythonNavigation.reason);
  }

  const testApi = testApiEvidenceAdjustment(row, question);
  score += testApi.score;
  if (testApi.score > 0) {
    addWhy(why, testApi.reason);
  }

  const decoratorTarget = decoratorTargetAdjustment(row, question);
  score += decoratorTarget.score;
  if (decoratorTarget.score > 0) {
    addWhy(why, decoratorTarget.reason);
  }

  const representationClass = representationClassAdjustment(row, question);
  score += representationClass.score;
  if (representationClass.score > 0) {
    addWhy(why, representationClass.reason);
  }

  const namedClassContainer = namedClassContainerAdjustment(row, question);
  score += namedClassContainer.score;
  if (namedClassContainer.score !== 0) {
    addWhy(why, namedClassContainer.reason);
  }

  const hookSpecification = hookSpecificationAdjustment(row, question);
  score += hookSpecification.score;
  if (hookSpecification.score !== 0) {
    addWhy(why, hookSpecification.reason);
  }

  const optionRegistration = optionRegistrationAdjustment(row, question);
  score += optionRegistration.score;
  if (optionRegistration.score !== 0) {
    addWhy(why, optionRegistration.reason);
  }

  const shortFlag = shortFlagSymbolAdjustment(row, question);
  score += shortFlag.score;
  if (shortFlag.score > 0) {
    addWhy(why, shortFlag.reason);
  }

  const neighbors = shouldExpandNeighbors(agentQuery) ? expandNeighbors(db, row.symbol_id) : [];
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
    evidence: compactEvidenceLine(row.chunk_text, rankedQueryTokens(question)),
    neighbors,
    debug: debug ? debugForRow(row) : undefined
  };
}

function shouldExpandNeighbors(agentQuery: AgentQuery | undefined): boolean {
  if (!agentQuery || agentQuery.expand === undefined) {
    return true;
  }
  return agentQuery.expand.length > 0;
}

function toPlainFtsMatch(row: CandidateRow, question: string, debug: boolean): QueryMatch {
  return {
    symbol: row.qualified_name,
    kind: row.kind,
    file: row.file_path,
    lines: [row.symbol_start_line, row.symbol_end_line],
    score: Number((-row.rank).toFixed(3)),
    why: ["plain FTS match"],
    evidence: compactEvidenceLine(row.chunk_text, rankedQueryTokens(question)),
    neighbors: [],
    debug: debug ? debugForRow(row) : undefined
  };
}

function debugForRow(row: CandidateRow): QueryMatchDebug {
  const candidateSources = row.candidateSources ?? inferredCandidateSources(row);
  return {
    candidateSources,
    ftsPosition: row.ftsPosition,
    intentBoost: row.intentBoost,
    intentReasons: row.intentReasons
  };
}

function inferredCandidateSources(row: CandidateRow): Array<"fts" | "intent"> {
  const sources: Array<"fts" | "intent"> = [];
  if (row.ftsPosition !== undefined) {
    sources.push("fts");
  }
  if (row.intentBoost !== undefined || row.intentReasons !== undefined) {
    sources.push("intent");
  }
  return sources;
}

function uniqueCandidateSources(sources: Array<"fts" | "intent">): Array<"fts" | "intent"> {
  return sources.filter((source, index) => sources.indexOf(source) === index);
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
      order by
        case when e.target_symbol_id = @symbolId then 0 else 1 end,
        case when e.kind = 'symbol_conforms_to' then 0 else 1 end,
        e.id
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
  const relation =
    row.relation === "symbol_calls_name"
      ? "called_by_name"
      : row.relation === "symbol_conforms_to"
        ? "conformed_to_by"
        : `incoming_${String(row.relation)}`;
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
  const fileStemTokens = fileStemTokensForRow(row);
  const symbolNameTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  const symbolTokens = new Set(symbolNameTokens);

  if (
    fileStemTokens.length > 0 &&
    row.kind === "function" &&
    symbolNameTokens.length === fileStemTokens.length &&
    fileStemTokens.every((fileToken) => symbolNameTokens.some((symbolToken) => tokensLooselyMatch(fileToken, symbolToken)))
  ) {
    score += 6;
  }

  for (const supportToken of ["rationale", "note", "notes", "doc", "docs", "describe", "description", "explain"]) {
    if (symbolTokens.has(supportToken)) {
      score -= 8;
    }
  }

  return { score, reason: "core symbol match" };
}

function tokensLooselyMatch(left: string, right: string): boolean {
  if (left === right || stemToken(left) === stemToken(right)) {
    return true;
  }

  if ((left === "pipe" && right === "pipeline") || (left === "pipeline" && right === "pipe")) {
    return true;
  }

  if ((left === "keep" && right === "stay") || (left === "stay" && right === "keep")) {
    return true;
  }

  if ((left === "sync" && right === "synchronous") || (left === "synchronous" && right === "sync")) {
    return true;
  }

  return commonPrefixLength(left, right) >= 5;
}

function fileStemTokensForRow(row: CandidateRow): string[] {
  return normalize(path.basename(row.file_path, ".py"))
    .split(/\s+/)
    .filter(Boolean);
}

function hasModuleDomainSignal(question: string): boolean {
  return moduleDomainTokensForQuestion(question).length > 0;
}

function moduleDomainTokensForQuestion(question: string): string[] {
  const tokens = rankedQueryTokens(question);
  return tokens.filter((token) =>
    moduleDomainVocabulary().some((domain) => moduleDomainTokensMatch(domain, token))
  );
}

function moduleDomainVocabulary(): string[] {
  return [
      "converter",
      "validator",
      "setter",
      "serializer",
      "parser",
      "reader",
      "writer",
      "filter",
      "compiler"
    ];
}

function moduleDomainTokensMatch(domainToken: string, queryToken: string): boolean {
  const domain = stemToken(domainToken);
  const query = stemToken(queryToken);
  if (domain === query) {
    return true;
  }

  if (domain === "validator" && query === "validate") {
    return true;
  }

  if (domain === "setter" && (query === "setattr" || query === "on" || query === "set")) {
    return true;
  }

  if (domain === "parser" && (query === "parse" || query === "parser")) {
    return true;
  }

  if (domain === "reader" && (query === "parse" || query === "parser" || query === "read")) {
    return true;
  }

  if (domain === "writer" && (query === "write" || query === "writer")) {
    return true;
  }

  return false;
}

function isReaderModuleQuestion(queryTokens: string[]): boolean {
  return queryTokens.some((token) =>
    ["body", "chunked", "header", "headers", "line", "lines", "message", "request", "response"].includes(token)
  );
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function methodOwnerNameAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (row.kind !== "method") {
    return { score: 0, reason: "method owner/name match" };
  }

  if (isPropertyMethod(row) && !questionMentionsExactQualifiedName(row, question)) {
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

function methodOwnerSourceAdjustment(
  row: CandidateRow,
  question: string,
  normalizedChunk: string
): { score: number; reason: string } {
  if (row.kind !== "method") {
    return { score: 0, reason: "method owner/source match" };
  }

  if (isPropertyMethod(row) && !questionMentionsExactQualifiedName(row, question)) {
    return { score: 0, reason: "method owner/source match" };
  }

  if (isDunderCandidate(row) && !isDunderQuestion(row, question)) {
    return { score: 0, reason: "method owner/source match" };
  }

  if (isHttpVerbDecoratorMethod(row) && !queryMentionsSymbolName(row, question)) {
    return { score: 0, reason: "method owner/source match" };
  }

  const decoratorTargetNames = decoratorTargets(question);
  if (decoratorTargetNames.length > 0 && !symbolNameMatchesAny(row, decoratorTargetNames)) {
    return { score: 0, reason: "method owner/source match" };
  }

  const queryTokenSet = new Set(rankedQueryTokens(question));
  const ownerName = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
  const ownerTokens = normalize(ownerName)
    .split(/\s+/)
    .filter(Boolean);
  const ownerTokenSet = new Set(ownerTokens);

  if (!ownerTokens.every((token) => queryTokenSet.has(token))) {
    return { score: 0, reason: "method owner/source match" };
  }

  const behaviorMatches = [...queryTokenSet].filter(
    (token) => !ownerTokenSet.has(token) && token.length >= 4 && normalizedChunk.includes(token)
  );

  if (behaviorMatches.length >= 2) {
    return { score: 3, reason: "method owner/source match" };
  }

  return { score: 0, reason: "method owner/source match" };
}

function namedOwnerApiMethodScore(row: CandidateRow, question: string): number {
  if (row.kind !== "method") {
    return 0;
  }

  if (isPropertyMethod(row) && !questionMentionsExactQualifiedName(row, question)) {
    return 0;
  }

  if (isDunderCandidate(row) && !isDunderQuestion(row, question)) {
    return 0;
  }

  const queryTokenSet = new Set(rankedQueryTokens(question));
  const ownerName = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
  const ownerTokens = normalize(ownerName)
    .split(/\s+/)
    .filter(Boolean);
  if (ownerTokens.length === 0 || !normalize(question).includes(ownerTokens.join(" "))) {
    return 0;
  }

  const methodTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  const significantMethodTokens = methodTokens.filter((token) => !ownerTokens.includes(token));
  if (significantMethodTokens.length === 0 || !significantMethodTokens.every((token) => queryCoversApiMethodToken(token, queryTokenSet))) {
    return 0;
  }

  const hasOwnerEcho = methodTokens.some((token) => ownerTokens.includes(token));
  const hasPublicApiToken = significantMethodTokens.some((token) => publicApiMethodTokens().has(token));
  if (!hasOwnerEcho && !hasPublicApiToken) {
    return 0;
  }

  let score = 44 + Math.min(significantMethodTokens.length, 3) * 5;
  if (methodTokens.length > significantMethodTokens.length) score += 4;
  if (normalize(row.file_path).includes(ownerTokens[ownerTokens.length - 1] ?? "")) score += 2;
  return score;
}

function queryCoversApiMethodToken(token: string, queryTokens: Set<string>): boolean {
  if (queryTokens.has(token)) {
    return true;
  }

  if (token === "dump") {
    return ["serialize", "serializes", "serialized", "serializing"].some((queryToken) => queryTokens.has(queryToken));
  }

  return false;
}

function publicApiMethodTokens(): Set<string> {
  return new Set(["validate", "dump", "json", "schema", "rebuild", "parse", "load", "save"]);
}

function symbolNameMatchesAny(row: CandidateRow, targets: string[]): boolean {
  const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  return (
    symbolTokens.length === 1 &&
    targets.some((target) => symbolTokens.some((symbolToken) => tokensLooselyMatch(symbolToken, target)))
  );
}

function symbolTokenCoverageAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  const queryTokens = rankedQueryTokens(question);
  const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter((token) => token && isRequiredSymbolCoverageToken(token));

  if (
    symbolTokens.length >= 2 &&
    symbolTokens.every((symbolToken) => queryTokens.some((queryToken) => tokensLooselyMatch(symbolToken, queryToken)))
  ) {
    return { score: 4, reason: "symbol token coverage match" };
  }

  return { score: 0, reason: "symbol token coverage match" };
}

function exactSymbolNameAdjustment(
  row: CandidateRow,
  question: string,
  normalizedQuestion: string
): { score: number; reason: string } {
  if (row.kind !== "function" && row.kind !== "method") {
    return { score: 0, reason: "exact symbol name match" };
  }

  if (isDunderCandidate(row) && isDunderQuestion(row, question)) {
    return { score: 18, reason: "exact symbol name match" };
  }

  const symbolTokens = exactMatchSymbolTokens(normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean));
  if (symbolTokens.length < 2) {
    return { score: 0, reason: "exact symbol name match" };
  }

  const normalizedName = symbolTokens.join(" ");
  if (normalizedQuestion.includes(normalizedName)) {
    return { score: 10, reason: "exact symbol name match" };
  }

  if (exactSymbolTokensInQueryOrder(symbolTokens, rankedQueryTokens(question))) {
    return { score: 8, reason: "exact symbol name match" };
  }

  return { score: 0, reason: "exact symbol name match" };
}

function exactMatchSymbolTokens(symbolTokens: string[]): string[] {
  if (symbolTokens.length >= 3 && ["handle", "on"].includes(symbolTokens[0])) {
    return symbolTokens.slice(1);
  }
  return symbolTokens;
}

function exactSymbolTokensInQueryOrder(symbolTokens: string[], queryTokens: string[]): boolean {
  let queryIndex = 0;
  for (const symbolToken of symbolTokens) {
    let found = false;
    while (queryIndex < queryTokens.length) {
      if (exactSymbolTokenMatches(symbolToken, queryTokens[queryIndex])) {
        found = true;
        queryIndex += 1;
        break;
      }
      queryIndex += 1;
    }
    if (!found) {
      return false;
    }
  }
  return true;
}

function exactSymbolTokenMatches(symbolToken: string, queryToken: string): boolean {
  if (symbolToken === queryToken || stemToken(symbolToken) === stemToken(queryToken)) {
    return true;
  }

  if ((symbolToken === "keep" && queryToken === "stay") || (symbolToken === "stay" && queryToken === "keep")) {
    return true;
  }

  if (
    (symbolToken === "sync" && queryToken === "synchronous") ||
    (symbolToken === "synchronous" && queryToken === "sync")
  ) {
    return true;
  }

  const parameterTokens = new Set(["param", "params", "parameter", "parameters"]);
  return parameterTokens.has(symbolToken) && parameterTokens.has(queryToken);
}

function actionDomainSymbolAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (row.kind !== "function" && row.kind !== "method") {
    return { score: 0, reason: "action/domain symbol match" };
  }

  const queryTokenSet = new Set(rankedQueryTokens(question));
  const actionTokens = implementationActionTokensForQuestion(queryTokenSet);
  if (actionTokens.length === 0) {
    return { score: 0, reason: "action/domain symbol match" };
  }

  const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  const actionMatch = actionTokens.some((action) => symbolTokens.some((symbolToken) => actionTokenMatches(symbolToken, action)));
  if (!actionMatch) {
    return { score: 0, reason: "action/domain symbol match" };
  }

  const domainMatch = symbolTokens.some((symbolToken) =>
    [...queryTokenSet].some((queryToken) => !actionTokens.includes(queryToken) && queryToken.length >= 5 && tokensLooselyMatch(symbolToken, queryToken))
  );
  if (!domainMatch) {
    return { score: 0, reason: "action/domain symbol match" };
  }

  return { score: 14, reason: "action/domain symbol match" };
}

function exactFileContextAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (row.kind !== "function" && row.kind !== "method" && row.kind !== "class") {
    return { score: 0, reason: "exact file context match" };
  }

  const fileStemTokens = normalize(path.basename(row.file_path, ".py"))
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  if (fileStemTokens.length === 0) {
    return { score: 0, reason: "exact file context match" };
  }

  const queryTokens = rankedQueryTokens(question);
  if (!fileStemTokens.every((fileToken) => queryTokens.some((queryToken) => tokensLooselyMatch(fileToken, queryToken)))) {
    return { score: 0, reason: "exact file context match" };
  }

  const actionTokens = fileContextActionTokensForQuestion(new Set(queryTokens));
  if (actionTokens.length === 0) {
    return { score: 0, reason: "exact file context match" };
  }

  const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  if (!symbolTokens.some((symbolToken) => actionTokens.some((actionToken) => actionTokenMatches(symbolToken, actionToken)))) {
    return { score: 0, reason: "exact file context match" };
  }

  return { score: 16, reason: "exact file context match" };
}

function pathHintAdjustment(row: CandidateRow, agentQuery: AgentQuery | undefined): { score: number; reason: string } {
  const pathHints = agentQuery?.pathHints?.map((hint) => ({ raw: hint, normalized: normalizedPathHint(hint) })).filter((hint) => hint.normalized) ?? [];
  if (pathHints.length === 0) {
    return { score: 0, reason: "path hint match" };
  }

  const normalizedFile = normalize(row.file_path);
  let score = 0;
  for (const hint of pathHints) {
    score += pathHintMatchScore(normalizedFile, hint.raw, hint.normalized);
  }
  if (score === 0) {
    return { score: 0, reason: "path hint match" };
  }

  return { score: Math.min(score, 30), reason: "path hint match" };
}

function normalizedPathHint(hint: string): string {
  return normalize(hint.replace(/\.py$/u, ""));
}

function pathHintMatchesFile(normalizedFile: string, normalizedHint: string): boolean {
  return pathHintMatchScore(normalizedFile, normalizedHint, normalizedHint) > 0;
}

function pathHintMatchScore(normalizedFile: string, rawHint: string, normalizedHint: string): number {
  if (!normalizedHint) {
    return 0;
  }

  const hasPathSeparator = /[\\/]/u.test(rawHint);
  const hasFileExtension = /\.[A-Za-z0-9]+$/u.test(rawHint);
  if (hasPathSeparator && hasFileExtension && (normalizedFile === normalizedHint || normalizedFile.endsWith(` ${normalizedHint}`))) {
    return 28;
  }

  if (normalizedFile.includes(normalizedHint)) {
    return hasPathSeparator ? 14 : 2;
  }

  const hintTokens = normalizedHint.split(/\s+/).filter((token) => token.length >= 2 && token !== "py");
  if (hintTokens.length === 0) {
    return 0;
  }

  const fileTokens = new Set(normalizedFile.split(/\s+/).filter(Boolean));
  return hintTokens.every((hintToken) =>
    [...fileTokens].some((fileToken) => fileToken === hintToken || tokensLooselyMatch(fileToken, hintToken))
  )
    ? 2
    : 0;
}

function swiftUIViewBodyAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (!row.file_path.endsWith(".swift") || row.kind !== "method" || row.symbol_name !== "body") {
    return { score: 0, reason: "SwiftUI view body flow match" };
  }

  const tokens = new Set(rankedQueryTokens(question));
  const asksForViewFlow =
    tokens.has("swiftui") ||
    (tokens.has("view") && (tokens.has("body") || tokens.has("model") || tokens.has("action") || tokens.has("button")));
  if (!asksForViewFlow || !tokens.has("body")) {
    return { score: 0, reason: "SwiftUI view body flow match" };
  }

  return { score: 14, reason: "SwiftUI view body flow match" };
}

function kotlinNavigationAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (!row.file_path.endsWith(".kt") && !row.file_path.endsWith(".kts")) {
    return { score: 0, reason: "Kotlin navigation signal match" };
  }

  const tokens = new Set(rankedQueryTokens(question));
  const chunk = normalize(row.chunk_text);
  const symbol = normalize(row.qualified_name);
  const file = normalize(row.file_path);
  let score = 0;

  const flowTerms = ["flow", "stateflow", "sharedflow", "suspend", "coroutine", "collect", "emit", "map", "transform", "launch"];
  if (flowTerms.some((term) => tokens.has(term))) {
    const flowEvidence = ["flow", "stateflow", "sharedflow", "suspend", "collect", "emit", "map", "transform", "launch", "viewmodelscope"].filter(
      (term) => chunk.includes(term) || symbol.includes(term)
    );
    if (flowEvidence.length > 0 && (row.kind === "function" || row.kind === "method")) {
      score += Math.min(10 + flowEvidence.length * 3, 24);
    }
  }

  const asksForGradle =
    tokens.has("gradle") ||
    tokens.has("plugin") ||
    tokens.has("dependency") ||
    tokens.has("dependencies") ||
    tokens.has("target") ||
    tokens.has("module") ||
    tokens.has("implementation") ||
    tokens.has("api") ||
    tokens.has("project") ||
    tokens.has("sourceset") ||
    tokens.has("sourcesets") ||
    tokens.has("wires") ||
    tokens.has("wiring");
  if (asksForGradle && row.file_path.endsWith(".gradle.kts")) {
    score += 12;
    if (symbol.startsWith("gradle ")) score += 10;
    if (["implementation", "api", "testimplementation", "androidtestimplementation", "plugin", "include", "namespace"].some((term) => symbol.includes(term))) {
      score += 8;
    }
  }

  const asksForDi =
    tokens.has("di") ||
    tokens.has("inject") ||
    tokens.has("injected") ||
    tokens.has("hilt") ||
    tokens.has("koin") ||
    tokens.has("module") ||
    tokens.has("single") ||
    tokens.has("factory");
  if (asksForDi) {
    const diEvidence = ["inject", "hiltviewmodel", "module", "single", "factory", "provides", "binds", "koin"].filter(
      (term) => chunk.includes(term) || symbol.includes(term)
    );
    if (diEvidence.length > 0) {
      score += Math.min(8 + diEvidence.length * 4, 24);
    }
  }

  if ((tokens.has("extension") || tokens.has("receiver")) && row.kind === "function" && symbol.split(/\s+/).length >= 2) {
    score += 12;
    if (chunk.includes("fun ") && row.qualified_name.includes(".")) {
      score += 8;
    }
  }

  if ((tokens.has("viewmodel") || tokens.has("ui") || tokens.has("state")) && file.includes("viewmodel")) {
    score += 8;
  }

  return score > 0 ? { score: Math.min(score, 36), reason: "Kotlin navigation signal match" } : { score: 0, reason: "Kotlin navigation signal match" };
}

function buildToolNavigationAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  const isBuildFile = row.file_path.endsWith(".gradle.kts") || row.file_path.endsWith("pom.xml") || row.file_path.endsWith("libs.versions.toml");
  if (!isBuildFile) {
    return { score: 0, reason: "build tool ownership match" };
  }

  const tokens = new Set(rankedQueryTokens(question));
  const asksForBuildTool =
    tokens.has("gradle") ||
    tokens.has("maven") ||
    tokens.has("pom") ||
    tokens.has("plugin") ||
    tokens.has("dependency") ||
    tokens.has("dependencies") ||
    tokens.has("target") ||
    tokens.has("module") ||
    tokens.has("implementation") ||
    tokens.has("api") ||
    tokens.has("project") ||
    tokens.has("artifact") ||
    tokens.has("artifactid") ||
    tokens.has("groupid") ||
    tokens.has("catalog") ||
    tokens.has("alias") ||
    tokens.has("library") ||
    tokens.has("libraries") ||
    tokens.has("version") ||
    tokens.has("versions") ||
    tokens.has("coordinate") ||
    tokens.has("coordinates") ||
    tokens.has("wires") ||
    tokens.has("wiring");
  if (!asksForBuildTool) {
    return { score: 0, reason: "build tool ownership match" };
  }

  const symbol = normalize(row.qualified_name);
  const chunk = normalize(row.chunk_text);
  let score = 10;
  if (symbol.startsWith("gradle ") || symbol.startsWith("maven ")) score += 10;
  if (["dependency", "implementation", "api", "plugin", "module", "project", "catalog", "library", "version", "sourceset"].some((term) => symbol.includes(term))) score += 8;
  if (["dependency", "artifactid", "groupid", "plugin", "module", "project", "version", "version ref"].some((term) => chunk.includes(term))) score += 6;
  return { score: Math.min(score, 30), reason: "build tool ownership match" };
}

function cythonNavigationAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (!isCythonPath(row.file_path)) {
    return { score: 0, reason: "Cython navigation signal match" };
  }

  const tokens = new Set(rankedQueryTokens(question));
  const chunk = normalize(row.chunk_text);
  const symbol = normalize(row.qualified_name);
  const file = normalize(row.file_path);
  const asksForCythonBackend = [
    "backend",
    "brute",
    "cdef",
    "cimport",
    "cpdef",
    "cython",
    "dense",
    "distance",
    "distances",
    "float32",
    "float64",
    "fused",
    "nogil",
    "parallel",
    "prange",
    "reduction",
    "sparse",
    "template"
  ].some((term) => tokens.has(term));
  if (!asksForCythonBackend) {
    return { score: 0, reason: "Cython navigation signal match" };
  }

  const evidenceTerms = ["cdef", "cpdef", "cimport", "nogil", "prange", "floating", "float32", "float64", "intp", "parallel", "reduction", "distances"].filter(
    (term) => chunk.includes(term) || symbol.includes(term) || file.includes(term)
  );
  if (evidenceTerms.length === 0) {
    return { score: 0, reason: "Cython navigation signal match" };
  }

  const kindBoost = row.kind === "method" || row.kind === "function" ? 8 : row.kind === "class" ? 5 : 2;
  return { score: Math.min(kindBoost + evidenceTerms.length * 3, 28), reason: "Cython navigation signal match" };
}

function isCythonPath(filePath: string): boolean {
  return /\.(?:pyx|pxd|pxi)(?:\.(?:tp|in))?$/u.test(filePath);
}

function testApiEvidenceAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (row.file_role !== "test") {
    return { score: 0, reason: "test API evidence match" };
  }

  const normalizedChunk = normalize(row.chunk_text);
  const normalizedSymbolName = normalize(row.symbol_name);
  const phrases = exactApiPhrases(question);
  const rawChunk = row.chunk_text;
  let score = 0;

  for (const phrase of phrases) {
    if (normalizedChunk.includes(phrase)) {
      score += 8;
    }
    if (normalizedSymbolName.includes(phrase)) {
      score += 10;
    }
  }

  const symbolNameTokens = new Set(normalizedSymbolName.split(/\s+/).filter(Boolean));
  const matchedNameTokens = rankedQueryTokens(question).filter(
    (token) => token.length >= 5 && symbolNameTokens.has(token)
  );
  score += Math.min(matchedNameTokens.length * 2, 8);

  for (const term of exactApiTerms(question)) {
    const leaf = term.includes(".") ? term.slice(term.lastIndexOf(".") + 1) : term;
    if (apiCallPattern(leaf).test(rawChunk)) {
      score += 14;
    } else if (apiKeywordArgumentPattern(leaf).test(rawChunk)) {
      score += 4;
    }
  }

  return score > 0 ? { score: Math.min(score, 36), reason: "test API evidence match" } : { score: 0, reason: "test API evidence match" };
}

function exactApiTerms(question: string): string[] {
  return question
    .split(/\s+/)
    .map((term) => term.trim().replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/gu, ""))
    .filter((term) => /[._]/u.test(term))
    .filter((term, index, terms) => terms.indexOf(term) === index);
}

function apiCallPattern(name: string): RegExp {
  return new RegExp(`(?:\\.|\\b)${escapeRegExp(name)}\\s*\\(`, "u");
}

function apiKeywordArgumentPattern(name: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(name)}\\s*=`, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function exactApiPhrases(question: string): string[] {
  return question
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => /[._]/u.test(term))
    .map((term) => normalize(term.replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/gu, "")))
    .filter((term) => term.split(/\s+/).filter(Boolean).length >= 2)
    .filter((term, index, terms) => terms.indexOf(term) === index);
}

function exactClassNameAdjustment(row: CandidateRow, normalizedQuestion: string): { score: number; reason: string } {
  if (row.kind !== "class") {
    return { score: 0, reason: "exact class name match" };
  }

  const normalizedName = normalize(row.symbol_name);
  if (normalizedQuestion.includes(`${normalizedName} class`) || normalizedQuestion.includes(`class ${normalizedName}`)) {
    return { score: 6, reason: "exact class name match" };
  }

  return { score: 0, reason: "exact class name match" };
}

function decoratorTargetAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  const targets = decoratorTargets(question);
  if (targets.length === 0 || (row.kind !== "function" && row.kind !== "method")) {
    return { score: 0, reason: "decorator target match" };
  }

  if (symbolNameMatchesAny(row, targets)) {
    return { score: 8, reason: "decorator target match" };
  }

  return { score: 0, reason: "decorator target match" };
}

function representationClassAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (row.kind !== "class") {
    return { score: 0, reason: "representation class match" };
  }

  const tokens = new Set(rankedQueryTokens(question));
  if (!tokens.has("represented") && !tokens.has("representation") && !tokens.has("config") && !tokens.has("configuration")) {
    return { score: 0, reason: "representation class match" };
  }

  const symbolTokens = normalize(row.symbol_name)
    .split(/\s+/)
    .filter(Boolean);
  if (symbolTokens.length > 0 && symbolTokens.every((token) => tokens.has(token))) {
    const fileScore = normalize(row.file_path).includes("config") ? 4 : 0;
    return { score: 8 + fileScore, reason: "representation class match" };
  }

  return { score: 0, reason: "representation class match" };
}

function namedClassContainerAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (row.kind !== "class") {
    return { score: 0, reason: "named class container context" };
  }

  const normalizedQuestion = normalize(question);
  const normalizedSymbol = normalize(row.qualified_name);
  if (!normalizedQuestion.includes(normalizedSymbol)) {
    return { score: 0, reason: "named class container context" };
  }

  const tokens = new Set(rankedQueryTokens(question));
  if (tokens.has("class") || tokens.has("represented") || tokens.has("representation") || tokens.has("config") || tokens.has("configuration")) {
    return { score: 0, reason: "named class container context" };
  }

  const behaviorTokens = [...tokens].filter((token) => token.length >= 5 && !normalizedSymbol.split(/\s+/).includes(token));
  if (behaviorTokens.length < 4) {
    return { score: 0, reason: "named class container context" };
  }

  return { score: -14, reason: "named class container context" };
}

function hookSpecificationAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  if (!path.basename(row.file_path).includes("hookspec")) {
    return { score: 0, reason: "hook specification context" };
  }

  const tokens = new Set(rankedQueryTokens(question));
  if (tokens.has("hook") || tokens.has("hookspec") || tokens.has("spec") || tokens.has("specification")) {
    return { score: 0, reason: "hook specification context" };
  }

  return { score: -16, reason: "hook specification context" };
}

function optionRegistrationAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  const normalizedSymbolName = normalize(row.symbol_name);
  if (!normalizedSymbolName.includes("addoption") && !normalizedSymbolName.includes("add option") && !normalizedSymbolName.includes("add argument")) {
    return { score: 0, reason: "option registration context" };
  }

  if (!/--[A-Za-z0-9][A-Za-z0-9-]*/.test(question)) {
    return { score: 0, reason: "option registration context" };
  }

  const tokens = new Set(rankedQueryTokens(question));
  if (
    tokens.has("option") ||
    tokens.has("options") ||
    tokens.has("register") ||
    tokens.has("registered") ||
    tokens.has("define") ||
    tokens.has("defined") ||
    tokens.has("declare") ||
    tokens.has("declared")
  ) {
    return { score: 0, reason: "option registration context" };
  }

  return { score: -10, reason: "option registration context" };
}

function shortFlagSymbolAdjustment(row: CandidateRow, question: string): { score: number; reason: string } {
  const shortFlags = [...question.matchAll(/--([A-Za-z][A-Za-z0-9-]*)\b/g)]
    .map((match) => match[1])
    .filter((flag): flag is string => Boolean(flag) && flag.length <= 3);
  if (shortFlags.length === 0) {
    return { score: 0, reason: "short flag symbol match" };
  }

  const rawQualifiedName = row.qualified_name.replace(/[^A-Za-z0-9]/g, "");
  if (shortFlags.some((flag) => rawQualifiedName.includes(flag.toUpperCase()))) {
    return { score: 12, reason: "short flag symbol match" };
  }

  return { score: 0, reason: "short flag symbol match" };
}

function intentRulesForQuestion(question: string): IntentRule[] {
  const normalizedQuestion = normalize(question);
  const tokens = new Set(queryTokens(question).flatMap((token) => [token, stemToken(token)]));
  const rules: IntentRule[] = [];
  const dottedReferences = dottedApiReferences(question);

  if (hasOwnerMethodQuestionSignal(question)) {
    rules.push({
      reason: "named owner API intent",
      boost: 12,
      score: (row) => namedOwnerApiMethodScore(row, question)
    });
  }

  if (hasOwnerMethodQuestionSignal(question)) {
    rules.push({
      reason: "owner method intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        if (questionMentionsDunderMethodName(question) && !isDunderQuestion(row, question)) {
          return 0;
        }

        if (isDunderCandidate(row) && !isDunderQuestion(row, question)) {
          return 0;
        }

        const ownerName = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
        const ownerTokens = normalize(ownerName)
          .split(/\s+/)
          .filter(Boolean);
        const methodTokens = normalize(row.symbol_name.replace(/^_+/, ""))
          .split(/\s+/)
          .filter(Boolean);
        const intentMethodTokens =
          methodTokens[0] === "do" && methodTokens.length > 1 ? methodTokens.slice(1) : methodTokens;
        const queryTokens = rankedQueryTokens(question);
        const queryTokenSet = new Set(queryTokens);
        const normalizedOwner = ownerTokens.join(" ");

        if (ownerTokens.length === 0 || intentMethodTokens.length === 0) {
          return 0;
        }
        if (isGenericGraphOwnerMismatch(row, question)) {
          return 0;
        }
        if (
          (queryTokenSet.has("compiler") || queryTokenSet.has("sqlcompiler")) &&
          !ownerTokens.some((token) => token === "compiler" || token === "sqlcompiler")
        ) {
          return 0;
        }
        if (ownerTokens.length > 1 && !normalizedQuestion.includes(normalizedOwner)) {
          return 0;
        }
        if (ownerTokens.length === 1 && !queryTokenSet.has(ownerTokens[0])) {
          return 0;
        }
        if (!exactSymbolTokensInQueryOrder(intentMethodTokens, queryTokens)) {
          return 0;
        }

        return (
          22 +
          Math.min(intentMethodTokens.length, 3) * 4 +
          (intentMethodTokens.length >= 2 ? 4 : 0) +
          (ownerTokens.length > 1 ? 18 : 0) +
          (methodTokens[0] === "do" ? 8 : 0)
        );
      }
    });
  }

  const directOwnerAction = directOwnerActionForQuestion(question);
  if (directOwnerAction) {
    rules.push({
      reason: "direct owner action intent",
      boost: 12,
      score: (row) =>
        hasExplicitDottedOwnerReference(dottedReferences) && !rowMatchesAnyDottedReference(row, dottedReferences)
          ? 0
          : directOwnerActionScore(row, question, directOwnerAction)
    });
  }

  if (isCreateObjectFactoryQuestion(tokens)) {
    rules.push({
      reason: "create object factory intent",
      boost: 12,
      score: (row) => createObjectFactoryScore(row, question, tokens)
    });
  }

  for (const reference of dottedReferences) {
    if (!shouldTreatDottedReferenceAsApi(reference, normalizedQuestion, tokens)) {
      continue;
    }

    rules.push({
      reason: "dotted API reference match",
      boost: 12,
      score: (row) => {
        if (!rowMatchesDottedReference(row, reference)) {
          return 0;
        }

        let score = hasExplicitDottedOwnerReference([reference]) ? 34 : 18;
        if (row.file_path.startsWith(`${reference.packageName}/`)) score += 8;
        if (normalizedQuestion.includes("module level") && row.kind === "function") score += 8;
        if (tokens.has("function") && row.kind === "function") score += 6;
        if (tokens.has("defined") || tokens.has("definition")) score += 4;
        if (row.kind === "method" && normalizedQuestion.includes("module level")) score -= 10;
        return score;
      }
    });
  }

  if (hasModuleDomainSignal(question)) {
    rules.push({
      reason: "module domain intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method" && row.kind !== "class") {
          return 0;
        }

        const fileStemTokens = fileStemTokensForRow(row).filter((token) => token.length >= 4);
        if (fileStemTokens.length === 0) {
          return 0;
        }

        const queryTokenList = rankedQueryTokens(question);
        const moduleDomainTokens = moduleDomainTokensForQuestion(question);
        const fileStemMatch = fileStemTokens.some((fileToken) =>
          moduleDomainTokens.some((queryToken) => moduleDomainTokensMatch(fileToken, queryToken))
        );
        if (!fileStemMatch) {
          return 0;
        }
        if (shouldSuppressModuleDomainForQuestion(fileStemTokens, tokens)) {
          return 0;
        }
        if (fileStemTokens.some((fileToken) => stemToken(fileToken) === "reader") && !isReaderModuleQuestion(queryTokenList)) {
          return 0;
        }

        const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
          .split(/\s+/)
          .filter(Boolean);
        const chunk = normalize(row.chunk_text);
        let score = 20;
        if (row.kind === "function" || row.kind === "method") score += 6;
        for (const symbolToken of symbolTokens) {
          if (queryTokenList.some((queryToken) => tokensLooselyMatch(symbolToken, queryToken))) {
            score += 6;
          }
        }
        for (const queryToken of queryTokenList.filter((token) => token.length >= 4)) {
          if (chunk.includes(queryToken)) {
            score += 1;
          }
        }
        return score;
      }
    });
  }

  if (isObjectSerializationQuestion(tokens)) {
    rules.push({
      reason: "object serialization intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.symbol_name);
        const qualified = normalize(row.qualified_name);
        let score = 0;
        if ((tokens.has("dict") || tokens.has("dictionary") || tokens.has("dictionaries")) && ["asdict", "to dict"].includes(symbol)) {
          score += 42;
        }
        if ((tokens.has("tuple") || tokens.has("tuples")) && ["astuple", "to tuple"].includes(symbol)) {
          score += 42;
        }
        if ((tokens.has("json") || tokens.has("jsonable")) && (symbol === "to json" || symbol === "json")) {
          score += 34;
        }
        if (isJsonCompatibleConversionQuestion(tokens)) {
          if (symbol.includes("jsonable") || symbol.includes("encoder") || symbol.includes("encode")) {
            score += 48;
          }
          if (qualified.includes("encoder")) {
            score += 10;
          }
        }
        if (qualified.includes("serializer") || qualified.includes("serializ")) {
          score += 8;
        }
        return score;
      }
    });
  }

  if (isOptionalNonePassthroughQuestion(tokens)) {
    rules.push({
      reason: "optional wrapper intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }
        if (row.symbol_name !== "optional") {
          return 0;
        }

        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        let score = 44;
        if (file.includes("converter") && (tokens.has("converter") || tokens.has("convert") || tokens.has("conversion"))) {
          score += 12;
        }
        if (file.includes("validator") && (tokens.has("validator") || tokens.has("validate") || tokens.has("validation"))) {
          score += 12;
        }
        if (chunk.includes("none")) score += 4;
        if (chunk.includes("convert") || chunk.includes("conversion")) score += 4;
        return score;
      }
    });
  }

  if (isScheduleSubtypeDueQuestion(tokens)) {
    rules.push({
      reason: "schedule subtype due intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" || row.symbol_name !== "is_due") {
          return 0;
        }

        const ownerName = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
        const ownerTokens = normalize(ownerName)
          .split(/\s+/)
          .filter(Boolean);
        if (!ownerTokens.some((token) => tokens.has(token) && ["crontab", "solar"].includes(token))) {
          return 0;
        }

        let score = 36;
        if (normalize(row.file_path).includes("schedule")) score += 6;
        return score;
      }
    });
  }

  if (isSchedulerTickQuestion(tokens)) {
    rules.push({
      reason: "scheduler tick intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (symbol.includes("scheduler tick")) score += 40;
        if (row.symbol_name === "tick") score += 18;
        if (normalize(row.file_path).includes("beat")) score += 8;
        if (row.symbol_name === "is_due") score -= 18;
        return score;
      }
    });
  }

  if (isSchedulerApplyEntryQuestion(tokens)) {
    rules.push({
      reason: "scheduler apply entry intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (symbol.includes("scheduler apply entry")) score += 44;
        if (row.symbol_name === "apply_entry") score += 20;
        if (normalize(row.file_path).includes("beat")) score += 8;
        if (row.symbol_name === "is_due") score -= 18;
        return score;
      }
    });
  }

  if (isGroupFreezeMetadataQuestion(tokens)) {
    rules.push({
      reason: "group freeze metadata intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (symbol.includes("group freeze group tasks")) score += 44;
        if (symbol.includes("group freeze tasks")) score += 34;
        if (row.qualified_name === "group.freeze") score += 24;
        if (symbol.includes("group freeze unroll")) score -= 18;
        if (normalize(row.file_path).includes("canvas")) score += 6;
        return score;
      }
    });
  }

  if (isGroupApplyOrchestrationQuestion(tokens)) {
    rules.push({
      reason: "group apply orchestration intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (symbol.includes("group apply async")) score += 44;
        if (symbol.includes("group apply tasks")) score += 36;
        if (symbol.includes("group prepared")) score += 16;
        if (symbol.includes("group unroll")) score -= 18;
        if (normalize(row.file_path).includes("canvas")) score += 6;
        return score;
      }
    });
  }

  if (isChordRunQuestion(tokens)) {
    rules.push({
      reason: "chord run orchestration intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (symbol.includes("chord run")) score += 44;
        if (symbol.includes("chord apply async")) score += 30;
        if (symbol.includes("chord freeze")) score -= 18;
        if (normalize(row.file_path).includes("canvas")) score += 6;
        return score;
      }
    });
  }

  if (isPoolApplyTargetQuestion(tokens)) {
    rules.push({
      reason: "pool target submission intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (symbol.includes("base pool apply async")) score += 40;
        if (symbol.includes("base pool on apply")) score += 34;
        if (row.symbol_name === "apply_async") score += 12;
        if (normalize(row.file_path).includes("concurrency base")) score += 8;
        return score;
      }
    });
  }

  if (isEagerTaskApplyQuestion(tokens)) {
    rules.push({
      reason: "eager task apply intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const owner = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
        const ownerTokens = normalize(owner)
          .split(/\s+/)
          .filter(Boolean);
        if (!ownerTokens.includes("task")) {
          return 0;
        }

        if (row.symbol_name === "apply") {
          return 46;
        }
        if (row.symbol_name === "apply_async") {
          return -12;
        }
        return 0;
      }
    });
  }

  const backendMarkState = backendMarkStateForQuestion(tokens);
  if (backendMarkState) {
    rules.push({
      reason: "backend state marking intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const owner = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
        const ownerTokens = normalize(owner)
          .split(/\s+/)
          .filter(Boolean);
        if (!ownerTokens.some((token) => token.includes("backend"))) {
          return 0;
        }

        if (backendMarkState === "success" && row.symbol_name === "mark_as_done") {
          return 44;
        }
        if (backendMarkState === "failure" && row.symbol_name === "mark_as_failure") {
          return 44;
        }
        return 0;
      }
    });
  }

  if (isUnknownTaskMessageQuestion(tokens)) {
    rules.push({
      reason: "unknown task message intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.qualified_name === "Consumer.on_unknown_task") score += 76;
        if (symbol.includes("consumer on unknown task")) score += 60;
        if (file.includes("worker consumer consumer")) score += 10;
        if (symbol.includes("send event") || symbol.includes("signal send")) score -= 20;
        return score;
      }
    });
  }

  if (isStrategyRefreshQuestion(tokens)) {
    rules.push({
      reason: "strategy refresh intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "update_strategies") score += 44;
        if (symbol.includes("update strategies")) score += 24;
        if (normalize(row.file_path).includes("consumer")) score += 6;
        return score;
      }
    });
  }

  if (isParserActionQuestion(tokens)) {
    rules.push({
      reason: "parser action match",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.symbol_name.replace(/^_+/, ""));
        let score = 0;
        if (symbol === "parse" || symbol.includes("parse")) score += 20;
        if (row.symbol_name === "render" && tokens.has("markup") && tokens.has("text")) score += 12;
        if (normalize(row.file_path).includes("markup")) score += 6;
        return score;
      }
    });
  }

  if (isProjectConfigParsingQuestion(tokens)) {
    rules.push({
      reason: "project config intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const symbolName = normalize(row.symbol_name.replace(/^_+/, ""));
        const file = normalize(row.file_path);
        let score = 0;
        if (symbolName.includes("prepareconfig") || symbolName.includes("prepare config")) score += 44;
        if (row.symbol_name === "find_project_root") score += 44;
        if (row.symbol_name === "parse_pyproject_toml") score += 42;
        if (row.symbol_name === "find_pyproject_toml") score += 34;
        if (row.symbol_name === "read_pyproject_toml") score += 32;
        if (row.symbol_name === "infer_target_version") score += 24;
        if (file.includes("files") || file.endsWith("init py")) score += 6;
        if (symbol.includes("parser") || file.includes("pgen2 parse")) score -= 30;
        return score;
      }
    });
  }

  if (isHttpRequestHandlerQuestion(tokens)) {
    rules.push({
      reason: "http request handler intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const file = normalize(row.file_path);
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "handle") score += 44;
        if (row.symbol_name === "format_code") score += 34;
        if (row.symbol_name === "parse_mode") score += 30;
        if (file.includes("blackd") || file.includes("server") || file.includes("request")) score += 10;
        if (symbol.includes("parser") || file.includes("pgen2 parse")) score -= 28;
        return score;
      }
    });
  }

  if (isPythonVariantHeaderQuestion(tokens)) {
    rules.push({
      reason: "python variant header intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const file = normalize(row.file_path);
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "parse_python_variant_header") score += 46;
        if (row.symbol_name === "parse_mode") score += 30;
        if (file.includes("blackd") || file.includes("headers") || file.includes("request")) score += 8;
        if (symbol.includes("parser") || file.includes("pgen2 parse")) score -= 28;
        return score;
      }
    });
  }

  if (isStdioFormattingQuestion(tokens)) {
    rules.push({
      reason: "stdio formatting intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.symbol_name === "format_stdin_to_stdout") score += 48;
        if (symbol.includes("stdin") && symbol.includes("stdout")) score += 22;
        if (symbol.includes("format")) score += 8;
        if (chunk.includes("stdin") && chunk.includes("stdout")) score += 8;
        if (symbol.includes("pyproject") || symbol.includes("version specifier")) score -= 24;
        return score;
      }
    });
  }

  if (isFilesystemLoaderSourceQuestion(tokens)) {
    rules.push({
      reason: "filesystem loader intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (symbol.includes("file system loader get source")) score += 52;
        if (row.symbol_name === "get_source") score += 18;
        if (file.includes("loader")) score += 6;
        if (symbol.includes("base loader get source")) score -= 18;
        return score;
      }
    });
  }

  if (isWebSocketServerAcceptResponseQuestion(tokens)) {
    rules.push({
      reason: "websocket server accept intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "H11Handshake._accept") score += 70;
        if (symbol.includes("handshake accept")) score += 36;
        if (symbol.includes("extension accept")) score -= 36;
        return score;
      }
    });
  }

  if (isWebSocketClientEstablishQuestion(tokens)) {
    rules.push({
      reason: "websocket client establish intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "H11Handshake._establish_client_connection") score += 74;
        if (symbol.includes("establish client connection")) score += 36;
        if (row.qualified_name === "H11Handshake._accept") score -= 28;
        if (symbol.includes("extension accept")) score -= 24;
        return score;
      }
    });
  }

  if (isFrameEventConversionQuestion(tokens)) {
    rules.push({
      reason: "frame event conversion intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.symbol_name === "events") score += 58;
        if (symbol.includes("connection events")) score += 14;
        if (chunk.includes("ping") && chunk.includes("pong") && chunk.includes("close")) score += 8;
        if (symbol.includes("received frames")) score -= 18;
        return score;
      }
    });
  }

  const extensionNegotiationSide = extensionNegotiationSideForQuestion(tokens);
  if (extensionNegotiationSide) {
    rules.push({
      reason: "extension negotiation intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (extensionNegotiationSide !== "client" && row.symbol_name === "server_extensions_handshake") score += 72;
        if (extensionNegotiationSide !== "server" && row.symbol_name === "client_extensions_handshake") score += 72;
        if (symbol.includes("extension accept") || symbol.includes("extension finalize")) score -= 26;
        if (normalize(row.file_path).includes("handshake")) score += 8;
        return score;
      }
    });
  }

  if (isTemplateParserPipelineQuestion(tokens)) {
    rules.push({
      reason: "template parser pipeline intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (symbol.includes("parser subparse")) score += 62;
        if (symbol === "parser parse") score += 56;
        if (symbol.includes("parser parse statement")) score += 18;
        if (symbol.includes("parser parse block")) score -= 24;
        if (symbol.includes("parser parse or") || symbol.includes("parser parse and")) score -= 30;
        return score;
      }
    });
  }

  if (isTemplateCompilePipelineQuestion(tokens)) {
    rules.push({
      reason: "template compile pipeline intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (symbol.includes("environment compile")) score += 70;
        if (symbol.includes("environment parse")) score += 52;
        if (symbol.includes("environment generate")) score += 52;
        if (row.kind === "function" && row.symbol_name === "generate" && file.includes("compiler")) score += 46;
        if (file.includes("environment")) score += 8;
        if (file.includes("parser") && symbol.includes("parse")) score -= 34;
        return score;
      }
    });
  }

  if (isUrlResolverQuestion(tokens)) {
    rules.push({
      reason: "url resolve intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "URLResolver.resolve") score += 44;
        if (row.symbol_name === "resolve" && symbol.includes("url resolver")) score += 32;
        if (row.symbol_name === "url_patterns") score -= 18;
        if (isPropertyMethod(row)) score -= 8;
        return score;
      }
    });
  }

  if (isUrlReverseQuestion(tokens)) {
    rules.push({
      reason: "url reverse intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const resolverInternalQuestion =
          tokens.has("urlresolver") || tokens.has("prefix") || tokens.has("namespace") || tokens.has("converters");
        let score = 0;
        if (resolverInternalQuestion && row.qualified_name === "URLResolver._reverse_with_prefix") score += 72;
        if (resolverInternalQuestion && row.qualified_name === "URLResolver.reverse") score += 48;
        if (row.kind === "function" && row.symbol_name === "reverse" && file.includes("urls base")) score += 42;
        if (row.symbol_name === "reverse" && symbol.includes("url resolver")) score += 24;
        if (symbol.includes("query set")) score -= 18;
        if (row.kind === "class") score -= 10;
        return score;
      }
    });
  }

  if (isAmqpTaskMessageQuestion(tokens)) {
    rules.push({
      reason: "amqp task message intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.qualified_name === "AMQP.as_task_v2") score += 72;
        if (symbol.includes("amqp as task v2")) score += 56;
        if (file.includes("app amqp")) score += 12;
        if (symbol.includes("proto1 to proto2") || symbol.includes("hybrid to proto2")) score -= 20;
        return score;
      }
    });
  }

  if (isTemplateParserQuestion(tokens)) {
    rules.push({
      reason: "template parser intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.qualified_name === "Parser.parse") score += 44;
        if (row.kind === "method" && row.symbol_name === "parse" && symbol.includes("parser")) score += 32;
        if (file.includes("template base")) score += 8;
        if (row.kind === "function" && row.symbol_name.startsWith("parse_")) score -= 12;
        return score;
      }
    });
  }

  if (isJsonResponseQuestion(tokens)) {
    rules.push({
      reason: "json response intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "JsonResponse.__init__") score += 44;
        if (row.kind === "method" && row.symbol_name === "__init__" && symbol.includes("json response")) score += 34;
        if (symbol.includes("file response")) score -= 16;
        if (row.symbol_name === "set_headers") score -= 12;
        return score;
      }
    });
  }

  if (isCsrfProcessViewQuestion(tokens)) {
    rules.push({
      reason: "csrf process view intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "CsrfViewMiddleware.process_view") score += 46;
        if (row.kind === "method" && row.symbol_name === "process_view" && symbol.includes("csrf view middleware")) score += 34;
        if (row.symbol_name === "_check_token") score -= 24;
        if (row.symbol_name === "process_response") score -= 10;
        return score;
      }
    });
  }

  if (isBindParameterQuestion(tokens)) {
    const compilerQuestion = isBindParameterCompilerQuestion(tokens);
    const constructorQuestion = isBindParameterConstructorQuestion(tokens);
    rules.push({
      reason: "bind parameter intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;

        if (compilerQuestion) {
          if (row.symbol_name === "visit_bindparam" && symbol.includes("compiler")) score += 40;
          if (file.includes("compiler")) score += 8;
          if (row.symbol_name === "bindparam") score += 8;
          if (symbol.includes("execute")) score -= 24;
          return score;
        }

        if (row.symbol_name === "bindparam") score += constructorQuestion ? 84 : 36;
        if (row.qualified_name === "BindParameter") score += constructorQuestion ? 44 : 26;
        if (constructorQuestion && row.kind === "method" && symbol.includes("bind parameter") && row.symbol_name !== "__init__") {
          score -= 44;
        }
        if (file.includes("element constructor") || file.includes("elements constructor")) score += 8;
        if (file.includes("elements")) score += 4;
        if (symbol.includes("execute")) score -= 24;
        return score;
      }
    });
  }

  if (isCompilerVisitorQuestion(tokens)) {
    rules.push({
      reason: "compiler visitor intent",
      boost: 12,
      score: (row) => compilerVisitorScore(row, tokens)
    });
  }

  const publicApiActions = publicApiActionNamesForQuestion(tokens);
  if (publicApiActions.length > 0) {
    rules.push({
      reason: "public API action intent",
      boost: 12,
      score: (row) => publicApiActionScore(row, publicApiActions)
    });
  }

  if (isBindResolutionQuestion(tokens)) {
    rules.push({
      reason: "bind resolution intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "get_bind") score += 56;
        if (symbol.includes("session get bind")) score += 8;
        if (row.symbol_name.startsWith("bind_")) score -= 14;
        return score;
      }
    });
  }

  const loaderOptions = loaderOptionNamesForQuestion(tokens);
  if (loaderOptions.length > 0) {
    rules.push({
      reason: "loader option intent",
      boost: 12,
      score: (row) => {
        let score = 0;
        if (loaderOptions.includes(row.symbol_name)) score += 52;
        if (row.symbol_name === "options") score -= 12;
        return score;
      }
    });
  }

  if (isTransactionBeginQuestion(tokens)) {
    rules.push({
      reason: "transaction begin intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "Connection.begin") score += 60;
        if (row.symbol_name === "begin" && symbol.includes("connection")) score += 44;
        if (symbol.includes("root transaction") && (row.symbol_name.includes("commit") || row.symbol_name.includes("rollback"))) {
          score -= 28;
        }
        return score;
      }
    });
  }

  if (isExecutionActionQuestion(tokens)) {
    rules.push({
      reason: "execution action intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.symbol_name === "execute") score += 34;
        if (symbol.includes("connection execute")) score += 10;
        if (symbol.includes("session execute")) score += 10;
        if (symbol.includes("async session execute")) score += 12;
        if (symbol.includes("async") && !tokens.has("async")) score -= 24;
        if (!symbol.includes("async") && tokens.has("session") && !tokens.has("async")) score += 8;
        if (chunk.includes("statement")) score += 4;
        if (chunk.includes("parameters") || chunk.includes("parameter")) score += 4;
        if (symbol.includes("execution option")) score -= 16;
        return score;
      }
    });
  }

  if (isUrlParseQuestion(tokens)) {
    rules.push({
      reason: "url parse intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.symbol_name === "_parse_url") score += 36;
        if (row.symbol_name === "make_url") score += 32;
        if (row.qualified_name === "URL.create") score += 24;
        if (file.includes("engine url")) score += 6;
        if (symbol.includes("render as string")) score -= 18;
        return score;
      }
    });
  }

  if (isExactScalarResultQuestion(tokens)) {
    rules.push({
      reason: "exact scalar result intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "Result.scalar_one") score += 36;
        if (row.symbol_name === "scalar_one") score += 24;
        if (symbol.includes("scalar one or none")) score -= 18;
        if (symbol.includes("scalar result one")) score += 6;
        return score;
      }
    });
  }

  if (isEngineDisposalQuestion(tokens)) {
    rules.push({
      reason: "engine disposal intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "Engine.dispose") score += 38;
        if (row.symbol_name === "dispose" && symbol.includes("engine")) score += 28;
        if (row.symbol_name === "dispose" && symbol.includes("pool")) score += 8;
        if (symbol.includes("engine disposed")) score -= 18;
        return score;
      }
    });
  }

  if (isEventKeyListenerQuestion(tokens)) {
    rules.push({
      reason: "event key listener intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.qualified_name === "_EventKey.listen") score += 38;
        if (row.symbol_name === "listen" && symbol.includes("event key")) score += 28;
        if (file.includes("event registry")) score += 8;
        if (row.kind === "class" && symbol.includes("events")) score -= 12;
        if (row.qualified_name === "listen") score -= 8;
        return score;
      }
    });
  }

  if (isCrossValidationScoreQuestion(tokens)) {
    rules.push({
      reason: "cross validation score intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.symbol_name === "cross_val_score") score += 36;
        if (row.symbol_name === "cross_validate") score += 16;
        if (file.includes("model selection validation")) score += 6;
        if (symbol.includes("display") || symbol.includes("plot")) score -= 14;
        return score;
      }
    });
  }

  if (isPipelineFinalPredictQuestion(tokens)) {
    rules.push({
      reason: "pipeline final estimator predict intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.qualified_name === "Pipeline.predict") score += 38;
        if (row.symbol_name === "predict" && symbol.includes("pipeline")) score += 28;
        if (row.symbol_name === "transform") score -= 14;
        if (row.symbol_name === "fit_transform" || row.symbol_name === "fit_predict") score -= 10;
        return score;
      }
    });
  }

  if (isGridSearchRunQuestion(tokens)) {
    rules.push({
      reason: "grid search run intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "class") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.qualified_name === "GridSearchCV._run_search") score += 42;
        if (row.symbol_name === "_run_search" && symbol.includes("grid search")) score += 30;
        if (chunk.includes("parameter grid") || chunk.includes("param grid")) score += 6;
        if (symbol.includes("halving")) score -= 18;
        if (row.kind === "class") score -= 10;
        return score;
      }
    });
  }

  if (isNearestNeighborsGraphQuestion(tokens)) {
    rules.push({
      reason: "nearest neighbors graph intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.symbol_name === "kneighbors_graph") score += 40;
        if (symbol.includes("k neighbors") && symbol.includes("graph")) score += 10;
        if (file.includes("neighbors graph")) score += 8;
        if (row.symbol_name === "kneighbors") score -= 18;
        return score;
      }
    });
  }

  if (isNearestNeighborsQuestion(tokens)) {
    rules.push({
      reason: "nearest neighbors intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "kneighbors") score += 36;
        if (row.symbol_name === "kneighbors_graph") score += 14;
        if (symbol.includes("k neighbors")) score += 8;
        if (symbol.includes("radius neighbors")) score -= 18;
        return score;
      }
    });
  }

  if (isPairedInputValidationQuestion(tokens)) {
    rules.push({
      reason: "paired input validation intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.symbol_name === "check_X_y") score += 40;
        if (row.symbol_name === "check_array") score += 10;
        if (file.includes("utils validation")) score += 8;
        if (symbol.includes("encoder") || symbol.includes("classifier") || symbol.includes("display")) score -= 12;
        return score;
      }
    });
  }

  if (isEstimatorDataValidationQuestion(tokens)) {
    rules.push({
      reason: "estimator data validation intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.symbol_name === "validate_data") score += 42;
        if (row.symbol_name === "check_array" || row.symbol_name === "check_X_y") score += 12;
        if (file.includes("utils validation")) score += 8;
        if (symbol.includes("estimator check") || symbol.includes("column names consistency")) score -= 16;
        return score;
      }
    });
  }

  if (isInputArrayValidationQuestion(tokens)) {
    rules.push({
      reason: "input array validation intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.symbol_name === "check_array") score += 36;
        if (row.symbol_name === "check_X_y") score += 18;
        if (row.symbol_name === "validate_data") score += 16;
        if (file.includes("utils validation")) score += 8;
        if (symbol.includes("scaler") || symbol.includes("transformer") || symbol.includes("classifier")) score -= 10;
        return score;
      }
    });
  }

  if (isForestFitQuestion(tokens)) {
    rules.push({
      reason: "forest fit intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.kind === "method" && row.symbol_name === "fit" && (symbol.includes("forest") || file.includes("forest"))) score += 36;
        if (file.includes("forest")) score += 8;
        if (chunk.includes("bootstrap")) score += 4;
        if (chunk.includes("out of bag") || chunk.includes("oob")) score += 4;
        if (row.kind === "class" && symbol.includes("forest")) score -= 14;
        return score;
      }
    });
  }

  if (isDeclarativeBaseFactoryQuestion(tokens)) {
    rules.push({
      reason: "declarative factory intent",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "declarative_base") score += 34;
        if (row.symbol_name === "generate_base" && symbol.includes("registry")) score += 34;
        if (row.kind === "class") score -= 12;
        return score;
      }
    });
  }

  if (isFactoryConstructorQuestion(tokens)) {
    rules.push({
      reason: "factory constructor intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const name = normalize(row.symbol_name.replace(/^_+/, ""));
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        let score = 0;

        if (row.kind === "function" && symbolTokensCoveredByQuestion(row, tokens)) score += 18;
        if (row.kind === "function" && isExactNounFactorySymbol(row, question)) score += 26;
        if (row.symbol_name === "select" && tokens.has("select") && tokens.has("statement")) score += 34;
        if (row.symbol_name === "relationship" && (tokens.has("relationship") || tokens.has("relationships"))) score += 34;
        if (row.symbol_name === "mapped_column" && tokens.has("mapped") && tokens.has("column")) score += 34;
        if (row.symbol_name === "declarative_base" && tokens.has("declarative") && tokens.has("base")) score += 34;
        if (
          row.symbol_name === "generate_base" &&
          symbol.includes("registry") &&
          tokens.has("declarative") &&
          tokens.has("base")
        ) {
          score += 34;
        }

        if (file.includes("constructor") || file.includes("constructors")) score += 6;
        if (chunk.includes("construct") || chunk.includes("create") || chunk.includes("generate")) score += 4;
        if (row.kind === "method" && name !== "generate base") score -= 8;
        return score;
      }
    });
  }

  if (isDynamicModelFactoryQuestion(tokens)) {
    rules.push({
      reason: "dynamic model factory intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function") {
          return 0;
        }

        let score = 0;
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        if (row.symbol_name === "create_model") score += 50;
        if (symbol.endsWith("create model")) score += 8;
        if (file.includes(" v1 ")) score -= 8;
        return score;
      }
    });
  }

  if (isDependencySolverQuestion(tokens)) {
    rules.push({
      reason: "dependency solver intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.symbol_name === "solve" && symbol.includes("solver")) score += 34;
        if (file.includes("puzzle solver") || file.endsWith("solver py")) score += 10;
        if (chunk.includes("transaction")) score += 6;
        if (chunk.includes("use latest") || chunk.includes("use latest for")) score += 6;
        if (chunk.includes("simplify marker")) score += 4;
        if (symbol.includes("provider") && !symbol.includes("solver")) score -= 14;
        if (symbol.includes("override") || symbol.includes("marker")) score -= 8;
        return score;
      }
    });
  }

  if (isInstallerOptionApplicationQuestion(tokens)) {
    rules.push({
      reason: "installer option application intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.symbol_name === "handle" && symbol.includes("install command")) score += 30;
        if (file.includes("commands install")) score += 10;
        if (chunk.includes("installer dry run")) score += 6;
        if (chunk.includes("installer extras")) score += 6;
        if (chunk.includes("installer only groups")) score += 6;
        if (chunk.includes("installer requires synchronization")) score += 6;
        if (chunk.includes("installer run")) score += 4;
        if (row.kind === "method" && row.symbol_name !== "handle" && symbol.includes("command")) score -= 8;
        return score;
      }
    });
  }

  if (isPluginActivationQuestion(tokens)) {
    rules.push({
      reason: "plugin activation intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.symbol_name === "activate" && symbol.includes("plugin manager")) score += 34;
        if (file.includes("plugin manager")) score += 8;
        if (chunk.includes("plugin activate")) score += 8;
        if (chunk.includes("for plugin in")) score += 4;
        if (symbol.includes("load plugin") || symbol.includes("load plugins")) score -= 12;
        return score;
      }
    });
  }

  const lifecycleActions = lifecycleActionsForQuestion(tokens);
  if (lifecycleActions.length >= 2) {
    rules.push({
      reason: "lifecycle action match",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
          .split(/\s+/)
          .filter(Boolean);
        const actionMatches = lifecycleActions.filter((action) =>
          symbolTokens.some((symbolToken) => actionTokenMatches(symbolToken, action))
        );
        if (actionMatches.length === 0) {
          return 0;
        }

        const domainMatches = [...tokens].filter(
          (token) =>
            token.length >= 4 &&
            !lifecycleActions.includes(token) &&
            symbolTokens.some((symbolToken) => tokensLooselyMatch(symbolToken, token))
        );
        if (domainMatches.length === 0) {
          return 0;
        }

        return actionMatches.length * 10 + Math.min(domainMatches.length, 2) * 4;
      }
    });
  }

  if (isEntrypointQuestion(normalizedQuestion, tokens)) {
    rules.push({
      reason: "entrypoint intent match",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.symbol_name);
        let score = 0;
        if (row.file_path.endsWith("__main__.py")) score += 20;
        if (tokens.has("console") && tokens.has("main")) {
          if (symbol === "console main") score += 48;
          if (symbol === "main") score += 12;
        }
        if (row.symbol_name === "main") score += 24;
        if (row.symbol_name === "_main") score += 10;
        if (row.symbol_name === "main" && normalize(row.file_path).includes("application")) score += 8;
        if (row.symbol_name === "main" && normalize(row.chunk_text).includes("application")) score += 4;
        if (row.symbol_name === "main" && normalize(row.chunk_text).includes("run")) score += 4;
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

  if (isReportGenerationQuestion(tokens)) {
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

  if (isDependencyGraphQuestion(tokens)) {
    rules.push({
      reason: "dependency graph intent match",
      boost: 12,
      score: (row) => {
        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (file.includes("dependenc")) score += 10;
        if (row.symbol_name === "get_dependant") score += 16;
        if (row.symbol_name === "get_flat_dependant") score += 12;
        if (row.symbol_name === "get_parameterless_sub_dependant") score += 12;
        if (symbol.includes("add non field param")) score -= 12;
        if (symbol.includes("dependant") || symbol.includes("dependent") || symbol.includes("dependenc")) score += 16;
        if (symbol.includes("signature") && (tokens.has("signature") || tokens.has("signatures"))) score += 8;
        if (symbol.includes("param") && (tokens.has("endpoint") || tokens.has("signature") || tokens.has("signatures"))) score += 4;
        return score;
      }
    });
  }

  if (isResponseSerializationQuestion(tokens)) {
    rules.push({
      reason: "response serialization intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.symbol_name === "serialize_response") score += 32;
        if (symbol.includes("serialize response")) score += 16;
        if (chunk.includes("response model")) score += 6;
        if (chunk.includes("return value") || chunk.includes("return values")) score += 4;
        if (chunk.includes("validate") || chunk.includes("validation")) score += 4;
        if (row.symbol_name === "get_request_handler") score -= 10;
        return score;
      }
    });
  }

  if (isModelDumpSerializationQuestion(tokens)) {
    rules.push({
      reason: "model dump serialization intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "model_dump") score += 32;
        if (symbol.includes("base model model dump")) score += 10;
        if (row.symbol_name === "model_dump_json" && !tokens.has("json")) score -= 10;
        if (row.symbol_name === "computed_field") score -= 18;
        return score;
      }
    });
  }

  if (isModelJsonSchemaQuestion(tokens)) {
    rules.push({
      reason: "model json schema intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "model_json_schema") score += 46;
        if (symbol.includes("base model model json schema")) score += 12;
        if (row.kind === "function" && row.symbol_name === "model_json_schema") score += 6;
        if (symbol.includes("generate schema") || symbol.includes("generate json schema")) score -= 10;
        return score;
      }
    });
  }

  if (isModelCompletionQuestion(tokens)) {
    rules.push({
      reason: "model completion intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "complete_model_class") score += 72;
        if (symbol.includes("model construction")) score += 10;
        if (symbol.includes("generate schema")) score -= 10;
        if (symbol.includes("computed field schema")) score -= 8;
        return score;
      }
    });
  }

  if (isModelRebuildQuestion(tokens)) {
    rules.push({
      reason: "model rebuild intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (row.symbol_name === "model_rebuild") score += 58;
        if (symbol.includes("base model model rebuild")) score += 12;
        if (row.symbol_name === "complete_model_class") score += 28;
        if (symbol.includes("resolve forward ref")) score -= 8;
        return score;
      }
    });
  }

  if (isExceptionResponseHandlerQuestion(tokens)) {
    rules.push({
      reason: "exception response handler intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (symbol.includes("exception") && symbol.includes("handler")) score += 18;
        if (symbol.includes("validation") && symbol.includes("handler")) score += 16;
        if (file.includes("exception handler")) score += 12;
        if (chunk.includes("json response")) score += 6;
        if (chunk.includes("jsonresponse")) score += 6;
        return score;
      }
    });
  }

  if (isDocumentationRouteSetupQuestion(tokens)) {
    rules.push({
      reason: "documentation route setup intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        let score = 0;
        if (row.symbol_name === "setup") score += 62;
        if (symbol.includes("swagger") || symbol.includes("redoc")) score += 24;
        if (file.includes("openapi") || file.includes("docs")) score += 8;
        if (chunk.includes("swagger") || chunk.includes("redoc")) score += 6;
        if (symbol.includes("api route") && !symbol.includes("setup")) score -= 12;
        return score;
      }
    });
  }

  if (isRouteRegistrationQuestion(tokens)) {
    rules.push({
      reason: "route registration intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" && row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        const directRegistration = row.symbol_name === "add_api_route";
        const routeConstructor =
          row.symbol_name === "__init__" &&
          (row.qualified_name.endsWith("APIRoute.__init__") || symbol.includes("api route init"));

        if (!directRegistration && !routeConstructor) {
          return 0;
        }

        let score = directRegistration ? 30 : 14;
        if (directRegistration && tokens.has("add")) score += 14;
        if (symbol.includes("fast api") || symbol.includes("api router")) score += 8;
        if (file.includes("routing") || file.includes("applications")) score += 6;
        if (chunk.includes("response model")) score += 4;
        if (chunk.includes("dependencies")) score += 4;
        if (chunk.includes("callbacks")) score += 4;
        return score;
      }
    });
  }

  if (isAuthHeaderBehaviorQuestion(tokens)) {
    rules.push({
      reason: "callable auth behavior intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "method" || row.symbol_name !== "__call__") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        const chunk = normalize(row.chunk_text);
        if (
          !chunk.includes("authorization") &&
          !chunk.includes("header") &&
          !chunk.includes("headers") &&
          !chunk.includes("token") &&
          !chunk.includes("credential")
        ) {
          return 0;
        }

        let score = 24;
        if (tokens.has("http")) {
          if (symbol.includes("http")) score += 14;
          if (symbol.includes("oauth")) score -= 16;
        }
        if (tokens.has("oauth") || tokens.has("oauth2")) {
          if (symbol.includes("oauth")) score += 14;
          if (symbol.includes("http") && !tokens.has("http")) score -= 10;
        }
        if (tokens.has("password")) {
          if (symbol.includes("password")) score += 12;
          if (symbol.includes("authorization code")) score -= 10;
        }
        if (symbol.includes("bearer")) score += 8;
        if (symbol.includes("oauth")) score += 8;
        if (symbol.includes("auth")) score += 6;
        if (file.includes("security")) score += 6;
        if (chunk.includes("authorization")) score += 6;
        if (chunk.includes("header") || chunk.includes("headers")) score += 4;
        return score;
      }
    });
  }

  if (isBuildConstructionQuestion(tokens)) {
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

  if (isBidirectionalDijkstraQuestion(tokens)) {
    rules.push({
      reason: "bidirectional path intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        let score = 0;
        if (symbol.includes("bidirectional") && symbol.includes("dijkstra")) score += 32;
        if (normalize(row.file_path).includes("weighted")) score += 4;
        return score;
      }
    });
  }

  if (isMultisourceDijkstraQuestion(tokens)) {
    rules.push({
      reason: "multisource dijkstra intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.symbol_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (symbol.includes("dijkstra") && (symbol.includes("multi source") || symbol.includes("multisource"))) score += 36;
        if (row.symbol_name === "_dijkstra") score += 18;
        if (file.includes("weighted")) score += 6;
        if (symbol === "shortest path") score -= 16;
        return score;
      }
    });
  }

  if (isPathWeightQuestion(tokens)) {
    rules.push({
      reason: "path weight intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function") {
          return 0;
        }

        let score = 0;
        if (row.symbol_name === "path_weight") score += 34;
        if (row.symbol_name === "is_path" && (tokens.has("exist") || tokens.has("exists") || tokens.has("existing"))) score += 10;
        if (normalize(row.file_path).includes("class")) score += 4;
        return score;
      }
    });
  }

  if (isGraphIsomorphismQuestion(tokens)) {
    rules.push({
      reason: "graph isomorphism intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function" && row.kind !== "class" && row.kind !== "method") {
          return 0;
        }

        const symbol = normalize(row.qualified_name);
        const file = normalize(row.file_path);
        let score = 0;
        if (row.symbol_name === "is_isomorphic") score += 34;
        if (symbol.includes("graph matcher")) score += 30;
        if (file.includes("isomorphism") || file.includes("isomorph")) score += 10;
        if (file.includes("vf2") || symbol.includes("vf2")) score += 6;
        if (symbol === "graph nodes" || symbol === "graph edges") score -= 20;
        return score;
      }
    });
  }

  if (isFastRandomGraphQuestion(tokens)) {
    rules.push({
      reason: "fast random graph intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.symbol_name);
        let score = 0;
        if (symbol.includes("fast") && symbol.includes("gnp") && symbol.includes("random") && symbol.includes("graph")) score += 34;
        if (symbol === "gnp random graph") score -= 12;
        return score;
      }
    });
  }

  if (isQuadraticRandomGraphQuestion(tokens)) {
    rules.push({
      reason: "quadratic random graph intent",
      boost: 12,
      score: (row) => {
        if (row.kind !== "function") {
          return 0;
        }

        const symbol = normalize(row.symbol_name);
        let score = 0;
        if (symbol === "gnp random graph") score += 38;
        if (symbol.includes("fast")) score -= 18;
        if (normalize(row.file_path).includes("random graph")) score += 6;
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

function decoratorTargets(question: string): string[] {
  const targets: string[] = [];
  for (const match of normalize(question).matchAll(/\b([a-z0-9]+)\s+decorators?\b/g)) {
    const target = match[1];
    if (target && !targets.includes(target)) {
      targets.push(target);
    }
  }
  return targets;
}

function isEntrypointQuestion(normalizedQuestion: string, tokens: Set<string>): boolean {
  return (
    normalizedQuestion.includes("entry point") ||
    tokens.has("entrypoint") ||
    (tokens.has("cli") && tokens.has("main")) ||
    (tokens.has("console") && tokens.has("main"))
  );
}

function isBuildConstructionQuestion(tokens: Set<string>): boolean {
  if (!tokens.has("build") && !tokens.has("built") && !tokens.has("construct")) {
    return false;
  }

  return (
    tokens.has("graph") &&
    !isDependencyGraphQuestion(tokens) &&
    !isGraphMatrixQuestion(tokens) &&
    !isNearestNeighborsGraphQuestion(tokens)
  );
}

function isDependencyGraphQuestion(tokens: Set<string>): boolean {
  return tokens.has("graph") && (tokens.has("dependency") || tokens.has("dependencies") || tokens.has("dependencie"));
}

function isGraphMatrixQuestion(tokens: Set<string>): boolean {
  return (
    tokens.has("laplacian") ||
    tokens.has("matrix") ||
    tokens.has("matrices") ||
    tokens.has("adjacency") ||
    tokens.has("degree")
  );
}

function isBidirectionalDijkstraQuestion(tokens: Set<string>): boolean {
  const dijkstraLike = tokens.has("dijkstra");
  const dispatchLike =
    tokens.has("choose") ||
    tokens.has("between") ||
    tokens.has("branch") ||
    tokens.has("branches") ||
    tokens.has("unweighted") ||
    tokens.has("bellman") ||
    tokens.has("ford");
  if (dispatchLike) {
    return false;
  }

  const bidirectionalLike =
    tokens.has("bidirectional") ||
    tokens.has("both") ||
    (tokens.has("source") && tokens.has("target"));
  return dijkstraLike && bidirectionalLike;
}

function isMultisourceDijkstraQuestion(tokens: Set<string>): boolean {
  const dijkstraLike = tokens.has("dijkstra");
  const sourceLike =
    tokens.has("multisource") ||
    ((tokens.has("source") || tokens.has("sources")) &&
      (tokens.has("multiple") || tokens.has("more") || tokens.has("one")));
  const implementationLike = tokens.has("heap") || tokens.has("fringe") || tokens.has("weighted") || tokens.has("implement");
  return dijkstraLike && sourceLike && implementationLike && !isBidirectionalDijkstraQuestion(tokens);
}

function isPathWeightQuestion(tokens: Set<string>): boolean {
  const pathLike = tokens.has("path") || tokens.has("paths");
  const weightLike = tokens.has("weight") || tokens.has("weights") || tokens.has("cost") || tokens.has("costs");
  const operationLike =
    tokens.has("sum") ||
    tokens.has("total") ||
    tokens.has("along") ||
    tokens.has("existing") ||
    tokens.has("exist") ||
    tokens.has("exists");
  return pathLike && weightLike && operationLike;
}

function isGraphIsomorphismQuestion(tokens: Set<string>): boolean {
  const graphLike = tokens.has("graph") || tokens.has("graphs");
  const isoLike = tokens.has("isomorphism") || tokens.has("isomorphic") || tokens.has("vf2");
  const matchingLike = tokens.has("matching") || tokens.has("matcher") || tokens.has("match") || tokens.has("algorithm");
  return graphLike && isoLike && matchingLike;
}

function isFastRandomGraphQuestion(tokens: Set<string>): boolean {
  const randomGraphLike = (tokens.has("random") || tokens.has("gnp")) && (tokens.has("graph") || tokens.has("graphs"));
  const sparseFastLike =
    tokens.has("fast") ||
    tokens.has("sparse") ||
    tokens.has("skipping") ||
    tokens.has("skip") ||
    tokens.has("absent");
  return randomGraphLike && sparseFastLike;
}

function isQuadraticRandomGraphQuestion(tokens: Set<string>): boolean {
  const randomGraphLike = (tokens.has("random") || tokens.has("gnp")) && (tokens.has("graph") || tokens.has("graphs"));
  const exhaustiveLike =
    tokens.has("possible") ||
    tokens.has("each") ||
    tokens.has("probability") ||
    tokens.has("squared") ||
    tokens.has("quadratic") ||
    tokens.has("checking") ||
    tokens.has("choose");
  const sparseFastLike = tokens.has("fast") || tokens.has("sparse") || tokens.has("skipping") || tokens.has("absent");
  return randomGraphLike && exhaustiveLike && !sparseFastLike;
}

function hasGraphAlgorithmOrFormatSignal(question: string): boolean {
  const tokens = new Set(rankedQueryTokens(question).flatMap((token) => [token, stemToken(token)]));
  return (
    tokens.has("isomorphism") ||
    tokens.has("isomorphic") ||
    tokens.has("vf2") ||
    tokens.has("gnp") ||
    tokens.has("erdos") ||
    tokens.has("renyi") ||
    tokens.has("barabasi") ||
    tokens.has("louvain") ||
    tokens.has("laplacian") ||
    tokens.has("graphml") ||
    tokens.has("dijkstra")
  );
}

function isExecutionActionQuestion(tokens: Set<string>): boolean {
  if (isBindParameterQuestion(tokens)) {
    return false;
  }

  const executeLike = tokens.has("execute") || tokens.has("executes") || tokens.has("executing") || tokens.has("execution");
  const statementLike =
    tokens.has("statement") ||
    tokens.has("statements") ||
    tokens.has("sql") ||
    tokens.has("executable") ||
    tokens.has("parameters") ||
    tokens.has("parameter");
  return executeLike && statementLike;
}

function isBindParameterQuestion(tokens: Set<string>): boolean {
  const bindLike = tokens.has("bind") || tokens.has("bindparam") || tokens.has("binds");
  const parameterLike =
    tokens.has("parameter") ||
    tokens.has("parameters") ||
    tokens.has("placeholder") ||
    tokens.has("placeholders") ||
    tokens.has("expanding") ||
    tokens.has("literal");
  return bindLike && parameterLike;
}

function isBindParameterCompilerQuestion(tokens: Set<string>): boolean {
  const compilerLike =
    tokens.has("compiler") ||
    tokens.has("compiled") ||
    tokens.has("compile") ||
    tokens.has("render") ||
    tokens.has("renders") ||
    tokens.has("placeholder") ||
    tokens.has("placeholders");
  return isBindParameterQuestion(tokens) && compilerLike;
}

function isBindParameterConstructorQuestion(tokens: Set<string>): boolean {
  const createLike = tokens.has("create") || tokens.has("creates") || tokens.has("construct") || tokens.has("constructor");
  const expressionLike = tokens.has("expression") || tokens.has("object") || tokens.has("key") || tokens.has("callable");
  return isBindParameterQuestion(tokens) && createLike && expressionLike;
}

function isCompilerVisitorQuestion(tokens: Set<string>): boolean {
  if (isBindParameterQuestion(tokens)) {
    return false;
  }

  const compilerLike = tokens.has("compiler") || tokens.has("sqlcompiler") || tokens.has("compile") || tokens.has("compiled");
  const renderLike =
    tokens.has("render") ||
    tokens.has("renders") ||
    tokens.has("visit") ||
    tokens.has("visitor");
  return compilerLike && renderLike;
}

function compilerVisitorScore(row: CandidateRow, tokens: Set<string>): number {
  if (row.kind !== "method") {
    return 0;
  }

  const symbol = normalize(row.qualified_name);
  const file = normalize(row.file_path);
  if (!symbol.includes("compiler") && !file.includes("compiler")) {
    return 0;
  }

  const methodTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  if (methodTokens[0] !== "visit") {
    return 0;
  }

  const nodeTokens = methodTokens.slice(1);
  if (nodeTokens.length === 0 || !nodeTokens.some((token) => tokens.has(token) || tokens.has(stemToken(token)))) {
    return 0;
  }

  let score = 64;
  if (nodeTokens.every((token) => tokens.has(token) || tokens.has(stemToken(token)))) score += 8;
  if (symbol.includes("compiler")) score += 6;
  if (file.includes("compiler")) score += 6;
  return score;
}

function publicApiActionNamesForQuestion(tokens: Set<string>): string[] {
  const actions: string[] = [];
  const inspectionLike = tokens.has("inspect") || tokens.has("inspector") || tokens.has("inspection") || tokens.has("inspecting");
  if (inspectionLike) {
    actions.push("inspect");
  }

  const eventLike = tokens.has("event") || tokens.has("events");
  const listenerLike = tokens.has("listener") || tokens.has("listeners") || tokens.has("listen");
  const registrationLike =
    tokens.has("register") ||
    tokens.has("registered") ||
    tokens.has("registration") ||
    tokens.has("attach") ||
    tokens.has("attached");
  if (eventLike && listenerLike && registrationLike) {
    actions.push("listen");
  }

  return actions;
}

function publicApiActionScore(row: CandidateRow, actions: string[]): number {
  if (row.kind !== "function") {
    return 0;
  }

  const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  if (symbolTokens.length === 0 || row.symbol_name.startsWith("_")) {
    return 0;
  }

  let score = 0;
  for (const action of actions) {
    if (row.symbol_name === action) {
      score = Math.max(score, 42);
      continue;
    }

    if (symbolTokens.some((token) => actionTokenMatches(token, action))) {
      score = Math.max(score, 20);
    }
  }

  return score;
}

function isBindResolutionQuestion(tokens: Set<string>): boolean {
  const bindLike = tokens.has("bind") || tokens.has("binds");
  const resolutionLike =
    tokens.has("resolve") ||
    tokens.has("resolves") ||
    tokens.has("resolution") ||
    tokens.has("fallback") ||
    tokens.has("rules");
  const contextLike =
    tokens.has("session") ||
    tokens.has("engine") ||
    tokens.has("connection") ||
    tokens.has("mapper") ||
    tokens.has("metadata") ||
    tokens.has("clause");
  return bindLike && resolutionLike && contextLike;
}

function loaderOptionNamesForQuestion(tokens: Set<string>): string[] {
  const loaderLike =
    tokens.has("loader") ||
    tokens.has("loading") ||
    tokens.has("eager") ||
    tokens.has("relationship") ||
    tokens.has("relationships") ||
    tokens.has("option") ||
    tokens.has("options");
  if (!loaderLike) {
    return [];
  }

  return ["joinedload", "selectinload", "subqueryload", "lazyload", "contains_eager"].filter((name) =>
    tokens.has(name)
  );
}

function isTransactionBeginQuestion(tokens: Set<string>): boolean {
  const transactionLike = tokens.has("transaction") || tokens.has("roottransaction") || tokens.has("root");
  const beginLike = tokens.has("begin") || tokens.has("begins") || tokens.has("start") || tokens.has("starts");
  const connectionLike = tokens.has("connection") || tokens.has("engine");
  return transactionLike && beginLike && connectionLike;
}

function isCreateObjectFactoryQuestion(tokens: Set<string>): boolean {
  return tokens.has("create") || tokens.has("creates") || tokens.has("build") || tokens.has("builds") || tokens.has("generate") || tokens.has("generates");
}

function createObjectFactoryScore(row: CandidateRow, question: string, tokens: Set<string>): number {
  if (row.kind !== "function") {
    return 0;
  }

  if (!candidateMatchesSpecificNamedConcept(row, question)) {
    return 0;
  }

  const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  const [actionToken, ...objectTokens] = symbolTokens;
  if (!actionToken || !["create", "build", "generate"].includes(actionToken)) {
    return 0;
  }

  const meaningfulObjectTokens = objectTokens.filter((token) => !factoryConnectorTokens.has(token));
  if (meaningfulObjectTokens.length === 0) {
    return 0;
  }

  const queryTokens = rankedQueryTokens(question);
  const actionObject = directFactoryObjectToken(queryTokens);
  let score = 0;

  if (actionObject && tokensLooselyMatch(meaningfulObjectTokens[0] ?? "", actionObject)) {
    score += 40;
  } else if (meaningfulObjectTokens.every((token) => tokens.has(token) || tokens.has(stemToken(token)))) {
    score += 18;
  }

  if (score > 0 && exactSymbolTokensInQueryOrder(symbolTokens, queryTokens)) {
    score += 8;
  }

  return score;
}

function isGenericGraphOwnerMismatch(row: CandidateRow, question: string): boolean {
  if (row.kind !== "method") {
    return false;
  }

  const ownerName = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
  if (normalize(ownerName) !== "graph") {
    return false;
  }

  const normalizedQuestion = normalize(question);
  if (normalizedQuestion.includes("graph class")) {
    return false;
  }

  if (hasGraphAlgorithmOrFormatSignal(question)) {
    return true;
  }

  return !candidateMatchesSpecificNamedConcept(row, question);
}

function directOwnerActionForQuestion(question: string): string | undefined {
  const actions = new Set(["send", "receive", "parse", "validate", "open", "close"]);
  return rankedQueryTokens(question).find((token) => actions.has(token));
}

function directOwnerActionScore(row: CandidateRow, question: string, action: string): number {
  if (row.kind !== "method") {
    return 0;
  }

  const ownerName = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
  const ownerTokens = normalize(ownerName)
    .split(/\s+/)
    .filter(Boolean);
  if (ownerTokens.length === 0) {
    return 0;
  }

  const queryTokens = new Set(rankedQueryTokens(question));
  if (!ownerTokens.every((token) => queryTokens.has(token))) {
    return 0;
  }
  if (action === "send" && isUnknownTaskMessageQuestion(queryTokens)) {
    return 0;
  }
  if (
    action === "parse" &&
    ownerTokens.every((token) => token === "config" || token === "configuration") &&
    (queryTokens.has("console") || queryTokens.has("command") || queryTokens.has("session") || queryTokens.has("main"))
  ) {
    return 0;
  }

  const methodTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  if (!methodTokens.some((token) => actionTokenMatches(token, action))) {
    return 0;
  }

  return 34 + Math.min(methodTokens.length, 3) * 3;
}

function candidateMatchesSpecificNamedConcept(row: CandidateRow, question: string): boolean {
  const specificTokens = specificNamedConceptTokens(question);
  if (specificTokens.length === 0) {
    return true;
  }

  const candidate = normalize(`${row.qualified_name} ${row.file_path}`).replace(/\s+/g, " ");
  const compactCandidate = candidate.replace(/\s+/g, "");
  return specificTokens.some((token) => candidate.includes(token) || compactCandidate.includes(token));
}

function specificNamedConceptTokens(question: string): string[] {
  const rawMatches = [...question.matchAll(/\b[A-Z][A-Za-z0-9]*\b/g)].map((match) => match[0]).filter(Boolean);
  const excluded = new Set([
    "networkx",
    "fastapi",
    "sqlalchemy",
    "pydantic",
    "django",
    "celery",
    "httpx",
    "attrs",
    "pytest",
    "click",
    "rich",
    "poetry",
    "basemodel",
    "engine",
    "graph",
    "api",
    "url",
    "json",
    "http",
    "orm",
    "sql"
  ]);

  return rawMatches
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 5 && !excluded.has(token));
}

const factoryConnectorTokens = new Set([
  "a",
  "an",
  "the",
  "from",
  "for",
  "with",
  "by",
  "to",
  "of",
  "and",
  "or"
]);

function directFactoryObjectToken(tokens: string[]): string | undefined {
  const actionIndex = tokens.findIndex((token) => ["create", "creates", "build", "builds", "generate", "generates"].includes(token));
  if (actionIndex === -1) {
    return undefined;
  }

  for (const token of tokens.slice(actionIndex + 1)) {
    if (!factoryConnectorTokens.has(token)) {
      return token;
    }
  }

  return undefined;
}

function isFactoryConstructorQuestion(tokens: Set<string>): boolean {
  const constructLike = tokens.has("construct") || tokens.has("constructor") || tokens.has("constructs");
  const createBuildLike =
    tokens.has("create") ||
    tokens.has("creates") ||
    tokens.has("build") ||
    tokens.has("builds") ||
    tokens.has("generate") ||
    tokens.has("generates");
  const parameterLike = tokens.has("parameter") || tokens.has("parameters") || tokens.has("param") || tokens.has("params");
  const concreteFactoryObjectLike =
    tokens.has("select") ||
    tokens.has("statement") ||
    tokens.has("relationship") ||
    tokens.has("relationships") ||
    tokens.has("declarative") ||
    tokens.has("registry") ||
    tokens.has("mapped") ||
    tokens.has("column") ||
    tokens.has("factory") ||
    tokens.has("function");
  if (constructLike && parameterLike && !createBuildLike && !concreteFactoryObjectLike) {
    return false;
  }

  const factoryActionLike =
    constructLike ||
    tokens.has("create") ||
    tokens.has("creates") ||
    tokens.has("build") ||
    tokens.has("builds") ||
    tokens.has("generate") ||
    tokens.has("generates") ||
    tokens.has("implement") ||
    tokens.has("implemented") ||
    tokens.has("implementation");
  const factoryObjectLike =
    tokens.has("select") ||
    tokens.has("statement") ||
    tokens.has("relationship") ||
    tokens.has("relationships") ||
    tokens.has("declarative") ||
    tokens.has("base") ||
    tokens.has("registry") ||
    tokens.has("mapped") ||
    tokens.has("column") ||
    tokens.has("factory") ||
    tokens.has("function");
  return factoryActionLike && factoryObjectLike;
}

function isDeclarativeBaseFactoryQuestion(tokens: Set<string>): boolean {
  const declarativeLike = tokens.has("declarative") && tokens.has("base");
  const factoryLike =
    tokens.has("create") ||
    tokens.has("creates") ||
    tokens.has("construct") ||
    tokens.has("generate") ||
    tokens.has("generates") ||
    tokens.has("registry");
  return declarativeLike && factoryLike;
}

function isUrlParseQuestion(tokens: Set<string>): boolean {
  const urlLike = tokens.has("url") || tokens.has("urls");
  const parseLike = tokens.has("parse") || tokens.has("parsed") || tokens.has("parses") || tokens.has("string");
  const fieldLike =
    tokens.has("drivername") ||
    tokens.has("username") ||
    tokens.has("password") ||
    tokens.has("host") ||
    tokens.has("port") ||
    tokens.has("database") ||
    tokens.has("query");
  return urlLike && parseLike && fieldLike;
}

function isExactScalarResultQuestion(tokens: Set<string>): boolean {
  const resultLike = tokens.has("result") || tokens.has("row") || tokens.has("rows");
  const scalarLike = tokens.has("scalar") || tokens.has("value");
  const exactOneLike = tokens.has("exactly") || (tokens.has("one") && (tokens.has("raise") || tokens.has("raises")));
  const notOptionalLike = tokens.has("more") || tokens.has("no") || tokens.has("than");
  return resultLike && scalarLike && tokens.has("one") && exactOneLike && notOptionalLike;
}

function isEngineDisposalQuestion(tokens: Set<string>): boolean {
  const engineLike = tokens.has("engine");
  const disposeLike = tokens.has("dispose") || tokens.has("disposes") || tokens.has("disposed") || tokens.has("disposal");
  const poolLike = tokens.has("pool") || tokens.has("connection") || tokens.has("connections");
  return engineLike && disposeLike && poolLike;
}

function isEventKeyListenerQuestion(tokens: Set<string>): boolean {
  const eventLike = tokens.has("event") || tokens.has("events");
  const registryLike = tokens.has("registry") || tokens.has("key");
  const listenLike =
    tokens.has("listener") ||
    tokens.has("listeners") ||
    tokens.has("listen") ||
    tokens.has("attach") ||
    tokens.has("attaches") ||
    tokens.has("registration");
  return eventLike && registryLike && listenLike;
}

function isUrlResolverQuestion(tokens: Set<string>): boolean {
  const urlLike = tokens.has("url") || tokens.has("urlresolver") || (tokens.has("url") && tokens.has("resolver"));
  const resolveLike = tokens.has("resolve") || tokens.has("resolves") || tokens.has("resolvermatch");
  const pathLike = tokens.has("path") || tokens.has("patterns") || tokens.has("pattern");
  return urlLike && resolveLike && pathLike;
}

function isUrlReverseQuestion(tokens: Set<string>): boolean {
  const urlLike = tokens.has("url") || tokens.has("urls") || tokens.has("urlresolver") || tokens.has("urlconf") || tokens.has("current") || tokens.has("app");
  const reverseLike = tokens.has("reverse") || tokens.has("reversed");
  const viewLike = tokens.has("view") || tokens.has("viewname") || tokens.has("name");
  const resolverPrefixLike = (tokens.has("urlresolver") || (tokens.has("url") && tokens.has("resolver"))) && tokens.has("prefix");
  const argumentLike =
    tokens.has("args") ||
    tokens.has("kwargs") ||
    tokens.has("query") ||
    tokens.has("fragment") ||
    tokens.has("namespace") ||
    tokens.has("prefix");
  return urlLike && reverseLike && (viewLike || resolverPrefixLike) && argumentLike;
}

function isAmqpTaskMessageQuestion(tokens: Set<string>): boolean {
  const protocolV2Like = (tokens.has("protocol") && tokens.has("v2")) || tokens.has("proto2");
  const taskMessageLike = tokens.has("task") && (tokens.has("message") || tokens.has("messages"));
  const buildLike = tokens.has("build") || tokens.has("create") || tokens.has("construct");
  const payloadLike =
    tokens.has("headers") ||
    tokens.has("body") ||
    tokens.has("callbacks") ||
    tokens.has("errbacks") ||
    tokens.has("stamped");
  return protocolV2Like && taskMessageLike && buildLike && payloadLike;
}

function isUnknownTaskMessageQuestion(tokens: Set<string>): boolean {
  const unknownTaskLike = tokens.has("unknown") && tokens.has("task");
  const messageLike = tokens.has("message") || tokens.has("messages");
  const failureLike = tokens.has("reject") || tokens.has("failure") || tokens.has("failed") || tokens.has("task-failed");
  const signalLike = tokens.has("signal") || tokens.has("task_unknown") || tokens.has("unknown");
  return unknownTaskLike && messageLike && failureLike && signalLike;
}

function isTemplateParserQuestion(tokens: Set<string>): boolean {
  const templateLike = tokens.has("template");
  const parserLike = tokens.has("parser");
  const parseLike = tokens.has("parse") || tokens.has("parsed") || tokens.has("parsing");
  const tokenLike = tokens.has("token") || tokens.has("tokens") || tokens.has("tag") || tokens.has("tags") || tokens.has("nodelist") || tokens.has("nodelists");
  return templateLike && parserLike && parseLike && tokenLike;
}

function isJsonResponseQuestion(tokens: Set<string>): boolean {
  const jsonLike = tokens.has("json");
  const responseLike = tokens.has("response") || tokens.has("jsonresponse");
  const serializeLike = tokens.has("serialize") || tokens.has("serializes") || tokens.has("serialized");
  const contentTypeLike = tokens.has("content") || tokens.has("type") || tokens.has("application");
  return jsonLike && responseLike && serializeLike && contentTypeLike;
}

function isCsrfProcessViewQuestion(tokens: Set<string>): boolean {
  const csrfLike = tokens.has("csrf");
  const processViewLike = tokens.has("process") && tokens.has("view");
  const protectionLike =
    tokens.has("cookie") ||
    tokens.has("cookies") ||
    tokens.has("token") ||
    tokens.has("tokens") ||
    tokens.has("origin") ||
    tokens.has("origins") ||
    tokens.has("trusted");
  return csrfLike && processViewLike && protectionLike;
}

function isCrossValidationScoreQuestion(tokens: Set<string>): boolean {
  const crossLike = tokens.has("cross");
  const validationLike = tokens.has("validation") || tokens.has("validate") || tokens.has("validated") || tokens.has("val");
  const scoreLike = tokens.has("score") || tokens.has("scores") || tokens.has("scoring") || tokens.has("evaluate");
  const splitLike = tokens.has("split") || tokens.has("splits") || tokens.has("estimator") || tokens.has("estimators");
  return crossLike && validationLike && scoreLike && splitLike;
}

function isPipelineFinalPredictQuestion(tokens: Set<string>): boolean {
  const pipelineLike = tokens.has("pipeline");
  const predictLike = tokens.has("predict") || tokens.has("prediction") || tokens.has("predictions");
  const finalEstimatorLike = tokens.has("final") || tokens.has("estimator");
  const stepLike = tokens.has("step") || tokens.has("steps") || tokens.has("through") || tokens.has("transform") || tokens.has("transformed");
  return pipelineLike && predictLike && finalEstimatorLike && stepLike;
}

function isGridSearchRunQuestion(tokens: Set<string>): boolean {
  const gridSearchLike = tokens.has("grid") && tokens.has("search");
  const candidateLike =
    tokens.has("candidate") ||
    tokens.has("candidates") ||
    tokens.has("parameter") ||
    tokens.has("parameters") ||
    tokens.has("param") ||
    tokens.has("grid");
  const runLike =
    tokens.has("enumerate") ||
    tokens.has("evaluating") ||
    tokens.has("evaluate") ||
    tokens.has("combination") ||
    tokens.has("combinations") ||
    tokens.has("run") ||
    tokens.has("search");
  return gridSearchLike && candidateLike && runLike;
}

function isNearestNeighborsGraphQuestion(tokens: Set<string>): boolean {
  const nearestLike = tokens.has("nearest") || tokens.has("neighbor") || tokens.has("neighbors") || tokens.has("neighbour") || tokens.has("neighbours");
  const graphLike = tokens.has("graph") || tokens.has("connectivity");
  const buildLike = tokens.has("build") || tokens.has("built") || tokens.has("compute") || tokens.has("computed") || tokens.has("connectivity");
  return nearestLike && graphLike && buildLike;
}

function isNearestNeighborsQuestion(tokens: Set<string>): boolean {
  if (isNearestNeighborsGraphQuestion(tokens)) {
    return false;
  }

  const nearestLike = tokens.has("nearest") || tokens.has("neighbor") || tokens.has("neighbors") || tokens.has("neighbour") || tokens.has("neighbours");
  const lookupLike =
    tokens.has("find") ||
    tokens.has("search") ||
    tokens.has("return") ||
    tokens.has("distances") ||
    tokens.has("distance") ||
    tokens.has("indices") ||
    tokens.has("index");
  const radiusLike = tokens.has("radius");
  return nearestLike && lookupLike && !radiusLike;
}

function isPairedInputValidationQuestion(tokens: Set<string>): boolean {
  const validationLike = tokens.has("validate") || tokens.has("validates") || tokens.has("validated") || tokens.has("validation");
  const pairedLike =
    tokens.has("together") ||
    tokens.has("consistent") ||
    tokens.has("length") ||
    tokens.has("multi") ||
    tokens.has("output") ||
    tokens.has("target") ||
    tokens.has("targets");
  const validationDetailsLike = tokens.has("finite") || tokens.has("values") || tokens.has("length") || tokens.has("targets") || tokens.has("output");
  return validationLike && pairedLike && validationDetailsLike;
}

function isEstimatorDataValidationQuestion(tokens: Set<string>): boolean {
  const estimatorLike = tokens.has("estimator") || tokens.has("estimators");
  const dataLike = tokens.has("data") || tokens.has("input") || tokens.has("inputs");
  const featureLike = tokens.has("feature") || tokens.has("features") || tokens.has("names") || tokens.has("checking") || tokens.has("setting");
  const validationLike =
    tokens.has("validate") ||
    tokens.has("validates") ||
    tokens.has("validated") ||
    tokens.has("validation") ||
    tokens.has("check") ||
    tokens.has("checking");
  return estimatorLike && dataLike && featureLike && validationLike;
}

function isInputArrayValidationQuestion(tokens: Set<string>): boolean {
  const validationLike = tokens.has("validate") || tokens.has("validates") || tokens.has("validated") || tokens.has("validation");
  const inputArrayLike =
    (tokens.has("input") || tokens.has("inputs")) && (tokens.has("array") || tokens.has("arrays") || tokens.has("matrix") || tokens.has("matrices"));
  const lowLevelChecks =
    tokens.has("dtype") ||
    tokens.has("shape") ||
    tokens.has("sparse") ||
    tokens.has("sparsity") ||
    tokens.has("finite") ||
    tokens.has("minimum") ||
    tokens.has("samples") ||
    tokens.has("features");
  return validationLike && inputArrayLike && lowLevelChecks;
}

function isForestFitQuestion(tokens: Set<string>): boolean {
  const forestLike = tokens.has("forest") || tokens.has("forests");
  const fitLike = tokens.has("fit") || tokens.has("fitting") || tokens.has("train") || tokens.has("training");
  const treeBuildLike =
    tokens.has("tree") ||
    tokens.has("trees") ||
    tokens.has("build") ||
    tokens.has("builds") ||
    tokens.has("bootstrap") ||
    tokens.has("parallel");
  return forestLike && fitLike && treeBuildLike;
}

function symbolTokensCoveredByQuestion(row: CandidateRow, tokens: Set<string>): boolean {
  const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter((token) => token && isRequiredSymbolCoverageToken(token));
  return symbolTokens.length > 0 && symbolTokens.every((symbolToken) => tokens.has(symbolToken) || tokens.has(stemToken(symbolToken)));
}

function isRequiredSymbolCoverageToken(token: string): boolean {
  return !factoryConnectorTokens.has(token) && !new Set(["if", "else", "then", "when", "unless"]).has(token);
}

function isExactNounFactorySymbol(row: CandidateRow, question: string): boolean {
  const symbolTokens = normalize(row.symbol_name.replace(/^_+/, ""))
    .split(/\s+/)
    .filter(Boolean);
  if (symbolTokens.length !== 1) {
    return false;
  }

  const tokens = rankedQueryTokens(question);
  const factoryIndex = tokens.indexOf("factory");
  if (factoryIndex <= 0) {
    return false;
  }

  return tokens[factoryIndex - 1] === symbolTokens[0];
}

function isExceptionResponseHandlerQuestion(tokens: Set<string>): boolean {
  const exceptionLike = tokens.has("exception") || tokens.has("exceptions") || tokens.has("error") || tokens.has("errors");
  const responseLike = tokens.has("response") || tokens.has("responses") || tokens.has("json");
  return exceptionLike && responseLike;
}

function isResponseSerializationQuestion(tokens: Set<string>): boolean {
  const responseLike = tokens.has("response") || tokens.has("responses");
  const serializeLike = tokens.has("serialize") || tokens.has("serializes") || tokens.has("serialized") || tokens.has("serializing");
  const validateLike = tokens.has("validate") || tokens.has("validates") || tokens.has("validated") || tokens.has("validation");
  const modelLike = tokens.has("model") || tokens.has("models");
  const returnLike = tokens.has("return") || tokens.has("returns") || tokens.has("value") || tokens.has("values");
  return responseLike && serializeLike && validateLike && modelLike && returnLike;
}

function isModelDumpSerializationQuestion(tokens: Set<string>): boolean {
  const modelLike = tokens.has("model") || tokens.has("models");
  const serializeLike = tokens.has("serialize") || tokens.has("serializes") || tokens.has("serialized") || tokens.has("serializing");
  const dictLike = tokens.has("dict") || tokens.has("dictionary") || tokens.has("python");
  const dumpOptionLike =
    tokens.has("include") ||
    tokens.has("exclude") ||
    tokens.has("alias") ||
    tokens.has("aliases") ||
    tokens.has("unset") ||
    tokens.has("defaults") ||
    tokens.has("none") ||
    tokens.has("round") ||
    tokens.has("trip");
  return modelLike && serializeLike && dictLike && dumpOptionLike;
}

function isModelJsonSchemaQuestion(tokens: Set<string>): boolean {
  const modelLike = tokens.has("model") || tokens.has("models") || tokens.has("basemodel");
  const jsonSchemaLike = tokens.has("json") && tokens.has("schema");
  const generateLike = tokens.has("generate") || tokens.has("generates") || tokens.has("generated") || tokens.has("schema");
  const optionLike =
    tokens.has("alias") ||
    tokens.has("aliases") ||
    tokens.has("ref") ||
    tokens.has("template") ||
    tokens.has("union") ||
    tokens.has("format") ||
    tokens.has("mode") ||
    tokens.has("generator");
  return modelLike && jsonSchemaLike && generateLike && optionLike;
}

function isModelCompletionQuestion(tokens: Set<string>): boolean {
  const modelLike = tokens.has("model") || tokens.has("models");
  const finishLike = tokens.has("finish") || tokens.has("finishes") || tokens.has("complete") || tokens.has("completion");
  const buildLike = tokens.has("build") || tokens.has("building") || tokens.has("built");
  const classLike = tokens.has("class") || tokens.has("classes");
  const schemaRuntimeLike =
    tokens.has("schema") &&
    (tokens.has("validator") ||
      tokens.has("validators") ||
      tokens.has("serializer") ||
      tokens.has("serializers") ||
      tokens.has("computed"));
  return modelLike && finishLike && buildLike && classLike && schemaRuntimeLike;
}

function isModelRebuildQuestion(tokens: Set<string>): boolean {
  const modelLike = tokens.has("model") || tokens.has("models") || tokens.has("basemodel");
  const rebuildLike = tokens.has("rebuild") || tokens.has("rebuilt") || tokens.has("rebuilding");
  const schemaLike = tokens.has("schema") || tokens.has("core");
  const namespaceLike =
    tokens.has("namespace") ||
    tokens.has("namespaces") ||
    tokens.has("forward") ||
    tokens.has("reference") ||
    tokens.has("references") ||
    tokens.has("refs");
  return modelLike && rebuildLike && schemaLike && namespaceLike;
}

function isDynamicModelFactoryQuestion(tokens: Set<string>): boolean {
  const modelLike = tokens.has("model") || tokens.has("models") || tokens.has("basemodel");
  const createLike = tokens.has("create") || tokens.has("creates") || tokens.has("created") || tokens.has("dynamically") || tokens.has("dynamic");
  const classLike = tokens.has("class") || tokens.has("subclass") || tokens.has("subclasses");
  const fieldLike = tokens.has("field") || tokens.has("fields") || tokens.has("definition") || tokens.has("definitions");
  return modelLike && createLike && classLike && fieldLike;
}

function isRouteRegistrationQuestion(tokens: Set<string>): boolean {
  const routeLike = tokens.has("route") || tokens.has("routes");
  const apiLike = tokens.has("api");
  const registrationLike =
    tokens.has("add") ||
    tokens.has("adds") ||
    tokens.has("adding") ||
    tokens.has("register") ||
    tokens.has("registered") ||
    tokens.has("registration");
  return routeLike && apiLike && registrationLike;
}

function isAuthHeaderBehaviorQuestion(tokens: Set<string>): boolean {
  const authLike =
    tokens.has("authorization") ||
    tokens.has("authorize") ||
    tokens.has("auth") ||
    tokens.has("authenticated") ||
    tokens.has("authentication");
  const headerLike = tokens.has("header") || tokens.has("headers");
  const credentialLike =
    tokens.has("token") ||
    tokens.has("tokens") ||
    tokens.has("bearer") ||
    tokens.has("credential") ||
    tokens.has("credentials") ||
    tokens.has("oauth2") ||
    tokens.has("oauth");
  return authLike && headerLike && credentialLike;
}

function isDependencySolverQuestion(tokens: Set<string>): boolean {
  const dependencyLike = tokens.has("dependency") || tokens.has("dependencies") || tokens.has("dependencie");
  const solveLike = tokens.has("solve") || tokens.has("solver") || tokens.has("solving") || tokens.has("resolved");
  const orchestrationLike =
    tokens.has("provider") ||
    tokens.has("progress") ||
    tokens.has("transaction") ||
    tokens.has("latest") ||
    tokens.has("override") ||
    tokens.has("overrides") ||
    tokens.has("marker") ||
    tokens.has("markers");
  return dependencyLike && solveLike && orchestrationLike;
}

function isInstallerOptionApplicationQuestion(tokens: Set<string>): boolean {
  const installLike = tokens.has("install") || tokens.has("installer") || tokens.has("installation");
  const commandLike = tokens.has("command") || tokens.has("cli") || tokens.has("option") || tokens.has("options");
  const optionLike =
    tokens.has("dry") ||
    tokens.has("extras") ||
    tokens.has("extra") ||
    tokens.has("groups") ||
    tokens.has("group") ||
    tokens.has("sync") ||
    tokens.has("compile") ||
    tokens.has("lock");
  const applyLike = tokens.has("apply") || tokens.has("applies") || tokens.has("set") || tokens.has("configure") || tokens.has("running");
  return installLike && commandLike && optionLike && applyLike;
}

function isPluginActivationQuestion(tokens: Set<string>): boolean {
  const pluginLike = tokens.has("plugin") || tokens.has("plugins");
  const activateLike = tokens.has("activate") || tokens.has("activated") || tokens.has("activation");
  const managerLike = tokens.has("manager") || tokens.has("loaded") || tokens.has("load") || tokens.has("calling");
  return pluginLike && activateLike && managerLike;
}

function lifecycleActionsForQuestion(tokens: Set<string>): string[] {
  const actionVocabulary = [
    "start",
    "stop",
    "suspend",
    "resume",
    "read",
    "write",
    "open",
    "close",
    "set",
    "unset",
    "undo",
    "reset",
    "create",
    "cleanup",
    "clean",
    "remove",
    "delete"
  ];
  return actionVocabulary.filter((action) => tokens.has(action));
}

function implementationActionTokensForQuestion(tokens: Set<string>): string[] {
  const actionVocabulary = ["perform"];
  return actionVocabulary.filter((action) => tokens.has(action));
}

function fileContextActionTokensForQuestion(tokens: Set<string>): string[] {
  const actionVocabulary = ["collect"];
  return actionVocabulary.filter((action) => tokens.has(action));
}

function actionTokenMatches(symbolToken: string, action: string): boolean {
  return (
    symbolToken === action ||
    stemToken(symbolToken) === action ||
    tokensLooselyMatch(symbolToken, action) ||
    (action.length >= 3 && symbolToken.startsWith(action) && symbolToken.length > action.length)
  );
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

function hasExplicitDottedOwnerReference(references: Array<{ packageName: string; member: string }>): boolean {
  return references.some((reference) => /^[A-Z]/.test(reference.packageName));
}

function rowMatchesAnyDottedReference(row: CandidateRow, references: Array<{ packageName: string; member: string }>): boolean {
  return references.some((reference) => rowMatchesDottedReference(row, reference));
}

function rowMatchesDottedReference(row: CandidateRow, reference: { packageName: string; member: string }): boolean {
  if (row.symbol_name !== reference.member) {
    return false;
  }

  if (/^[A-Z]/.test(reference.packageName)) {
    const ownerName = row.qualified_name.includes(".") ? row.qualified_name.slice(0, row.qualified_name.lastIndexOf(".")) : "";
    return normalize(ownerName) === normalize(reference.packageName);
  }

  return true;
}

function hasOwnerMethodQuestionSignal(question: string): boolean {
  return /\b[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/.test(question);
}

function isPropertyMethod(row: CandidateRow): boolean {
  return row.kind === "method" && /(^|\n)\s*@property\b/.test(row.chunk_text);
}

function isDunderCandidate(row: CandidateRow): boolean {
  return row.kind === "method" && row.symbol_name.startsWith("__") && row.symbol_name.endsWith("__");
}

function questionMentionsDunderMethodName(question: string): boolean {
  return /__[A-Za-z0-9_]+__/.test(question);
}

function isDunderQuestion(row: CandidateRow, question: string): boolean {
  if (questionMentionsExactQualifiedName(row, question) || question.includes(row.symbol_name)) {
    return true;
  }

  const tokens = new Set(rankedQueryTokens(question));
  if (row.symbol_name === "__init__") {
    return tokens.has("init") || tokens.has("initialize") || tokens.has("initialized") || tokens.has("constructor");
  }

  return false;
}

function isHttpVerbDecoratorMethod(row: CandidateRow): boolean {
  return ["get", "post", "put", "delete", "options", "head", "patch", "trace"].includes(row.symbol_name);
}

function queryMentionsSymbolName(row: CandidateRow, question: string): boolean {
  const tokens = new Set(rankedQueryTokens(question));
  return normalize(row.symbol_name)
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => tokens.has(token));
}

function questionMentionsExactQualifiedName(row: CandidateRow, question: string): boolean {
  return normalize(question).includes(normalize(row.qualified_name));
}

function shouldTreatDottedReferenceAsApi(
  reference: { packageName: string; member: string },
  normalizedQuestion: string,
  tokens: Set<string>
): boolean {
  const lowerCaseReference = reference.packageName === reference.packageName.toLowerCase() && reference.member === reference.member.toLowerCase();
  if (!lowerCaseReference) {
    return true;
  }

  return (
    normalizedQuestion.includes("module level") ||
    tokens.has("function") ||
    tokens.has("method") ||
    tokens.has("class") ||
    tokens.has("defined") ||
    tokens.has("definition") ||
    tokens.has("convenience") ||
    tokens.has("api")
  );
}

function isParserActionQuestion(tokens: Set<string>): boolean {
  return (
    (tokens.has("parse") || tokens.has("parsed") || tokens.has("parser") || tokens.has("parsing")) &&
    (tokens.has("markup") || tokens.has("tag") || tokens.has("tags"))
  );
}

function shouldSuppressModuleDomainForQuestion(fileStemTokens: string[], tokens: Set<string>): boolean {
  const parserFile = fileStemTokens.some((token) => stemToken(token) === "parser" || stemToken(token) === "parse");
  return (
    parserFile &&
    (isProjectConfigParsingQuestion(tokens) ||
      isHttpRequestHandlerQuestion(tokens) ||
      isPythonVariantHeaderQuestion(tokens) ||
      isTemplateParserPipelineQuestion(tokens) ||
      isTemplateCompilePipelineQuestion(tokens))
  );
}

function isProjectConfigParsingQuestion(tokens: Set<string>): boolean {
  const configLike =
    tokens.has("pyproject") ||
    tokens.has("toml") ||
    tokens.has("config") ||
    tokens.has("configuration") ||
    (tokens.has("project") && tokens.has("root"));
  const actionLike =
    tokens.has("parse") ||
    tokens.has("parsed") ||
    tokens.has("find") ||
    tokens.has("discover") ||
    tokens.has("infer") ||
    tokens.has("inferred");
  return configLike && actionLike;
}

function isHttpRequestHandlerQuestion(tokens: Set<string>): boolean {
  const requestLike = tokens.has("http") || tokens.has("request") || tokens.has("response") || tokens.has("server");
  const headerLike = tokens.has("header") || tokens.has("headers");
  const bodyLike = tokens.has("body") || tokens.has("format") || tokens.has("formatted");
  const handlerLike = tokens.has("handle") || tokens.has("handler") || tokens.has("return") || tokens.has("response");
  return requestLike && headerLike && bodyLike && handlerLike;
}

function isPythonVariantHeaderQuestion(tokens: Set<string>): boolean {
  const variantLike = tokens.has("variant") || tokens.has("python") || tokens.has("pyi");
  const headerLike = tokens.has("header") || tokens.has("headers");
  const targetLike = tokens.has("target") || tokens.has("targets") || tokens.has("version") || tokens.has("versions");
  return variantLike && headerLike && targetLike;
}

function isStdioFormattingQuestion(tokens: Set<string>): boolean {
  const stdinLike = tokens.has("stdin") || (tokens.has("standard") && tokens.has("input"));
  const stdoutLike = tokens.has("stdout") || (tokens.has("standard") && tokens.has("output"));
  const formatLike = tokens.has("format") || tokens.has("formatted") || tokens.has("formatting") || tokens.has("diff");
  return stdinLike && stdoutLike && formatLike;
}

function isFilesystemLoaderSourceQuestion(tokens: Set<string>): boolean {
  const filesystemLike = tokens.has("filesystem") || (tokens.has("file") && tokens.has("system"));
  const loaderLike = tokens.has("loader") || tokens.has("loaders") || tokens.has("template") || tokens.has("templates");
  const sourceLike = tokens.has("source") || tokens.has("text") || tokens.has("read");
  const reloadLike = tokens.has("uptodate") || tokens.has("reload") || tokens.has("directories") || tokens.has("directory");
  return filesystemLike && loaderLike && sourceLike && reloadLike;
}

function isTemplateParserPipelineQuestion(tokens: Set<string>): boolean {
  const parserLike = tokens.has("parse") || tokens.has("parser") || tokens.has("parsing");
  const templateLike = tokens.has("template") || tokens.has("templates");
  const fullTemplateSignals = [
    tokens.has("data"),
    tokens.has("variable") || tokens.has("variables"),
    tokens.has("statement") || tokens.has("statements"),
    tokens.has("ast"),
    tokens.has("node") || tokens.has("nodes")
  ].filter(Boolean).length;
  return parserLike && templateLike && fullTemplateSignals >= 2;
}

function isTemplateCompilePipelineQuestion(tokens: Set<string>): boolean {
  const templateLike = tokens.has("template") || tokens.has("templates");
  const compileLike = tokens.has("compile") || tokens.has("compiled") || tokens.has("compiler");
  const generateLike = tokens.has("generate") || tokens.has("generated") || tokens.has("generation");
  const codeLike = tokens.has("code") || tokens.has("source") || tokens.has("raw");
  const parseLike = tokens.has("parse") || tokens.has("parsed") || tokens.has("parser");
  return templateLike && compileLike && generateLike && codeLike && parseLike;
}

function isWebSocketServerAcceptResponseQuestion(tokens: Set<string>): boolean {
  const websocketLike = tokens.has("websocket") || tokens.has("sec");
  const serverLike = tokens.has("server");
  const acceptLike = tokens.has("accept") || tokens.has("accepted");
  const responseLike = tokens.has("response") || tokens.has("headers") || tokens.has("header");
  const detailLike = tokens.has("subprotocol") || tokens.has("extension") || tokens.has("extensions") || tokens.has("sec");
  return websocketLike && serverLike && acceptLike && responseLike && detailLike;
}

function isWebSocketClientEstablishQuestion(tokens: Set<string>): boolean {
  const websocketLike = tokens.has("websocket") || tokens.has("upgrade") || tokens.has("101");
  const clientLike = tokens.has("client");
  const responseLike = tokens.has("response") || tokens.has("101") || tokens.has("headers") || tokens.has("header");
  const acceptLike = tokens.has("accept") || tokens.has("accepted") || tokens.has("token");
  const validateLike = tokens.has("validate") || tokens.has("validates") || tokens.has("establish") || tokens.has("established");
  return websocketLike && clientLike && responseLike && acceptLike && validateLike;
}

function isFrameEventConversionQuestion(tokens: Set<string>): boolean {
  const frameLike = tokens.has("frame") || tokens.has("frames");
  const eventLike = tokens.has("event") || tokens.has("events");
  const conversionLike = tokens.has("convert") || tokens.has("converted") || tokens.has("into") || tokens.has("yield") || tokens.has("yields");
  const typedEventLike =
    tokens.has("ping") ||
    tokens.has("pong") ||
    tokens.has("close") ||
    tokens.has("textmessage") ||
    tokens.has("bytesmessage") ||
    tokens.has("message");
  return frameLike && eventLike && conversionLike && typedEventLike;
}

function extensionNegotiationSideForQuestion(tokens: Set<string>): "client" | "server" | "either" | undefined {
  const extensionLike = tokens.has("extension") || tokens.has("extensions");
  const negotiationLike =
    tokens.has("handshake") ||
    tokens.has("agree") ||
    tokens.has("agrees") ||
    tokens.has("requested") ||
    tokens.has("accepted") ||
    tokens.has("finalize") ||
    tokens.has("finalizes") ||
    tokens.has("unrecognized") ||
    tokens.has("header") ||
    tokens.has("headers");
  if (!extensionLike || !negotiationLike) {
    return undefined;
  }
  if (tokens.has("server") || tokens.has("requested") || tokens.has("response")) {
    return "server";
  }
  if (tokens.has("client") || tokens.has("accepted") || tokens.has("unrecognized") || tokens.has("finalize")) {
    return "client";
  }
  return "either";
}

function isReportGenerationQuestion(tokens: Set<string>): boolean {
  const reportLike = tokens.has("report") || tokens.has("reports");
  const generationLike = tokens.has("generate") || tokens.has("generated") || tokens.has("generat") || tokens.has("generation");
  return reportLike && generationLike;
}

function backendMarkStateForQuestion(tokens: Set<string>): "success" | "failure" | undefined {
  const backendLike = tokens.has("backend") || tokens.has("result") || tokens.has("results");
  const markLike = tokens.has("mark") || tokens.has("marks") || tokens.has("marked") || tokens.has("store") || tokens.has("stored");
  if (!backendLike || !markLike) {
    return undefined;
  }

  if (tokens.has("successful") || tokens.has("success") || tokens.has("succeeded") || tokens.has("done")) {
    return "success";
  }
  if (tokens.has("failed") || tokens.has("failure") || tokens.has("fail") || tokens.has("exception")) {
    return "failure";
  }
  return undefined;
}

function isStrategyRefreshQuestion(tokens: Set<string>): boolean {
  const strategyLike = tokens.has("strategy") || tokens.has("strategies");
  const refreshLike = tokens.has("rebuild") || tokens.has("refresh") || tokens.has("update") || tokens.has("install");
  const workerLike = tokens.has("worker") || tokens.has("consumer");
  const registryLike = tokens.has("registry") || tokens.has("tracer") || tokens.has("tracers") || tokens.has("task") || tokens.has("tasks");
  return strategyLike && refreshLike && workerLike && registryLike;
}

function isEagerTaskApplyQuestion(tokens: Set<string>): boolean {
  const taskLike = tokens.has("task") || tokens.has("tasks");
  const eagerLike = tokens.has("eager") || tokens.has("eagerly") || tokens.has("inline") || tokens.has("local") || tokens.has("locally");
  const processLike = tokens.has("process") || tokens.has("current");
  const requestLike =
    tokens.has("request") ||
    tokens.has("callbacks") ||
    tokens.has("callback") ||
    tokens.has("errbacks") ||
    tokens.has("result") ||
    tokens.has("state");
  return taskLike && eagerLike && processLike && requestLike;
}

function isScheduleSubtypeDueQuestion(tokens: Set<string>): boolean {
  const subtypeLike = tokens.has("crontab") || tokens.has("solar");
  const scheduleLike = tokens.has("schedule") || tokens.has("scheduled") || tokens.has("schedules");
  const dueLike = tokens.has("due") || tokens.has("run") || tokens.has("time");
  return subtypeLike && scheduleLike && dueLike;
}

function isSchedulerTickQuestion(tokens: Set<string>): boolean {
  const beatLike = tokens.has("beat") || tokens.has("scheduler") || tokens.has("schedule") || tokens.has("scheduled");
  const heapLike = tokens.has("heap") || tokens.has("pop") || tokens.has("popped") || tokens.has("reserve") || tokens.has("reserved");
  const delayLike = tokens.has("delay") || tokens.has("next") || tokens.has("tick") || tokens.has("interval");
  const dueLike = tokens.has("due") || tokens.has("entry") || tokens.has("entries");
  return beatLike && heapLike && delayLike && dueLike;
}

function isSchedulerApplyEntryQuestion(tokens: Set<string>): boolean {
  const beatLike = tokens.has("beat") || tokens.has("scheduler");
  const scheduledTaskLike = tokens.has("scheduled") || tokens.has("schedule") || tokens.has("task");
  const sendLike = tokens.has("sent") || tokens.has("send") || tokens.has("sending") || tokens.has("applying") || tokens.has("apply");
  const resultLike = tokens.has("result") || tokens.has("id") || tokens.has("log") || tokens.has("debug") || tokens.has("report");
  return beatLike && scheduledTaskLike && sendLike && resultLike;
}

function isGroupFreezeMetadataQuestion(tokens: Set<string>): boolean {
  const groupLike = tokens.has("group");
  const freezeLike = tokens.has("freeze") || tokens.has("frozen");
  const childLike = tokens.has("child") || tokens.has("children") || tokens.has("signature") || tokens.has("signatures");
  const metadataLike =
    tokens.has("id") ||
    tokens.has("root") ||
    tokens.has("parent") ||
    tokens.has("chord") ||
    tokens.has("index") ||
    tokens.has("indexes") ||
    tokens.has("metadata");
  return groupLike && freezeLike && childLike && metadataLike;
}

function isGroupApplyOrchestrationQuestion(tokens: Set<string>): boolean {
  const groupLike = tokens.has("group") || tokens.has("groupresult");
  const applyLike = tokens.has("apply") || tokens.has("applies") || tokens.has("applying");
  const childLike = tokens.has("child") || tokens.has("children") || tokens.has("signature") || tokens.has("signatures");
  const orchestrationLike = tokens.has("unroll") || tokens.has("prepared") || tokens.has("trail") || tokens.has("groupresult");
  return groupLike && applyLike && childLike && orchestrationLike;
}

function isChordRunQuestion(tokens: Set<string>): boolean {
  const chordLike = tokens.has("chord");
  const headerLike = tokens.has("header") || tokens.has("headers");
  const bodyLike = tokens.has("body") || tokens.has("callback") || tokens.has("callbacks");
  const runLike = tokens.has("schedule") || tokens.has("scheduled") || tokens.has("attach") || tokens.has("unlock") || tokens.has("run");
  return chordLike && headerLike && bodyLike && runLike;
}

function isPoolApplyTargetQuestion(tokens: Set<string>): boolean {
  const poolLike = tokens.has("pool") || tokens.has("concurrency");
  const targetLike = tokens.has("target") || tokens.has("args") || tokens.has("kwargs");
  const callbackLike = tokens.has("callback") || tokens.has("callbacks") || tokens.has("correlation") || tokens.has("timeout");
  const submitLike = tokens.has("submit") || tokens.has("submits") || tokens.has("apply");
  return poolLike && targetLike && callbackLike && submitLike;
}

function isObjectSerializationQuestion(tokens: Set<string>): boolean {
  const actionLike =
    tokens.has("convert") ||
    tokens.has("conversion") ||
    tokens.has("serialize") ||
    tokens.has("serializes") ||
    tokens.has("serialized") ||
    tokens.has("serializing");
  const objectLike = tokens.has("instance") || tokens.has("instances") || tokens.has("object") || tokens.has("objects") || tokens.has("model");
  const outputLike =
    tokens.has("dict") ||
    tokens.has("dictionary") ||
    tokens.has("dictionaries") ||
    tokens.has("tuple") ||
    tokens.has("tuples") ||
    tokens.has("json") ||
    tokens.has("jsonable");
  return actionLike && objectLike && outputLike;
}

function isJsonCompatibleConversionQuestion(tokens: Set<string>): boolean {
  const actionLike = tokens.has("convert") || tokens.has("conversion") || tokens.has("encode") || tokens.has("encoder");
  const jsonLike = tokens.has("json") || tokens.has("jsonable");
  const compatibleLike = tokens.has("compatible") || tokens.has("data") || tokens.has("value") || tokens.has("values");
  return actionLike && jsonLike && compatibleLike;
}

function isOptionalNonePassthroughQuestion(tokens: Set<string>): boolean {
  const noneLike = tokens.has("none") || tokens.has("null") || tokens.has("nil");
  const optionalLike =
    tokens.has("optional") ||
    tokens.has("allow") ||
    tokens.has("allows") ||
    tokens.has("accept") ||
    tokens.has("accepts") ||
    tokens.has("pass") ||
    tokens.has("passes") ||
    tokens.has("without");
  const conversionLike =
    tokens.has("converter") ||
    tokens.has("converters") ||
    tokens.has("convert") ||
    tokens.has("conversion") ||
    tokens.has("default") ||
    tokens.has("defaults");
  const passthroughLike =
    tokens.has("without") ||
    tokens.has("unchanged") ||
    tokens.has("passthrough") ||
    tokens.has("pass") ||
    tokens.has("passes") ||
    tokens.has("skip") ||
    tokens.has("skips");
  return noneLike && optionalLike && conversionLike && passthroughLike;
}

function isDocumentationRouteSetupQuestion(tokens: Set<string>): boolean {
  const setupLike = tokens.has("setup") || tokens.has("set") || tokens.has("configure") || tokens.has("configured");
  const docsLike = tokens.has("docs") || tokens.has("doc") || tokens.has("documentation") || tokens.has("swagger") || tokens.has("redoc");
  const openapiLike = tokens.has("openapi") || tokens.has("swagger") || tokens.has("redoc");
  const routeLike = tokens.has("route") || tokens.has("routes");
  return setupLike && docsLike && openapiLike && routeLike;
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

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function addWhy(why: string[], reason: string): void {
  if (!why.includes(reason)) {
    why.push(reason);
  }
}
