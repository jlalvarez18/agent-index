import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { fileClusterSqlForTesting, findFileClusters } from "../../src/core/file-clusters.js";
import { indexTarget } from "../../src/core/indexer.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]

def save_value(key, value):
    semantic_cache = {"saved": value}
    return semantic_cache
`
  );
  await writeFile(
    path.join(root, "pkg", "noise.py"),
    Array.from(
      { length: 30 },
      (_, index) => `def semantic_cache_noise_${index}():\n    return "semantic cache noise"\n`
    ).join("\n")
  );
  await writeFile(
    path.join(root, "tests", "test_cache.py"),
    `def test_load_value():
    assert load_value("x") == "x"
`
  );
  await indexTarget(root);
  return root;
}

describe("findFileClusters", () => {
  test("groups matching symbols into ranked low-token file clusters", async () => {
    const root = await fixtureProject();

    const result = findFileClusters(
      {
        terms: ["load_value", "semantic", "cache"],
        roles: ["source"],
        pathHints: ["pkg/cache.py"]
      },
      { target: root, limit: 3 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "pkg/cache.py",
      role: "source",
      matchedChunks: expect.any(Number)
    });
    expect(result.clusters[0].symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "load_value",
          kind: "function"
        })
      ])
    );
    expect(result.clusters[0].why).toEqual(expect.arrayContaining(["path hint match", "symbol name match", "role match"]));
    expect(result.clusters[0].evidence).toContain("semantic_cache");
    expect(result.clusters[0].evidence?.length).toBeLessThanOrEqual(96);
    expect(result.clusters[0].contextTokens).toBeLessThan(80);
  });

  test("can cluster only test files for test-discovery navigation", async () => {
    const root = await fixtureProject();

    const result = findFileClusters(
      {
        terms: ["load_value", "cache"],
        roles: ["test"]
      },
      { target: root, limit: 3 }
    );

    expect(result.clusters.map((cluster) => cluster.file)).toEqual(["tests/test_cache.py"]);
  });

  test("can treat tokenized structured path hints as hard file-path filters", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-token-path-filter-"));
    await mkdir(path.join(root, "pkg", "algorithms", "tests"), { recursive: true });
    await mkdir(path.join(root, "pkg", "community", "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "algorithms", "tests", "test_cuts.py"),
      `def test_mixing_expansion():
    mixing_expansion_conductance_cut_size = "cuts"
    return mixing_expansion_conductance_cut_size
`
    );
    await writeFile(
      path.join(root, "pkg", "community", "tests", "test_quality.py"),
      `def test_community_expansion():
    mixing_expansion_conductance_cut_size = "community"
    return mixing_expansion_conductance_cut_size
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["mixing_expansion", "conductance", "cut_size"],
        symbolKinds: ["function"],
        roles: ["test"],
        pathHints: ["algorithms cuts"],
        pathMode: "filter"
      },
      { target: root, limit: 5 }
    );

    expect(result.clusters.map((cluster) => cluster.file)).toEqual(["pkg/algorithms/tests/test_cuts.py"]);
  });

  test("uses a path-first query plan for hard file-path filters", () => {
    const queryPlan = fileClusterSqlForTesting({
      terms: ["cursor", "row count", "preserve", "memoize", "closed", "execution option"],
      symbolKinds: ["method", "function"],
      roles: ["source"],
      pathHints: ["lib/sqlalchemy/engine"],
      pathMode: "filter"
    });

    expect(queryPlan.kind).toBe("path-filter");
    expect(queryPlan.sql).not.toContain("chunk_fts match");
    expect(queryPlan.sql).toContain("idx_files_role_path");
  });

  test("uses path hints as an FTS prefilter before broad fallback", () => {
    const queryPlan = fileClusterSqlForTesting({
      terms: ["radius", "neighbors", "sort", "results", "distance", "brute", "float32", "merge"],
      symbolKinds: ["class", "method", "function"],
      roles: ["source"],
      pathHints: ["neighbors", "pairwise distances reduction"]
    });

    expect(queryPlan.kind).toBe("path-hint-prefilter");
    expect(queryPlan.sql).toContain("chunk_fts match");
    expect(queryPlan.sql).toContain("lower(f.path) like");
    expect(queryPlan.fallback?.kind).toBe("fts");
  });

  test("prefers files with broader task-term coverage over repeated partial noise", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-coverage-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "redirects.py"),
      `def preserve_redirect_history(response):
    history = response.history
    return history

def build_manual_next_request(request):
    next_request = request.copy()
    return next_request
`
    );
    await writeFile(
      path.join(root, "pkg", "noise.py"),
      Array.from(
        { length: 24 },
        (_, index) => `def redirect_history_noise_${index}(response):\n    return response.history\n`
      ).join("\n")
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["redirect", "history", "next_request"],
        roles: ["source"]
      },
      { target: root, limit: 2 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "pkg/redirects.py"
    });
    expect(result.clusters[0].why).toContain("broader task-term coverage");
  });

  test("uses file basename task terms to break adapter-method ties", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-path-"));
    await mkdir(path.join(root, "pkg", "contrib"), { recursive: true });
    await mkdir(path.join(root, "pkg", "http"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "contrib", "handlers.py"),
      `class StaticHandler:
    async def get_response_async(self, request):
        return request
`
    );
    await writeFile(
      path.join(root, "pkg", "http", "response.py"),
      `class StreamingResponse:
    async def __aiter__(self):
        yield b""

    def set_streaming_iterator(self, iterator):
        self.iterator = iterator
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["streaming", "async", "iterator", "response"],
        symbolKinds: ["method", "function"],
        roles: ["source"]
      },
      { target: root, limit: 2 }
    );

    expect(result.clusters[0]).toMatchObject({
      file: "pkg/http/response.py"
    });
    expect(result.clusters[0].evidence).toContain("set_streaming_iterator");
    expect(result.clusters[0].why).toContain("file name matches task terms");
  });

  test("retains enough matched symbols for downstream completion scoring", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-symbol-cap-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "backend.py"),
      `class RadiusNeighbors:
    def compute(self):
        return self._finalize_results()

    def _parallel_on_X_prange_iter_finalize(self):
        return self._merge_vectors()

    def _parallel_on_Y_finalize(self):
        return self._merge_vectors()

    def _parallel_on_Y_init(self):
        return self.chunks

    def _parallel_on_X_init(self):
        return self.chunks

    def _merge_vectors(self):
        return []

    def _finalize_results(self):
        return []
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["radius", "neighbors", "sort", "results", "merge", "vectors", "finalize"],
        symbolKinds: ["class", "method"],
        roles: ["source"]
      },
      { target: root, limit: 1 }
    );

    expect(result.clusters[0].symbols.map((symbol) => symbol.name)).toContain("RadiusNeighbors._merge_vectors");
  });

  test("keeps late task-relevant symbols ahead of earlier generic symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-symbol-relevance-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "default.py"),
      `${Array.from({ length: 16 }, (_, index) => `class Generic${index}:\n    def option_${index}(self):\n        return "cursor option"\n`).join("\n")}

class DefaultExecutionContext:
    def _has_rowcount(self):
        return self.cursor.rowcount

    def _setup_result_proxy(self):
        preserve_rowcount = self.execution_options.get("preserve_rowcount")
        return preserve_rowcount
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["cursor", "row count", "preserve", "execution option"],
        symbolKinds: ["method", "function"],
        roles: ["source"],
        pathHints: ["pkg/engine"],
        pathMode: "filter"
      },
      { target: root, limit: 1 }
    );

    expect(result.clusters[0].symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["DefaultExecutionContext._has_rowcount", "DefaultExecutionContext._setup_result_proxy"])
    );
  });

  test("reranks symbols for soft path-hinted clusters so late behavior helpers stay visible", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-file-clusters-soft-symbol-relevance-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "canvas.py"),
      `${Array.from({ length: 18 }, (_, index) => `class Generic${index}:\n    def generic_${index}(self):\n        return "chain group apply_async options canvas"\n`).join("\n")}

def chain_group_apply_async_options(options, tasks):
    return "chain group apply_async options canvas"
`
    );
    await indexTarget(root);

    const result = findFileClusters(
      {
        terms: ["canvas", "chain", "group", "apply_async", "options"],
        symbolKinds: ["class", "method", "function"],
        roles: ["source"],
        pathHints: ["pkg", "canvas"]
      },
      { target: root, limit: 1 }
    );

    expect(result.clusters[0].symbols.map((symbol) => symbol.name)).toContain("chain_group_apply_async_options");
  });
});
