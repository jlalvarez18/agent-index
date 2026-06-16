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
      agentIndexAvgFirstUsefulLatencyMs: expect.any(Number),
      rgAvgFirstUsefulLatencyMs: expect.any(Number),
      rgOptimizedAvgFirstUsefulLatencyMs: expect.any(Number),
      agentIndexAvgCompletionLatencyMs: expect.any(Number),
      rgAvgCompletionLatencyMs: expect.any(Number),
      rgOptimizedAvgCompletionLatencyMs: expect.any(Number),
      agentIndexAvgFirstUsefulContextTokens: expect.any(Number),
      rgAvgFirstUsefulContextTokens: expect.any(Number),
      rgOptimizedAvgFirstUsefulContextTokens: expect.any(Number),
      agentIndexAvgCompletionContextTokens: expect.any(Number),
      rgAvgCompletionContextTokens: expect.any(Number),
      rgOptimizedAvgCompletionContextTokens: expect.any(Number),
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
        firstUsefulRank: 1,
        firstUsefulLatencyMs: expect.any(Number),
        firstUsefulContextTokens: expect.any(Number),
        completionCommand: 1,
        completionLatencyMs: expect.any(Number),
        completionContextTokens: expect.any(Number)
      },
      rg: {
        commands: 1,
        foundUseful: true,
        taskComplete: true,
        firstUsefulCommand: 1,
        firstUsefulLatencyMs: expect.any(Number),
        firstUsefulContextTokens: expect.any(Number),
        completionCommand: 1,
        completionLatencyMs: expect.any(Number),
        completionContextTokens: expect.any(Number)
      }
    });
    expect(result.caseResults[0].agentIndex.firstUsefulLatencyMs).toBeLessThanOrEqual(result.caseResults[0].agentIndex.latencyMs);
    expect(result.caseResults[0].agentIndex.firstUsefulContextTokens).toBeLessThanOrEqual(result.caseResults[0].agentIndex.contextTokens);
    expect(result.caseResults[0].agentIndex.completionLatencyMs).toBeLessThanOrEqual(result.caseResults[0].agentIndex.latencyMs);
    expect(result.caseResults[0].agentIndex.completionContextTokens).toBeLessThanOrEqual(result.caseResults[0].agentIndex.contextTokens);
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
                limit: 3
              }
            ],
            rgQueries: [
              ["load_value", "semantic", "cache"],
              ["load_value", "test"]
            ],
            rgOptimizedSteps: [
              {
                type: "files",
                terms: ["load_value", "semantic", "cache"],
                paths: ["pkg"],
                limit: 10
              },
              {
                type: "snippets",
                terms: ["load_value", "semantic", "cache"],
                fromStep: 1,
                limit: 3
              },
              {
                type: "files",
                terms: ["load_value", "test"],
                paths: ["tests"],
                limit: 10
              },
              {
                type: "snippets",
                terms: ["load_value", "test"],
                fromStep: 3,
                limit: 3
              }
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
        firstUsefulRank: 1,
        firstUsefulLatencyMs: expect.any(Number),
        firstUsefulContextTokens: expect.any(Number),
        completionCommand: 2,
        completionLatencyMs: expect.any(Number),
        completionContextTokens: expect.any(Number)
      }
    });
    expect(result.caseResults[0].agentIndex.completionContextTokens).toBe(result.caseResults[0].agentIndex.contextTokens);
    expect(result.caseResults[0].agentIndex.steps.map((step) => step.type)).toEqual(["file-clusters", "related-tests"]);
    expect(result.caseResults[0].agentIndex.steps[1]).toMatchObject({
      command: "agent-index related-tests --source step:1",
      usefulRank: 1,
      usefulFile: "tests/test_cache.py"
    });
    expect(result.caseResults[0].rgOptimized).toMatchObject({
      commands: 4,
      foundUseful: true,
      taskComplete: true
    });
    expect(result.caseResults[0].rgOptimized.steps.map((step) => step.type)).toEqual([
      "rg-optimized",
      "rg-optimized",
      "rg-optimized",
      "rg-optimized"
    ]);
    expect(result.caseResults[0].agentIndex.contextTokens).toBeLessThan(result.caseResults[0].rg.contextTokens);
  });

  test("related-tests can follow multiple source candidates from a prior navigation step", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-multi-source-tests-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "reporting.py"),
      `def format_report_section(phase):
    report_section = f"captured output during {phase}"
    captured_stdout = report_section
    captured_stderr = report_section
    return captured_stdout, captured_stderr
`
    );
    await writeFile(
      path.join(root, "pkg", "capture.py"),
      `def route_captured_output(phase):
    captured_stdout = f"stdout during {phase}"
    captured_stderr = f"stderr during {phase}"
    report_section = phase
    return report_section, captured_stdout, captured_stderr
`
    );
    await writeFile(
      path.join(root, "tests", "test_reporting.py"),
      `from pkg.reporting import format_report_section


def test_report_section_label():
    assert format_report_section("setup")[0]
`
    );
    await writeFile(
      path.join(root, "tests", "test_capture.py"),
      `from pkg.capture import route_captured_output


def test_captured_stdout_setup_call_teardown_sections():
    for phase in ["setup", "call", "teardown"]:
        section, stdout, stderr = route_captured_output(phase)
        assert section in stdout
        assert section in stderr
`
    );
    await indexTarget(root);

    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-multi-source-file-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "captured-output-sections-behavior-only",
            task: "Investigate why captured stdout and stderr from setup, call, and teardown appear under the wrong report section, and find related tests without naming internal APIs.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "file-clusters",
                query: {
                  terms: ["captured", "stdout", "stderr", "setup", "call", "teardown", "report", "section"],
                  roles: ["source"],
                  symbolKinds: ["function"]
                },
                limit: 2
              },
              {
                type: "related-tests",
                sourceFromStep: 1,
                terms: ["captured", "stdout", "stderr", "setup", "call", "teardown", "report", "section"],
                limit: 1
              }
            ],
            rgQueries: [["captured", "stdout", "stderr", "setup", "call", "teardown", "report", "section"]],
            expected: {
              files: ["pkg/capture.py", "tests/test_capture.py"],
              symbols: ["route_captured_output"],
              requiredFiles: ["pkg/capture.py", "tests/test_capture.py"],
              requiredSymbols: []
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

    expect(result.caseResults[0].agentIndex).toMatchObject({
      taskComplete: true,
      foundFiles: ["pkg/capture.py", "tests/test_capture.py"]
    });
    expect(result.caseResults[0].agentIndex.steps[1]).toMatchObject({
      command: "agent-index related-tests --source step:1 --term captured --term stdout --term stderr --term setup --term call --term teardown --term report --term section",
      usefulFile: "tests/test_capture.py"
    });
  });

  test("can evaluate iterative optimized rg plans from prior snippets", async () => {
    const { root } = await fixtureProject();
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-rg-v2-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "semantic-cache-iterative-rg",
            task: "Find semantic cache source and related tests using only visible rg snippets for refinement.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "file-clusters",
                query: {
                  terms: ["semantic", "cache"],
                  roles: ["source"]
                },
                limit: 3
              },
              {
                type: "related-tests",
                sourceFromStep: 1,
                terms: ["semantic", "cache"],
                limit: 3
              }
            ],
            rgQueries: [["semantic", "cache"]],
            rgOptimizedPlan: {
              version: 2,
              steps: [
                {
                  type: "search-files",
                  terms: ["semantic", "cache"],
                  scope: "source",
                  paths: ["pkg"],
                  globs: ["*.py"],
                  limit: 10
                },
                {
                  type: "read-snippets",
                  fromStep: 1,
                  terms: ["semantic", "cache"],
                  before: 1,
                  after: 1,
                  limit: 3
                },
                {
                  type: "search-files-from-snippets",
                  fromStep: 2,
                  includeTerms: ["load_value"],
                  scope: "test",
                  paths: ["tests"],
                  globs: ["*.py"],
                  limit: 10
                },
                {
                  type: "read-snippets",
                  fromStep: 3,
                  terms: ["load_value"],
                  before: 1,
                  after: 1,
                  limit: 3
                }
              ]
            },
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

    expect(result.caseResults[0].rgOptimized).toMatchObject({
      commands: 4,
      foundUseful: true,
      taskComplete: true,
      foundFiles: ["pkg/cache.py", "tests/test_cache.py"],
      foundSymbols: ["load_value"]
    });
    expect(result.caseResults[0].rgOptimized.steps[0].command).toContain("pkg");
    expect(result.caseResults[0].rgOptimized.steps[2]).toMatchObject({
      command: expect.stringContaining("--from-snippets step:2"),
      usefulFile: "tests/test_cache.py"
    });
  });

  test("does not run optimized rg refinement when snippets yield no allowed terms", async () => {
    const { root } = await fixtureProject();
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-rg-empty-terms-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "semantic-cache-empty-rg-refinement",
            task: "Search tests only from terms visible in source snippets.",
            kind: "bugfix",
            agentIndexQueries: [
              {
                terms: ["semantic", "cache"],
                roles: ["source"],
                expand: []
              }
            ],
            rgQueries: [["semantic", "cache"]],
            rgOptimizedPlan: {
              version: 2,
              steps: [
                {
                  type: "search-files",
                  terms: ["semantic", "cache"],
                  paths: ["pkg"],
                  limit: 10
                },
                {
                  type: "read-snippets",
                  fromStep: 1,
                  terms: ["semantic", "cache"],
                  limit: 3
                },
                {
                  type: "search-files-from-snippets",
                  fromStep: 2,
                  includeTerms: ["not_visible_in_snippets"],
                  paths: ["tests"],
                  limit: 10
                }
              ]
            },
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

    expect(result.caseResults[0].rgOptimized.steps[2]).toMatchObject({
      command: "rg --files-with-matches --color never -F --from-snippets step:2 tests | head -10",
      contextChars: 17,
      outputFiles: []
    });
  });

  test("rejects behavior-only workflows that pass exact related-test symbols", async () => {
    const { root } = await fixtureProject();
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-fairness-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "semantic-cache-behavior-only",
            task: "Find semantic cache source and tests without naming the function.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "file-clusters",
                query: {
                  terms: ["semantic", "cache"],
                  roles: ["source"]
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
            rgQueries: [["semantic", "cache"]],
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

    await expect(runNavigationEval(navigationEvalPath, { target: root, mode: "hybrid" })).rejects.toThrow(
      /behavior-only step 2 must infer related-tests symbol/
    );
  });

  test("rejects behavior-only workflows that include exact target symbol terms", async () => {
    const { root } = await fixtureProject();
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-term-fairness-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "semantic-cache-behavior-only",
            task: "Find semantic cache source without naming the function.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "file-clusters",
                query: {
                  terms: ["semantic", "cache", "load_value"],
                  roles: ["source"]
                },
                limit: 3
              }
            ],
            rgQueries: [["semantic", "cache"]],
            expected: {
              files: ["pkg/cache.py"],
              symbols: ["load_value"],
              requiredSymbols: ["load_value"]
            }
          }
        ],
        null,
        2
      )
    );

    await expect(runNavigationEval(navigationEvalPath, { target: root, mode: "hybrid" })).rejects.toThrow(
      /behavior-only step 1 must not include exact target symbol term\(s\): load_value/
    );
  });

  test("rejects behavior-only rg baselines that include exact target terms", async () => {
    const { root } = await fixtureProject();
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-rg-term-fairness-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "semantic-cache-behavior-only",
            task: "Find semantic cache source without naming the function.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "file-clusters",
                query: {
                  terms: ["semantic", "cache"],
                  roles: ["source"]
                },
                limit: 3
              }
            ],
            rgQueries: [["semantic", "cache", "load_value"]],
            rgOptimizedPlan: {
              version: 2,
              steps: [
                {
                  type: "search-files",
                  terms: ["semantic", "cache", "load_value"],
                  paths: ["pkg"],
                  limit: 10
                }
              ]
            },
            expected: {
              files: ["pkg/cache.py"],
              symbols: ["load_value"],
              requiredSymbols: ["load_value"]
            }
          }
        ],
        null,
        2
      )
    );

    await expect(runNavigationEval(navigationEvalPath, { target: root, mode: "hybrid" })).rejects.toThrow(
      /behavior-only rg query 1 must not include exact target symbol term\(s\): load_value/
    );
  });

  test("rejects behavior-only optimized rg paths that point at expected files", async () => {
    const { root } = await fixtureProject();
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-rg-path-fairness-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "semantic-cache-behavior-only",
            task: "Find semantic cache source without naming the file.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "file-clusters",
                query: {
                  terms: ["semantic", "cache"],
                  roles: ["source"]
                },
                limit: 3
              }
            ],
            rgQueries: [["semantic", "cache"]],
            rgOptimizedPlan: {
              version: 2,
              steps: [
                {
                  type: "search-files",
                  terms: ["semantic", "cache"],
                  paths: ["pkg/cache.py"],
                  limit: 10
                }
              ]
            },
            expected: {
              files: ["pkg/cache.py"],
              symbols: ["load_value"],
              requiredFiles: ["pkg/cache.py"],
              requiredSymbols: ["load_value"]
            }
          }
        ],
        null,
        2
      )
    );

    await expect(runNavigationEval(navigationEvalPath, { target: root, mode: "hybrid" })).rejects.toThrow(
      /behavior-only optimized rg step 1 must not search expected file path\(s\): pkg\/cache.py/
    );
  });
});
