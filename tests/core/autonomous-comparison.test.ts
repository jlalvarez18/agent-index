import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  autonomousConditions,
  loadAutonomousTaskManifest,
  validateAutonomousTaskManifest
} from "../../src/core/autonomous-comparison.js";
import type { AutonomousTaskManifest } from "../../src/core/schema.js";

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

  test("loads a manifest from disk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-manifest-"));
    const manifestPath = path.join(root, "pilot.json");
    await writeFile(manifestPath, JSON.stringify(validManifest(), null, 2));
    const manifest = await loadAutonomousTaskManifest(manifestPath);
    expect(manifest.tasks[0].id).toBe("click-color-default-behavior");
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
});
