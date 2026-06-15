import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { compareNavigationArtifacts } from "../../src/core/navigation-artifacts.js";
import type { NavigationSuiteResult } from "../../src/core/schema.js";

function suiteResult(overrides: Partial<NavigationSuiteResult> = {}): NavigationSuiteResult {
  const result: NavigationSuiteResult = {
    repos: 1,
    cases: 2,
    agentIndexUsefulRate: 1,
    rgUsefulRate: 1,
    rgOptimizedUsefulRate: 1,
    agentIndexCompletionRate: 1,
    rgCompletionRate: 0.5,
    rgOptimizedCompletionRate: 0,
    agentIndexAvgCommands: 2,
    rgAvgCommands: 2,
    rgOptimizedAvgCommands: 4,
    agentIndexAvgLatencyMs: 50,
    rgAvgLatencyMs: 20,
    rgOptimizedAvgLatencyMs: 15,
    agentIndexAvgContextTokens: 100,
    rgAvgContextTokens: 1000,
    rgOptimizedAvgContextTokens: 300,
    avgTokenSavings: 900,
    avgOptimizedRgTokenSavings: 200,
    agentIndexWins: 2,
    rgWins: 0,
    ties: 0,
    inconclusive: 0,
    agentIndexWinsVsOptimizedRg: 2,
    rgOptimizedWins: 0,
    optimizedRgTies: 0,
    optimizedRgInconclusive: 0,
    repoResults: [
      {
        name: "fixture",
        evalPath: "/tmp/eval.json",
        target: "/tmp/repo",
        mode: "hybrid",
        result: {
          cases: 2,
          agentIndexUsefulRate: 1,
          rgUsefulRate: 1,
          rgOptimizedUsefulRate: 1,
          agentIndexCompletionRate: 1,
          rgCompletionRate: 0.5,
          rgOptimizedCompletionRate: 0,
          agentIndexAvgCommands: 2,
          rgAvgCommands: 2,
          rgOptimizedAvgCommands: 4,
          agentIndexAvgLatencyMs: 50,
          rgAvgLatencyMs: 20,
          rgOptimizedAvgLatencyMs: 15,
          agentIndexAvgContextTokens: 100,
          rgAvgContextTokens: 1000,
          rgOptimizedAvgContextTokens: 300,
          avgTokenSavings: 900,
          avgOptimizedRgTokenSavings: 200,
          agentIndexWins: 2,
          rgWins: 0,
          ties: 0,
          inconclusive: 0,
          agentIndexWinsVsOptimizedRg: 2,
          rgOptimizedWins: 0,
          optimizedRgTies: 0,
          optimizedRgInconclusive: 0,
          caseResults: []
        }
      }
    ]
  };
  return { ...result, ...overrides };
}

async function writeSummary(result: NavigationSuiteResult): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-nav-artifact-"));
  await mkdir(path.join(root, "repos"));
  await writeFile(path.join(root, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
  return root;
}

describe("compareNavigationArtifacts", () => {
  test("passes when current artifact preserves completion, wins, and token budget", async () => {
    const baseline = await writeSummary(suiteResult());
    const current = await writeSummary(suiteResult());

    const result = await compareNavigationArtifacts(baseline, current);

    expect(result).toMatchObject({
      passed: true,
      regressions: []
    });
  });

  test("reports completion and win regressions", async () => {
    const baseline = await writeSummary(suiteResult());
    const current = await writeSummary(
      suiteResult({
        agentIndexCompletionRate: 0.5,
        agentIndexWinsVsOptimizedRg: 1
      })
    );

    const result = await compareNavigationArtifacts(baseline, current);

    expect(result.passed).toBe(false);
    expect(result.regressions.map((regression) => regression.metric)).toEqual(
      expect.arrayContaining(["agentIndexCompletionRate", "agentIndexWinsVsOptimizedRg"])
    );
  });

  test("allows bounded token increases and fails larger regressions", async () => {
    const baseline = await writeSummary(suiteResult());
    const current = await writeSummary(suiteResult({ agentIndexAvgContextTokens: 112 }));

    await expect(compareNavigationArtifacts(baseline, current, { maxAgentTokenIncreasePercent: 15 })).resolves.toMatchObject({
      passed: true
    });
    await expect(compareNavigationArtifacts(baseline, current, { maxAgentTokenIncrease: 5 })).resolves.toMatchObject({
      passed: false,
      regressions: [
        expect.objectContaining({
          metric: "agentIndexAvgContextTokens"
        })
      ]
    });
  });
});
