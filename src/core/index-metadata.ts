import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FileRole, IndexMetadata, IndexMode, IndexRoleCounts, IndexWarning } from "./schema.js";

export const INDEX_SCHEMA_VERSION = 1;

const fileRoles: FileRole[] = ["source", "test", "docs", "example", "fixture", "tool", "benchmark"];

export function emptyRoleCounts(): IndexRoleCounts {
  return Object.fromEntries(fileRoles.map((role) => [role, 0])) as IndexRoleCounts;
}

export function countFileRoles(roles: FileRole[]): IndexRoleCounts {
  const counts = emptyRoleCounts();
  for (const role of roles) {
    counts[role] += 1;
  }
  return counts;
}

export function writeIndexMetadata(db: Database.Database, metadata: IndexMetadata): void {
  const insert = db.prepare(`
    insert into index_metadata(key, value)
    values (@key, @value)
  `);
  insert.run({ key: "schema_version", value: String(metadata.schemaVersion) });
  insert.run({ key: "root", value: metadata.root });
  insert.run({ key: "created_at", value: metadata.createdAt });
  insert.run({ key: "index_mode", value: metadata.mode });
  insert.run({ key: "role_counts", value: JSON.stringify(metadata.roleCounts) });
}

export function readIndexMetadata(db: Database.Database): IndexMetadata | undefined {
  const hasMetadataTable = db
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'index_metadata'")
    .get();
  if (!hasMetadataTable) {
    return undefined;
  }

  const rows = db.prepare("select key, value from index_metadata").all() as Array<{ key: string; value: string }>;
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const schemaVersion = Number.parseInt(values.get("schema_version") ?? "", 10);
  const root = values.get("root");
  const createdAt = values.get("created_at");
  const mode = values.get("index_mode") as IndexMode | undefined;
  if (!Number.isInteger(schemaVersion) || !root || !createdAt || (mode !== "all-files" && mode !== "source-only")) {
    return undefined;
  }

  return {
    schemaVersion,
    root,
    createdAt,
    mode,
    roleCounts: parseRoleCounts(values.get("role_counts"))
  };
}

export function indexWarningsForPath(
  target: string,
  indexPath: string | undefined,
  requestedRoles: FileRole[] = [],
  options: { requiresTestRole?: boolean } = {}
): IndexWarning[] {
  const dbPath = indexPath ?? path.join(path.resolve(target), ".codeindex", "index.sqlite");
  if (!existsSync(dbPath)) {
    return [];
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    return indexWarningsForDatabase(db, target, requestedRoles, options);
  } finally {
    db.close();
  }
}

export function indexWarningsForDatabase(
  db: Database.Database,
  target: string,
  requestedRoles: FileRole[] = [],
  options: { requiresTestRole?: boolean } = {}
): IndexWarning[] {
  return indexWarningsForMetadata(readIndexMetadata(db), target, requestedRoles, options);
}

export function indexWarningsForMetadata(
  metadata: IndexMetadata | undefined,
  target: string,
  requestedRoles: FileRole[] = [],
  options: { requiresTestRole?: boolean } = {}
): IndexWarning[] {
  if (!metadata) {
    return [
      {
        code: "legacy-index-metadata",
        message: "index metadata is missing; rebuild the index to enable root, mode, and role checks"
      }
    ];
  }

  const warnings: IndexWarning[] = [];
  const resolvedTarget = path.resolve(target);
  if (path.resolve(metadata.root) !== resolvedTarget) {
    warnings.push({
      code: "target-mismatch",
      message: `index target mismatch: index was built for ${metadata.root}, but query target is ${resolvedTarget}`
    });
  }

  const needsTests = options.requiresTestRole || requestedRoles.includes("test");
  if (needsTests && metadata.mode === "source-only") {
    warnings.push({
      code: "source-only-index",
      message: "source-only index: test files were skipped; rebuild without --source-only before asking for tests"
    });
  }

  const rolesToCheck = uniqueValues([...requestedRoles, ...(options.requiresTestRole ? ["test" as FileRole] : [])]);
  for (const role of rolesToCheck) {
    if ((metadata.roleCounts[role] ?? 0) === 0) {
      warnings.push({
        code: "missing-role",
        message: `index has no ${role}-role files; ${role} queries may be incomplete`
      });
    }
  }

  return uniqueWarnings(warnings);
}

export function mergeIndexWarnings(...warningGroups: Array<IndexWarning[] | undefined>): IndexWarning[] | undefined {
  const warnings = uniqueWarnings(warningGroups.flatMap((group) => group ?? []));
  return warnings.length > 0 ? warnings : undefined;
}

function parseRoleCounts(value: string | undefined): IndexRoleCounts {
  const counts = emptyRoleCounts();
  if (!value) {
    return counts;
  }
  try {
    const parsed = JSON.parse(value) as Partial<Record<FileRole, unknown>>;
    for (const role of fileRoles) {
      const count = parsed[role];
      counts[role] = typeof count === "number" && Number.isFinite(count) ? count : 0;
    }
  } catch {
    return counts;
  }
  return counts;
}

function uniqueWarnings(warnings: IndexWarning[]): IndexWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}\0${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueValues<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
