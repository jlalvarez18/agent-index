import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  autonomousConditions,
  loadAutonomousReviews,
  loadAutonomousTaskManifest,
  prepareAutonomousRunPacket,
  summarizeAutonomousReviews,
  validateAutonomousTaskManifest
} from "../../src/core/autonomous-comparison.js";
import type { AutonomousReviewRecord, AutonomousTaskManifest } from "../../src/core/schema.js";

function validManifest(): AutonomousTaskManifest {
  return {
    version: 1,
    name: "pilot",
    tasks: [
      {
        id: "click-color-default-behavior",
        repo: "click",
        kind: "bugfix",
        prompt: "Find and fix where Click decides default color behavior from environment state.",
        successCriteria: ["NO_COLOR disables color by default.", "Explicit color=True still wins."],
        expectedEvidence: {
          files: ["src/click/globals.py"],
          symbols: ["resolve_color_default"]
        },
        testCommand: "pytest tests/test_globals.py"
      }
    ]
  };
}

function validReview(): AutonomousReviewRecord {
  return {
    taskId: "task-a",
    condition: "agent-index",
    success: "pass",
    quality: 5,
    firstUsefulFile: null,
    firstUsefulTool: "agent-index",
    specialToolHelped: "yes",
    tests: "passed",
    failureMode: null,
    wallTimeMinutes: 12,
    filesOpened: 4,
    contextTokens: 900,
    notes: "good"
  };
}

async function writeReviewArtifact(review: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-review-"));
  const reviewPath = path.join(root, "task-a", "agent-index", "review.json");
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, JSON.stringify(review, null, 2), "utf8");
  return root;
}

describe("autonomous comparison manifest", () => {
  test("defines the three pilot conditions", () => {
    expect(autonomousConditions).toEqual(["graphify", "agent-index", "no-special-tool"]);
  });

  test("accepts a valid task manifest", () => {
    expect(validateAutonomousTaskManifest(validManifest(), "fixture.json")).toEqual(validManifest());
  });

  test("rejects duplicate task ids", () => {
    const manifest = validManifest();
    manifest.tasks.push({ ...manifest.tasks[0] });
    expect(() => validateAutonomousTaskManifest(manifest, "fixture.json")).toThrow(/duplicate task id/i);
  });

  test("rejects prompts that leak expected evidence", () => {
    const manifest = validManifest();
    manifest.tasks[0].prompt = "Open src/click/globals.py and fix resolve_color_default.";
    expect(() => validateAutonomousTaskManifest(manifest, "fixture.json")).toThrow(/leaks expected evidence/i);
  });

  test("rejects success criteria that leak expected evidence", () => {
    const fileLeak = validManifest();
    fileLeak.tasks[0].successCriteria = ["Fix src/click/globals.py without changing public APIs."];
    expect(() => validateAutonomousTaskManifest(fileLeak, "fixture.json")).toThrow(/leaks expected evidence/i);

    const symbolLeak = validManifest();
    symbolLeak.tasks[0].successCriteria = ["resolve_color_default handles NO_COLOR correctly."];
    expect(() => validateAutonomousTaskManifest(symbolLeak, "fixture.json")).toThrow(/leaks expected evidence/i);
  });

  test("rejects path traversal task ids before preparing run packets", async () => {
    const manifest = validManifest();
    manifest.tasks[0].id = "../outside";
    expect(() => validateAutonomousTaskManifest(manifest, "fixture.json")).toThrow(/path-safe slug/i);

    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-traversal-"));
    await expect(
      prepareAutonomousRunPacket(manifest.tasks[0], "agent-index", {
        artifactsDir: root
      })
    ).rejects.toThrow(/path-safe slug/i);
  });

  test("loads a manifest from disk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-manifest-"));
    const manifestPath = path.join(root, "pilot.json");
    await writeFile(manifestPath, JSON.stringify(validManifest(), null, 2));
    const manifest = await loadAutonomousTaskManifest(manifestPath);
    expect(manifest.tasks[0].id).toBe("click-color-default-behavior");
  });

  test("pilot manifest is valid and has ten tasks", async () => {
    const manifest = await loadAutonomousTaskManifest("benchmarks/autonomous/graphify-agent-index-pilot.json");
    expect(manifest.name).toBe("graphify-agent-index-pilot");
    expect(manifest.tasks).toHaveLength(10);
    expect(manifest.tasks.map((task) => task.id)).toEqual([
      "click-color-default-behavior",
      "httpx-redirect-history",
      "pydantic-computed-fields-serialization",
      "tanstack-query-infinite-query-flow",
      "rich-print-json-file-output",
      "sqlalchemy-rowcount-preservation",
      "fastapi-response-serialization",
      "vite-env-prefix-behavior",
      "redux-toolkit-create-slice-bugfix",
      "graphify-query-path-explanation"
    ]);

    const taskById = new Map(manifest.tasks.map((task) => [task.id, task]));
    expect(taskById.get("httpx-redirect-history")?.expectedEvidence.symbols).toEqual([
      "Client._send_handling_redirects",
      "AsyncClient._send_handling_redirects"
    ]);
    expect(taskById.get("pydantic-computed-fields-serialization")?.expectedEvidence.symbols).toEqual(
      expect.arrayContaining(["computed_field", "BaseModel.model_dump", "BaseModel.model_dump_json"])
    );
    expect(taskById.get("rich-print-json-file-output")?.expectedEvidence.files).toEqual(
      expect.arrayContaining(["tests/test_rich_print.py", "tests/test_console.py"])
    );
    expect(taskById.get("rich-print-json-file-output")?.testCommand).toBe(
      "pytest tests/test_rich_print.py tests/test_console.py -k print_json"
    );
    expect(taskById.get("sqlalchemy-rowcount-preservation")?.expectedEvidence.files).toEqual(
      expect.arrayContaining(["lib/sqlalchemy/engine/default.py", "lib/sqlalchemy/engine/base.py"])
    );
    expect(taskById.get("sqlalchemy-rowcount-preservation")?.expectedEvidence.symbols).toEqual(
      expect.arrayContaining(["DefaultExecutionContext._setup_result_proxy"])
    );
    expect(taskById.get("fastapi-response-serialization")?.expectedEvidence.files).toEqual(
      expect.arrayContaining(["tests/test_serialize_response_model.py"])
    );
    expect(taskById.get("vite-env-prefix-behavior")?.expectedEvidence.files).toEqual(
      expect.arrayContaining(["packages/vite/src/node/__tests__/config.spec.ts"])
    );
    expect(taskById.get("vite-env-prefix-behavior")?.expectedEvidence.symbols).toEqual(
      expect.arrayContaining(["loadEnv", "resolveEnvPrefix"])
    );
  });

  test("rejects missing or non-string prompts without throwing TypeError", () => {
    const missingPrompt = validManifest() as unknown as { tasks: Array<Record<string, unknown>> };
    delete missingPrompt.tasks[0].prompt;
    expect(() => validateAutonomousTaskManifest(missingPrompt, "fixture.json")).toThrow(/prompt is required/i);
    expect(() => validateAutonomousTaskManifest(missingPrompt, "fixture.json")).not.toThrow(TypeError);

    const nonStringPrompt = validManifest() as unknown as { tasks: Array<Record<string, unknown>> };
    nonStringPrompt.tasks[0].prompt = 42;
    expect(() => validateAutonomousTaskManifest(nonStringPrompt, "fixture.json")).toThrow(/prompt must be a string/i);
    expect(() => validateAutonomousTaskManifest(nonStringPrompt, "fixture.json")).not.toThrow(TypeError);
  });

  test("rejects non-object task entries without throwing TypeError", () => {
    const manifest = {
      version: 1,
      name: "pilot",
      tasks: [null, "not-a-task"]
    };
    expect(() => validateAutonomousTaskManifest(manifest, "fixture.json")).toThrow(/task must be an object/i);
    expect(() => validateAutonomousTaskManifest(manifest, "fixture.json")).not.toThrow(TypeError);
  });

  test("rejects invalid task kind", () => {
    const manifest = validManifest() as unknown as { tasks: Array<Record<string, unknown>> };
    manifest.tasks[0].kind = "debugging";
    expect(() => validateAutonomousTaskManifest(manifest, "fixture.json")).toThrow(/kind must be one of/i);
  });

  test("requires expected evidence files to be a non-empty string array", () => {
    const missingFiles = validManifest() as unknown as { tasks: Array<Record<string, unknown>> };
    missingFiles.tasks[0].expectedEvidence = {};
    expect(() => validateAutonomousTaskManifest(missingFiles, "fixture.json")).toThrow(
      /expectedEvidence\.files must be a non-empty string array/i
    );

    const emptyFiles = validManifest() as unknown as { tasks: Array<Record<string, unknown>> };
    emptyFiles.tasks[0].expectedEvidence = { files: [] };
    expect(() => validateAutonomousTaskManifest(emptyFiles, "fixture.json")).toThrow(
      /expectedEvidence\.files must be a non-empty string array/i
    );
  });

  test("rejects non-string success criteria and optional string fields", () => {
    const badCriterion = validManifest() as unknown as { tasks: Array<Record<string, unknown>> };
    badCriterion.tasks[0].successCriteria = ["works", 7];
    expect(() => validateAutonomousTaskManifest(badCriterion, "fixture.json")).toThrow(
      /successCriteria must contain only strings/i
    );

    const badOptional = validManifest() as unknown as { tasks: Array<Record<string, unknown>> };
    badOptional.tasks[0].commit = 123;
    badOptional.tasks[0].testCommand = ["pytest"];
    badOptional.tasks[0].notes = false;
    expect(() => validateAutonomousTaskManifest(badOptional, "fixture.json")).toThrow(/commit must be a string/i);
    expect(() => validateAutonomousTaskManifest(badOptional, "fixture.json")).toThrow(/testCommand must be a string/i);
    expect(() => validateAutonomousTaskManifest(badOptional, "fixture.json")).toThrow(/notes must be a string/i);
  });

  test("writes a run packet without leaking expected evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-packet-"));
    const manifest = validManifest();
    const packet = await prepareAutonomousRunPacket(manifest.tasks[0], "agent-index", {
      artifactsDir: root,
      timeLimitMinutes: 30
    });

    expect(packet.taskId).toBe("click-color-default-behavior");
    expect(packet.condition).toBe("agent-index");
    expect(packet.runDir).toBe(path.join(root, "click-color-default-behavior", "agent-index"));
    expect(packet.promptPath).toBe(path.join(packet.runDir, "prompt.md"));
    expect(packet.reviewTemplatePath).toBe(path.join(packet.runDir, "review-template.json"));

    const prompt = await readFile(path.join(packet.runDir, "prompt.md"), "utf8");
    expect(prompt).toContain("agent-index is available");
    expect(prompt).toContain("30 minute wall-clock cap");
    expect(prompt).not.toContain("src/click/globals.py");
    expect(prompt).not.toContain("resolve_color_default");

    const review = await readFile(path.join(packet.runDir, "review-template.json"), "utf8");
    expect(JSON.parse(review)).toMatchObject({
      taskId: "click-color-default-behavior",
      condition: "agent-index",
      success: "fail",
      specialToolHelped: "ignored",
      indexing: {}
    });
  });

  test("no-special-tool prompt does not mention Graphify or agent-index availability", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-no-tool-"));
    const manifest = validManifest();
    const packet = await prepareAutonomousRunPacket(manifest.tasks[0], "no-special-tool", {
      artifactsDir: root,
      timeLimitMinutes: 30
    });
    const prompt = await readFile(path.join(packet.runDir, "prompt.md"), "utf8");
    expect(prompt).toContain("No special code-navigation tool is available");
    expect(prompt).not.toContain("Graphify is available");
    expect(prompt).not.toContain("agent-index is available");
  });

  test("summarizes autonomous review records by condition", () => {
    const reviews: AutonomousReviewRecord[] = [
      {
        taskId: "a",
        condition: "agent-index",
        success: "pass",
        quality: 5,
        firstUsefulFile: "src/a.py",
        firstUsefulTool: "agent-index",
        specialToolHelped: "yes",
        tests: "passed",
        failureMode: null,
        wallTimeMinutes: 12,
        filesOpened: 4,
        contextTokens: 900,
        notes: "good"
      },
      {
        taskId: "b",
        condition: "agent-index",
        success: "partial",
        quality: 3,
        firstUsefulFile: "src/b.py",
        firstUsefulTool: "rg",
        specialToolHelped: "no",
        tests: "failed",
        failureMode: "test-gap",
        wallTimeMinutes: 30,
        filesOpened: 10,
        contextTokens: 2000,
        notes: "partial"
      },
      {
        taskId: "a",
        condition: "no-special-tool",
        success: "fail",
        quality: 2,
        firstUsefulFile: null,
        firstUsefulTool: null,
        specialToolHelped: "ignored",
        tests: "not-run",
        failureMode: "timeout",
        notes: "timed out"
      }
    ];

    const summary = summarizeAutonomousReviews(reviews);
    expect(summary.runs).toBe(3);
    expect(summary.byCondition.find((row) => row.condition === "agent-index")).toMatchObject({
      runs: 2,
      pass: 1,
      partial: 1,
      fail: 0,
      avgQuality: 4,
      specialToolUsedRate: 0.5,
      specialToolHelpedRate: 0.5,
      medianWallTimeMinutes: 30,
      medianFilesOpened: 10,
      medianContextTokens: 2000
    });
    expect(summary.failureModes).toMatchObject({
      "test-gap": 1,
      timeout: 1
    });
  });

  test("rejects review artifacts with missing quality", async () => {
    const review = validReview() as unknown as Record<string, unknown>;
    delete review.quality;
    const root = await writeReviewArtifact(review);

    await expect(loadAutonomousReviews(root)).rejects.toThrow(/quality must be an integer from 1 to 5/i);
  });

  test("rejects review artifacts with invalid conditions", async () => {
    const review = validReview() as unknown as Record<string, unknown>;
    review.condition = "bogus";
    const root = await writeReviewArtifact(review);

    await expect(loadAutonomousReviews(root)).rejects.toThrow(/condition must be one of/i);
  });

  test("rejects review artifacts with missing or invalid failure modes", async () => {
    const missingFailureMode = validReview() as unknown as Record<string, unknown>;
    delete missingFailureMode.failureMode;
    const missingRoot = await writeReviewArtifact(missingFailureMode);

    await expect(loadAutonomousReviews(missingRoot)).rejects.toThrow(/failureMode must be one of/i);

    const invalidFailureMode = validReview() as unknown as Record<string, unknown>;
    invalidFailureMode.failureMode = "unknown";
    const invalidRoot = await writeReviewArtifact(invalidFailureMode);

    await expect(loadAutonomousReviews(invalidRoot)).rejects.toThrow(/failureMode must be one of/i);
  });
});
