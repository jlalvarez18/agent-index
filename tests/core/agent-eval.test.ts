import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runAgentEval, scoreGraphifyMentions } from "../../src/core/agent-eval.js";
import { indexTarget } from "../../src/core/indexer.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-eval-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]

def helper_value(key):
    return key
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

  const graphifyResultsPath = path.join(root, "graphify-results.json");
  await writeFile(
    graphifyResultsPath,
    JSON.stringify(
      [
        {
          id: "semantic-cache",
          text: "NODE load_value() [src=pkg/cache.py loc=L1]"
        },
        {
          id: "file-only",
          text: "NODE cache.py [src=pkg/cache.py loc=L1]"
        }
      ],
      null,
      2
    )
  );

  return { root, benchmarkPath, graphifyResultsPath };
}

describe("agent eval", () => {
  test("scores expected file and symbol mentions in Graphify query text", () => {
    const result = scoreGraphifyMentions(
      {
        id: "semantic-cache",
        question: "where is semantic cache loaded?",
        expected: {
          files: ["pkg/cache.py"],
          symbols: ["load_value"]
        }
      },
      "NODE load_value() [src=pkg/cache.py loc=L1]"
    );

    expect(result).toMatchObject({
      id: "semantic-cache",
      symbolMention: true,
      fileMention: true
    });
  });

  test("runs agent-index benchmark and compares Graphify mention results", async () => {
    const { root, benchmarkPath, graphifyResultsPath } = await fixtureProject();

    const result = await runAgentEval(benchmarkPath, {
      target: root,
      graphifyResultsPath
    });

    expect(result.questions).toBe(2);
    expect(result.agentIndex.symbolHitAt1).toBe(0.5);
    expect(result.graphify?.symbolMentionRate).toBe(0.5);
    expect(result.graphify?.fileMentionRate).toBe(1);
    expect(result.cases[0]).toMatchObject({
      id: "semantic-cache",
      agentIndexSymbolRank: 1,
      graphifySymbolMention: true,
      winner: "tie"
    });
    expect(result.cases[1]).toMatchObject({
      id: "file-only",
      agentIndexSymbolRank: null,
      graphifySymbolMention: false,
      graphifyFileMention: true,
      winner: "inconclusive"
    });
  });
});
