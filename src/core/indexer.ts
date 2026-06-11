import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { stat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { extractPython } from "./extractors/python.js";
import { scanPythonFiles } from "./scanner.js";
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
    const files = await scanPythonFiles(root, { includeSupportCode: options.includeSupportCode });
    const extractions = files.map(extractPython);
    const stats = writeExtractions(db, extractions);
    return { ...stats, indexPath };
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
      language text not null
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

    create virtual table chunk_fts using fts5(
      chunk_id unindexed,
      text,
      symbol_name,
      file_path
    );
  `);
}

function writeExtractions(db: Database.Database, extractions: ExtractionResult[]): Omit<IndexStats, "indexPath"> {
  const insertFile = db.prepare(`
    insert into files(path, hash, language)
    values (@path, @hash, @language)
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
        language: extraction.file.language
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
