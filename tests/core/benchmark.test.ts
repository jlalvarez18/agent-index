import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { runBenchmark } from "../../src/core/benchmark.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-benchmark-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  await indexTarget(root);
  const benchmarkPath = path.join(root, "benchmark.json");
  await writeFile(
    benchmarkPath,
    JSON.stringify(
      [
        {
          id: "semantic-cache",
          question: "where is semantic cache loaded?",
          expected: {
            files: ["pkg/cache.py"],
            symbols: ["load_value"]
          }
        },
        {
          id: "file-only",
          question: "where is cache code?",
          expected: {
            files: ["pkg/cache.py"],
            symbols: ["missing_symbol"]
          }
        }
      ],
      null,
      2
    )
  );
  return { root, benchmarkPath };
}

describe("runBenchmark", () => {
  test("computes hit rates, MRR, partial file hits, and latency", async () => {
    const { root, benchmarkPath } = await fixtureProject();

    const result = await runBenchmark(benchmarkPath, { target: root });

    expect(result.questions).toBe(2);
    expect(result.hitAt1).toBe(1);
    expect(result.hitAt5).toBe(1);
    expect(result.mrr).toBe(1);
    expect(result.partialFileHits).toBe(0.5);
    expect(result.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0]).toMatchObject({
      id: "semantic-cache",
      hitAt1: true,
      hitAt5: true,
      reciprocalRank: 1,
      partialFileHit: false
    });
    expect(result.cases[1]).toMatchObject({
      id: "file-only",
      hitAt1: true,
      hitAt5: true,
      reciprocalRank: 1,
      partialFileHit: true
    });
  });
});
