import Database from "better-sqlite3";
import path from "node:path";
import type { RelatedTestMatch, RelatedTestsResult } from "./schema.js";

export interface RelatedTestsOptions {
  target: string;
  indexPath?: string;
  sourceFile: string;
  symbol?: string;
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

export function findRelatedTests(options: RelatedTestsOptions): RelatedTestsResult {
  const dbPath = options.indexPath ?? path.join(path.resolve(options.target), ".codeindex", "index.sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `
        with test_text as (
          select file_id, group_concat(text, char(10)) as text
          from chunks
          group by file_id
        ),
        test_edges as (
          select
            s.file_id,
            group_concat(distinct case when e.kind = 'symbol_imports_module' then e.target_name end) as imported_modules,
            group_concat(distinct case when e.kind = 'symbol_calls_name' then e.target_name end) as called_names
          from symbols s
          join edges e on e.source_symbol_id = s.id
          group by s.file_id
        )
        select f.path, test_text.text, test_edges.imported_modules, test_edges.called_names
        , test_symbols.symbols
        from files f
        join test_text on test_text.file_id = f.id
        left join test_edges on test_edges.file_id = f.id
        left join (
          select file_id, group_concat(qualified_name) as symbols
          from symbols
          where kind in ('function', 'method', 'class')
          group by file_id
        ) test_symbols on test_symbols.file_id = f.id
        where f.role = 'test'
        order by f.path
        `
      )
      .all() as TestFileRow[];
    const matches = rows
      .map((row) => scoreTestFile(row, options.sourceFile, options.symbol, options.terms ?? []))
      .filter((match): match is RelatedTestMatch => match !== undefined)
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .slice(0, options.limit ?? 5);
    return {
      sourceFile: normalizeSourceFile(options.sourceFile),
      symbol: options.symbol,
      matches
    };
  } finally {
    db.close();
  }
}

function scoreTestFile(
  row: TestFileRow,
  sourceFile: string,
  symbol: string | undefined,
  terms: string[]
): RelatedTestMatch | undefined {
  const normalizedSource = normalizeSourceFile(sourceFile);
  const sourceStem = fileStem(normalizedSource);
  const sourceModules = moduleNamesForSource(normalizedSource);
  const sourceTokens = pathTokens(normalizedSource);
  const normalizedTestPath = normalize(row.path);
  const normalizedText = normalize(row.text);
  const importedModules = splitCsv(row.imported_modules).map(normalizeDottedName);
  const calledNames = splitCsv(row.called_names).map(normalize);
  const why: string[] = [];
  let score = 0;

  if (normalizedTestPath.includes(sourceStem)) {
    score += 20;
    why.push("test path includes source stem");
  }

  const sharedPathTokens = sourceTokens.filter((token) => token.length >= 3 && normalizedTestPath.includes(token));
  if (sharedPathTokens.length > 0) {
    score += Math.min(sharedPathTokens.length * 4, 16);
    why.push("test path shares source path tokens");
  }

  if (importsSourceModule(importedModules, sourceModules, sourceStem, normalizedText)) {
    score += 30;
    why.push("test imports source module");
  }

  const matchedTerms = terms.map(normalize).filter((term) => term.length >= 2 && normalizedText.includes(term));
  if (matchedTerms.length > 0) {
    score += Math.min(matchedTerms.length * 10, 40);
    why.push("test body matches task terms");
  }

  if (symbol) {
    const normalizedSymbol = normalize(symbol);
    const symbolLeaf = normalize(symbol.includes(".") ? symbol.slice(symbol.lastIndexOf(".") + 1) : symbol);
    if (normalizedText.includes(normalizedSymbol) || normalizedText.includes(symbolLeaf)) {
      score += 24;
      why.push("test body mentions source symbol");
    }
    if (calledNames.includes(symbolLeaf)) {
      score += 28;
      why.push("test calls source symbol");
    }
    if (normalizedTestPath.includes(symbolLeaf)) {
      score += 12;
      why.push("test path includes symbol name");
    }
  }

  if (score === 0) {
    return undefined;
  }

  return {
    file: row.path,
    score,
    why,
    firstLine: firstUsefulLine(row.text, sourceStem, sourceModules, symbol, terms),
    symbols: splitCsv(row.symbols)
  };
}

function firstUsefulLine(
  text: string,
  sourceStem: string,
  sourceModules: string[],
  symbol: string | undefined,
  terms: string[] = []
): number | null {
  const symbolLeaf = symbol ? normalize(symbol.includes(".") ? symbol.slice(symbol.lastIndexOf(".") + 1) : symbol) : undefined;
  const normalizedTerms = terms.map(normalize).filter((term) => term.length >= 2);
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => {
    const normalizedLine = normalize(line);
    const dottedLine = normalizeDottedName(line);
    return (
      normalizedLine.includes(sourceStem) ||
      sourceModules.some((sourceModule) => dottedLine.includes(sourceModule)) ||
      (symbolLeaf ? normalizedLine.includes(symbolLeaf) : false) ||
      normalizedTerms.some((term) => normalizedLine.includes(term))
    );
  });
  return index === -1 ? null : index + 1;
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

function pathTokens(file: string): string[] {
  return normalize(file).split(/\s+/).filter(Boolean);
}

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
