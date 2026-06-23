import { describe, expect, test } from "vitest";
import { guideAgentTask, planAgentTask } from "../../src/core/task-mode.js";
import type { AgentTaskResult } from "../../src/core/task-mode.js";

describe("planAgentTask", () => {
  test("plans bugfix as source map, implementation query, and related tests", () => {
    const plan = planAgentTask("bugfix", {
      task: "NO_COLOR should disable color by default",
      pathHints: ["click"],
      limit: 4
    });

    expect(plan.kind).toBe("bugfix");
    expect(plan.steps.map((step) => step.purpose)).toEqual(["source-map", "implementation-context", "related-tests"]);
    expect(plan.steps[0]).toMatchObject({
      type: "file-clusters",
      query: {
        terms: ["NO_COLOR", "should", "disable", "color", "by", "default", "resolve", "decision"],
        roles: ["source"],
        pathHints: ["click"]
      },
      limit: 4
    });
    expect(plan.steps[1]).toMatchObject({
      type: "query",
      query: {
        symbolKinds: ["function", "method", "class"],
        roles: ["source"],
        expand: ["callers", "callees", "imports"]
      }
    });
    expect(plan.steps[2]).toMatchObject({
      type: "source-tests",
      testLimit: 2,
      testFanoutLimit: 3
    });
  });

  test("plans feature as source map, nearby APIs, and test/example discovery", () => {
    const plan = planAgentTask("feature", {
      task: "add receipt email rendering",
      terms: ["ReceiptEmail"],
      kinds: ["class"]
    });

    expect(plan.steps.map((step) => step.purpose)).toEqual(["source-map", "nearby-apis", "likely-tests", "examples"]);
    expect(plan.steps[1]).toMatchObject({
      type: "query",
      query: {
        terms: ["add", "receipt", "email", "rendering", "ReceiptEmail"],
        symbolKinds: ["class"],
        roles: ["source"],
        expand: ["imports", "parents", "children"]
      }
    });
    expect(plan.steps[2]).toMatchObject({
      type: "source-tests",
      query: {
        roles: ["source"]
      }
    });
    expect(plan.steps[3]).toMatchObject({
      type: "file-clusters",
      query: {
        roles: ["test", "example"]
      }
    });
  });

  test("plans explain with callers, callees, and import context", () => {
    const plan = planAgentTask("explain", {
      task: "how response serialization works"
    });

    expect(plan.steps.map((step) => step.purpose)).toEqual(["source-map", "core-symbols"]);
    expect(plan.steps[1]).toMatchObject({
      type: "query",
      query: {
        expand: ["callers", "callees", "imports", "parents"],
        roles: ["source"]
      }
    });
  });

  test("plans find-tests as source/test relation discovery", () => {
    const plan = planAgentTask("find-tests", {
      task: "CheckoutController submit",
      limit: 3,
      testLimit: 4
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      type: "source-tests",
      purpose: "source-test-relations",
      limit: 3,
      testLimit: 4
    });
  });

  test("plans source-to-tests as direct related-tests from a known source file", () => {
    const plan = planAgentTask("source-to-tests", {
      source: "lib/foo.dart",
      task: "submit checkout",
      terms: ["CheckoutController"]
    });

    expect(plan.steps).toEqual([
      {
        type: "related-tests",
        purpose: "direct-related-tests",
        sourceFile: "lib/foo.dart",
        terms: ["submit", "checkout", "CheckoutController"],
        limit: 5
      }
    ]);
  });

  test("requires a source file for source-to-tests", () => {
    expect(() => planAgentTask("source-to-tests", { task: "submit checkout" })).toThrow(
      "task source-to-tests requires --source <file>"
    );
  });

  test("guides high-confidence bugfix agents to open the top source result before broad search", () => {
    const guidance = guideAgentTask(taskResultFixture("bugfix"));

    expect(guidance).toEqual({
      recommendedNextAction: "open-top-result",
      confidence: "high",
      openFirst: { file: "src/click/globals.py", line: 54 },
      why: ["source hit rank 1", "evidence available", "implementation query corroborated", "related tests found"],
      next: "inspect source before broad rg",
      followUpCommands: ["agent-index task source-to-tests --source src/click/globals.py --term resolve_color_default"]
    });
  });

  test("guides medium-confidence agents when only source context is available", () => {
    const result = taskResultFixture("explain");
    result.steps = result.steps.slice(0, 1);
    const guidance = guideAgentTask(result);

    expect(guidance).toMatchObject({
      recommendedNextAction: "open-top-result",
      confidence: "medium",
      openFirst: { file: "src/click/globals.py", line: 54 },
      why: ["source hit rank 1", "evidence available"],
      next: "inspect source, then refine with more specific terms if needed"
    });
  });

  test("guides medium-confidence agents when related tests belong to a different source file", () => {
    const result = taskResultFixture("bugfix");
    const sourceTestsStep = result.steps.find((step) => step.type === "source-tests");
    if (sourceTestsStep?.type === "source-tests") {
      sourceTestsStep.result.bundles[0].source.file = "src/click/core.py";
    }

    const guidance = guideAgentTask(result);

    expect(guidance).toMatchObject({
      recommendedNextAction: "open-top-result",
      confidence: "medium",
      openFirst: { file: "src/click/globals.py", line: 54 },
      why: ["source hit rank 1", "evidence available", "implementation query corroborated", "graph neighbors found"]
    });
  });

  test("guides medium-confidence agents when evidence is generic without symbol or path corroboration", () => {
    const result = taskResultFixture("bugfix");
    const clusterStep = result.steps.find((step) => step.type === "file-clusters");
    if (clusterStep?.type === "file-clusters") {
      clusterStep.result.clusters[0] = {
        ...clusterStep.result.clusters[0],
        file: "src/click/testing.py",
        evidence: "class CliRunner:",
        symbols: [{ name: "CliRunner", kind: "class", lines: [1, 120] }]
      };
    }
    result.steps = result.steps.filter((step) => step.type !== "query" && step.type !== "source-tests");

    const guidance = guideAgentTask(result);

    expect(guidance).toMatchObject({
      recommendedNextAction: "open-top-result",
      confidence: "medium",
      openFirst: { file: "src/click/testing.py", line: 1 },
      why: ["source hit rank 1", "evidence available", "support/artifact path"]
    });
  });

  test("guides medium-confidence agents for support artifact paths even with corroborating evidence", () => {
    const result = taskResultFixture("bugfix");
    for (const step of result.steps) {
      if (step.type === "file-clusters") {
        step.result.clusters[0] = {
          ...step.result.clusters[0],
          file: "_artifacts/domain_map.yaml",
          language: "yaml",
          evidence: "createSlice: packages/toolkit/src/createSlice.ts",
          symbols: [{ name: "_artifacts/domain_map.yaml", kind: "module", lines: [1, 1] }]
        };
      } else if (step.type === "query") {
        step.result.matches[0] = {
          ...step.result.matches[0],
          file: "_artifacts/domain_map.yaml",
          symbol: "_artifacts/domain_map.yaml",
          kind: "module",
          lines: [1, 1],
          evidence: "createSlice: packages/toolkit/src/createSlice.ts"
        };
      } else if (step.type === "source-tests") {
        step.result.bundles[0].source = {
          ...step.result.bundles[0].source,
          file: "_artifacts/domain_map.yaml",
          language: "yaml",
          evidence: "createSlice: packages/toolkit/src/createSlice.ts",
          symbols: [{ name: "_artifacts/domain_map.yaml", kind: "module", lines: [1, 1] }]
        };
      }
    }

    const guidance = guideAgentTask(result);

    expect(guidance).toMatchObject({
      recommendedNextAction: "open-top-result",
      confidence: "medium",
      openFirst: { file: "_artifacts/domain_map.yaml", line: 1 },
      why: [
        "source hit rank 1",
        "evidence available",
        "implementation query corroborated",
        "related tests found",
        "support/artifact path"
      ]
    });
  });

  test("guides medium-confidence agents for testing helper paths even with same-file test corroboration", () => {
    const result = taskResultFixture("bugfix");
    for (const step of result.steps) {
      if (step.type === "file-clusters") {
        step.result.clusters[0] = {
          ...step.result.clusters[0],
          file: "src/click/testing.py",
          evidence: ":param stdout_bytes: The standard output as bytes.",
          symbols: [
            { name: "src/click/testing.py", kind: "module", lines: [1, 774] },
            { name: "CliRunner.get_default_prog_name", kind: "method", lines: [317, 335] }
          ]
        };
      } else if (step.type === "query") {
        step.result.matches[0] = {
          ...step.result.matches[0],
          file: "src/click/testing.py",
          symbol: "CliRunner.get_default_prog_name",
          kind: "method",
          lines: [317, 335],
          why: ["matched source text", "file path match", "symbol name match", "method name match", "nearby graph edge"],
          evidence: "Given a command object it will return the default program name"
        };
      } else if (step.type === "source-tests") {
        step.result.bundles[0].source = {
          ...step.result.bundles[0].source,
          file: "src/click/testing.py",
          evidence: ":param stdout_bytes: The standard output as bytes.",
          symbols: [
            { name: "src/click/testing.py", kind: "module", lines: [1, 774] },
            { name: "CliRunner.get_default_prog_name", kind: "method", lines: [317, 335] }
          ]
        };
      }
    }

    const guidance = guideAgentTask(result);

    expect(guidance).toMatchObject({
      recommendedNextAction: "open-top-result",
      confidence: "medium",
      openFirst: { file: "src/click/testing.py", line: 1 },
      why: [
        "source hit rank 1",
        "evidence available",
        "implementation query corroborated",
        "related tests found",
        "support/artifact path"
      ]
    });
  });

  test("guides low-confidence agents to refine when no task step finds a result", () => {
    const result = taskResultFixture("bugfix");
    result.steps = result.steps.map((step) => {
      if (step.type === "file-clusters") {
        return { ...step, result: { clusters: [] } };
      }
      if (step.type === "query") {
        return { ...step, result: { query: "missing", mode: "hybrid", matches: [] } };
      }
      return { ...step, result: { bundles: [] } };
    });

    expect(guideAgentTask(result)).toEqual({
      recommendedNextAction: "refine-query",
      confidence: "low",
      why: ["no source result found"],
      next: "rerun agent-index with more specific code terms before broad rg"
    });
  });

  test("guides source-to-tests agents to inspect the top related test", () => {
    const guidance = guideAgentTask({
      plan: planAgentTask("source-to-tests", {
        source: "src/click/globals.py",
        task: "resolve color default",
        terms: ["resolve_color_default"]
      }),
      steps: [
        {
          type: "related-tests",
          purpose: "direct-related-tests",
          result: {
            sourceFiles: ["src/click/globals.py"],
            symbol: "resolve_color_default",
            matches: [
              {
                file: "tests/test_globals.py",
                firstLine: 97,
                symbols: ["test_no_color_disables_default_color"],
                why: ["imports source", "term match"]
              }
            ]
          }
        }
      ]
    });

    expect(guidance).toMatchObject({
      recommendedNextAction: "inspect-related-tests",
      confidence: "high",
      openFirst: { file: "tests/test_globals.py", line: 97 },
      why: ["related test rank 1", "test symbols found"]
    });
  });
});

function taskResultFixture(kind: "bugfix" | "explain"): AgentTaskResult {
  return {
    plan: planAgentTask(kind, {
      task: "NO_COLOR should disable color by default",
      terms: ["resolve_color_default"]
    }),
    steps: [
      {
        type: "file-clusters",
        purpose: "source-map",
        result: {
          clusters: [
            {
              file: "src/click/globals.py",
              role: "source",
              language: "python",
              score: 42,
              matchedChunks: 2,
              contextChars: 120,
              contextTokens: 30,
              evidence: "def resolve_color_default(color=None):",
              why: ["matched query terms", "role match"],
              symbols: [{ name: "resolve_color_default", kind: "function", lines: [54, 67] }]
            }
          ]
        }
      },
      {
        type: "query",
        purpose: "implementation-context",
        result: {
          query: "NO_COLOR should disable color by default resolve_color_default",
          mode: "hybrid",
          matches: [
            {
              symbol: "resolve_color_default",
              kind: "function",
              file: "src/click/globals.py",
              lines: [54, 67],
              score: 99,
              why: ["symbol name match"],
              evidence: "def resolve_color_default(color=None):",
              neighbors: [{ relation: "called_by_name", symbol: "Context.color", file: "src/click/core.py", lines: [420, 430] }]
            }
          ]
        }
      },
      {
        type: "source-tests",
        purpose: "related-tests",
        result: {
          bundles: [
            {
              source: {
                file: "src/click/globals.py",
                role: "source",
                language: "python",
                score: 42,
                matchedChunks: 2,
                contextChars: 120,
                contextTokens: 30,
                evidence: "def resolve_color_default(color=None):",
                why: ["matched query terms", "role match"],
                symbols: [{ name: "resolve_color_default", kind: "function", lines: [54, 67] }]
              },
              tests: [
                {
                  file: "tests/test_globals.py",
                  role: "test",
                  language: "python",
                  score: 30,
                  firstLine: 97,
                  why: ["source stem match"],
                  symbols: ["test_no_color_disables_default_color"]
                }
              ]
            }
          ]
        }
      }
    ]
  };
}
