import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { runNavigationSuite } from "../../src/core/navigation-suite.js";

async function fixtureSuite() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-repo-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  const index = await indexTarget(root);
  const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-eval-"));
  const evalPath = path.join(evalRoot, "navigation-eval.json");
  await writeFile(
    evalPath,
    JSON.stringify([
      {
        id: "semantic-cache",
        task: "Find semantic cache implementation.",
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
          }
        ],
        rgQueries: [["load_value", "semantic", "cache"]],
        expected: {
          files: ["pkg/cache.py"],
          symbols: ["load_value"],
          requiredFiles: ["pkg/cache.py"],
          requiredSymbols: ["load_value"]
        }
      }
    ])
  );
  const manifestPath = path.join(evalRoot, "suite.json");
  await writeFile(
    manifestPath,
    JSON.stringify([
      {
        name: "fixture",
        evalPath: path.basename(evalPath),
        target: root,
        indexPath: index.indexPath,
        mode: "hybrid"
      }
    ])
  );
  return manifestPath;
}

async function fixtureSuiteWithoutIndex() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-reindex-repos-"));
  const root = path.join(repoRoot, "fixture-repo");
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-reindex-eval-"));
  const evalPath = path.join(evalRoot, "navigation-eval.json");
  const indexPath = path.join(evalRoot, "index.sqlite");
  await writeFile(
    evalPath,
    JSON.stringify([
      {
        id: "semantic-cache",
        task: "Find semantic cache implementation.",
        kind: "bugfix",
        agentIndexQueries: [
          {
            terms: ["load_value", "semantic", "cache"],
            roles: ["source"],
            pathHints: ["pkg/cache.py"]
          }
        ],
        rgQueries: [["load_value", "semantic", "cache"]],
        expected: {
          files: ["pkg/cache.py"],
          symbols: ["load_value"]
        }
      }
    ])
  );
  const manifestPath = path.join(evalRoot, "suite.json");
  await writeFile(
    manifestPath,
    JSON.stringify([
      {
        name: "fixture",
        evalPath: path.basename(evalPath),
        target: "fixture-repo",
        mode: "hybrid"
      }
    ])
  );
  return { manifestPath, repoRoot, indexRoot: evalRoot, indexPath };
}

describe("runNavigationSuite", () => {
  test("aggregates multi-repository navigation metrics from a manifest", async () => {
    const manifestPath = await fixtureSuite();

    const result = await runNavigationSuite(manifestPath);

    expect(result).toMatchObject({
      repos: 1,
      cases: 1,
      agentIndexUsefulRate: 1,
      rgUsefulRate: 1,
      agentIndexCompletionRate: 1,
      rgCompletionRate: 1,
      agentIndexWins: 1,
      rgWins: 0
    });
    expect(result.agentIndexAvgContextTokens).toBeLessThan(result.rgAvgContextTokens);
    expect(result.repoResults[0]).toMatchObject({
      name: "fixture",
      result: {
        cases: 1
      }
    });
  });

  test("can rebuild suite indexes before evaluating repositories", async () => {
    const { manifestPath, repoRoot, indexRoot, indexPath } = await fixtureSuiteWithoutIndex();

    const result = await runNavigationSuite(manifestPath, { reindex: true, repoRoot, indexRoot });

    expect(result.repoResults[0].indexStats).toMatchObject({
      files: 1,
      symbols: expect.any(Number),
      chunks: expect.any(Number)
    });
    expect(result.repoResults[0].target).toBe(path.join(repoRoot, "fixture-repo"));
    expect(result.repoResults[0].indexPath).toBe(path.join(indexRoot, "fixture.sqlite"));
    expect(result.repoResults[0].indexPath).not.toBe(indexPath);
    expect(result).toMatchObject({
      cases: 1,
      agentIndexCompletionRate: 1
    });
  });

  test("writes summary and per-repository JSON artifacts", async () => {
    const manifestPath = await fixtureSuite();
    const artifactsDir = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-artifacts-"));

    const result = await runNavigationSuite(manifestPath, { artifactsDir });
    const summary = JSON.parse(await readFile(path.join(artifactsDir, "summary.json"), "utf8"));
    const repo = JSON.parse(await readFile(path.join(artifactsDir, "repos", "fixture.json"), "utf8"));

    expect(summary).toMatchObject({
      repos: 1,
      cases: 1,
      agentIndexCompletionRate: result.agentIndexCompletionRate,
      repoResults: [
        {
          name: "fixture",
          result: {
            cases: 1,
            caseResults: [
              {
                id: "semantic-cache",
                winner: "agent-index"
              }
            ]
          }
        }
      ]
    });
    expect(repo).toMatchObject({
      name: "fixture",
      result: {
        cases: 1,
        caseResults: [
          {
            id: "semantic-cache",
            agentIndex: {
              taskComplete: true
            }
          }
        ]
      }
    });
  });
});
