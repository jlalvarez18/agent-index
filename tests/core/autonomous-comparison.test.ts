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
    outputTokens: 250,
    agentTurns: 6,
    toolCalls: 14,
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
      indexing: {},
      dependencySetup: {},
      telemetry: {
        schemaVersion: 1,
        metadata: {
          taskId: "click-color-default-behavior",
          condition: "agent-index",
          repo: "click",
          taskKind: "bugfix"
        },
        artifacts: {
          runDir: packet.runDir,
          promptPath: packet.promptPath,
          reviewTemplatePath: packet.reviewTemplatePath,
          generatedPaths: [packet.promptPath, packet.reviewTemplatePath]
        }
      }
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
        outputTokens: 250,
        agentTurns: 6,
        toolCalls: 14,
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
        outputTokens: 750,
        agentTurns: 10,
        toolCalls: 27,
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
      medianContextTokens: 2000,
      medianOutputTokens: 750,
      medianAgentTurns: 10,
      medianToolCalls: 27
    });
    expect(summary.failureModes).toMatchObject({
      "test-gap": 1,
      timeout: 1
    });
  });

  test("accepts structured telemetry with measured and estimated metric provenance", async () => {
    const review = {
      ...validReview(),
      telemetry: {
        schemaVersion: 1,
        metadata: {
          taskId: "task-a",
          condition: "agent-index",
          repo: "click",
          taskKind: "bugfix",
          commit: "9f4c2d1"
        },
        artifacts: {
          runDir: "/tmp/autonomous/task-a/agent-index",
          promptPath: "/tmp/autonomous/task-a/agent-index/prompt.md",
          reviewTemplatePath: "/tmp/autonomous/task-a/agent-index/review-template.json",
          generatedPaths: [
            "/tmp/autonomous/task-a/agent-index/prompt.md",
            "/tmp/autonomous/task-a/agent-index/review-template.json"
          ]
        },
        timestamps: {
          preparedAt: "2026-06-22T12:00:00.000Z",
          reviewTemplateWrittenAt: "2026-06-22T12:00:00.500Z",
          runStartedAt: "2026-06-22T12:05:00.000Z",
          runEndedAt: "2026-06-22T12:17:00.000Z"
        },
        metrics: {
          wallTimeSeconds: {
            value: 720,
            source: "measured",
            method: "coordinator stopwatch"
          },
          toolCalls: {
            value: 14,
            source: "measured",
            method: "tool transcript count"
          },
          contextTokens: {
            value: 900,
            source: "estimated",
            method: "transcript chars divided by four"
          },
          outputTokens: {
            value: 250,
            source: "estimated",
            method: "assistant output chars divided by four"
          }
        },
        indexSetup: {
          fullIndexWallTimeSeconds: {
            value: 18,
            source: "measured",
            method: "time command"
          },
          indexArtifactBytes: {
            value: 1048576,
            source: "measured",
            method: "fs.stat"
          }
        },
        testCommands: [
          {
            command: "pytest tests/test_globals.py",
            outcome: "passed",
            exitCode: 0,
            source: "measured",
            startedAt: "2026-06-22T12:16:00.000Z",
            endedAt: "2026-06-22T12:16:20.000Z"
          }
        ]
      }
    };
    const root = await writeReviewArtifact(review);

    const [loaded] = await loadAutonomousReviews(root);

    expect(loaded.telemetry?.metrics?.wallTimeSeconds?.source).toBe("measured");
    expect(loaded.telemetry?.metrics?.contextTokens?.method).toBe("transcript chars divided by four");
    expect(loaded.telemetry?.artifacts?.reviewPath).toContain("review.json");
    expect(loaded.telemetry?.timestamps?.reviewWrittenAt).toMatch(/T/);
    expect(loaded.telemetry?.timestamps?.validationCompletedAt).toMatch(/T/);
  });

  test("rejects telemetry estimates without methods and invalid metric sources", async () => {
    const missingMethod = {
      ...validReview(),
      telemetry: {
        schemaVersion: 1,
        metrics: {
          contextTokens: {
            value: 900,
            source: "estimated"
          }
        }
      }
    };
    const missingMethodRoot = await writeReviewArtifact(missingMethod);

    await expect(loadAutonomousReviews(missingMethodRoot)).rejects.toThrow(/contextTokens\.method/i);

    const invalidSource = {
      ...validReview(),
      telemetry: {
        schemaVersion: 1,
        metrics: {
          toolCalls: {
            value: 14,
            source: "exact",
            method: "tool transcript count"
          }
        }
      }
    };
    const invalidSourceRoot = await writeReviewArtifact(invalidSource);

    await expect(loadAutonomousReviews(invalidSourceRoot)).rejects.toThrow(/toolCalls\.source/i);
  });

  test("separates measured and estimated telemetry in autonomous summaries", () => {
    const measuredReview: AutonomousReviewRecord = {
      ...validReview(),
      wallTimeMinutes: undefined,
      contextTokens: undefined,
      outputTokens: undefined,
      toolCalls: undefined,
      telemetry: {
        schemaVersion: 1,
        metrics: {
          wallTimeSeconds: {
            value: 600,
            source: "measured",
            method: "coordinator stopwatch"
          },
          toolCalls: {
            value: 11,
            source: "measured",
            method: "tool transcript count"
          },
          contextTokens: {
            value: 800,
            source: "estimated",
            method: "transcript chars divided by four"
          },
          outputTokens: {
            value: 200,
            source: "estimated",
            method: "assistant output chars divided by four"
          }
        }
      }
    };
    const legacyReview = validReview();

    const summary = summarizeAutonomousReviews([measuredReview, legacyReview]);
    const agentIndex = summary.byCondition.find((row) => row.condition === "agent-index");

    expect(agentIndex?.medianWallTimeMinutes).toBe(12);
    expect(agentIndex?.metricConfidence.wallTimeMinutes).toEqual({
      measured: 1,
      estimated: 1,
      missing: 0
    });
    expect(agentIndex?.metricConfidence.toolCalls).toEqual({
      measured: 1,
      estimated: 1,
      missing: 0
    });
    expect(agentIndex?.metricConfidence.contextTokens).toEqual({
      measured: 0,
      estimated: 2,
      missing: 0
    });
    expect(agentIndex?.measuredMedians).toMatchObject({
      wallTimeMinutes: 10,
      toolCalls: 11,
      contextTokens: null
    });
    expect(agentIndex?.estimatedMedians).toMatchObject({
      wallTimeMinutes: 12,
      toolCalls: 14,
      contextTokens: 900,
      outputTokens: 250
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

  test("rejects review artifacts with impossible condition tool claims", async () => {
    const noToolReview = {
      ...validReview(),
      condition: "no-special-tool",
      firstUsefulTool: "agent-index",
      specialToolHelped: "yes"
    };
    const noToolRoot = await writeReviewArtifact(noToolReview);

    await expect(loadAutonomousReviews(noToolRoot)).rejects.toThrow(/no-special-tool/i);

    const graphifyReview = {
      ...validReview(),
      condition: "graphify",
      firstUsefulTool: "agent-index"
    };
    const graphifyRoot = await writeReviewArtifact(graphifyReview);

    await expect(loadAutonomousReviews(graphifyRoot)).rejects.toThrow(/opposite special tool/i);
  });

  test("rejects review artifacts with invalid indexing metrics", async () => {
    const stringMetric = {
      ...validReview(),
      indexing: {
        fullIndexWallTimeSeconds: "fast"
      }
    };
    const stringMetricRoot = await writeReviewArtifact(stringMetric);

    await expect(loadAutonomousReviews(stringMetricRoot)).rejects.toThrow(/fullIndexWallTimeSeconds/i);

    const negativeMetric = {
      ...validReview(),
      indexing: {
        indexedFiles: -1
      }
    };
    const negativeMetricRoot = await writeReviewArtifact(negativeMetric);

    await expect(loadAutonomousReviews(negativeMetricRoot)).rejects.toThrow(/indexedFiles/i);

    const invalidNotes = {
      ...validReview(),
      indexing: {
        notes: 42
      }
    };
    const invalidNotesRoot = await writeReviewArtifact(invalidNotes);

    await expect(loadAutonomousReviews(invalidNotesRoot)).rejects.toThrow(/indexing.notes/i);

    const unknownMetric = {
      ...validReview(),
      indexing: {
        durationSeconds: 2
      }
    };
    const unknownMetricRoot = await writeReviewArtifact(unknownMetric);

    await expect(loadAutonomousReviews(unknownMetricRoot)).rejects.toThrow(/indexing\.durationSeconds/i);
  });

  test("rejects review artifacts with invalid run measurements", async () => {
    const badMeasurements = {
      ...validReview(),
      outputTokens: -1,
      agentTurns: "many",
      toolCalls: null
    };
    const root = await writeReviewArtifact(badMeasurements);

    await expect(loadAutonomousReviews(root)).rejects.toThrow(/outputTokens/i);
    await expect(loadAutonomousReviews(root)).rejects.toThrow(/agentTurns/i);
    await expect(loadAutonomousReviews(root)).rejects.toThrow(/toolCalls/i);
  });

  test("accepts dependency setup and coordinator verification records", async () => {
    const review = {
      ...validReview(),
      dependencySetup: {
        dependencySetupWallTimeSeconds: 16.2,
        dependencyArtifactBytes: 123456,
        notes: "Installed dependencies from a warm local package cache before the autonomous timer."
      },
      coordinatorVerification: {
        tests: "passed",
        command: "pnpm --filter @tanstack/react-query test:lib src/__tests__/useInfiniteQuery.test.tsx --run",
        notes: "Coordinator reran the same focused test after normalizing dependency setup."
      }
    };
    const root = await writeReviewArtifact(review);

    await expect(loadAutonomousReviews(root)).resolves.toHaveLength(1);
  });

  test("rejects invalid dependency setup and coordinator verification records", async () => {
    const invalidDependencySetup = {
      ...validReview(),
      dependencySetup: {
        dependencySetupWallTimeSeconds: -1
      }
    };
    const invalidDependencySetupRoot = await writeReviewArtifact(invalidDependencySetup);

    await expect(loadAutonomousReviews(invalidDependencySetupRoot)).rejects.toThrow(
      /dependencySetup\.dependencySetupWallTimeSeconds/i
    );

    const invalidCoordinatorVerification = {
      ...validReview(),
      coordinatorVerification: {
        tests: "green",
        notes: ""
      }
    };
    const invalidCoordinatorVerificationRoot = await writeReviewArtifact(invalidCoordinatorVerification);

    await expect(loadAutonomousReviews(invalidCoordinatorVerificationRoot)).rejects.toThrow(
      /coordinatorVerification/i
    );

    const unknownDependencySetup = {
      ...validReview(),
      dependencySetup: {
        preflightCommand: "pnpm --version"
      }
    };
    const unknownDependencySetupRoot = await writeReviewArtifact(unknownDependencySetup);

    await expect(loadAutonomousReviews(unknownDependencySetupRoot)).rejects.toThrow(
      /dependencySetup\.preflightCommand/i
    );
  });
});
