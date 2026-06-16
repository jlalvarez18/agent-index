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
    const files = db.prepare("select path, language, role from files").all();
    const symbols = db.prepare("select name, qualified_name, kind from symbols order by id").all();
    const fts = db.prepare("select chunk_id, symbol_name, file_path from chunk_fts").all();
    const indexes = db
      .prepare("select name from sqlite_master where type = 'index' and name like 'idx_%' order by name")
      .all()
      .map((row) => (row as { name: string }).name);
    db.close();

    expect(files).toEqual([{ path: "pkg/cache.py", language: "python", role: "source" }]);
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
    expect(indexes).toEqual([
      "idx_chunks_file_id",
      "idx_edges_source_kind_target",
      "idx_edges_source_symbol_id",
      "idx_files_role",
      "idx_files_role_path",
      "idx_symbols_file_id",
      "idx_symbols_file_kind_qualified"
    ]);
  });

  test("writes file roles into the local index", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-roles-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(path.join(root, "examples"), { recursive: true });
    await mkdir(path.join(root, "fixtures"), { recursive: true });
    await mkdir(path.join(root, "tools"), { recursive: true });
    await mkdir(path.join(root, "benchmarks"), { recursive: true });
    await mkdir(path.join(root, "t", "unit"), { recursive: true });
    await writeFile(path.join(root, "pkg", "service.py"), "def source_symbol():\n    return 1\n");
    await writeFile(path.join(root, "tests", "test_service.py"), "def test_symbol():\n    return 1\n");
    await writeFile(path.join(root, "docs", "snippet.py"), "def docs_symbol():\n    return 1\n");
    await writeFile(path.join(root, "examples", "demo.py"), "def example_symbol():\n    return 1\n");
    await writeFile(path.join(root, "fixtures", "data.py"), "def fixture_symbol():\n    return 1\n");
    await writeFile(path.join(root, "tools", "gen.py"), "def tool_symbol():\n    return 1\n");
    await writeFile(path.join(root, "benchmarks", "bench.py"), "def benchmark_symbol():\n    return 1\n");
    await writeFile(path.join(root, "t", "unit", "test_tasks.py"), "def celery_test_symbol():\n    return 1\n");

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, role from files order by path").all();
    db.close();

    expect(files).toEqual([
      { path: "benchmarks/bench.py", role: "benchmark" },
      { path: "docs/snippet.py", role: "docs" },
      { path: "examples/demo.py", role: "example" },
      { path: "fixtures/data.py", role: "fixture" },
      { path: "pkg/service.py", role: "source" },
      { path: "t/unit/test_tasks.py", role: "test" },
      { path: "tests/test_service.py", role: "test" },
      { path: "tools/gen.py", role: "tool" }
    ]);
  });

  test("indexes Rust source files alongside Python files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-rust-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "pydantic-core", "src", "serializers"), { recursive: true });
    await writeFile(path.join(root, "pkg", "main.py"), "def model_dump_json():\n    return 'json'\n");
    await writeFile(
      path.join(root, "pydantic-core", "src", "serializers", "computed_fields.rs"),
      `pub struct ComputedFields {}

impl ComputedFields {
    pub fn serialize(&self) {
        exclude_computed_fields();
    }
}
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("pydantic-core/src/serializers/computed_fields.rs");
    db.close();

    expect(files).toEqual([
      { path: "pkg/main.py", language: "python" },
      { path: "pydantic-core/src/serializers/computed_fields.rs", language: "rust" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "ComputedFields", kind: "class" },
        { qualified_name: "ComputedFields.serialize", kind: "method" }
      ])
    );
  });

  test("indexes Cython template source files alongside Python files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-cython-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "sklearn", "metrics", "_pairwise_distances_reduction"), { recursive: true });
    await writeFile(path.join(root, "pkg", "main.py"), "def radius_neighbors():\n    return 'python api'\n");
    await writeFile(
      path.join(root, "sklearn", "metrics", "_pairwise_distances_reduction", "_radius_neighbors.pyx.tp"),
      `cdef class RadiusNeighbors{{name_suffix}}:
    def compute(self, sort_results=False):
        return self._finalize_results()

    def _finalize_results(self):
        return []
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp");
    db.close();

    expect(files).toEqual([
      { path: "pkg/main.py", language: "python" },
      { path: "sklearn/metrics/_pairwise_distances_reduction/_radius_neighbors.pyx.tp", language: "cython" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "RadiusNeighbors", kind: "class" },
        { qualified_name: "RadiusNeighbors.compute", kind: "method" },
        { qualified_name: "RadiusNeighbors._finalize_results", kind: "method" }
      ])
    );
  });

  test("indexes TypeScript, TSX, and JavaScript family files alongside Python files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-typescript-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "src", "views"), { recursive: true });
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(path.join(root, "pkg", "main.py"), "def dashboard():\n    return 'python api'\n");
    await writeFile(
      path.join(root, "src", "views", "DashboardScreen.tsx"),
      `import { invoke } from "@tauri-apps/api/core";

export const DashboardScreen = () => {
  invoke("get_roadmap");
  return null;
};
`
    );
    await writeFile(
      path.join(root, "src", "lib", "client.mjs"),
      `export const apiClient = {
  async listPayments(params) {
    return fetch("/payments", { params });
  }
};
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language from files order by path").all();
    const symbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("src/views/DashboardScreen.tsx");
    const jsSymbols = db
      .prepare("select qualified_name, kind from symbols where file_id = (select id from files where path = ?) order by id")
      .all("src/lib/client.mjs");
    const edges = db
      .prepare("select target_name, kind from edges where source_symbol_id is not null order by target_name")
      .all();
    db.close();

    expect(files).toEqual([
      { path: "pkg/main.py", language: "python" },
      { path: "src/lib/client.mjs", language: "javascript" },
      { path: "src/views/DashboardScreen.tsx", language: "typescript" }
    ]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "src/views/DashboardScreen.tsx", kind: "module" },
        { qualified_name: "DashboardScreen", kind: "function" }
      ])
    );
    expect(jsSymbols).toEqual(
      expect.arrayContaining([
        { qualified_name: "src/lib/client.mjs", kind: "module" },
        { qualified_name: "apiClient", kind: "class" },
        { qualified_name: "apiClient.listPayments", kind: "method" }
      ])
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        { target_name: "@tauri-apps/api/core", kind: "symbol_imports_module" },
        { target_name: "invoke", kind: "symbol_calls_name" }
      ])
    );
  });

  test("indexes JSON config and diagnostic files as module chunks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-indexer-json-"));
    await mkdir(path.join(root, "src", "compiler"), { recursive: true });
    await writeFile(
      path.join(root, "src", "compiler", "diagnosticMessages.json"),
      `{
  "Cannot_find_name_0": {
    "code": 2304,
    "key": "TS2304"
  }
}
`
    );

    const stats = await indexTarget(root);
    const db = new Database(stats.indexPath);
    const files = db.prepare("select path, language, role from files order by path").all();
    const symbols = db.prepare("select qualified_name, kind from symbols order by id").all();
    const fts = db.prepare("select symbol_name, file_path from chunk_fts").all();
    db.close();

    expect(files).toEqual([{ path: "src/compiler/diagnosticMessages.json", language: "json", role: "source" }]);
    expect(symbols).toEqual([{ qualified_name: "src/compiler/diagnosticMessages.json", kind: "module" }]);
    expect(fts).toEqual([
      {
        symbol_name: "src/compiler/diagnosticMessages.json",
        file_path: "src/compiler/diagnosticMessages.json"
      }
    ]);
  });

  test("rejects a missing target before creating an index directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-missing-"));
    const missing = path.join(root, "missing-project");

    await expect(indexTarget(missing)).rejects.toThrow("Target does not exist");
    await expect(access(missing)).rejects.toThrow();
  });
});
