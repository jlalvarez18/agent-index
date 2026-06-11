import Database from "better-sqlite3";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    "class Cache:\n    def get(self, key):\n        return load_value(key)\n\ndef load_value(key):\n    return key\n"
  );
  return root;
}

describe("indexTarget", () => {
  test("writes files, symbols, chunks, edges, and FTS rows into the local index", async () => {
    const root = await fixtureProject();

    const stats = await indexTarget(root);

    expect(stats.indexPath).toBe(path.join(root, ".codeindex", "index.sqlite"));
    expect(stats).toMatchObject({
      files: 1,
      symbols: 4,
      chunks: 4
    });
    expect(stats.edges).toBeGreaterThanOrEqual(4);

    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files").all();
    const symbols = db.prepare("select name, qualified_name, kind from symbols order by id").all();
    const fts = db.prepare("select chunk_id, symbol_name, file_path from chunk_fts").all();
    db.close();

    expect(files).toEqual([{ path: "pkg/cache.py", language: "python" }]);
    expect(symbols).toEqual([
      { name: "pkg/cache.py", qualified_name: "pkg/cache.py", kind: "module" },
      { name: "Cache", qualified_name: "Cache", kind: "class" },
      { name: "get", qualified_name: "Cache.get", kind: "method" },
      { name: "load_value", qualified_name: "load_value", kind: "function" }
    ]);
    expect(fts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol_name: "Cache.get", file_path: "pkg/cache.py" }),
        expect.objectContaining({ symbol_name: "load_value", file_path: "pkg/cache.py" })
      ])
    );
  });

  test("rejects a missing target before creating an index directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-missing-"));
    const missing = path.join(root, "missing-project");

    await expect(indexTarget(missing)).rejects.toThrow("Target does not exist");
    await expect(access(missing)).rejects.toThrow();
  });
});
