import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { stat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { extractC } from "./extractors/c.js";
import { extractCpp } from "./extractors/cpp.js";
import { extractCSharp } from "./extractors/csharp.js";
import { extractCython } from "./extractors/cython.js";
import { extractDart } from "./extractors/dart.js";
import { extractGo } from "./extractors/go.js";
import { extractJson } from "./extractors/json.js";
import { extractJava } from "./extractors/java.js";
import { extractKotlin } from "./extractors/kotlin.js";
import { extractPhp } from "./extractors/php.js";
import { extractPython } from "./extractors/python.js";
import { extractRuby } from "./extractors/ruby.js";
import { extractRust } from "./extractors/rust.js";
import { extractSwift } from "./extractors/swift.js";
import { extractToml } from "./extractors/toml.js";
import { extractTypeScript } from "./extractors/typescript.js";
import { extractXml } from "./extractors/xml.js";
import { extractYaml } from "./extractors/yaml.js";
import { countFileRoles, INDEX_SCHEMA_VERSION, writeIndexMetadata } from "./index-metadata.js";
import { scanCodeFiles } from "./scanner.js";
import type { CodeEdge, CodeSymbol, ExtractionResult, IndexStats } from "./schema.js";

export interface IndexOptions {
  indexPath?: string;
  includeSupportCode?: boolean;
}

export async function indexTarget(target: string, options: IndexOptions = {}): Promise<IndexStats> {
  const root = path.resolve(target);
  await assertDirectory(root);
  const indexPath = options.indexPath ?? path.join(root, ".codeindex", "index.sqlite");
  await mkdir(path.dirname(indexPath), { recursive: true });
  await rm(indexPath, { force: true });

  const db = new Database(indexPath);
  try {
    createSchema(db);
    const files = await scanCodeFiles(root, { includeSupportCode: options.includeSupportCode });
    const mode = options.includeSupportCode === false ? "source-only" : "all-files";
    const roleCounts = countFileRoles(files.map((file) => file.role));
    const extractions = files.map((file) => {
      if (file.language === "rust") {
        return extractRust(file);
      }
      if (file.language === "swift") {
        return extractSwift(file);
      }
      if (file.language === "kotlin") {
        return extractKotlin(file);
      }
      if (file.language === "java") {
        return extractJava(file);
      }
      if (file.language === "ruby") {
        return extractRuby(file);
      }
      if (file.language === "php") {
        return extractPhp(file);
      }
      if (file.language === "csharp") {
        return extractCSharp(file);
      }
      if (file.language === "go") {
        return extractGo(file);
      }
      if (file.language === "cython") {
        return extractCython(file);
      }
      if (file.language === "cpp") {
        return extractCpp(file);
      }
      if (file.language === "c") {
        return extractC(file);
      }
      if (file.language === "typescript" || file.language === "javascript") {
        return extractTypeScript(file);
      }
      if (file.language === "json") {
        return extractJson(file);
      }
      if (file.language === "dart") {
        return extractDart(file);
      }
      if (file.language === "xml") {
        return extractXml(file);
      }
      if (file.language === "toml") {
        return extractToml(file);
      }
      if (file.language === "yaml") {
        return extractYaml(file);
      }
      return extractPython(file);
    });
    const stats = writeExtractions(db, extractions);
    const createdAt = new Date().toISOString();
    writeIndexMetadata(db, {
      schemaVersion: INDEX_SCHEMA_VERSION,
      root,
      createdAt,
      mode,
      roleCounts
    });
    return { ...stats, indexPath, root, createdAt, mode, roleCounts };
  } finally {
    db.close();
  }
}

async function assertDirectory(target: string): Promise<void> {
  try {
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) {
      throw new Error(`Target is not a directory: ${target}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Target is not a directory")) {
      throw error;
    }
    throw new Error(`Target does not exist: ${target}`);
  }
}

export function createSchema(db: Database.Database): void {
  db.exec(`
    create table files(
      id integer primary key,
      path text not null unique,
      hash text not null,
      language text not null,
      role text not null
    );

    create table symbols(
      id integer primary key,
      file_id integer not null references files(id),
      name text not null,
      qualified_name text not null,
      kind text not null,
      start_line integer not null,
      end_line integer not null,
      parent_symbol_id integer references symbols(id)
    );

    create table chunks(
      id integer primary key,
      file_id integer not null references files(id),
      symbol_id integer references symbols(id),
      start_line integer not null,
      end_line integer not null,
      text text not null
    );

    create table edges(
      id integer primary key,
      source_symbol_id integer references symbols(id),
      target_symbol_id integer references symbols(id),
      target_name text not null,
      kind text not null,
      confidence text not null
    );

    create table index_metadata(
      key text primary key,
      value text not null
    );

    create virtual table chunk_fts using fts5(
      chunk_id unindexed,
      text,
      symbol_name,
      file_path
    );

    create index idx_files_role on files(role);
    create index idx_files_role_path on files(role, path);
    create index idx_chunks_file_id on chunks(file_id);
    create index idx_symbols_file_id on symbols(file_id);
    create index idx_symbols_file_kind_qualified on symbols(file_id, kind, qualified_name);
    create index idx_edges_source_symbol_id on edges(source_symbol_id);
    create index idx_edges_source_kind_target on edges(source_symbol_id, kind, target_name);
  `);
}

function writeExtractions(db: Database.Database, extractions: ExtractionResult[]): Pick<IndexStats, "files" | "symbols" | "chunks" | "edges"> {
  const insertFile = db.prepare(`
    insert into files(path, hash, language, role)
    values (@path, @hash, @language, @role)
  `);
  const insertSymbol = db.prepare(`
    insert into symbols(file_id, name, qualified_name, kind, start_line, end_line, parent_symbol_id)
    values (@fileId, @name, @qualifiedName, @kind, @startLine, @endLine, @parentSymbolId)
  `);
  const updateParent = db.prepare("update symbols set parent_symbol_id = @parentId where id = @id");
  const insertChunk = db.prepare(`
    insert into chunks(file_id, symbol_id, start_line, end_line, text)
    values (@fileId, @symbolId, @startLine, @endLine, @text)
  `);
  const insertFts = db.prepare(`
    insert into chunk_fts(chunk_id, text, symbol_name, file_path)
    values (@chunkId, @text, @symbolName, @filePath)
  `);
  const insertEdge = db.prepare(`
    insert into edges(source_symbol_id, target_symbol_id, target_name, kind, confidence)
    values (@sourceSymbolId, @targetSymbolId, @targetName, @kind, @confidence)
  `);

  let symbolCount = 0;
  let chunkCount = 0;
  let edgeCount = 0;

  const transaction = db.transaction(() => {
    for (const extraction of extractions) {
      const fileResult = insertFile.run({
        path: extraction.file.relativePath,
        hash: hashText(extraction.file.text),
        language: extraction.file.language,
        role: extraction.file.role
      });
      const fileId = Number(fileResult.lastInsertRowid);
      const symbolIds = new Map<string, number>();
      const symbolsByParent: Array<{ id: number; symbol: CodeSymbol }> = [];

      for (const symbol of extraction.symbols) {
        const result = insertSymbol.run({
          fileId,
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          kind: symbol.kind,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          parentSymbolId: null
        });
        const id = Number(result.lastInsertRowid);
        symbolIds.set(symbol.qualifiedName, id);
        symbolsByParent.push({ id, symbol });
        symbolCount++;
      }

      for (const { id, symbol } of symbolsByParent) {
        if (symbol.parentSymbolName && symbolIds.has(symbol.parentSymbolName)) {
          updateParent.run({ id, parentId: symbolIds.get(symbol.parentSymbolName) });
        }
      }

      for (const chunk of extraction.chunks) {
        const symbolId = chunk.symbolName ? symbolIds.get(chunk.symbolName) : undefined;
        const result = insertChunk.run({
          fileId,
          symbolId: symbolId ?? null,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text
        });
        const chunkId = Number(result.lastInsertRowid);
        insertFts.run({
          chunkId,
          text: `${chunk.text}\n${searchableText(chunk.text)}\n${searchableText(chunk.symbolName ?? "")}`,
          symbolName: chunk.symbolName ?? "",
          filePath: extraction.file.relativePath
        });
        chunkCount++;
      }

      for (const edge of extraction.edges) {
        insertEdge.run(edgeParams(edge, symbolIds));
        edgeCount++;
      }
    }

    resolveCrossFileConformanceTargets(db);
    edgeCount += insertProtocolImplementationEdges(db);
  });

  transaction();
  return { files: extractions.length, symbols: symbolCount, chunks: chunkCount, edges: edgeCount };
}

function edgeParams(edge: CodeEdge, symbolIds: Map<string, number>) {
  return {
    sourceSymbolId: symbolIds.get(edge.sourceSymbolName) ?? null,
    targetSymbolId: symbolIds.get(edge.targetName) ?? null,
    targetName: edge.targetName,
    kind: edge.kind,
    confidence: edge.confidence
  };
}

function resolveCrossFileConformanceTargets(db: Database.Database): number {
  const edges = db
    .prepare(
      `
      select id, target_name
      from edges
      where kind = 'symbol_conforms_to'
        and target_symbol_id is null
      `
    )
    .all() as Array<{ id: number; target_name: string }>;
  if (edges.length === 0) {
    return 0;
  }

  const targetNames = uniqueValues(edges.map((edge) => edge.target_name));
  const symbolsByName = symbolTargetsByName(db, targetNames);
  const updateEdge = db.prepare("update edges set target_symbol_id = @targetSymbolId where id = @id");
  let resolved = 0;
  for (const edge of edges) {
    const targetSymbolId = symbolsByName.get(edge.target_name);
    if (targetSymbolId !== undefined) {
      updateEdge.run({ id: edge.id, targetSymbolId });
      resolved++;
    }
  }
  return resolved;
}

function symbolTargetsByName(db: Database.Database, targetNames: string[]): Map<string, number> {
  if (targetNames.length === 0) {
    return new Map();
  }
  const params = Object.fromEntries(targetNames.map((targetName, index) => [`target${index}`, targetName]));
  const nameList = targetNames.map((_, index) => `@target${index}`).join(", ");
  const rows = db
    .prepare(
      `
      select id, name, qualified_name
      from symbols
      where name in (${nameList})
         or qualified_name in (${nameList})
      order by id
      `
    )
    .all(params) as Array<{ id: number; name: string; qualified_name: string }>;
  const byName = new Map<string, number>();
  for (const targetName of targetNames) {
    const exact = rows.find((row) => row.qualified_name === targetName);
    const named = rows.find((row) => row.name === targetName);
    const match = exact ?? named;
    if (match) {
      byName.set(targetName, match.id);
    }
  }
  return byName;
}

function insertProtocolImplementationEdges(db: Database.Database): number {
  const result = db
    .prepare(
      `
      insert into edges(source_symbol_id, target_symbol_id, target_name, kind, confidence)
      select implementer_requirement.id,
             protocol_requirement.id,
             protocol_requirement.qualified_name,
             'symbol_conforms_to',
             'name'
      from edges conformance
      join symbols conforming_type on conforming_type.id = conformance.source_symbol_id
      join symbols protocol_type on protocol_type.id = conformance.target_symbol_id
      join symbols protocol_requirement on protocol_requirement.parent_symbol_id = protocol_type.id
      join symbols implementer_requirement
        on implementer_requirement.parent_symbol_id = conforming_type.id
       and implementer_requirement.name = protocol_requirement.name
       and implementer_requirement.kind = protocol_requirement.kind
      where conformance.kind = 'symbol_conforms_to'
        and conforming_type.kind = 'class'
        and protocol_type.kind = 'class'
        and protocol_requirement.kind in ('function', 'method')
        and not exists (
          select 1
          from edges existing
          where existing.source_symbol_id = implementer_requirement.id
            and existing.target_symbol_id = protocol_requirement.id
            and existing.kind = 'symbol_conforms_to'
        )
      `
    )
    .run();
  return result.changes;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function searchableText(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_/.-]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValues<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
