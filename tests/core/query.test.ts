import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { queryIndex } from "../../src/core/query.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `class Cache:
    def get(self, key):
        return load_value(key)

def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  return root;
}

describe("queryIndex", () => {
  test("returns the expected symbol in top results with line citations and nearby edges", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const result = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5 });

    expect(result.query).toBe("where is semantic cache loaded?");
    expect(result.matches[0]).toMatchObject({
      symbol: "load_value",
      kind: "function",
      file: "pkg/cache.py",
      lines: [5, 7]
    });
    expect(result.matches[0].score).toBeGreaterThan(0);
    expect(result.matches[0].why).toEqual(expect.arrayContaining(["matched source text"]));
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "called_by_name",
          symbol: "Cache.get"
        })
      ])
    );
  });

  test("can return plain FTS results without symbol boosts or graph expansion", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const result = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "fts" });

    expect(result.mode).toBe("fts");
    expect(result.matches[0].why).toEqual(["plain FTS match"]);
    expect(result.matches[0].neighbors).toEqual([]);
  });

  test("hybrid mode preserves the FTS top-five set while adding graph context", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const fts = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "fts" });
    const hybrid = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "hybrid" });

    expect(hybrid.mode).toBe("hybrid");
    expect(hybrid.matches.map((match) => match.symbol).sort()).toEqual(
      fts.matches.map((match) => match.symbol).sort()
    );
    expect(hybrid.matches.some((match) => match.neighbors.length > 0)).toBe(true);
    expect(hybrid.matches[0].why).toContain("matched source text");
  });

  test("hybrid mode can add an entrypoint intent candidate outside plain FTS matches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-entrypoint-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "__main__.py"),
      `def main():
    return run_app()

def run_app():
    return "ok"
`
    );
    await writeFile(
      path.join(root, "pkg", "notes.py"),
      `def describe_command_line_entrypoint():
    command_line_entrypoint_notes = "documentation only"
    return command_line_entrypoint_notes
`
    );
    await indexTarget(root);

    const fts = await queryIndex("where is the command line entrypoint?", {
      target: root,
      limit: 5,
      mode: "fts"
    });
    const hybrid = await queryIndex("where is the command line entrypoint?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(fts.matches[0].symbol).toBe("describe_command_line_entrypoint");
    expect(hybrid.matches[0]).toMatchObject({
      symbol: "main",
      file: "pkg/__main__.py"
    });
    expect(hybrid.matches[0].why).toContain("entrypoint intent match");
  });

  test("hybrid mode boosts high-signal implementation intents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-intents-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "export.py"),
      `def to_json(graph):
    return graph.to_json()
`
    );
    await writeFile(
      path.join(root, "pkg", "report.py"),
      `def generate():
    return "report"
`
    );
    await writeFile(
      path.join(root, "pkg", "cluster.py"),
      `def cluster_communities(graph):
    return graph
`
    );
    await writeFile(
      path.join(root, "pkg", "serve.py"),
      `def serve():
    return "mcp"
`
    );
    await writeFile(
      path.join(root, "pkg", "notes.py"),
      `def graph_json_export_notes():
    return "graph json export notes"

def report_generation_notes():
    return "report generation notes"

def community_detection_notes():
    return "community detection notes"

def mcp_server_notes():
    return "mcp server notes"
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where is graph json export handled?", "to_json");
    await expectTopHybridSymbol(root, "where is report generation?", "generate");
    await expectTopHybridSymbol(root, "where is community detection?", "cluster_communities");
    await expectTopHybridSymbol(root, "where is mcp server?", "serve");
  });
});

async function expectTopHybridSymbol(root: string, question: string, symbol: string): Promise<void> {
  const result = await queryIndex(question, { target: root, limit: 5, mode: "hybrid" });

  expect(result.matches[0].symbol).toBe(symbol);
  expect(result.matches[0].why).toContain("query intent match");
}
