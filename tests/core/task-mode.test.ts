import { describe, expect, test } from "vitest";
import { planAgentTask } from "../../src/core/task-mode.js";

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
});
