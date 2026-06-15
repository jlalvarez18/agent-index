import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { runNavigationEval } from "../../src/core/navigation-eval.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]

${Array.from(
  { length: 80 },
  (_, index) => `semantic_cache_noise_${index} = "semantic cache load_value noise"`
).join("\n")}
`
  );
  await writeFile(
    path.join(root, "tests", "test_cache.py"),
    `def test_load_value():
    assert load_value("x") == "x"
`
  );
  await indexTarget(root);

  const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-file-"));
  const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
  await writeFile(
    navigationEvalPath,
    JSON.stringify(
      [
        {
          id: "semantic-cache-bugfix",
          task: "Fix semantic cache loading so the useful implementation location is found before noisy constants.",
          kind: "bugfix",
          agentIndexQueries: [
            {
              terms: ["load_value", "semantic", "cache"],
              symbolKinds: ["function"],
              roles: ["source"],
              pathHints: ["pkg/cache.py"],
              expand: []
            }
          ],
          rgQueries: [["load_value", "semantic", "cache"]],
          expected: {
            files: ["pkg/cache.py"],
            symbols: ["load_value"]
          }
        }
      ],
      null,
      2
    )
  );

  return { root, navigationEvalPath };
}

describe("runNavigationEval", () => {
  test("compares compact agent-index navigation against real rg output", async () => {
    const { root, navigationEvalPath } = await fixtureProject();

    const result = await runNavigationEval(navigationEvalPath, {
      target: root,
      mode: "hybrid"
    });

    expect(result).toMatchObject({
      cases: 1,
      agentIndexUsefulRate: 1,
      rgUsefulRate: 1,
      agentIndexWins: 1,
      rgWins: 0
    });
    expect(result.agentIndexAvgContextTokens).toBeLessThan(result.rgAvgContextTokens);
    expect(result.caseResults[0]).toMatchObject({
      id: "semantic-cache-bugfix",
      winner: "agent-index",
      agentIndex: {
        commands: 1,
        foundUseful: true,
        taskComplete: true,
        foundFiles: ["pkg/cache.py"],
        foundSymbols: ["load_value"],
        missingFiles: [],
        missingSymbols: [],
        firstUsefulCommand: 1,
        firstUsefulRank: 1
      },
      rg: {
        commands: 1,
        foundUseful: true,
        taskComplete: true,
        firstUsefulCommand: 1
      }
    });
    expect(result.caseResults[0].tokenSavings).toBeGreaterThan(0);
  });

  test("can evaluate multi-tool agent workflows with file clusters and related tests", async () => {
    const { root } = await fixtureProject();
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-steps-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "semantic-cache-map-then-tests",
            task: "Map the semantic cache source file, then find related tests.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "file-clusters",
                query: {
                  terms: ["load_value", "semantic", "cache"],
                  roles: ["source"],
                  pathHints: ["pkg/cache.py"]
                },
                limit: 3
              },
              {
                type: "related-tests",
                sourceFromStep: 1,
                symbol: "load_value",
                limit: 3
              }
            ],
            rgQueries: [
              ["load_value", "semantic", "cache"],
              ["load_value", "test"]
            ],
            expected: {
              files: ["pkg/cache.py", "tests/test_cache.py"],
              symbols: ["load_value"]
            }
          }
        ],
        null,
        2
      )
    );

    const result = await runNavigationEval(navigationEvalPath, {
      target: root,
      mode: "hybrid"
    });

    expect(result.caseResults[0]).toMatchObject({
      id: "semantic-cache-map-then-tests",
      agentIndex: {
        commands: 2,
        foundUseful: true,
        taskComplete: true,
        foundFiles: ["pkg/cache.py", "tests/test_cache.py"],
        foundSymbols: ["load_value"],
        firstUsefulCommand: 1,
        firstUsefulRank: 1
      }
    });
    expect(result.caseResults[0].agentIndex.steps.map((step) => step.type)).toEqual(["file-clusters", "related-tests"]);
    expect(result.caseResults[0].agentIndex.steps[1]).toMatchObject({
      command: "agent-index related-tests --source step:1 --symbol load_value",
      usefulRank: 1,
      usefulFile: "tests/test_cache.py"
    });
    expect(result.caseResults[0].agentIndex.contextTokens).toBeLessThan(result.caseResults[0].rg.contextTokens);
  });
});
