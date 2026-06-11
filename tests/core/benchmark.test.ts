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

    expect(result.mode).toBe("symbol");
    expect(result.questions).toBe(2);
    expect(result.symbolHitAt1).toBe(0.5);
    expect(result.symbolHitAt5).toBe(0.5);
    expect(result.symbolMrr).toBe(0.5);
    expect(result.fileHitAt1).toBe(1);
    expect(result.fileHitAt5).toBe(1);
    expect(result.fileMrr).toBe(1);
    expect(result.partialFileHits).toBe(0.5);
    expect(result.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0]).toMatchObject({
      id: "semantic-cache",
      question: "where is semantic cache loaded?",
      expectedSymbols: ["load_value"],
      expectedFiles: ["pkg/cache.py"],
      symbolRank: 1,
      fileRank: 1,
      symbolHitAt1: true,
      symbolHitAt5: true,
      symbolReciprocalRank: 1,
      fileHitAt1: true,
      fileHitAt5: true,
      fileReciprocalRank: 1,
      partialFileHit: false,
      topMatches: expect.arrayContaining([
        expect.objectContaining({
          symbol: "load_value",
          file: "pkg/cache.py",
          rank: 1
        })
      ])
    });
    expect(result.cases[1]).toMatchObject({
      id: "file-only",
      symbolRank: null,
      fileRank: 1,
      symbolHitAt1: false,
      symbolHitAt5: false,
      symbolReciprocalRank: 0,
      fileHitAt1: true,
      fileHitAt5: true,
      fileReciprocalRank: 1,
      partialFileHit: true
    });
  });

  test("can run the plain FTS benchmark mode", async () => {
    const { root, benchmarkPath } = await fixtureProject();

    const result = await runBenchmark(benchmarkPath, { target: root, mode: "fts" });

    expect(result.mode).toBe("fts");
    expect(result.questions).toBe(2);
    expect(result.cases[0].firstMatch?.why).toEqual(["plain FTS match"]);
  });

  test("can run the hybrid benchmark mode", async () => {
    const { root, benchmarkPath } = await fixtureProject();

    const result = await runBenchmark(benchmarkPath, { target: root, mode: "hybrid" });

    expect(result.mode).toBe("hybrid");
    expect(result.questions).toBe(2);
  });
});
