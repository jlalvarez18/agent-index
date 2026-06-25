import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { compareNavigationArtifacts } from "../../src/core/navigation-artifacts.js";
import type { NavigationEvalCaseResult, NavigationSuiteResult, NavigationTaskKind } from "../../src/core/schema.js";

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
    agentToolUseCases: 1,
    agentToolUseSatisfiedRate: 1,
    agentToolUseAvgFirstUsefulLatencyMs: 25,
    agentToolUseAvgCompletionLatencyMs: 45,
    agentToolUseAvgFirstUsefulContextTokens: 30,
    agentToolUseAvgCompletionContextTokens: 90,
    agentIndexAvgCommands: 2,
    rgAvgCommands: 2,
    rgOptimizedAvgCommands: 4,
    agentIndexAvgLatencyMs: 50,
    rgAvgLatencyMs: 20,
    rgOptimizedAvgLatencyMs: 15,
    agentIndexAvgFirstUsefulLatencyMs: 30,
    rgAvgFirstUsefulLatencyMs: 20,
    rgOptimizedAvgFirstUsefulLatencyMs: 15,
    agentIndexAvgContextTokens: 100,
    rgAvgContextTokens: 1000,
    rgOptimizedAvgContextTokens: 300,
    agentIndexAvgFirstUsefulContextTokens: 40,
    rgAvgFirstUsefulContextTokens: 1000,
    rgOptimizedAvgFirstUsefulContextTokens: 150,
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
          agentToolUseCases: 1,
          agentToolUseSatisfiedRate: 1,
          agentToolUseAvgFirstUsefulLatencyMs: 25,
          agentToolUseAvgCompletionLatencyMs: 45,
          agentToolUseAvgFirstUsefulContextTokens: 30,
          agentToolUseAvgCompletionContextTokens: 90,
          agentIndexAvgCommands: 2,
          rgAvgCommands: 2,
          rgOptimizedAvgCommands: 4,
          agentIndexAvgLatencyMs: 50,
          rgAvgLatencyMs: 20,
          rgOptimizedAvgLatencyMs: 15,
          agentIndexAvgFirstUsefulLatencyMs: 30,
          rgAvgFirstUsefulLatencyMs: 20,
          rgOptimizedAvgFirstUsefulLatencyMs: 15,
          agentIndexAvgContextTokens: 100,
          rgAvgContextTokens: 1000,
          rgOptimizedAvgContextTokens: 300,
          agentIndexAvgFirstUsefulContextTokens: 40,
          rgAvgFirstUsefulContextTokens: 1000,
          rgOptimizedAvgFirstUsefulContextTokens: 150,
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

function navigationCaseResult(
  id: string,
  kind: NavigationTaskKind,
  winner: NavigationEvalCaseResult["winner"],
  optimizedRgWinner: NavigationEvalCaseResult["optimizedRgWinner"]
): NavigationEvalCaseResult {
  return {
    id,
    task: id,
    kind,
    expectedFiles: [],
    expectedSymbols: [],
    agentIndex: {} as NavigationEvalCaseResult["agentIndex"],
    rg: {} as NavigationEvalCaseResult["rg"],
    rgOptimized: {} as NavigationEvalCaseResult["rgOptimized"],
    tokenSavings: 0,
    tokenSavingsRatio: null,
    optimizedRgTokenSavings: 0,
    optimizedRgTokenSavingsRatio: null,
    commandSavings: 0,
    optimizedRgCommandSavings: 0,
    winner,
    optimizedRgWinner
  };
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

  test("fails first-useful token regressions", async () => {
    const baseline = await writeSummary(suiteResult());
    const current = await writeSummary(suiteResult({ agentIndexAvgFirstUsefulContextTokens: 50 }));

    await expect(compareNavigationArtifacts(baseline, current, { maxAgentTokenIncreasePercent: 25 })).resolves.toMatchObject({
      passed: true
    });
    await expect(compareNavigationArtifacts(baseline, current, { maxAgentTokenIncrease: 5 })).resolves.toMatchObject({
      passed: false,
      regressions: [
        expect.objectContaining({
          metric: "agentIndexAvgFirstUsefulContextTokens"
        })
      ]
    });
  });

  test("optionally fails latency regressions", async () => {
    const baseline = await writeSummary(suiteResult());
    const current = await writeSummary(suiteResult({ agentIndexAvgLatencyMs: 70 }));

    await expect(compareNavigationArtifacts(baseline, current)).resolves.toMatchObject({
      passed: true
    });
    await expect(compareNavigationArtifacts(baseline, current, { maxAgentLatencyIncreasePercent: 50 })).resolves.toMatchObject({
      passed: true
    });
    await expect(compareNavigationArtifacts(baseline, current, { maxAgentLatencyIncreaseMs: 10 })).resolves.toMatchObject({
      passed: false,
      regressions: [
        expect.objectContaining({
          metric: "agentIndexAvgLatencyMs"
        })
      ]
    });
  });

  test("optionally fails first-useful latency regressions", async () => {
    const baseline = await writeSummary(suiteResult());
    const current = await writeSummary(suiteResult({ agentIndexAvgFirstUsefulLatencyMs: 50 }));

    const result = await compareNavigationArtifacts(baseline, current, { maxAgentLatencyIncreaseMs: 10 });

    expect(result).toMatchObject({
      passed: false,
      regressions: [
        expect.objectContaining({
          metric: "agentIndexAvgFirstUsefulLatencyMs"
        })
      ]
    });
  });

  test("fails agent tool-use regressions and budget increases", async () => {
    const baseline = await writeSummary(suiteResult());
    const current = await writeSummary(
      suiteResult({
        agentToolUseCases: 0,
        agentToolUseSatisfiedRate: 0,
        agentToolUseAvgFirstUsefulContextTokens: 41,
        agentToolUseAvgCompletionContextTokens: 100
      })
    );

    const result = await compareNavigationArtifacts(baseline, current);

    expect(result).toMatchObject({
      passed: false,
      regressions: expect.arrayContaining([
        expect.objectContaining({ metric: "agentToolUseCases" }),
        expect.objectContaining({ metric: "agentToolUseSatisfiedRate" }),
        expect.objectContaining({ metric: "agentToolUseAvgFirstUsefulContextTokens" }),
        expect.objectContaining({ metric: "agentToolUseAvgCompletionContextTokens" })
      ])
    });
  });

  test("requires current artifacts to include fully satisfied agent tool-use cases when requested", async () => {
    const baseline = await writeSummary(suiteResult({ agentToolUseCases: 0, agentToolUseSatisfiedRate: 0 }));
    const noToolUseCurrent = await writeSummary(suiteResult({ agentToolUseCases: 0, agentToolUseSatisfiedRate: 0 }));
    const unsatisfiedCurrent = await writeSummary(suiteResult({ agentToolUseCases: 1, agentToolUseSatisfiedRate: 0.5 }));

    await expect(compareNavigationArtifacts(baseline, noToolUseCurrent, { requireAgentToolUse: true })).resolves.toMatchObject({
      passed: false,
      regressions: [
        expect.objectContaining({
          metric: "agentToolUseCases"
        })
      ]
    });
    await expect(compareNavigationArtifacts(baseline, unsatisfiedCurrent, { requireAgentToolUse: true })).resolves.toMatchObject({
      passed: false,
      regressions: expect.arrayContaining([
        expect.objectContaining({
          metric: "agentToolUseSatisfiedRate"
        })
      ])
    });
  });

  test("optionally requires current artifacts to dominate rg baselines", async () => {
    const weakBaseline = await writeSummary(
      suiteResult({
        agentIndexCompletionRate: 0.5,
        agentIndexWinsVsOptimizedRg: 0,
        agentIndexAvgContextTokens: 500,
        rgOptimizedAvgContextTokens: 250
      })
    );
    const current = await writeSummary(
      suiteResult({
        agentIndexCompletionRate: 0.5,
        rgOptimizedCompletionRate: 1,
        agentIndexWinsVsOptimizedRg: 0,
        agentIndexAvgContextTokens: 500,
        rgOptimizedAvgContextTokens: 250
      })
    );

    await expect(compareNavigationArtifacts(weakBaseline, current)).resolves.toMatchObject({
      passed: true
    });
    await expect(compareNavigationArtifacts(weakBaseline, current, { requireAgentDominance: true })).resolves.toMatchObject({
      passed: false,
      regressions: expect.arrayContaining([
        expect.objectContaining({ metric: "dominance.agentIndexCompletionRate" }),
        expect.objectContaining({ metric: "dominance.agentIndexWinsVsOptimizedRg" }),
        expect.objectContaining({ metric: "dominance.agentIndexAvgContextTokens" })
      ])
    });
  });

  test("agent dominance exempts exact-string audits from win-count requirements", async () => {
    const fixtureRepo = suiteResult().repoResults[0];
    const caseResults = [
      navigationCaseResult("feature-tracing", "feature", "agent-index", "agent-index"),
      navigationCaseResult("diagnostic-code-audit", "exact-string-audit", "rg", "rg-optimized")
    ];
    const artifact = suiteResult({
        cases: 2,
        agentIndexWins: 1,
        rgWins: 1,
        agentIndexWinsVsOptimizedRg: 1,
        rgOptimizedWins: 1,
        repoResults: [
          {
            ...fixtureRepo,
            result: {
              ...fixtureRepo.result,
              cases: 2,
              agentIndexWins: 1,
              rgWins: 1,
              agentIndexWinsVsOptimizedRg: 1,
              rgOptimizedWins: 1,
              caseResults
            }
          }
        ]
      });
    const baseline = await writeSummary(artifact);
    const current = await writeSummary(artifact);

    await expect(compareNavigationArtifacts(baseline, current, { requireAgentDominance: true })).resolves.toMatchObject({
      passed: true
    });
  });

  test("agent dominance still requires non-exact navigation cases to beat optimized rg", async () => {
    const fixtureRepo = suiteResult().repoResults[0];
    const caseResults = [
      navigationCaseResult("feature-tracing", "feature", "agent-index", "rg-optimized"),
      navigationCaseResult("diagnostic-code-audit", "exact-string-audit", "rg", "rg-optimized")
    ];
    const baseline = await writeSummary(suiteResult());
    const current = await writeSummary(
      suiteResult({
        cases: 2,
        agentIndexWins: 1,
        rgWins: 1,
        agentIndexWinsVsOptimizedRg: 0,
        rgOptimizedWins: 2,
        repoResults: [
          {
            ...fixtureRepo,
            result: {
              ...fixtureRepo.result,
              cases: 2,
              agentIndexWins: 1,
              rgWins: 1,
              agentIndexWinsVsOptimizedRg: 0,
              rgOptimizedWins: 2,
              caseResults
            }
          }
        ]
      })
    );

    await expect(compareNavigationArtifacts(baseline, current, { requireAgentDominance: true })).resolves.toMatchObject({
      passed: false,
      regressions: expect.arrayContaining([
        expect.objectContaining({
          metric: "dominance.agentIndexWinsVsOptimizedRg",
          baseline: 1,
          current: 0
        }),
        expect.objectContaining({
          metric: "repo.fixture.dominance.agentIndexWinsVsOptimizedRg",
          baseline: 1,
          current: 0
        })
      ])
    });
  });
});
