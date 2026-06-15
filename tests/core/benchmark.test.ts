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
          agentQuery: {
            terms: ["semantic", "cache", "load"],
            symbolKinds: ["function"],
            pathHints: ["cache"],
            excludeSupportCode: true
          },
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

async function noisyContextProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-benchmark-noisy-context-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  const noise = Array.from(
    { length: 80 },
    (_, index) => `semantic_cache_load_value_noise_${index} = "semantic cache load_value noise"`
  ).join("\n");
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]

${noise}
`
  );
  await indexTarget(root);
  const benchmarkPath = path.join(root, "benchmark.json");
  await writeFile(
    benchmarkPath,
    JSON.stringify([
      {
        id: "semantic-cache-noisy-context",
        question: "where is semantic cache loaded?",
        agentQuery: {
          terms: ["load_value", "semantic", "cache"],
          symbolKinds: ["function"],
          pathHints: ["cache"],
          excludeSupportCode: true,
          expand: []
        },
        expected: {
          files: ["pkg/cache.py"],
          symbols: ["load_value"]
        }
      }
    ])
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
    expect(result.avgContextTokens).toBeGreaterThan(0);
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
      contextChars: expect.any(Number),
      contextTokens: expect.any(Number),
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

  test("can include query debug diagnostics in benchmark matches", async () => {
    const { root, benchmarkPath } = await fixtureProject();

    const result = await runBenchmark(benchmarkPath, { target: root, mode: "hybrid", debug: true });

    expect(result.cases[0].topMatches[0]).toMatchObject({
      symbol: "load_value",
      debug: {
        candidateSources: expect.arrayContaining(["fts"]),
        ftsPosition: expect.any(Number),
        hybrid: {
          adjustedScore: expect.any(Number),
          lexicalBoost: expect.any(Number),
          specificityBoost: expect.any(Number),
          containerAdjustment: expect.any(Number)
        }
      }
    });
  });

  test("can benchmark structured agent queries and include an rg-style lexical file baseline", async () => {
    const { root, benchmarkPath } = await fixtureProject();

    const result = await runBenchmark(benchmarkPath, {
      target: root,
      mode: "hybrid",
      queryStyle: "agent",
      includeRgBaseline: true
    });

    expect(result.queryStyle).toBe("agent");
    expect(result.cases[0]).toMatchObject({
      id: "semantic-cache",
      symbolRank: 1,
      fileRank: 1
    });
    expect(result.rgBaseline).toMatchObject({
      baselineKind: "lexical",
      questions: 2,
      fileHitAt1: 1,
      fileHitAt5: 1,
      avgContextTokens: expect.any(Number)
    });
    expect(result.rgBaseline?.cases[0].topFiles[0]).toMatchObject({
      file: "pkg/cache.py",
      rank: 1
    });
  });

  test("can measure context-token savings against the lexical baseline", async () => {
    const { root, benchmarkPath } = await noisyContextProject();

    const result = await runBenchmark(benchmarkPath, {
      target: root,
      mode: "hybrid",
      queryStyle: "agent",
      includeRgBaseline: true
    });

    expect(result.cases[0]).toMatchObject({
      symbolRank: 1,
      fileRank: 1
    });
    expect(result.rgBaseline?.cases[0]).toMatchObject({
      fileRank: 1,
      matchedLineCount: expect.any(Number),
      contextTokens: expect.any(Number)
    });
    expect(result.cases[0].contextTokens).toBeLessThan(result.rgBaseline?.cases[0].contextTokens ?? 0);
  });

  test("can run a real rg command baseline with context-token metrics", async () => {
    const { root, benchmarkPath } = await noisyContextProject();

    const result = await runBenchmark(benchmarkPath, {
      target: root,
      mode: "hybrid",
      queryStyle: "agent",
      includeRgBaseline: true,
      rgBaselineKind: "command"
    });

    expect(result.rgBaseline).toMatchObject({
      baselineKind: "command",
      questions: 1,
      avgContextTokens: expect.any(Number)
    });
    expect(result.rgBaseline?.cases[0]).toMatchObject({
      command: expect.stringContaining("load_value"),
      exitCode: 0,
      matchedLineCount: expect.any(Number),
      contextTokens: expect.any(Number)
    });
    expect(result.cases[0].contextTokens).toBeLessThan(result.rgBaseline?.cases[0].contextTokens ?? 0);
  });
});
