import Database from "better-sqlite3";
import path from "node:path";
import type { RelatedTestMatch, RelatedTestsResult } from "./schema.js";

export interface RelatedTestsOptions {
  target: string;
  indexPath?: string;
  sourceFile: string;
  sourceFiles?: string[];
  symbol?: string;
  terms?: string[];
  limit?: number;
}

export interface RelatedTestsBatchOptions {
  target: string;
  indexPath?: string;
  sources: Array<{
    sourceFile: string;
    symbol?: string;
  }>;
  terms?: string[];
  limit?: number;
}

interface TestFileRow {
  path: string;
  text: string;
  symbols: string | null;
  imported_modules: string | null;
  called_names: string | null;
}

interface TestFileRowsResult {
  rows: TestFileRow[];
  pruned: boolean;
}

interface TestFileAnalysis {
  row: TestFileRow;
  normalizedTestPath: string;
  normalizedText: string;
  importedModules: string[];
  calledNames: string[];
  fixtureArgs?: string[];
  parametrizeBlocks?: string[];
  normalizedParametrizeText?: string;
}

interface RelatedTestsInternalResult {
  result: RelatedTestsResult;
  candidateFiles: string[];
}

export function findRelatedTests(options: RelatedTestsOptions): RelatedTestsResult {
  const sourceFiles = uniqueValues((options.sourceFiles && options.sourceFiles.length > 0 ? options.sourceFiles : [options.sourceFile]).map(normalizeSourceFile));
  const dbPath = options.indexPath ?? path.join(path.resolve(options.target), ".codeindex", "index.sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    if (sourceFiles.length > 1) {
      return findRelatedTestsForSources(db, options, sourceFiles);
    }
    return runRelatedTestsWithDb(db, options).result;
  } finally {
    db.close();
  }
}

export function findRelatedTestsBatch(options: RelatedTestsBatchOptions): RelatedTestsResult[] {
  const dbPath = options.indexPath ?? path.join(path.resolve(options.target), ".codeindex", "index.sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    return runRelatedTestsBatchWithDb(db, options);
  } finally {
    db.close();
  }
}

function runRelatedTestsBatchWithDb(db: Database.Database, options: RelatedTestsBatchOptions): RelatedTestsResult[] {
  const sourceOptions = options.sources.map((source) => ({
    target: options.target,
    indexPath: options.indexPath,
    sourceFile: source.sourceFile,
    symbol: source.symbol,
    terms: options.terms,
    limit: options.limit
  }));
  const candidatePathsBySource = sourceOptions.map((sourceOption) => queryCandidateTestPaths(db, sourceOption));
  const allTestPaths = candidatePathsBySource.some((paths) => paths.length === 0) ? queryAllTestPaths(db) : [];
  const analysisCache = analysesByPath(
    queryTestRowsByPaths(db, uniqueValues(candidatePathsBySource.flatMap((paths) => (paths.length > 0 ? paths : allTestPaths))))
  );

  const results = sourceOptions.map((sourceOption, index) => {
    const candidatePaths = candidatePathsBySource[index].length > 0 ? candidatePathsBySource[index] : allTestPaths;
    let analyses = candidatePaths.map((candidatePath) => analysisCache.get(candidatePath)).filter((analysis): analysis is TestFileAnalysis => analysis !== undefined);
    let matches = scoreTestAnalyses(analyses, sourceOption);
    if (candidatePathsBySource[index].length > 0 && matches.length < (sourceOption.limit ?? 5)) {
      analyses =
        allTestPaths.length > 0
          ? allTestPaths.map((testPath) => analysisCache.get(testPath)).filter((analysis): analysis is TestFileAnalysis => analysis !== undefined)
          : queryAllTestRows(db).map(analyzeTestFile);
      matches = scoreTestAnalyses(analyses, sourceOption);
    }
    const selectedMatches = matches.slice(0, sourceOption.limit ?? 5);
    return {
      sourceFile: normalizeSourceFile(sourceOption.sourceFile),
      symbol: sourceOption.symbol,
      candidateFilesScored: analyses.length,
      matches: selectedMatches
    };
  });
  const symbolsByPath = queryRelatedTestSymbolsByPath(db, uniqueValues(results.flatMap((result) => result.matches.map((match) => match.file))));
  return results.map((result) => ({
    ...result,
    matches: withRelatedTestSymbols(result.matches, symbolsByPath)
  }));
}

function runRelatedTestsWithDb(db: Database.Database, options: RelatedTestsOptions): RelatedTestsInternalResult {
  let { rows, pruned } = queryTestRows(db, options);
  let matches = scoreTestRows(rows, options);
  if (pruned && matches.length < (options.limit ?? 5)) {
    rows = queryAllTestRows(db);
    pruned = false;
    matches = scoreTestRows(rows, options);
  }
  return {
    result: {
      sourceFile: normalizeSourceFile(options.sourceFile),
      sourceFiles: options.sourceFiles,
      symbol: options.symbol,
      candidateFilesScored: rows.length,
      matches: hydrateRelatedTestSymbols(db, matches.slice(0, options.limit ?? 5))
    },
    candidateFiles: rows.map((row) => row.path)
  };
}

function queryCandidateTestPaths(db: Database.Database, options: RelatedTestsOptions): string[] {
  const fastCandidateQuery = testCandidateSqlQuery(options, "fts");
  const fastRows = queryCandidateTestPathRows(db, fastCandidateQuery);
  const minimumCandidates = options.limit ?? 5;
  if (!usesTaskTermCandidates(options) || fastRows.length >= minimumCandidates) {
    return fastRows.map((row) => row.path);
  }

  const fallbackCandidateQuery = testCandidateSqlQuery(options, "fallback");
  const fallbackRows = queryCandidateTestPathRows(db, fallbackCandidateQuery);
  return fallbackRows.map((row) => row.path);
}

function queryCandidateTestPathRows(
  db: Database.Database,
  candidateQuery: { sql: string; params: Record<string, unknown> }
): Array<{ path: string }> {
  return db.prepare(candidatePathSql(candidateQuery.sql)).all(candidateQuery.params) as Array<{ path: string }>;
}

function candidatePathSql(candidateQuerySql: string): string {
  return `
        with candidate_files(file_id) as (
          ${candidateQuerySql}
        )
        select path
        from files
        join candidate_files on candidate_files.file_id = files.id
        where role = 'test'
        order by path
        `;
}

function queryAllTestPaths(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `
        select path
        from files
        where role = 'test'
        order by path
        `
    )
    .all() as Array<{ path: string }>;
  return rows.map((row) => row.path);
}

function analysesByPath(rows: TestFileRow[]): Map<string, TestFileAnalysis> {
  return new Map(rows.map((row) => [row.path, analyzeTestFile(row)]));
}

function findRelatedTestsForSources(db: Database.Database, options: RelatedTestsOptions, sourceFiles: string[]): RelatedTestsResult {
  const results = sourceFiles.map((sourceFile) =>
    runRelatedTestsWithDb(db, {
      ...options,
      sourceFile,
      sourceFiles: undefined,
      symbol: undefined
    })
  );
  const bestByFile = new Map<string, RelatedTestMatch>();
  for (const { result } of results) {
    for (const match of result.matches) {
      const existing = bestByFile.get(match.file);
      if (!existing || match.score > existing.score) {
        bestByFile.set(match.file, match);
      }
    }
  }

  return {
    sourceFile: normalizeSourceFile(options.sourceFile),
    sourceFiles,
    symbol: options.symbol,
    candidateFilesScored: uniqueValues(results.flatMap((result) => result.candidateFiles)).length,
    matches: [...bestByFile.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, options.limit ?? 5)
  };
}

function scoreTestRows(rows: TestFileRow[], options: RelatedTestsOptions): RelatedTestMatch[] {
  return scoreTestAnalyses(rows.map(analyzeTestFile), options);
}

function scoreTestAnalyses(analyses: TestFileAnalysis[], options: RelatedTestsOptions): RelatedTestMatch[] {
  return analyses
    .map((analysis) => scoreTestFile(analysis, options.sourceFile, options.symbol, options.terms ?? []))
    .filter((match): match is RelatedTestMatch => match !== undefined)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

function analyzeTestFile(row: TestFileRow): TestFileAnalysis {
  const parametrizeBlocks = row.text.includes("parametrize") ? testParametrizeBlocks(row.text) : undefined;
  return {
    row,
    normalizedTestPath: normalize(row.path),
    normalizedText: normalize(row.text),
    importedModules: uniqueValues([
      ...splitCsv(row.imported_modules).map(normalizeDottedName),
      ...(row.text.includes("use ") ? rustImportedModules(row.text) : [])
    ]),
    calledNames: uniqueValues([...splitCsv(row.called_names).map(normalize), ...calledNamesFromText(row.text)]),
    fixtureArgs: row.text.includes("def test") ? testFixtureArgs(row.text) : undefined,
    parametrizeBlocks,
    normalizedParametrizeText: parametrizeBlocks ? normalize(parametrizeBlocks.join("\n")) : undefined
  };
}

function queryTestRows(db: Database.Database, options: RelatedTestsOptions): TestFileRowsResult {
  const candidatePaths = queryCandidateTestPaths(db, options);
  const rows = queryTestRowsByPaths(db, candidatePaths);

  if (rows.length > 0) {
    return { rows, pruned: true };
  }
  return { rows: queryAllTestRows(db), pruned: false };
}

function queryTestRowsByPaths(db: Database.Database, paths: string[]): TestFileRow[] {
  if (paths.length === 0) {
    return [];
  }
  const params = Object.fromEntries(paths.map((pathValue, index) => [`path${index}`, pathValue]));
  const pathList = paths.map((_, index) => `@path${index}`).join(", ");
  return db.prepare(testRowSql(pathList, true)).all(params) as TestFileRow[];
}

export function relatedTestRowSqlForTesting(paths: string[]): string {
  const pathList = paths.map((_, index) => `@path${index}`).join(", ");
  return testRowSql(pathList, true);
}

function testRowSql(pathList: string, includePathFilter: boolean): string {
  const pathFilter = includePathFilter ? ` and f.path in (${pathList})` : "";
  return `
        with test_text as (
          select c.file_id, group_concat(c.text, char(10)) as text
          from chunks c
          join files f on f.id = c.file_id
          where f.role = 'test'${pathFilter}
          group by c.file_id
        ),
        test_edges as (
          select
            s.file_id,
            group_concat(distinct case when e.kind = 'symbol_imports_module' then e.target_name end) as imported_modules,
            group_concat(distinct case when e.kind = 'symbol_calls_name' then e.target_name end) as called_names
          from symbols s
          join test_text on test_text.file_id = s.file_id
          join edges e on e.source_symbol_id = s.id
          where s.file_id in (select file_id from test_text)
          group by s.file_id
        )
        select f.path, test_text.text, test_edges.imported_modules, test_edges.called_names
        , null as symbols
        from files f
        join test_text on test_text.file_id = f.id
        left join test_edges on test_edges.file_id = f.id
        where f.role = 'test'${pathFilter}
        order by f.path
        `;
}

function queryAllTestRows(db: Database.Database): TestFileRow[] {
  return db.prepare(testRowSql("", false)).all() as TestFileRow[];
}

function hydrateRelatedTestSymbols(db: Database.Database, matches: RelatedTestMatch[]): RelatedTestMatch[] {
  if (matches.length === 0) {
    return matches;
  }
  const symbolsByPath = queryRelatedTestSymbolsByPath(db, matches.map((match) => match.file));
  return withRelatedTestSymbols(matches, symbolsByPath);
}

function withRelatedTestSymbols(matches: RelatedTestMatch[], symbolsByPath: Map<string, string[]>): RelatedTestMatch[] {
  return matches.map((match) => ({
    ...match,
    symbols: symbolsByPath.get(match.file) ?? []
  }));
}

function queryRelatedTestSymbolsByPath(db: Database.Database, paths: string[]): Map<string, string[]> {
  if (paths.length === 0) {
    return new Map();
  }
  const params = Object.fromEntries(paths.map((pathValue, index) => [`path${index}`, pathValue]));
  const pathList = paths.map((_, index) => `@path${index}`).join(", ");
  const rows = db
    .prepare(
      `
        select f.path, group_concat(s.qualified_name) as symbols
        from files f
        join symbols s on s.file_id = f.id
        where f.role = 'test'
          and f.path in (${pathList})
          and s.kind in ('function', 'method', 'class')
        group by f.id, f.path
        `
    )
    .all(params) as Array<{ path: string; symbols: string | null }>;

  return new Map(rows.map((row) => [row.path, splitCsv(row.symbols)]));
}

type TaskTermCandidateStrategy = "fts" | "fallback";

function testCandidateSqlQuery(
  options: RelatedTestsOptions,
  taskTermStrategy: TaskTermCandidateStrategy = "fts"
): { sql: string; params: Record<string, unknown> } {
  const normalizedSource = normalizeSourceFile(options.sourceFile);
  const sourceStem = fileStem(normalizedSource);
  const sourceModules = moduleNamesForSource(normalizedSource);
  const sourceTokens = candidateSourcePathTokens(normalizedSource);
  const symbolLeaf = options.symbol ? normalize(options.symbol.includes(".") ? options.symbol.slice(options.symbol.lastIndexOf(".") + 1) : options.symbol) : "";
  const pathTokensToMatch = uniqueValues([sourceStem, ...sourceTokens].filter((term) => term.length >= 3));
  const branches: string[] = [];
  const params: Record<string, unknown> = {};

  for (const [index, token] of pathTokensToMatch.entries()) {
    const key = `candidatePath${index}`;
    params[key] = `%${token}%`;
    branches.push(`
      select id as file_id
      from files
      where role = 'test'
        and lower(path) like @${key}
    `);
  }

  for (const [index, sourceModule] of sourceModules.entries()) {
    const key = `candidateImport${index}`;
    params[key] = sourceModule;
    branches.push(`
      select distinct candidate_s.file_id
      from symbols candidate_s
      join files candidate_f on candidate_f.id = candidate_s.file_id
      join edges candidate_e on candidate_e.source_symbol_id = candidate_s.id
      where candidate_f.role = 'test'
        and candidate_e.kind = 'symbol_imports_module'
        and replace(lower(candidate_e.target_name), '.', '') like '%' || @${key} || '%'
    `);
  }

  const candidateTerms = taskTermCandidateTokens(options.terms ?? []);
  if (candidateTerms.length > 0) {
    branches.push(taskTermCandidateSql(candidateTerms, params, taskTermStrategy));
  }

  if (symbolLeaf) {
    params.candidateCall = symbolLeaf;
    branches.push(`
      select distinct candidate_s.file_id
      from symbols candidate_s
      join files candidate_f on candidate_f.id = candidate_s.file_id
      join edges candidate_e on candidate_e.source_symbol_id = candidate_s.id
      where candidate_f.role = 'test'
        and candidate_e.kind = 'symbol_calls_name'
        and lower(candidate_e.target_name) = @candidateCall
    `);
  }

  if (branches.length === 0) {
    return {
      sql: `
        select id as file_id
        from files
        where role = 'test'
      `,
      params
    };
  }

  return { sql: branches.join("\nunion\n"), params };
}

export function relatedTestCandidateSqlForTesting(options: RelatedTestsOptions): {
  sql: string;
  fallbackSql: string;
  params: Record<string, unknown>;
} {
  const fast = testCandidateSqlQuery(options, "fts");
  const fallback = testCandidateSqlQuery(options, "fallback");
  return {
    sql: fast.sql,
    fallbackSql: fallback.sql,
    params: { ...fast.params, ...fallback.params }
  };
}

function usesTaskTermCandidates(options: RelatedTestsOptions): boolean {
  return taskTermCandidateTokens(options.terms ?? []).length > 0;
}

function taskTermCandidateSql(
  candidateTerms: string[],
  params: Record<string, unknown>,
  strategy: TaskTermCandidateStrategy
): string {
  candidateTerms.forEach((term, index) => {
    params[`candidateTerm${index}`] = strategy === "fts" ? ftsTermMatch(term) : `%${term}%`;
  });

  return `
      select file_id
      from (
        ${candidateTerms
          .map((_, index) =>
            strategy === "fts" ? ftsTaskTermCandidateBranch(index) : fallbackTaskTermCandidateBranch(index)
          )
          .join("\nunion\n")}
      )
      group by file_id
      having count(distinct term_index) = ${candidateTerms.length}
    `;
}

function ftsTaskTermCandidateBranch(index: number): string {
  return `
            select candidate_c.file_id
                 , ${index} as term_index
            from chunk_fts
            join chunks candidate_c on candidate_c.id = chunk_fts.chunk_id
            join files candidate_f on candidate_f.id = candidate_c.file_id
            where candidate_f.role = 'test'
              and chunk_fts match @candidateTerm${index}
          `;
}

function fallbackTaskTermCandidateBranch(index: number): string {
  return `
            select candidate_c.file_id
                 , ${index} as term_index
            from chunks candidate_c
            join files candidate_f on candidate_f.id = candidate_c.file_id
            where candidate_f.role = 'test'
              and lower(candidate_c.text) like @candidateTerm${index}
          `;
}

function scoreTestFile(
  analysis: TestFileAnalysis,
  sourceFile: string,
  symbol: string | undefined,
  terms: string[]
): RelatedTestMatch | undefined {
  const row = analysis.row;
  const normalizedSource = normalizeSourceFile(sourceFile);
  const sourceStem = fileStem(normalizedSource);
  const sourceModules = moduleNamesForSource(normalizedSource);
  const sourceTokens = pathTokens(normalizedSource);
  const why: string[] = [];
  let score = 0;

  if (analysis.normalizedTestPath.includes(sourceStem)) {
    score += 20;
    why.push("test path includes source stem");
  }

  const pathTermMatches = taskTermsInPath(terms, analysis.normalizedTestPath);
  if (pathTermMatches.length > 0) {
    score += Math.min(pathTermMatches.length * 8, 32);
    why.push("test path matches task terms");
  }

  const sharedPathTokens = sourceTokens.filter((token) => token.length >= 3 && !layoutStopwords.has(token) && analysis.normalizedTestPath.includes(token));
  if (sharedPathTokens.length > 0) {
    score += Math.min(sharedPathTokens.length * 4, 16);
    why.push("test path shares source path tokens");
  }

  const mirroredLayoutTokens = mirroredPackageLayoutTokens(normalizedSource, row.path);
  if (mirroredLayoutTokens.length > 0) {
    score += Math.min(10 + mirroredLayoutTokens.length * 6, 22);
    why.push("test path mirrors source package layout");
  }

  if (importsSourceModule(analysis.importedModules, sourceModules, sourceStem, analysis.normalizedText)) {
    score += 30;
    why.push("test imports source module");
  }

  const fixtureArgs = mayUseRelatedFixture(row.text, analysis.normalizedText, sourceStem, symbol) ? analysis.fixtureArgs : undefined;
  if (fixtureArgs && usesRelatedFixture(fixtureArgs, sourceStem, symbol)) {
    score += 18;
    why.push("test uses related fixture");
  }

  const parametrizeBlocks = analysis.parametrizeBlocks;
  if (parametrizeBlocks) {
    const normalizedParametrizeText = analysis.normalizedParametrizeText ?? "";
    const parametrizeTermMatches = terms.map(normalize).filter((term) => term.length >= 2 && normalizedParametrizeText.includes(term));
    if (parametrizeTermMatches.length > 0) {
      score += Math.min(parametrizeTermMatches.length * 12, 36);
      why.push("parametrized cases match task terms");
    }

    if (parametrizeMentionsTarget(parametrizeBlocks, sourceStem, symbol)) {
      score += 16;
      why.push("parametrized cases mention source target");
    }
  }

  const matchedTerms = terms.map(normalize).filter((term) => term.length >= 2 && analysis.normalizedText.includes(term));
  if (matchedTerms.length > 0) {
    score += Math.min(matchedTerms.length * 12, 84);
    why.push("test body matches task terms");
    if (matchedTerms.length >= 5) {
      score += 24;
      why.push("strong task-term coverage");
    }
  }

  if (symbol) {
    const normalizedSymbol = normalize(symbol);
    const symbolLeaf = normalize(symbol.includes(".") ? symbol.slice(symbol.lastIndexOf(".") + 1) : symbol);
    if (analysis.normalizedText.includes(normalizedSymbol) || analysis.normalizedText.includes(symbolLeaf)) {
      score += 24;
      why.push("test body mentions source symbol");
    }
    if (analysis.calledNames.includes(symbolLeaf)) {
      score += 28;
      why.push("test calls source symbol");
    }
    if (analysis.normalizedTestPath.includes(symbolLeaf)) {
      score += 12;
      why.push("test path includes symbol name");
    }
  }

  if (score > 0 && isExternalTestRoot(row.path)) {
    score += 24;
    why.push("external test root");
  }

  if (score === 0) {
    return undefined;
  }

  return {
    file: row.path,
    score,
    why,
    firstLine: firstUsefulLine(row.text, sourceStem, sourceModules, symbol, terms, fixtureArgs ?? [], parametrizeBlocks ?? []),
    symbols: splitCsv(row.symbols)
  };
}

function mayUseRelatedFixture(text: string, normalizedText: string, sourceStem: string, symbol: string | undefined): boolean {
  if (!text.includes("def test")) {
    return false;
  }
  return fixtureNameCandidates(sourceStem, symbol).some((candidate) => normalizedText.includes(candidate));
}

function taskTermsInPath(terms: string[], normalizedTestPath: string): string[] {
  return uniqueValues(
    terms
      .map(normalize)
      .flatMap((term) => term.split(/\s+/))
      .filter((term) => term.length >= 4 && !layoutStopwords.has(term) && normalizedTestPath.includes(term))
  );
}

function taskTermCandidateTokens(terms: string[]): string[] {
  const tokens = uniqueValues(
    terms
      .map(normalize)
      .flatMap((term) => term.split(/\s+/))
      .filter((term) => term.length >= 5 && !layoutStopwords.has(term))
  );
  return tokens.slice(0, Math.min(3, tokens.length));
}

function ftsTermMatch(term: string): string {
  return `"${term.replace(/"/gu, '""')}"`;
}

function firstUsefulLine(
  text: string,
  sourceStem: string,
  sourceModules: string[],
  symbol: string | undefined,
  terms: string[] = [],
  fixtureArgs: string[] = [],
  parametrizeBlocks: string[] = []
): number | null {
  const symbolLeaf = symbol ? normalize(symbol.includes(".") ? symbol.slice(symbol.lastIndexOf(".") + 1) : symbol) : undefined;
  const normalizedTerms = terms.map(normalize).filter((term) => term.length >= 2);
  const normalizedParametrizeBlocks = parametrizeBlocks.map(normalize);
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => {
    const normalizedLine = normalize(line);
    const dottedLine = normalizeDottedName(line);
    return (
      normalizedLine.includes(sourceStem) ||
      sourceModules.some((sourceModule) => dottedLine.includes(sourceModule)) ||
      (symbolLeaf ? normalizedLine.includes(symbolLeaf) : false) ||
      fixtureArgs.some((fixtureArg) => normalizedLine.includes(fixtureArg)) ||
      normalizedParametrizeBlocks.some(
        (block) => normalizedLine.length > 0 && (block.includes(normalizedLine) || normalizedLine.includes("parametrize"))
      ) ||
      normalizedTerms.some((term) => normalizedLine.includes(term))
    );
  });
  return index === -1 ? null : index + 1;
}

function parametrizeMentionsTarget(blocks: string[], sourceStem: string, symbol: string | undefined): boolean {
  if (blocks.length === 0) {
    return false;
  }
  const normalizedBlocks = normalize(blocks.join("\n"));
  const candidates = fixtureNameCandidates(sourceStem, symbol);
  return candidates.some((candidate) => normalizedBlocks.includes(candidate));
}

function usesRelatedFixture(fixtureArgs: string[], sourceStem: string, symbol: string | undefined): boolean {
  if (fixtureArgs.length === 0) {
    return false;
  }
  const candidates = fixtureNameCandidates(sourceStem, symbol);
  return fixtureArgs.some((fixtureArg) => candidates.includes(fixtureArg));
}

function fixtureNameCandidates(sourceStem: string, symbol: string | undefined): string[] {
  const symbolLeaf = symbol ? normalize(symbol.includes(".") ? symbol.slice(symbol.lastIndexOf(".") + 1) : symbol) : "";
  const candidates = [sourceStem, symbolLeaf, ...nounLikeSuffixes(symbolLeaf)].filter((candidate) => candidate.length >= 3);
  return uniqueValues(candidates);
}

function nounLikeSuffixes(symbolLeaf: string): string[] {
  const parts = symbolLeaf.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return [];
  }
  const commonVerbs = new Set(["build", "create", "get", "load", "make", "new", "open", "parse", "read", "resolve"]);
  return commonVerbs.has(parts[0]) ? [parts.slice(1).join(" ")] : [];
}

function testFixtureArgs(text: string): string[] {
  const args: string[] = [];
  const definitionPattern = /\bdef\s+test[\w_]*\s*\(([^)]*)\)/g;
  for (const match of text.matchAll(definitionPattern)) {
    args.push(...splitPythonArgs(match[1]).map(normalize));
  }
  return uniqueValues(args.filter((arg) => arg.length > 0 && arg !== "self" && arg !== "cls"));
}

function testParametrizeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("parametrize")) {
      continue;
    }
    const block: string[] = [];
    for (let lineIndex = index; lineIndex < lines.length && block.length < 12; lineIndex += 1) {
      const line = lines[lineIndex];
      if (block.length > 0 && /^\s*(?:async\s+)?def\s+test/u.test(line)) {
        break;
      }
      block.push(line);
      if (block.length > 1 && /^\s*\)\s*$/u.test(line)) {
        break;
      }
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

function splitPythonArgs(args: string): string[] {
  return args
    .split(",")
    .map((arg) => arg.trim().replace(/^[*/]+/u, "").replace(/\s*=.*$/u, "").replace(/\s*:.*$/u, ""))
    .filter(Boolean);
}

function normalizeSourceFile(sourceFile: string): string {
  return sourceFile.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function fileStem(file: string): string {
  return normalize(path.posix.basename(file).replace(/\.[^.]+$/u, ""));
}

function moduleNamesForSource(file: string): string[] {
  const withoutExtension = file.replace(/\.[^.]+$/u, "");
  const withoutInit = withoutExtension.endsWith("/__init__") ? withoutExtension.slice(0, -"/__init__".length) : withoutExtension;
  const pathVariants = [withoutInit];
  for (const sourceRoot of ["src", "lib"]) {
    if (withoutInit.startsWith(`${sourceRoot}/`)) {
      pathVariants.push(withoutInit.slice(sourceRoot.length + 1));
    }
  }
  return uniqueValues(pathVariants.map((variant) => normalizeDottedName(variant.replace(/\//gu, "."))));
}

function importsSourceModule(
  importedModules: string[],
  sourceModules: string[],
  sourceStem: string,
  normalizedText: string
): boolean {
  return sourceModules.some((sourceModule) => {
    if (importedModules.some((importedModule) => importedModule === sourceModule || importedModule.startsWith(`${sourceModule}.`))) {
      return true;
    }

    const parentModule = sourceModule.includes(".") ? sourceModule.slice(0, sourceModule.lastIndexOf(".")) : "";
    return Boolean(parentModule && importedModules.includes(parentModule) && normalizedText.includes(sourceStem));
  });
}

function rustImportedModules(text: string): string[] {
  const modules: string[] = [];
  const usePattern = /^\s*use\s+([^;]+);/gmu;
  for (const match of text.matchAll(usePattern)) {
    modules.push(...rustUsePathVariants(match[1]));
  }
  return uniqueValues(modules);
}

function rustUsePathVariants(usePath: string): string[] {
  const expanded = usePath
    .replace(/\{([^{}]+)\}/gu, (_, inner: string) => inner.split(",").map((part) => part.trim()).join(" "))
    .split(/\s+/)
    .map((part) => part.trim().replace(/,$/u, ""))
    .filter(Boolean);
  const variants: string[] = [];
  for (const part of expanded) {
    const normalized = normalizeDottedName(part.replace(/::/gu, "."));
    if (!normalized) {
      continue;
    }
    variants.push(normalized);
    const withoutRoot = normalized.replace(/^(?:crate|self|super)\./u, "");
    variants.push(withoutRoot);
    if (withoutRoot.includes(".")) {
      variants.push(withoutRoot.slice(0, withoutRoot.lastIndexOf(".")));
    }
  }
  return uniqueValues(variants.filter(Boolean));
}

function calledNamesFromText(text: string): string[] {
  const names: string[] = [];
  const callPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:::<[^>]+>\s*)?\(/gu;
  for (const match of text.matchAll(callPattern)) {
    names.push(normalize(match[1]));
  }
  return uniqueValues(names);
}

function pathTokens(file: string): string[] {
  return normalize(file).split(/\s+/).filter(Boolean);
}

function candidateSourcePathTokens(sourceFile: string): string[] {
  const tokens = pathTokens(sourceFile).filter((token) => token.length >= 3 && !layoutStopwords.has(token));
  return uniqueValues(tokens.slice(1));
}

function mirroredPackageLayoutTokens(sourceFile: string, testFile: string): string[] {
  const sourceTokens = packageLayoutTokens(sourceFile);
  const testTokens = packageLayoutTokens(testFile);
  return sourceTokens.filter((token) => testTokens.includes(token));
}

function packageLayoutTokens(file: string): string[] {
  const parts = normalizeSourceFile(file)
    .replace(/\.[^.]+$/u, "")
    .split("/")
    .flatMap((part) => normalize(part).split(/\s+/))
    .filter((token) => token.length >= 3 && !layoutStopwords.has(token));
  return uniqueValues(parts);
}

function isExternalTestRoot(file: string): boolean {
  const normalized = normalizeSourceFile(file);
  return /^(?:tests?|integration_tests?|functional_tests?|acceptance_tests?)\//u.test(normalized);
}

const layoutStopwords = new Set([
  "lib",
  "pkg",
  "src",
  "test",
  "tests",
  "testing",
  "unit",
  "utils",
  "util",
  "common",
  "core",
  "base",
  "main"
]);

function splitCsv(value: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeDottedName(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/\//gu, ".")
    .replace(/[^A-Za-z0-9_.]+/gu, " ")
    .trim()
    .toLowerCase();
}

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.\/]+/g, " ")
    .toLowerCase();
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}
