import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AutonomousCondition,
  AutonomousReviewRecord,
  AutonomousSummaryCondition,
  AutonomousSummaryResult,
  AutonomousTaskKind,
  AutonomousTaskDefinition,
  AutonomousTaskManifest
} from "./schema.js";

export const autonomousConditions: AutonomousCondition[] = ["graphify", "agent-index", "no-special-tool"];
const autonomousTaskKinds: AutonomousTaskKind[] = [
  "bugfix",
  "feature",
  "code-explanation",
  "test-discovery",
  "incremental-follow-up"
];
const reviewSuccessValues = ["pass", "partial", "fail"];
const reviewFirstUsefulTools = ["graphify", "agent-index", "rg", "file-read", "other"];
const reviewSpecialToolHelpedValues = ["yes", "no", "ignored", "misleading"];
const reviewTestValues = ["passed", "failed", "not-run", "not-applicable"];
const reviewFailureModes = [
  "wrong-file",
  "over-read",
  "bad-edit",
  "test-gap",
  "timeout",
  "tool-ignored",
  "tool-misled",
  "other"
];

export async function loadAutonomousTaskManifest(manifestPath: string): Promise<AutonomousTaskManifest> {
  return validateAutonomousTaskManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
    manifestPath
  );
}

export async function loadAutonomousReviews(artifactsDir: string): Promise<AutonomousReviewRecord[]> {
  const reviewPaths = await findReviewFiles(artifactsDir);
  const reviews = await Promise.all(
    reviewPaths.map(async (reviewPath) =>
      validateAutonomousReviewRecord(JSON.parse(await readFile(reviewPath, "utf8")), reviewPath)
    )
  );
  return reviews;
}

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
  if (!isPathSafeSlug(task.id)) {
    throw new Error(`autonomous task id "${task.id}" must be a path-safe slug`);
  }

  const artifactsDir = path.resolve(options.artifactsDir);
  const runDir = path.resolve(artifactsDir, task.id, condition);
  if (!isPathInside(runDir, artifactsDir)) {
    throw new Error(`autonomous run directory must stay inside artifactsDir: ${runDir}`);
  }
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

export function validateAutonomousTaskManifest(
  manifest: unknown,
  source = "autonomous manifest"
): AutonomousTaskManifest {
  const errors: string[] = [];

  if (!isRecord(manifest)) {
    throw new Error(`${source}: manifest must be an object`);
  }

  if (manifest.version !== 1) {
    errors.push(`${source}: version must be 1`);
  }
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    errors.push(`${source}: name is required`);
  }
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    errors.push(`${source}: tasks must be a non-empty array`);
  }

  const ids = new Set<string>();
  for (const task of Array.isArray(manifest.tasks) ? manifest.tasks : []) {
    validateTask(task, source, ids, errors);
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return manifest as unknown as AutonomousTaskManifest;
}

export function validateAutonomousReviewRecord(
  review: unknown,
  source = "autonomous review"
): AutonomousReviewRecord {
  if (!isRecord(review)) {
    throw new Error(`${source}: review must be an object`);
  }

  const errors: string[] = [];
  requireString(review, "taskId", source, errors);
  requireEnum(review, "condition", autonomousConditions, source, errors);
  requireEnum(review, "success", reviewSuccessValues, source, errors);
  requireQuality(review, source, errors);
  requireNullableString(review, "firstUsefulFile", source, errors);
  requireNullableEnum(review, "firstUsefulTool", reviewFirstUsefulTools, source, errors);
  requireEnum(review, "specialToolHelped", reviewSpecialToolHelpedValues, source, errors);
  requireEnum(review, "tests", reviewTestValues, source, errors);
  requireNullableEnum(review, "failureMode", reviewFailureModes, source, errors);
  requireString(review, "notes", source, errors);
  validateOptionalNonNegativeNumber(review, "wallTimeMinutes", source, errors);
  validateOptionalNonNegativeNumber(review, "filesOpened", source, errors);
  validateOptionalNonNegativeNumber(review, "contextTokens", source, errors);
  if (review.indexing !== undefined && !isRecord(review.indexing)) {
    errors.push(`${source}: indexing must be an object`);
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return review as unknown as AutonomousReviewRecord;
}

export function summarizeAutonomousReviews(
  reviews: AutonomousReviewRecord[]
): AutonomousSummaryResult {
  const failureModes: Record<string, number> = {};
  for (const review of reviews) {
    if (review.failureMode !== null) {
      failureModes[review.failureMode] = (failureModes[review.failureMode] ?? 0) + 1;
    }
  }

  return {
    runs: reviews.length,
    byCondition: autonomousConditions.map((condition) => summarizeCondition(condition, reviews)),
    failureModes
  };
}

function summarizeCondition(
  condition: AutonomousCondition,
  reviews: AutonomousReviewRecord[]
): AutonomousSummaryCondition {
  const conditionReviews = reviews.filter((review) => review.condition === condition);
  const runs = conditionReviews.length;
  const conditionTool = specialToolForCondition(condition);

  return {
    condition,
    runs,
    pass: conditionReviews.filter((review) => review.success === "pass").length,
    partial: conditionReviews.filter((review) => review.success === "partial").length,
    fail: conditionReviews.filter((review) => review.success === "fail").length,
    avgQuality: runs === 0 ? 0 : roundToFour(conditionReviews.reduce((sum, review) => sum + review.quality, 0) / runs),
    specialToolUsedRate:
      runs === 0 || conditionTool === null
        ? 0
        : conditionReviews.filter((review) => review.firstUsefulTool === conditionTool).length / runs,
    specialToolHelpedRate:
      runs === 0 ? 0 : conditionReviews.filter((review) => review.specialToolHelped === "yes").length / runs,
    medianWallTimeMinutes: upperMedian(conditionReviews.map((review) => review.wallTimeMinutes)),
    medianFilesOpened: upperMedian(conditionReviews.map((review) => review.filesOpened)),
    medianContextTokens: upperMedian(conditionReviews.map((review) => review.contextTokens))
  };
}

function specialToolForCondition(condition: AutonomousCondition): "graphify" | "agent-index" | null {
  if (condition === "graphify") {
    return "graphify";
  }
  if (condition === "agent-index") {
    return "agent-index";
  }
  return null;
}

function upperMedian(values: Array<number | undefined>): number | null {
  const sorted = values
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  return sorted[Math.floor(sorted.length / 2)];
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  source: string,
  errors: string[]
): void {
  if (typeof record[field] !== "string") {
    errors.push(`${source}: ${field} must be a string`);
  }
}

function requireEnum(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  source: string,
  errors: string[]
): void {
  if (typeof record[field] !== "string" || !allowed.includes(record[field])) {
    errors.push(`${source}: ${field} must be one of ${allowed.join(", ")}`);
  }
}

function requireNullableString(
  record: Record<string, unknown>,
  field: string,
  source: string,
  errors: string[]
): void {
  if (typeof record[field] !== "string" && record[field] !== null) {
    errors.push(`${source}: ${field} must be a string or null`);
  }
}

function requireNullableEnum(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  source: string,
  errors: string[]
): void {
  const value = record[field];
  if (!(field in record) || (value !== null && (typeof value !== "string" || !allowed.includes(value)))) {
    errors.push(`${source}: ${field} must be one of ${allowed.join(", ")} or null`);
  }
}

function requireQuality(record: Record<string, unknown>, source: string, errors: string[]): void {
  const value = record.quality;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) {
    errors.push(`${source}: quality must be an integer from 1 to 5`);
  }
}

function validateOptionalNonNegativeNumber(
  record: Record<string, unknown>,
  field: string,
  source: string,
  errors: string[]
): void {
  const value = record[field];
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    errors.push(`${source}: ${field} must be a finite non-negative number`);
  }
}

async function findReviewFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return findReviewFiles(entryPath);
      }
      if (entry.isFile() && entry.name === "review.json") {
        return [entryPath];
      }
      return [];
    })
  );
  return nested.flat().sort();
}

function validateTask(
  task: unknown,
  source: string,
  ids: Set<string>,
  errors: string[]
): void {
  if (!isRecord(task)) {
    errors.push(`${source}: task must be an object`);
    return;
  }

  const taskLabel = typeof task.id === "string" && task.id.trim().length > 0 ? task.id : "<unknown>";

  if (typeof task.id !== "string" || task.id.trim().length === 0) {
    errors.push(`${source}: task id is required`);
    return;
  }
  if (!isPathSafeSlug(task.id)) {
    errors.push(`${source}: ${taskLabel}: task id must be a path-safe slug`);
  }
  if (ids.has(task.id)) {
    errors.push(`${source}: duplicate task id "${task.id}"`);
  }
  ids.add(task.id);
  if (typeof task.repo !== "string" || task.repo.trim().length === 0) {
    errors.push(`${source}: ${taskLabel}: repo is required`);
  }
  if (!isOptionalString(task.commit)) {
    errors.push(`${source}: ${taskLabel}: commit must be a string`);
  }
  if (!isAutonomousTaskKind(task.kind)) {
    errors.push(`${source}: ${taskLabel}: kind must be one of ${autonomousTaskKinds.join(", ")}`);
  }
  if (task.prompt === undefined || task.prompt === null || task.prompt === "") {
    errors.push(`${source}: ${taskLabel}: prompt is required`);
  } else if (typeof task.prompt !== "string") {
    errors.push(`${source}: ${taskLabel}: prompt must be a string`);
  } else if (task.prompt.trim().length === 0) {
    errors.push(`${source}: ${taskLabel}: prompt is required`);
  }
  if (!Array.isArray(task.successCriteria) || task.successCriteria.length === 0) {
    errors.push(`${source}: ${taskLabel}: successCriteria must be non-empty`);
  } else if (!task.successCriteria.every((criterion) => typeof criterion === "string")) {
    errors.push(`${source}: ${taskLabel}: successCriteria must contain only strings`);
  }
  if (!isExpectedEvidence(task.expectedEvidence)) {
    errors.push(`${source}: ${taskLabel}: expectedEvidence.files must be a non-empty string array`);
  }
  if (isRecord(task.expectedEvidence) && !isOptionalStringArray(task.expectedEvidence.symbols)) {
    errors.push(`${source}: ${taskLabel}: expectedEvidence.symbols must be a string array`);
  }
  if (!isOptionalString(task.testCommand)) {
    errors.push(`${source}: ${taskLabel}: testCommand must be a string`);
  }
  if (!isOptionalString(task.notes)) {
    errors.push(`${source}: ${taskLabel}: notes must be a string`);
  }

  if (
    typeof task.prompt === "string" &&
    isExpectedEvidence(task.expectedEvidence) &&
    Array.isArray(task.successCriteria)
  ) {
    const leaked = leakedEvidence(task as unknown as AutonomousTaskDefinition);
    if (leaked.length > 0) {
      errors.push(`${source}: ${taskLabel}: prompt leaks expected evidence: ${leaked.join(", ")}`);
    }
  }
}

function leakedEvidence(task: AutonomousTaskDefinition): string[] {
  const agentVisibleText = [
    task.prompt,
    ...task.successCriteria.filter((criterion): criterion is string => typeof criterion === "string")
  ].join("\n").toLowerCase();
  const evidence = [
    ...(task.expectedEvidence?.files ?? []),
    ...(task.expectedEvidence?.symbols ?? [])
  ].filter((value) => value.length > 0);
  return evidence.filter((value) => agentVisibleText.includes(value.toLowerCase()));
}

function isPathSafeSlug(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAutonomousTaskKind(value: unknown): value is AutonomousTaskKind {
  return typeof value === "string" && autonomousTaskKinds.includes(value as AutonomousTaskKind);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

function isExpectedEvidence(value: unknown): value is { files: string[]; symbols?: string[] } {
  return isRecord(value) && isStringArray(value.files) && value.files.length > 0;
}
