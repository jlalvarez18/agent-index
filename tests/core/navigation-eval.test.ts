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

  test("runs Swift exact-string audit workflows against indexed Swift test files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-swift-exact-"));
    await mkdir(path.join(root, "test", "Concurrency"), { recursive: true });
    await writeFile(
      path.join(root, "test", "Concurrency", "sendable_checking.swift"),
      `func capturesMutableState() async {
  var value = 0
  Task {
    value += 1 // expected-warning {{reference to captured var 'value' in concurrently-executing code}}
  }
}
`
    );
    await indexTarget(root);

    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-swift-exact-file-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "swift-exact-string-audit",
            task: "Audit exact Swift concurrency diagnostic expectations where rg should be a strong baseline.",
            kind: "exact-string-audit",
            agentIndexSteps: [
              {
                type: "query",
                query: {
                  terms: ["reference to captured var", "concurrently-executing code", "expected-warning", "Concurrency"],
                  roles: ["source", "test"],
                  pathHints: ["test/Concurrency"]
                }
              }
            ],
            rgQueries: [["reference to captured var", "concurrently-executing code"]],
            rgOptimizedPlan: {
              version: 2,
              steps: [
                {
                  type: "search-files",
                  terms: ["reference to captured var", "concurrently-executing code"],
                  paths: ["test/Concurrency"],
                  globs: ["*.swift"],
                  limit: 10
                },
                {
                  type: "read-snippets",
                  terms: ["reference to captured var", "concurrently-executing code"],
                  fromStep: 1,
                  before: 2,
                  after: 2,
                  limit: 4
                }
              ]
            },
            expected: {
              files: ["test/Concurrency/sendable_checking.swift"],
              requiredFiles: ["test/Concurrency/sendable_checking.swift"]
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
      id: "swift-exact-string-audit",
      agentIndex: {
        foundUseful: true,
        taskComplete: true,
        foundFiles: ["test/Concurrency/sendable_checking.swift"]
      },
      rg: {
        foundUseful: true,
        taskComplete: true
      },
      rgOptimized: {
        foundUseful: true,
        taskComplete: true
      }
    });
  });

  test("counts compact query neighbor symbols toward navigation completion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-neighbor-symbols-"));
    await mkdir(path.join(root, "Sources", "DequeModule"), { recursive: true });
    await writeFile(
      path.join(root, "Sources", "DequeModule", "Deque.swift"),
      `public struct Deque<Element> {
  internal var _storage: ContiguousArray<Element>

  public mutating func append(_ element: Element) {
    _storage.append(element)
  }
}
`
    );
    await indexTarget(root);

    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-neighbor-symbols-file-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify([
        {
          id: "swift-parent-neighbor-symbol",
          task: "Find the Deque storage-backed append implementation and identify the owning type.",
          kind: "test-discovery",
          agentIndexSteps: [
            {
              type: "query",
              query: {
                terms: ["Deque", "append", "storage"],
                symbolKinds: ["method"],
                roles: ["source"],
                pathHints: ["Sources/DequeModule"],
                expand: ["parents"]
              }
            }
          ],
          rgQueries: [["Deque", "append", "storage"]],
          expected: {
            files: ["Sources/DequeModule/Deque.swift"],
            symbols: ["Deque"],
            requiredFiles: ["Sources/DequeModule/Deque.swift"],
            requiredSymbols: ["Deque"]
          }
        }
      ])
    );

    const result = await runNavigationEval(navigationEvalPath, {
      target: root,
      mode: "hybrid"
    });

    expect(result.caseResults[0].agentIndex).toMatchObject({
      taskComplete: true,
      foundSymbols: ["Deque"],
      missingSymbols: []
    });
    expect(result.caseResults[0].agentIndex.steps[0].outputSymbols).toContain("Deque");
  });

  test("counts top-level file symbols from file-cluster results toward navigation completion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-cluster-file-symbols-"));
    await mkdir(path.join(root, "Sources", "NIOCore"), { recursive: true });
    await writeFile(
      path.join(root, "Sources", "NIOCore", "EventLoop.swift"),
      `public protocol EventLoop {}

public final class EventLoopFuture<Value> {}

extension EventLoopFuture {
  public func flatMapError(_ callback: (Error) -> EventLoopFuture<Value>) -> EventLoopFuture<Value> {
    callback(ChannelError.ioOnClosedChannel)
  }
}

public enum ChannelError: Error {
  case ioOnClosedChannel
}
`
    );
    await indexTarget(root);

    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-cluster-file-symbols-file-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify([
        {
          id: "swift-file-cluster-top-symbol",
          task: "Find EventLoopFuture error propagation extension behavior and identify the owning future type.",
          kind: "component-navigation",
          agentIndexSteps: [
            {
              type: "file-clusters",
              query: {
                terms: ["EventLoopFuture", "flatMapError", "Error", "extension"],
                symbolKinds: ["method"],
                roles: ["source"],
                pathHints: ["Sources/NIOCore"]
              },
              limit: 4
            }
          ],
          rgQueries: [["EventLoopFuture", "flatMapError", "Error"]],
          expected: {
            files: ["Sources/NIOCore/EventLoop.swift"],
            symbols: ["EventLoopFuture"],
            requiredFiles: ["Sources/NIOCore/EventLoop.swift"],
            requiredSymbols: ["EventLoopFuture"]
          }
        }
      ])
    );

    const result = await runNavigationEval(navigationEvalPath, {
      target: root,
      mode: "hybrid"
    });

    expect(result.caseResults[0].agentIndex).toMatchObject({
      taskComplete: true,
      foundSymbols: ["EventLoopFuture"],
      missingSymbols: []
    });
    expect(result.caseResults[0].agentIndex.steps[0].outputSymbols).toContain("EventLoopFuture");
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

  test("can evaluate a compact source and tests bundle as one agent command", async () => {
    const { root } = await fixtureProject();
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-source-tests-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "semantic-cache-source-tests-bundle",
            task: "Find the semantic cache implementation and related tests in one compact navigation bundle.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "source-tests",
                query: {
                  terms: ["load_value", "semantic", "cache"],
                  roles: ["source"],
                  pathHints: ["pkg/cache.py"]
                },
                limit: 3,
                testLimit: 2,
                testFanoutLimit: 1
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

    expect(result.caseResults[0].agentIndex).toMatchObject({
      commands: 1,
      foundUseful: true,
      taskComplete: true,
      foundFiles: ["pkg/cache.py", "tests/test_cache.py"],
      foundSymbols: ["load_value"],
      firstUsefulCommand: 1,
      completionCommand: 1
    });
    expect(result.caseResults[0].agentIndex.steps[0]).toMatchObject({
      type: "source-tests",
      command: "agent-index source-tests load_value semantic cache --test-fanout-limit 1",
      usefulFile: "pkg/cache.py"
    });
  });

  test("passes the top source symbol into related-tests even with multiple source files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-multi-source-symbol-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "routing.py"), "def serialize_response(value):\n    return value\n");
    await writeFile(path.join(root, "pkg", "applications.py"), "def serialize_endpoint(value):\n    return value\n");
    await writeFile(
      path.join(root, "tests", "test_schema_ref.py"),
      `from pkg import applications

def test_endpoint_response_model_schema():
    assert applications.serialize_endpoint("validate serialize endpoint return response model")
`
    );
    await writeFile(
      path.join(root, "tests", "test_serialize_response_model.py"),
      `def test_response_model_return_value_is_serialized():
    response_model = {"name": "x"}
    serialized = "endpoint return response model"
    assert response_model and serialized
`
    );
    await indexTarget(root);
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-multi-source-symbol-file-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify([
        {
          id: "multi-source-related-tests-symbol-handoff",
          task: "Find response serialization code and tests.",
          kind: "bugfix",
          agentIndexSteps: [
            {
              type: "query",
              query: {
                terms: ["serialize_response", "response", "model", "endpoint", "return"],
                symbolKinds: ["function"],
                roles: ["source"],
                pathHints: ["routing"],
                limit: 2
              }
            },
            {
              type: "related-tests",
              sourceFromStep: 1,
              terms: ["validate", "serialize", "endpoint", "return", "response", "model"],
              limit: 2
            }
          ],
          rgQueries: [["serialize", "response", "model"]],
          expected: {
            files: ["pkg/routing.py", "tests/test_serialize_response_model.py"],
            symbols: ["serialize_response"],
            requiredFiles: ["pkg/routing.py", "tests/test_serialize_response_model.py"],
            requiredSymbols: ["serialize_response"]
          }
        }
      ])
    );

    const result = await runNavigationEval(navigationEvalPath, {
      target: root,
      mode: "hybrid"
    });

    expect(result.caseResults[0].agentIndex.steps[1]).toMatchObject({
      type: "related-tests",
      usefulRank: 1,
      usefulFile: "tests/test_serialize_response_model.py"
    });
  });

  test("credits qualified Python test method symbols against unqualified expected names", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-qualified-tests-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "canvas.py"),
      `def run_canvas_chain_group(value):
    return value + 1
`
    );
    await writeFile(
      path.join(root, "tests", "test_canvas.py"),
      `from pkg.canvas import run_canvas_chain_group


class test_chain:
    def test_chain_inside_group_receives_arguments(self):
        assert run_canvas_chain_group(13) == 14
`
    );
    await indexTarget(root);

    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-qualified-tests-file-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "qualified-python-test-method",
            task: "Find the canvas chain group implementation and its class-scoped test.",
            kind: "bugfix",
            agentIndexSteps: [
              {
                type: "source-tests",
                query: {
                  terms: ["canvas", "chain", "group", "arguments"],
                  roles: ["source", "test"]
                },
                limit: 3
              }
            ],
            rgQueries: [["canvas", "chain", "group", "arguments", "test_chain_inside_group_receives_arguments"]],
            expected: {
              files: ["pkg/canvas.py", "tests/test_canvas.py"],
              symbols: ["run_canvas_chain_group", "test_chain_inside_group_receives_arguments"],
              requiredSymbols: ["test_chain_inside_group_receives_arguments"]
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
      foundSymbols: ["run_canvas_chain_group", "test_chain_inside_group_receives_arguments"],
      missingSymbols: []
    });
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

  test("evaluates JavaScript SDK method tracing with source and related tests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-js-sdk-"));
    await mkdir(path.join(root, "lib", "core"), { recursive: true });
    await mkdir(path.join(root, "test", "specs", "core"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "core", "Axios.js"),
      `function Axios(defaultConfig) {
  this.defaults = defaultConfig;
}

Axios.prototype.request = function request(config) {
  const merged = mergeConfig(this.defaults, config);
  return dispatchRequest(merged);
};

${Array.from({ length: 60 }, (_, index) => `const requestNoise${index} = "request dispatch config noise";`).join("\n")}
`
    );
    await writeFile(path.join(root, "lib", "core", "dispatchRequest.js"), "export default function dispatchRequest(config) {\n  return config;\n}\n");
    await writeFile(path.join(root, "lib", "core", "mergeConfig.js"), "export default function mergeConfig(defaults, config) {\n  return { ...defaults, ...config };\n}\n");
    await writeFile(
      path.join(root, "test", "specs", "core", "Axios.spec.js"),
      `import Axios from "../../../lib/core/Axios";

describe("Axios.prototype.request", () => {
  it("merges config before dispatch", () => {
    const client = new Axios({ timeout: 100 });
    return client.request({ url: "/payments" });
  });
});
`
    );
    await indexTarget(root);
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-js-sdk-file-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "axios-request-js-sdk-source-tests",
            task: "Trace the JavaScript SDK request method from config merge into dispatch and find its tests.",
            kind: "sdk-tracing",
            agentIndexSteps: [
              {
                type: "source-tests",
                query: {
                  terms: ["Axios", "request", "mergeConfig", "dispatchRequest", "config"],
                  symbolKinds: ["function", "method"],
                  roles: ["source", "test"],
                  pathHints: ["lib/core", "Axios"]
                },
                limit: 3,
                testLimit: 2,
                testFanoutLimit: 2
              }
            ],
            rgQueries: [
              ["Axios", "request", "mergeConfig", "dispatchRequest", "config"],
              ["Axios.prototype.request", "mergeConfig", "dispatchRequest"]
            ],
            rgOptimizedPlan: {
              version: 2,
              steps: [
                {
                  type: "search-files",
                  terms: ["Axios", "request", "mergeConfig", "dispatchRequest"],
                  paths: ["lib/core"],
                  globs: ["*.js"],
                  limit: 10
                },
                {
                  type: "read-snippets",
                  terms: ["Axios.prototype.request", "mergeConfig", "dispatchRequest"],
                  fromStep: 1,
                  before: 6,
                  after: 6,
                  limit: 3
                },
                {
                  type: "search-files",
                  terms: ["Axios.prototype.request", "mergeConfig", "dispatchRequest"],
                  paths: ["test"],
                  globs: ["*.js"],
                  limit: 10
                },
                {
                  type: "read-snippets",
                  terms: ["Axios.prototype.request", "request"],
                  fromStep: 3,
                  before: 6,
                  after: 6,
                  limit: 3
                }
              ]
            },
            expected: {
              files: ["lib/core/Axios.js", "test/specs/core/Axios.spec.js"],
              symbols: ["Axios.request"],
              requiredFiles: ["lib/core/Axios.js", "test/specs/core/Axios.spec.js"],
              requiredSymbols: ["Axios.request"]
            }
          }
        ],
        null,
        2
      )
    );

    const result = await runNavigationEval(navigationEvalPath, { target: root, mode: "hybrid" });

    expect(result.caseResults[0]).toMatchObject({
      id: "axios-request-js-sdk-source-tests",
      agentIndex: {
        commands: 1,
        foundUseful: true,
        taskComplete: true,
        foundFiles: ["lib/core/Axios.js", "test/specs/core/Axios.spec.js"],
        foundSymbols: ["Axios.request"]
      },
      optimizedRgWinner: "agent-index"
    });
    expect(result.caseResults[0].agentIndex.contextTokens).toBeLessThan(result.caseResults[0].rgOptimized.contextTokens);
  });

  test("can evaluate exact-string JSON audits while keeping optimized rg competitive", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-json-exact-"));
    await mkdir(path.join(root, "src", "compiler"), { recursive: true });
    await mkdir(path.join(root, "tests", "baselines", "reference", "api"), { recursive: true });
    await writeFile(path.join(root, "src", "compiler", "diagnosticMessages.json"), "{\"key\":\"TS2304\",\"message\":\"Cannot find name\"}\n");
    await writeFile(
      path.join(root, "tests", "baselines", "reference", "api", "diagnosticMessages.generated.json"),
      "{\"key\":\"TS2304\",\"category\":\"Error\"}\n"
    );
    await writeFile(path.join(root, "src", "compiler", "checker.ts"), "export function checkName() { return 'diagnostic'; }\n");
    await indexTarget(root);
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-eval-json-exact-file-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    await writeFile(
      navigationEvalPath,
      JSON.stringify(
        [
          {
            id: "json-diagnostic-exact-string-audit",
            task: "Audit every JSON source and baseline location for exact diagnostic string TS2304.",
            kind: "exact-string-audit",
            agentIndexSteps: [
              {
                type: "file-clusters",
                query: {
                  terms: ["TS2304"],
                  roles: ["source", "test"],
                  pathHints: ["src/compiler", "tests/baselines"],
                  limit: 4
                },
                limit: 4
              }
            ],
            rgQueries: [["TS2304"]],
            rgOptimizedPlan: {
              version: 2,
              steps: [
                {
                  type: "search-files",
                  terms: ["TS2304"],
                  paths: ["."],
                  globs: ["*.json"],
                  limit: 10
                },
                {
                  type: "read-snippets",
                  terms: ["TS2304"],
                  fromStep: 1,
                  before: 1,
                  after: 1,
                  limit: 4
                }
              ]
            },
            expected: {
              files: [
                "src/compiler/diagnosticMessages.json",
                "tests/baselines/reference/api/diagnosticMessages.generated.json"
              ],
              requiredFiles: [
                "src/compiler/diagnosticMessages.json",
                "tests/baselines/reference/api/diagnosticMessages.generated.json"
              ]
            }
          }
        ],
        null,
        2
      )
    );

    const result = await runNavigationEval(navigationEvalPath, { target: root, mode: "hybrid" });

    expect(result.caseResults[0]).toMatchObject({
      id: "json-diagnostic-exact-string-audit",
      agentIndex: {
        foundUseful: true,
        taskComplete: true
      },
      rgOptimized: {
        foundUseful: true,
        taskComplete: true
      }
    });
  });
});
