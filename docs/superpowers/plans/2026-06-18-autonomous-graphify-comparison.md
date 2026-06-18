# Autonomous Graphify Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the lightweight task, run-packet, and summary support needed to start the 10-task autonomous Graphify vs agent-index vs no-special-tool pilot.

**Architecture:** Add a small autonomous-comparison layer that defines pilot task JSON, validates the three-condition run matrix, writes per-run prompt/review templates, and summarizes completed review artifacts. It does not run the agent itself; the benchmark stays a raw autonomous work trial, with the harness only preparing identical prompts and collecting human-reviewed outcomes.

**Tech Stack:** TypeScript, Node.js fs/path APIs, Commander, Vitest, existing `src/core/schema.ts` and `src/cli.ts` patterns.

---

## File Structure

- Create `src/core/autonomous-comparison.ts`: task/review loaders, validation, condition prompt generation, run-packet file writing, and summary aggregation.
- Modify `src/core/schema.ts`: shared types for autonomous tasks, conditions, review records, run packets, and summary output.
- Modify `src/cli.ts`: add `autonomous-list`, `autonomous-prepare`, and `autonomous-summary` commands.
- Create `tests/core/autonomous-comparison.test.ts`: unit coverage for validation, prompt generation, packet writing, and summary math.
- Modify `tests/core/cli.test.ts`: CLI smoke tests for the three new commands.
- Create `benchmarks/autonomous/graphify-agent-index-pilot.json`: the 10-task pilot manifest.
- Create `docs/autonomous-comparison.md`: short operator guide for running the pilot without turning it into a scripted retrieval benchmark.

## Task 1: Core Types And Validation

**Files:**
- Modify: `src/core/schema.ts`
- Create: `src/core/autonomous-comparison.ts`
- Test: `tests/core/autonomous-comparison.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `tests/core/autonomous-comparison.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: FAIL because `src/core/autonomous-comparison.ts` and the schema types do not exist.

- [ ] **Step 3: Add schema types**

Append these types in `src/core/schema.ts` after the existing navigation suite types:

```ts
export type AutonomousCondition = "graphify" | "agent-index" | "no-special-tool";

export type AutonomousTaskKind =
  | "bugfix"
  | "feature"
  | "code-explanation"
  | "test-discovery"
  | "incremental-follow-up";

export interface AutonomousExpectedEvidence {
  files: string[];
  symbols?: string[];
}

export interface AutonomousTaskDefinition {
  id: string;
  repo: string;
  commit?: string;
  kind: AutonomousTaskKind;
  prompt: string;
  successCriteria: string[];
  expectedEvidence: AutonomousExpectedEvidence;
  testCommand?: string;
  notes?: string;
}

export interface AutonomousTaskManifest {
  version: 1;
  name: string;
  tasks: AutonomousTaskDefinition[];
}

export interface AutonomousIndexMetrics {
  fullIndexWallTimeSeconds?: number;
  incrementalIndexWallTimeSeconds?: number;
  indexArtifactBytes?: number;
  indexedFiles?: number;
  indexedSymbols?: number;
  indexedNodes?: number;
  notes?: string;
}

export interface AutonomousReviewRecord {
  taskId: string;
  condition: AutonomousCondition;
  success: "pass" | "partial" | "fail";
  quality: 1 | 2 | 3 | 4 | 5;
  firstUsefulFile: string | null;
  firstUsefulTool: "graphify" | "agent-index" | "rg" | "file-read" | "other" | null;
  specialToolHelped: "yes" | "no" | "ignored" | "misleading";
  tests: "passed" | "failed" | "not-run" | "not-applicable";
  failureMode:
    | "wrong-file"
    | "over-read"
    | "bad-edit"
    | "test-gap"
    | "timeout"
    | "tool-ignored"
    | "tool-misled"
    | "other"
    | null;
  indexing?: AutonomousIndexMetrics;
  wallTimeMinutes?: number;
  filesOpened?: number;
  contextTokens?: number;
  notes: string;
}

export interface AutonomousSummaryCondition {
  condition: AutonomousCondition;
  runs: number;
  pass: number;
  partial: number;
  fail: number;
  avgQuality: number;
  specialToolUsedRate: number;
  specialToolHelpedRate: number;
  medianWallTimeMinutes: number | null;
  medianFilesOpened: number | null;
  medianContextTokens: number | null;
}

export interface AutonomousSummaryResult {
  runs: number;
  byCondition: AutonomousSummaryCondition[];
  failureModes: Record<string, number>;
}
```

- [ ] **Step 4: Implement manifest validation**

Create `src/core/autonomous-comparison.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AutonomousCondition,
  AutonomousReviewRecord,
  AutonomousSummaryCondition,
  AutonomousSummaryResult,
  AutonomousTaskDefinition,
  AutonomousTaskManifest
} from "./schema.js";

export const autonomousConditions: AutonomousCondition[] = ["graphify", "agent-index", "no-special-tool"];

export async function loadAutonomousTaskManifest(manifestPath: string): Promise<AutonomousTaskManifest> {
  return validateAutonomousTaskManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as AutonomousTaskManifest,
    manifestPath
  );
}

export function validateAutonomousTaskManifest(
  manifest: AutonomousTaskManifest,
  source = "autonomous manifest"
): AutonomousTaskManifest {
  const errors: string[] = [];
  if (manifest.version !== 1) {
    errors.push(`${source}: version must be 1`);
  }
  if (!manifest.name || manifest.name.trim().length === 0) {
    errors.push(`${source}: name is required`);
  }
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    errors.push(`${source}: tasks must be a non-empty array`);
  }

  const ids = new Set<string>();
  for (const task of manifest.tasks ?? []) {
    validateTask(task, source, ids, errors);
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return manifest;
}

function validateTask(
  task: AutonomousTaskDefinition,
  source: string,
  ids: Set<string>,
  errors: string[]
): void {
  if (!task.id || task.id.trim().length === 0) {
    errors.push(`${source}: task id is required`);
    return;
  }
  if (ids.has(task.id)) {
    errors.push(`${source}: duplicate task id "${task.id}"`);
  }
  ids.add(task.id);
  if (!task.repo || task.repo.trim().length === 0) {
    errors.push(`${source}: ${task.id}: repo is required`);
  }
  if (!task.prompt || task.prompt.trim().length === 0) {
    errors.push(`${source}: ${task.id}: prompt is required`);
  }
  if (!Array.isArray(task.successCriteria) || task.successCriteria.length === 0) {
    errors.push(`${source}: ${task.id}: successCriteria must be non-empty`);
  }
  const leaked = leakedEvidence(task);
  if (leaked.length > 0) {
    errors.push(`${source}: ${task.id}: prompt leaks expected evidence: ${leaked.join(", ")}`);
  }
}

function leakedEvidence(task: AutonomousTaskDefinition): string[] {
  const prompt = task.prompt.toLowerCase();
  const evidence = [
    ...(task.expectedEvidence?.files ?? []),
    ...(task.expectedEvidence?.symbols ?? [])
  ].filter((value) => value.length > 0);
  return evidence.filter((value) => prompt.includes(value.toLowerCase()));
}
```

- [ ] **Step 5: Run validation tests**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: PASS for all tests in `autonomous-comparison.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/core/schema.ts src/core/autonomous-comparison.ts tests/core/autonomous-comparison.test.ts
git commit -m "Add autonomous comparison manifest validation"
```

## Task 2: Prompt Packet Generation

**Files:**
- Modify: `src/core/autonomous-comparison.ts`
- Test: `tests/core/autonomous-comparison.test.ts`

- [ ] **Step 1: Add failing tests for prompt packets**

Append to `tests/core/autonomous-comparison.test.ts`:

```ts
import { prepareAutonomousRunPacket } from "../../src/core/autonomous-comparison.js";

test("writes a run packet without leaking expected evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-packet-"));
  const manifest = validManifest();
  const packet = await prepareAutonomousRunPacket(manifest.tasks[0], "agent-index", {
    artifactsDir: root,
    timeLimitMinutes: 30
  });

  expect(packet.taskId).toBe("click-color-default-behavior");
  expect(packet.condition).toBe("agent-index");
  expect(packet.runDir).toContain("click-color-default-behavior/agent-index");

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
    specialToolHelped: "ignored"
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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: FAIL because `prepareAutonomousRunPacket()` is not implemented.

- [ ] **Step 3: Implement packet generation**

Add these exports to `src/core/autonomous-comparison.ts`:

```ts
export interface PrepareAutonomousRunOptions {
  artifactsDir: string;
  timeLimitMinutes?: number;
}

export interface AutonomousRunPacket {
  taskId: string;
  condition: AutonomousCondition;
  runDir: string;
  promptPath: string;
  reviewTemplatePath: string;
}

export async function prepareAutonomousRunPacket(
  task: AutonomousTaskDefinition,
  condition: AutonomousCondition,
  options: PrepareAutonomousRunOptions
): Promise<AutonomousRunPacket> {
  const runDir = path.join(options.artifactsDir, task.id, condition);
  await mkdir(runDir, { recursive: true });
  const promptPath = path.join(runDir, "prompt.md");
  const reviewTemplatePath = path.join(runDir, "review-template.json");
  await writeFile(promptPath, renderAutonomousPrompt(task, condition, options.timeLimitMinutes ?? 30));
  await writeFile(reviewTemplatePath, `${JSON.stringify(reviewTemplate(task.id, condition), null, 2)}\n`);
  return {
    taskId: task.id,
    condition,
    runDir,
    promptPath,
    reviewTemplatePath
  };
}

export function renderAutonomousPrompt(
  task: AutonomousTaskDefinition,
  condition: AutonomousCondition,
  timeLimitMinutes = 30
): string {
  return [
    `# Autonomous Trial: ${task.id}`,
    "",
    `Repository: ${task.repo}`,
    `Task kind: ${task.kind}`,
    `Time limit: ${timeLimitMinutes} minute wall-clock cap`,
    "",
    "## Task",
    "",
    task.prompt,
    "",
    "## Success Criteria",
    "",
    ...task.successCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## Tool Condition",
    "",
    conditionInstructions(condition),
    "",
    "## Run Rules",
    "",
    "- Work autonomously until the task is complete, blocked, or the time limit is reached.",
    "- Use normal shell, file-reading, editing, and test commands as needed.",
    "- Do not use internet access, credentials, or services outside the repository.",
    "- For explanation-only tasks, cite the relevant files and line numbers.",
    "- At the end, report what changed or what you found, and list tests run.",
    ""
  ].join("\n");
}

function conditionInstructions(condition: AutonomousCondition): string {
  if (condition === "graphify") {
    return [
      "Graphify is available for codebase navigation.",
      "Use Graphify when it seems useful, but you may also use ordinary shell tools."
    ].join("\n");
  }
  if (condition === "agent-index") {
    return [
      "agent-index is available for codebase navigation.",
      "Use agent-index when it seems useful, but you may also use ordinary shell tools."
    ].join("\n");
  }
  return [
    "No special code-navigation tool is available.",
    "Use ordinary shell tools, file reads, edits, and tests."
  ].join("\n");
}

function reviewTemplate(taskId: string, condition: AutonomousCondition): AutonomousReviewRecord {
  return {
    taskId,
    condition,
    success: "fail",
    quality: 1,
    firstUsefulFile: null,
    firstUsefulTool: null,
    specialToolHelped: "ignored",
    tests: "not-run",
    failureMode: null,
    indexing: {},
    notes: ""
  };
}
```

- [ ] **Step 4: Run prompt packet tests**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/autonomous-comparison.ts tests/core/autonomous-comparison.test.ts
git commit -m "Generate autonomous trial run packets"
```

## Task 3: Summary Aggregation

**Files:**
- Modify: `src/core/autonomous-comparison.ts`
- Test: `tests/core/autonomous-comparison.test.ts`

- [ ] **Step 1: Add failing summary tests**

Append to `tests/core/autonomous-comparison.test.ts`:

```ts
import { summarizeAutonomousReviews } from "../../src/core/autonomous-comparison.js";
import type { AutonomousReviewRecord } from "../../src/core/schema.js";

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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: FAIL because `summarizeAutonomousReviews()` is not implemented.

- [ ] **Step 3: Implement summary aggregation**

Add to `src/core/autonomous-comparison.ts`:

```ts
export function summarizeAutonomousReviews(reviews: AutonomousReviewRecord[]): AutonomousSummaryResult {
  return {
    runs: reviews.length,
    byCondition: autonomousConditions.map((condition) => summarizeCondition(condition, reviews)),
    failureModes: summarizeFailureModes(reviews)
  };
}

function summarizeCondition(
  condition: AutonomousCondition,
  reviews: AutonomousReviewRecord[]
): AutonomousSummaryCondition {
  const matching = reviews.filter((review) => review.condition === condition);
  return {
    condition,
    runs: matching.length,
    pass: matching.filter((review) => review.success === "pass").length,
    partial: matching.filter((review) => review.success === "partial").length,
    fail: matching.filter((review) => review.success === "fail").length,
    avgQuality: average(matching.map((review) => review.quality)),
    specialToolUsedRate: ratio(
      matching.filter((review) => review.firstUsefulTool === conditionTool(condition)).length,
      matching.length
    ),
    specialToolHelpedRate: ratio(
      matching.filter((review) => review.specialToolHelped === "yes").length,
      matching.length
    ),
    medianWallTimeMinutes: median(matching.map((review) => review.wallTimeMinutes)),
    medianFilesOpened: median(matching.map((review) => review.filesOpened)),
    medianContextTokens: median(matching.map((review) => review.contextTokens))
  };
}

function conditionTool(condition: AutonomousCondition): "graphify" | "agent-index" | null {
  if (condition === "graphify") {
    return "graphify";
  }
  if (condition === "agent-index") {
    return "agent-index";
  }
  return null;
}

function summarizeFailureModes(reviews: AutonomousReviewRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const review of reviews) {
    if (review.failureMode) {
      counts[review.failureMode] = (counts[review.failureMode] ?? 0) + 1;
    }
  }
  return counts;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function median(values: Array<number | undefined>): number | null {
  const sorted = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  return sorted[Math.floor(sorted.length / 2)];
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}
```

- [ ] **Step 4: Run summary tests**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/autonomous-comparison.ts tests/core/autonomous-comparison.test.ts
git commit -m "Summarize autonomous comparison reviews"
```

## Task 4: CLI Commands

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/core/cli.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Append to `tests/core/cli.test.ts` near the existing command tests:

```ts
test("lists autonomous comparison tasks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-cli-list-"));
  const manifestPath = path.join(root, "pilot.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      version: 1,
      name: "pilot",
      tasks: [
        {
          id: "click-color-default-behavior",
          repo: "click",
          kind: "bugfix",
          prompt: "Find and fix where Click decides default color behavior from environment state.",
          successCriteria: ["NO_COLOR disables color by default."],
          expectedEvidence: {
            files: ["src/click/globals.py"],
            symbols: ["resolve_color_default"]
          }
        }
      ]
    })
  );

  const output = await runCliForTest(["autonomous-list", manifestPath]);
  expect(output).toContain("pilot");
  expect(output).toContain("click-color-default-behavior");
  expect(output).toContain("graphify, agent-index, no-special-tool");
});

test("prepares an autonomous run packet", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-cli-prepare-"));
  const manifestPath = path.join(root, "pilot.json");
  const artifactsDir = path.join(root, "artifacts");
  await writeFile(
    manifestPath,
    JSON.stringify({
      version: 1,
      name: "pilot",
      tasks: [
        {
          id: "click-color-default-behavior",
          repo: "click",
          kind: "bugfix",
          prompt: "Find and fix where Click decides default color behavior from environment state.",
          successCriteria: ["NO_COLOR disables color by default."],
          expectedEvidence: {
            files: ["src/click/globals.py"],
            symbols: ["resolve_color_default"]
          }
        }
      ]
    })
  );

  const output = await runCliForTest([
    "autonomous-prepare",
    manifestPath,
    "--task",
    "click-color-default-behavior",
    "--condition",
    "agent-index",
    "--artifacts-dir",
    artifactsDir
  ]);

  expect(output).toContain("prompt.md");
  const prompt = await readFile(path.join(artifactsDir, "click-color-default-behavior", "agent-index", "prompt.md"), "utf8");
  expect(prompt).toContain("agent-index is available");
});
```

- [ ] **Step 2: Run CLI tests to verify failure**

Run: `npx vitest run tests/core/cli.test.ts -t autonomous`

Expected: FAIL because the CLI commands do not exist.

- [ ] **Step 3: Add CLI imports**

In `src/cli.ts`, extend imports:

```ts
import {
  autonomousConditions,
  loadAutonomousTaskManifest,
  prepareAutonomousRunPacket,
  summarizeAutonomousReviews
} from "./core/autonomous-comparison.js";
import type { AutonomousCondition, AutonomousReviewRecord } from "./core/schema.js";
```

- [ ] **Step 4: Add CLI commands**

In `runCli()` before `program.parseAsync(argv)`, add:

```ts
  program
    .command("autonomous-list")
    .argument("<manifest>", "autonomous comparison task manifest")
    .action(async (manifestPath: string) => {
      const manifest = await loadAutonomousTaskManifest(manifestPath);
      io.write(formatAutonomousList(manifest));
    });

  program
    .command("autonomous-prepare")
    .argument("<manifest>", "autonomous comparison task manifest")
    .requiredOption("--task <id>", "task id to prepare")
    .requiredOption("--condition <condition>", "graphify, agent-index, or no-special-tool")
    .requiredOption("--artifacts-dir <path>", "artifact root for run packets")
    .option("--time-limit-minutes <minutes>", "wall-clock cap included in the prompt", "30")
    .action(
      async (
        manifestPath: string,
        options: { task: string; condition: string; artifactsDir: string; timeLimitMinutes: string }
      ) => {
        const manifest = await loadAutonomousTaskManifest(manifestPath);
        const task = manifest.tasks.find((candidate) => candidate.id === options.task);
        if (!task) {
          throw new Error(`Unknown autonomous task: ${options.task}`);
        }
        const condition = parseAutonomousCondition(options.condition);
        const packet = await prepareAutonomousRunPacket(task, condition, {
          artifactsDir: options.artifactsDir,
          timeLimitMinutes: Number.parseInt(options.timeLimitMinutes, 10)
        });
        io.write(`Prepared ${packet.taskId} / ${packet.condition}`);
        io.write(`Prompt: ${packet.promptPath}`);
        io.write(`Review template: ${packet.reviewTemplatePath}`);
      }
    );
```

- [ ] **Step 5: Add CLI format helpers**

Near other `format*` helpers in `src/cli.ts`, add:

```ts
function parseAutonomousCondition(value: string): AutonomousCondition {
  if (autonomousConditions.includes(value as AutonomousCondition)) {
    return value as AutonomousCondition;
  }
  throw new Error(`Invalid autonomous condition: ${value}`);
}

function formatAutonomousList(manifest: { name: string; tasks: Array<{ id: string; repo: string; kind: string }> }): string {
  return [
    `Autonomous comparison: ${manifest.name}`,
    `Conditions: ${autonomousConditions.join(", ")}`,
    "",
    ...manifest.tasks.map((task) => `${task.id}\t${task.repo}\t${task.kind}`)
  ].join("\n");
}
```

- [ ] **Step 6: Run CLI tests**

Run: `npx vitest run tests/core/cli.test.ts -t autonomous`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/core/cli.test.ts
git commit -m "Expose autonomous comparison CLI helpers"
```

## Task 5: Summary CLI

**Files:**
- Modify: `src/core/autonomous-comparison.ts`
- Modify: `src/cli.ts`
- Modify: `tests/core/cli.test.ts`

- [ ] **Step 1: Add failing test for summary command**

Append to `tests/core/cli.test.ts`:

```ts
test("summarizes autonomous review JSON files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-cli-summary-"));
  const reviewDir = path.join(root, "task-a", "agent-index");
  await mkdir(reviewDir, { recursive: true });
  await writeFile(
    path.join(reviewDir, "review.json"),
    JSON.stringify({
      taskId: "task-a",
      condition: "agent-index",
      success: "pass",
      quality: 5,
      firstUsefulFile: "src/a.ts",
      firstUsefulTool: "agent-index",
      specialToolHelped: "yes",
      tests: "passed",
      failureMode: null,
      wallTimeMinutes: 8,
      filesOpened: 3,
      contextTokens: 700,
      notes: "done"
    })
  );

  const output = await runCliForTest(["autonomous-summary", root]);
  expect(output).toContain("Runs: 1");
  expect(output).toContain("agent-index");
  expect(output).toContain("pass=1");
});
```

- [ ] **Step 2: Run CLI test to verify failure**

Run: `npx vitest run tests/core/cli.test.ts -t autonomous`

Expected: FAIL because `autonomous-summary` is not implemented.

- [ ] **Step 3: Add recursive review loading**

Add to `src/core/autonomous-comparison.ts`:

```ts
import { readdir } from "node:fs/promises";

export async function loadAutonomousReviews(artifactsDir: string): Promise<AutonomousReviewRecord[]> {
  const reviewPaths = await findReviewFiles(artifactsDir);
  const reviews: AutonomousReviewRecord[] = [];
  for (const reviewPath of reviewPaths) {
    reviews.push(JSON.parse(await readFile(reviewPath, "utf8")) as AutonomousReviewRecord);
  }
  return reviews;
}

async function findReviewFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findReviewFiles(entryPath)));
    } else if (entry.name === "review.json") {
      files.push(entryPath);
    }
  }
  return files;
}
```

Ensure the existing `node:fs/promises` import becomes:

```ts
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
```

- [ ] **Step 4: Add summary CLI command and formatter**

In `src/cli.ts`, include `loadAutonomousReviews` in the autonomous import and add:

```ts
  program
    .command("autonomous-summary")
    .argument("<artifacts-dir>", "artifact root containing review.json files")
    .option("--json", "write JSON summary")
    .action(async (artifactsDir: string, options: { json?: boolean }) => {
      const reviews = await loadAutonomousReviews(artifactsDir);
      const summary = summarizeAutonomousReviews(reviews);
      io.write(options.json ? JSON.stringify(summary, null, 2) : formatAutonomousSummary(summary));
    });
```

Near CLI format helpers, add:

```ts
function formatAutonomousSummary(summary: { runs: number; byCondition: Array<{ condition: string; runs: number; pass: number; partial: number; fail: number; avgQuality: number; specialToolUsedRate: number; specialToolHelpedRate: number }> }): string {
  return [
    `Runs: ${summary.runs}`,
    "",
    ...summary.byCondition.map(
      (row) =>
        `${row.condition}: runs=${row.runs} pass=${row.pass} partial=${row.partial} fail=${row.fail} avgQuality=${row.avgQuality} specialToolUsed=${row.specialToolUsedRate} specialToolHelped=${row.specialToolHelpedRate}`
    )
  ].join("\n");
}
```

- [ ] **Step 5: Run summary CLI tests**

Run: `npx vitest run tests/core/cli.test.ts -t autonomous`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/autonomous-comparison.ts src/cli.ts tests/core/cli.test.ts
git commit -m "Summarize autonomous comparison artifacts"
```

## Task 6: Pilot Manifest

**Files:**
- Create: `benchmarks/autonomous/graphify-agent-index-pilot.json`
- Test: `tests/core/autonomous-comparison.test.ts`

- [ ] **Step 1: Add failing test that the pilot manifest is valid**

Append to `tests/core/autonomous-comparison.test.ts`:

```ts
test("pilot manifest is valid and has ten tasks", async () => {
  const manifest = await loadAutonomousTaskManifest("benchmarks/autonomous/graphify-agent-index-pilot.json");
  expect(manifest.name).toBe("graphify-agent-index-pilot");
  expect(manifest.tasks).toHaveLength(10);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts -t "pilot manifest"`

Expected: FAIL because `benchmarks/autonomous/graphify-agent-index-pilot.json` does not exist.

- [ ] **Step 3: Create the pilot manifest**

Create `benchmarks/autonomous/graphify-agent-index-pilot.json`:

```json
{
  "version": 1,
  "name": "graphify-agent-index-pilot",
  "tasks": [
    {
      "id": "click-color-default-behavior",
      "repo": "click",
      "kind": "bugfix",
      "prompt": "Find and fix where Click decides default color behavior from environment state. The fix should honor the standard environment signal for disabling color output while preserving explicit color enablement.",
      "successCriteria": [
        "The environment signal disables color by default.",
        "Explicit color enablement still wins over the environment default.",
        "Relevant color/default tests pass."
      ],
      "expectedEvidence": {
        "files": ["src/click/globals.py", "tests/test_globals.py"],
        "symbols": ["resolve_color_default"]
      },
      "testCommand": "pytest tests/test_globals.py"
    },
    {
      "id": "httpx-redirect-history",
      "repo": "httpx",
      "kind": "bugfix",
      "prompt": "Investigate redirect handling and make sure response history is preserved correctly across redirects. Update or identify the relevant tests.",
      "successCriteria": [
        "Redirect response history is preserved in the expected order.",
        "The behavior is covered by the relevant client redirect tests.",
        "Relevant redirect tests pass."
      ],
      "expectedEvidence": {
        "files": ["httpx/_client.py", "tests/client/test_redirects.py"],
        "symbols": ["Client.send", "AsyncClient.send"]
      },
      "testCommand": "pytest tests/client/test_redirects.py"
    },
    {
      "id": "pydantic-computed-fields-serialization",
      "repo": "pydantic",
      "kind": "code-explanation",
      "prompt": "Explain how computed fields flow through model serialization and where exclusion behavior is implemented. No code change is required.",
      "successCriteria": [
        "The explanation names the source path for model serialization.",
        "The explanation names the computed-field metadata path.",
        "The explanation cites relevant tests or test locations."
      ],
      "expectedEvidence": {
        "files": ["pydantic/main.py", "pydantic/fields.py", "tests/test_computed_fields.py"],
        "symbols": ["computed_field"]
      }
    },
    {
      "id": "tanstack-query-infinite-query-flow",
      "repo": "query",
      "kind": "feature",
      "prompt": "Trace the infinite query feature from the React hook into core query behavior, especially how page parameters flow through fetches and tests. Make the smallest enhancement or documentation-quality explanation needed to clarify that path.",
      "successCriteria": [
        "The React hook and core behavior paths are both identified.",
        "The page parameter flow is explained or improved.",
        "Relevant infinite-query tests are identified or run."
      ],
      "expectedEvidence": {
        "files": [
          "packages/react-query/src/useInfiniteQuery.ts",
          "packages/query-core/src/infiniteQueryBehavior.ts",
          "packages/react-query/src/__tests__/useInfiniteQuery.test.tsx"
        ],
        "symbols": ["useInfiniteQuery", "infiniteQueryBehavior"]
      },
      "testCommand": "pnpm test useInfiniteQuery"
    },
    {
      "id": "rich-print-json-file-output",
      "repo": "rich",
      "kind": "feature",
      "prompt": "Add or verify support for sending JSON pretty-print output to a caller-provided file-like destination instead of always writing to the default console.",
      "successCriteria": [
        "The public JSON printing entrypoint supports file-like output.",
        "The console output path remains compatible.",
        "Relevant JSON output tests pass."
      ],
      "expectedEvidence": {
        "files": ["rich/__init__.py", "rich/console.py", "tests/test_json.py"],
        "symbols": ["print_json", "Console.print_json"]
      },
      "testCommand": "pytest tests/test_json.py"
    },
    {
      "id": "sqlalchemy-rowcount-preservation",
      "repo": "sqlalchemy",
      "kind": "bugfix",
      "prompt": "Investigate how rowcount is preserved for executed statements and fix or explain the path that controls preservation behavior.",
      "successCriteria": [
        "The execution/result path controlling rowcount preservation is identified.",
        "The behavior is fixed or explained with relevant source citations.",
        "Relevant engine or SQL tests are identified or run."
      ],
      "expectedEvidence": {
        "files": ["lib/sqlalchemy/engine/cursor.py", "test/sql/test_resultset.py"],
        "symbols": ["CursorResult"]
      },
      "testCommand": "pytest test/sql/test_resultset.py"
    },
    {
      "id": "fastapi-response-serialization",
      "repo": "fastapi",
      "kind": "code-explanation",
      "prompt": "Explain the response serialization path for endpoint return values, including where field validation or serialization is applied. No code change is required.",
      "successCriteria": [
        "The route handling source path is identified.",
        "The serialization helper path is identified.",
        "The answer cites relevant tests or examples."
      ],
      "expectedEvidence": {
        "files": ["fastapi/routing.py", "tests/test_serialize_response.py"],
        "symbols": ["serialize_response"]
      }
    },
    {
      "id": "vite-env-prefix-behavior",
      "repo": "vite",
      "kind": "bugfix",
      "prompt": "Investigate environment variable prefix handling and ensure only intended variables are exposed through configuration. Update or identify relevant tests.",
      "successCriteria": [
        "The environment-loading path is identified.",
        "Prefix filtering behavior is correct.",
        "Relevant config or env tests pass."
      ],
      "expectedEvidence": {
        "files": ["packages/vite/src/node/env.ts", "packages/vite/src/node/config.ts"],
        "symbols": ["loadEnv"]
      },
      "testCommand": "pnpm test env"
    },
    {
      "id": "redux-toolkit-create-slice-bugfix",
      "repo": "redux-toolkit",
      "kind": "bugfix",
      "prompt": "Investigate slice creation behavior around generated reducers and actions, then fix or explain the smallest path responsible for the issue.",
      "successCriteria": [
        "The slice creation implementation path is identified.",
        "Generated reducer/action behavior is fixed or explained.",
        "Relevant create-slice tests are identified or run."
      ],
      "expectedEvidence": {
        "files": ["packages/toolkit/src/createSlice.ts", "packages/toolkit/src/tests/createSlice.test.ts"],
        "symbols": ["createSlice"]
      },
      "testCommand": "pnpm test createSlice"
    },
    {
      "id": "graphify-query-path-explanation",
      "repo": "graphify",
      "kind": "code-explanation",
      "prompt": "Explain how a codebase question becomes selected graph context in Graphify, from query text through seed selection and traversal. No code change is required.",
      "successCriteria": [
        "The query entrypoint or serving path is identified.",
        "Seed selection is explained.",
        "Graph traversal or context selection is explained."
      ],
      "expectedEvidence": {
        "files": ["graphify/serve.py", "graphify/query.py"],
        "symbols": ["_pick_seeds"]
      }
    }
  ]
}
```

- [ ] **Step 4: Run manifest test**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts -t "pilot manifest"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add benchmarks/autonomous/graphify-agent-index-pilot.json tests/core/autonomous-comparison.test.ts
git commit -m "Add autonomous comparison pilot manifest"
```

## Task 7: Operator Documentation

**Files:**
- Create: `docs/autonomous-comparison.md`
- Modify: `README.md`

- [ ] **Step 1: Write the operator guide**

Create `docs/autonomous-comparison.md`:

```markdown
# Autonomous Comparison Pilot

This pilot compares three autonomous agent conditions on the same real-world tasks:

- Graphify available
- agent-index available
- no special code-navigation tool available

The harness prepares identical task prompts and review templates. It does not script the agent's search steps.

## Prepare A Run Packet

```bash
npm run build
node dist/cli.js autonomous-list benchmarks/autonomous/graphify-agent-index-pilot.json
node dist/cli.js autonomous-prepare benchmarks/autonomous/graphify-agent-index-pilot.json \
  --task click-color-default-behavior \
  --condition agent-index \
  --artifacts-dir /tmp/agent-index-autonomous-artifacts
```

Give the generated `prompt.md` to the autonomous agent in a clean checkout of the target repository.

## Record A Review

After the run, copy `review-template.json` to `review.json` and fill in the observed outcome:

```json
{
  "taskId": "click-color-default-behavior",
  "condition": "agent-index",
  "success": "pass",
  "quality": 5,
  "firstUsefulFile": "src/click/globals.py",
  "firstUsefulTool": "agent-index",
  "specialToolHelped": "yes",
  "tests": "passed",
    "failureMode": null,
    "indexing": {
      "fullIndexWallTimeSeconds": 18,
      "indexArtifactBytes": 1048576,
      "indexedFiles": 142,
      "indexedSymbols": 3081,
      "notes": "Measured before starting the autonomous run timer."
    },
    "wallTimeMinutes": 14,
  "filesOpened": 5,
  "contextTokens": 1200,
  "notes": "The agent used agent-index first, found the default-color function, patched behavior, and ran focused tests."
}
```

## Summarize Results

```bash
node dist/cli.js autonomous-summary /tmp/agent-index-autonomous-artifacts
node dist/cli.js autonomous-summary /tmp/agent-index-autonomous-artifacts --json
```

Report pilot results by scenario and condition. Do not claim statistical dominance from one run per task.
```

- [ ] **Step 2: Link from README**

Add a short bullet near the benchmark or docs section in `README.md`:

```markdown
- [Autonomous comparison pilot](docs/autonomous-comparison.md) describes the raw agent-work trial comparing Graphify, agent-index, and no-special-tool conditions.
```

- [ ] **Step 3: Run documentation checks**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/autonomous-comparison.md README.md
git commit -m "Document autonomous comparison pilot workflow"
```

## Task 8: Final Verification

**Files:**
- All files changed in Tasks 1-7

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/core/autonomous-comparison.test.ts tests/core/cli.test.ts -t autonomous
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Smoke the built CLI**

Run:

```bash
node dist/cli.js autonomous-list benchmarks/autonomous/graphify-agent-index-pilot.json
```

Expected output includes:

```text
Autonomous comparison: graphify-agent-index-pilot
Conditions: graphify, agent-index, no-special-tool
click-color-default-behavior
```

- [ ] **Step 5: Check final status**

Run:

```bash
git status --short
```

Expected: clean worktree after the final verification commit, or only intentional uncommitted artifacts if the user asked not to commit.

## Self-Review

- Spec coverage: The plan covers task definitions, three conditions, run packets, review capture, summary reporting, typed indexing-cost metrics in review artifacts, and operator docs. It keeps agent execution autonomous and excludes optimized rg baselines and setup-complexity scoring.
- Red-flag scan: No unfinished-work markers remain. The only intentionally human-filled file is `review.json`, generated from an explicit template after a real run.
- Type consistency: `AutonomousCondition`, `AutonomousTaskManifest`, `AutonomousReviewRecord`, and summary names are consistent across schema, core, CLI, tests, and docs.
