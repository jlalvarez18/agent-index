import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AutonomousCondition,
  AutonomousMetricConfidence,
  AutonomousReviewRecord,
  AutonomousSummaryMetricMedians,
  AutonomousSummaryCondition,
  AutonomousSummaryResult,
  AutonomousTelemetry,
  AutonomousTelemetryMetric,
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
const autonomousIndexMetricFields = [
  "fullIndexWallTimeSeconds",
  "incrementalIndexWallTimeSeconds",
  "indexArtifactBytes",
  "indexedFiles",
  "indexedSymbols",
  "indexedNodes"
];
const autonomousDependencySetupMetricFields = [
  "dependencySetupWallTimeSeconds",
  "dependencyArtifactBytes"
];
const autonomousIndexMetricFieldSet = new Set([...autonomousIndexMetricFields, "notes"]);
const autonomousDependencySetupMetricFieldSet = new Set([...autonomousDependencySetupMetricFields, "notes"]);
const autonomousCoordinatorVerificationFieldSet = new Set(["tests", "command", "notes"]);
const autonomousTelemetryFieldSet = new Set([
  "schemaVersion",
  "metadata",
  "artifacts",
  "timestamps",
  "metrics",
  "indexSetup",
  "dependencySetup",
  "testCommands"
]);
const autonomousTelemetryMetadataFieldSet = new Set([
  "taskId",
  "condition",
  "repo",
  "taskKind",
  "commit",
  "testCommand"
]);
const autonomousTelemetryArtifactFieldSet = new Set([
  "runDir",
  "promptPath",
  "reviewTemplatePath",
  "reviewPath",
  "generatedPaths"
]);
const autonomousTelemetryTimestampFields = [
  "preparedAt",
  "reviewTemplateWrittenAt",
  "reviewWrittenAt",
  "validationStartedAt",
  "validationCompletedAt",
  "runStartedAt",
  "runEndedAt"
] as const;
const autonomousTelemetryTimestampFieldSet = new Set(autonomousTelemetryTimestampFields);
const autonomousTelemetryMetricFields = [
  "wallTimeSeconds",
  "filesOpened",
  "contextTokens",
  "outputTokens",
  "agentTurns",
  "toolCalls",
  "commandInvocations"
] as const;
const autonomousTelemetryMetricFieldSet = new Set(autonomousTelemetryMetricFields);
const autonomousTelemetrySetupMetricFields = [
  "fullIndexWallTimeSeconds",
  "incrementalIndexWallTimeSeconds",
  "indexArtifactBytes",
  "indexedFiles",
  "indexedSymbols",
  "indexedNodes",
  "dependencySetupWallTimeSeconds",
  "dependencyArtifactBytes"
] as const;
const autonomousTelemetrySetupMetricFieldSet = new Set(autonomousTelemetrySetupMetricFields);
const autonomousTelemetryMetricSourceValues = ["measured", "estimated"];
const autonomousTelemetryTestCommandFieldSet = new Set([
  "command",
  "outcome",
  "exitCode",
  "source",
  "startedAt",
  "endedAt",
  "notes"
]);
const summaryMetricFields = [
  "wallTimeMinutes",
  "filesOpened",
  "contextTokens",
  "outputTokens",
  "agentTurns",
  "toolCalls"
] as const;
type SummaryMetricField = (typeof summaryMetricFields)[number];

export async function loadAutonomousTaskManifest(manifestPath: string): Promise<AutonomousTaskManifest> {
  return validateAutonomousTaskManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
    manifestPath
  );
}

export async function loadAutonomousReviews(artifactsDir: string): Promise<AutonomousReviewRecord[]> {
  const reviewPaths = await findReviewFiles(artifactsDir);
  const reviews = await Promise.all(
    reviewPaths.map(async (reviewPath) => {
      const validationStartedAt = new Date().toISOString();
      const [text, reviewStats] = await Promise.all([readFile(reviewPath, "utf8"), stat(reviewPath)]);
      const review = validateAutonomousReviewRecord(JSON.parse(text), reviewPath);
      return annotateLoadedReviewTelemetry(
        review,
        reviewPath,
        reviewStats.mtime.toISOString(),
        validationStartedAt,
        new Date().toISOString()
      );
    })
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
  const preparedAt = new Date().toISOString();
  await writeFile(promptPath, renderAutonomousPrompt(task, condition, options.timeLimitMinutes ?? 30));
  const reviewTemplateWrittenAt = new Date().toISOString();
  await writeFile(
    reviewTemplatePath,
    `${JSON.stringify(
      reviewTemplate(task, condition, runDir, promptPath, reviewTemplatePath, preparedAt, reviewTemplateWrittenAt),
      null,
      2
    )}\n`
  );

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
    "- At the end, record benchmark measurements in review.json. Keep legacy fields such as wallTimeMinutes, agentTurns, toolCalls, filesOpened, contextTokens, and outputTokens for compatibility.",
    "- For each metric you can substantiate, also fill telemetry.metrics with value, source (measured or estimated), and method. Token counts may be estimates only when exact counters are unavailable; record the estimation method.",
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
  validateOptionalNonNegativeNumber(review, "outputTokens", source, errors);
  validateOptionalNonNegativeNumber(review, "agentTurns", source, errors);
  validateOptionalNonNegativeNumber(review, "toolCalls", source, errors);
  validateConditionToolClaims(review, source, errors);
  if (review.indexing !== undefined && !isRecord(review.indexing)) {
    errors.push(`${source}: indexing must be an object`);
  } else if (isRecord(review.indexing)) {
    validateIndexingMetrics(review.indexing, source, errors);
  }
  if (review.dependencySetup !== undefined && !isRecord(review.dependencySetup)) {
    errors.push(`${source}: dependencySetup must be an object`);
  } else if (isRecord(review.dependencySetup)) {
    validateDependencySetupMetrics(review.dependencySetup, source, errors);
  }
  if (review.coordinatorVerification !== undefined && !isRecord(review.coordinatorVerification)) {
    errors.push(`${source}: coordinatorVerification must be an object`);
  } else if (isRecord(review.coordinatorVerification)) {
    validateCoordinatorVerification(review.coordinatorVerification, source, errors);
  }
  if (review.telemetry !== undefined && !isRecord(review.telemetry)) {
    errors.push(`${source}: telemetry must be an object`);
  } else if (isRecord(review.telemetry)) {
    validateTelemetry(review.telemetry, source, errors);
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
      runs === 0 || conditionTool === null
        ? 0
        : conditionReviews.filter((review) => review.specialToolHelped === "yes").length / runs,
    medianWallTimeMinutes: medianResolvedMetric(conditionReviews, "wallTimeMinutes"),
    medianFilesOpened: medianResolvedMetric(conditionReviews, "filesOpened"),
    medianContextTokens: medianResolvedMetric(conditionReviews, "contextTokens"),
    medianOutputTokens: medianResolvedMetric(conditionReviews, "outputTokens"),
    medianAgentTurns: medianResolvedMetric(conditionReviews, "agentTurns"),
    medianToolCalls: medianResolvedMetric(conditionReviews, "toolCalls"),
    measuredMedians: medianResolvedMetricsBySource(conditionReviews, "measured"),
    estimatedMedians: medianResolvedMetricsBySource(conditionReviews, "estimated"),
    metricConfidence: metricConfidence(conditionReviews)
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

function medianResolvedMetric(reviews: AutonomousReviewRecord[], field: SummaryMetricField): number | null {
  return upperMedian(reviews.map((review) => resolveSummaryMetric(review, field)?.value));
}

function medianResolvedMetricsBySource(
  reviews: AutonomousReviewRecord[],
  source: "measured" | "estimated"
): AutonomousSummaryMetricMedians {
  const medians = emptySummaryMetricMedians();
  for (const field of summaryMetricFields) {
    medians[field] = upperMedian(
      reviews
        .map((review) => resolveSummaryMetric(review, field))
        .filter((metric): metric is { value: number; source: "measured" | "estimated" } => metric?.source === source)
        .map((metric) => metric.value)
    );
  }
  return medians;
}

function metricConfidence(
  reviews: AutonomousReviewRecord[]
): Record<SummaryMetricField, AutonomousMetricConfidence> {
  const confidence = Object.fromEntries(
    summaryMetricFields.map((field) => [field, { measured: 0, estimated: 0, missing: 0 }])
  ) as Record<SummaryMetricField, AutonomousMetricConfidence>;

  for (const field of summaryMetricFields) {
    for (const review of reviews) {
      const metric = resolveSummaryMetric(review, field);
      if (!metric) {
        confidence[field].missing += 1;
      } else {
        confidence[field][metric.source] += 1;
      }
    }
  }

  return confidence;
}

function emptySummaryMetricMedians(): AutonomousSummaryMetricMedians {
  return {
    wallTimeMinutes: null,
    filesOpened: null,
    contextTokens: null,
    outputTokens: null,
    agentTurns: null,
    toolCalls: null
  };
}

function resolveSummaryMetric(
  review: AutonomousReviewRecord,
  field: SummaryMetricField
): { value: number; source: "measured" | "estimated" } | undefined {
  const telemetryMetric = telemetryMetricForSummaryField(review.telemetry, field);
  if (telemetryMetric !== undefined) {
    return {
      value: field === "wallTimeMinutes" ? telemetryMetric.value / 60 : telemetryMetric.value,
      source: telemetryMetric.source
    };
  }

  const legacyValue = review[field];
  return legacyValue === undefined ? undefined : { value: legacyValue, source: "estimated" };
}

function telemetryMetricForSummaryField(
  telemetry: AutonomousTelemetry | undefined,
  field: SummaryMetricField
): AutonomousTelemetryMetric | undefined {
  if (field === "wallTimeMinutes") {
    return telemetry?.metrics?.wallTimeSeconds;
  }
  return telemetry?.metrics?.[field];
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
  errors: string[],
  label = field
): void {
  const value = record[field];
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    errors.push(`${source}: ${label} must be a finite non-negative number`);
  }
}

function validateConditionToolClaims(
  review: Record<string, unknown>,
  source: string,
  errors: string[]
): void {
  if (!autonomousConditions.includes(review.condition as AutonomousCondition)) {
    return;
  }
  const condition = review.condition as AutonomousCondition;
  const conditionTool = specialToolForCondition(condition);
  const firstUsefulTool = review.firstUsefulTool;
  const specialToolHelped = review.specialToolHelped;

  if (conditionTool === null) {
    if (firstUsefulTool === "graphify" || firstUsefulTool === "agent-index") {
      errors.push(`${source}: no-special-tool review cannot use ${firstUsefulTool} as firstUsefulTool`);
    }
    if (specialToolHelped === "yes" || specialToolHelped === "misleading") {
      errors.push(`${source}: no-special-tool review cannot mark specialToolHelped as ${specialToolHelped}`);
    }
    return;
  }

  const oppositeTool = conditionTool === "graphify" ? "agent-index" : "graphify";
  if (firstUsefulTool === oppositeTool) {
    errors.push(`${source}: ${condition} review cannot use the opposite special tool ${oppositeTool}`);
  }
}

function validateIndexingMetrics(
  indexing: Record<string, unknown>,
  source: string,
  errors: string[]
): void {
  rejectUnknownFields(indexing, autonomousIndexMetricFieldSet, source, errors, "indexing");
  for (const field of autonomousIndexMetricFields) {
    validateOptionalNonNegativeNumber(indexing, field, source, errors, `indexing.${field}`);
  }
  if (indexing.notes !== undefined && typeof indexing.notes !== "string") {
    errors.push(`${source}: indexing.notes must be a string`);
  }
}

function validateDependencySetupMetrics(
  dependencySetup: Record<string, unknown>,
  source: string,
  errors: string[]
): void {
  rejectUnknownFields(dependencySetup, autonomousDependencySetupMetricFieldSet, source, errors, "dependencySetup");
  for (const field of autonomousDependencySetupMetricFields) {
    validateOptionalNonNegativeNumber(dependencySetup, field, source, errors, `dependencySetup.${field}`);
  }
  if (dependencySetup.notes !== undefined && typeof dependencySetup.notes !== "string") {
    errors.push(`${source}: dependencySetup.notes must be a string`);
  }
}

function validateCoordinatorVerification(
  verification: Record<string, unknown>,
  source: string,
  errors: string[]
): void {
  rejectUnknownFields(verification, autonomousCoordinatorVerificationFieldSet, source, errors, "coordinatorVerification");
  requireEnum(verification, "tests", reviewTestValues, source, errors);
  if (verification.command !== undefined && typeof verification.command !== "string") {
    errors.push(`${source}: coordinatorVerification.command must be a string`);
  }
  if (typeof verification.notes !== "string" || verification.notes.trim().length === 0) {
    errors.push(`${source}: coordinatorVerification.notes must be a non-empty string`);
  }
}

function validateTelemetry(
  telemetry: Record<string, unknown>,
  source: string,
  errors: string[]
): void {
  rejectUnknownFields(telemetry, autonomousTelemetryFieldSet, source, errors, "telemetry");
  if (telemetry.schemaVersion !== 1) {
    errors.push(`${source}: telemetry.schemaVersion must be 1`);
  }
  if (telemetry.metadata !== undefined && !isRecord(telemetry.metadata)) {
    errors.push(`${source}: telemetry.metadata must be an object`);
  } else if (isRecord(telemetry.metadata)) {
    validateTelemetryMetadata(telemetry.metadata, source, errors);
  }
  if (telemetry.artifacts !== undefined && !isRecord(telemetry.artifacts)) {
    errors.push(`${source}: telemetry.artifacts must be an object`);
  } else if (isRecord(telemetry.artifacts)) {
    validateTelemetryArtifacts(telemetry.artifacts, source, errors);
  }
  if (telemetry.timestamps !== undefined && !isRecord(telemetry.timestamps)) {
    errors.push(`${source}: telemetry.timestamps must be an object`);
  } else if (isRecord(telemetry.timestamps)) {
    validateTelemetryTimestamps(telemetry.timestamps, source, errors, "telemetry.timestamps");
  }
  if (telemetry.metrics !== undefined && !isRecord(telemetry.metrics)) {
    errors.push(`${source}: telemetry.metrics must be an object`);
  } else if (isRecord(telemetry.metrics)) {
    validateTelemetryMetricRecord(
      telemetry.metrics,
      autonomousTelemetryMetricFieldSet,
      source,
      errors,
      "telemetry.metrics"
    );
  }
  if (telemetry.indexSetup !== undefined && !isRecord(telemetry.indexSetup)) {
    errors.push(`${source}: telemetry.indexSetup must be an object`);
  } else if (isRecord(telemetry.indexSetup)) {
    validateTelemetryMetricRecord(
      telemetry.indexSetup,
      autonomousTelemetrySetupMetricFieldSet,
      source,
      errors,
      "telemetry.indexSetup"
    );
  }
  if (telemetry.dependencySetup !== undefined && !isRecord(telemetry.dependencySetup)) {
    errors.push(`${source}: telemetry.dependencySetup must be an object`);
  } else if (isRecord(telemetry.dependencySetup)) {
    validateTelemetryMetricRecord(
      telemetry.dependencySetup,
      autonomousTelemetrySetupMetricFieldSet,
      source,
      errors,
      "telemetry.dependencySetup"
    );
  }
  if (telemetry.testCommands !== undefined && !Array.isArray(telemetry.testCommands)) {
    errors.push(`${source}: telemetry.testCommands must be an array`);
  } else if (Array.isArray(telemetry.testCommands)) {
    telemetry.testCommands.forEach((command, index) =>
      validateTelemetryTestCommand(command, source, errors, `telemetry.testCommands[${index}]`)
    );
  }
}

function validateTelemetryMetadata(
  metadata: Record<string, unknown>,
  source: string,
  errors: string[]
): void {
  rejectUnknownFields(metadata, autonomousTelemetryMetadataFieldSet, source, errors, "telemetry.metadata");
  validateOptionalTelemetryString(metadata, "taskId", source, errors, "telemetry.metadata.taskId");
  validateOptionalTelemetryString(metadata, "repo", source, errors, "telemetry.metadata.repo");
  validateOptionalTelemetryString(metadata, "commit", source, errors, "telemetry.metadata.commit");
  validateOptionalTelemetryString(metadata, "testCommand", source, errors, "telemetry.metadata.testCommand");
  if (metadata.condition !== undefined && !autonomousConditions.includes(metadata.condition as AutonomousCondition)) {
    errors.push(`${source}: telemetry.metadata.condition must be one of ${autonomousConditions.join(", ")}`);
  }
  if (metadata.taskKind !== undefined && !isAutonomousTaskKind(metadata.taskKind)) {
    errors.push(`${source}: telemetry.metadata.taskKind must be one of ${autonomousTaskKinds.join(", ")}`);
  }
}

function validateTelemetryArtifacts(
  artifacts: Record<string, unknown>,
  source: string,
  errors: string[]
): void {
  rejectUnknownFields(artifacts, autonomousTelemetryArtifactFieldSet, source, errors, "telemetry.artifacts");
  for (const field of ["runDir", "promptPath", "reviewTemplatePath", "reviewPath"]) {
    validateOptionalTelemetryString(artifacts, field, source, errors, `telemetry.artifacts.${field}`);
  }
  if (artifacts.generatedPaths !== undefined && !isStringArray(artifacts.generatedPaths)) {
    errors.push(`${source}: telemetry.artifacts.generatedPaths must be a string array`);
  }
}

function validateTelemetryTimestamps(
  timestamps: Record<string, unknown>,
  source: string,
  errors: string[],
  label: string
): void {
  rejectUnknownFields(timestamps, autonomousTelemetryTimestampFieldSet, source, errors, label);
  for (const field of autonomousTelemetryTimestampFields) {
    validateOptionalTimestamp(timestamps, field, source, errors, `${label}.${field}`);
  }
}

function validateTelemetryMetricRecord(
  record: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  source: string,
  errors: string[],
  label: string
): void {
  rejectUnknownFields(record, allowedFields, source, errors, label);
  for (const [field, value] of Object.entries(record)) {
    validateTelemetryMetric(value, source, errors, `${label}.${field}`);
  }
}

function validateTelemetryMetric(
  value: unknown,
  source: string,
  errors: string[],
  label: string
): void {
  if (!isRecord(value)) {
    errors.push(`${source}: ${label} must be an object`);
    return;
  }
  const metricFieldSet = new Set(["value", "source", "method", "notes"]);
  rejectUnknownFields(value, metricFieldSet, source, errors, label);
  validateOptionalNonNegativeNumber(value, "value", source, errors, `${label}.value`);
  if (typeof value.value !== "number") {
    errors.push(`${source}: ${label}.value is required`);
  }
  if (typeof value.source !== "string" || !autonomousTelemetryMetricSourceValues.includes(value.source)) {
    errors.push(`${source}: ${label}.source must be one of measured, estimated`);
  }
  if (typeof value.method !== "string" || value.method.trim().length === 0) {
    errors.push(`${source}: ${label}.method must be a non-empty string`);
  }
  if (value.notes !== undefined && typeof value.notes !== "string") {
    errors.push(`${source}: ${label}.notes must be a string`);
  }
}

function validateTelemetryTestCommand(
  command: unknown,
  source: string,
  errors: string[],
  label: string
): void {
  if (!isRecord(command)) {
    errors.push(`${source}: ${label} must be an object`);
    return;
  }
  rejectUnknownFields(command, autonomousTelemetryTestCommandFieldSet, source, errors, label);
  if (typeof command.command !== "string" || command.command.trim().length === 0) {
    errors.push(`${source}: ${label}.command must be a non-empty string`);
  }
  requireEnum(command, "outcome", reviewTestValues, source, errors);
  if (typeof command.source !== "string" || !autonomousTelemetryMetricSourceValues.includes(command.source)) {
    errors.push(`${source}: ${label}.source must be one of measured, estimated`);
  }
  const exitCode = command.exitCode;
  if (exitCode !== undefined && (typeof exitCode !== "number" || !Number.isInteger(exitCode) || exitCode < 0)) {
    errors.push(`${source}: ${label}.exitCode must be a non-negative integer`);
  }
  validateOptionalTimestamp(command, "startedAt", source, errors, `${label}.startedAt`);
  validateOptionalTimestamp(command, "endedAt", source, errors, `${label}.endedAt`);
  if (command.notes !== undefined && typeof command.notes !== "string") {
    errors.push(`${source}: ${label}.notes must be a string`);
  }
}

function validateOptionalTelemetryString(
  record: Record<string, unknown>,
  field: string,
  source: string,
  errors: string[],
  label: string
): void {
  if (record[field] !== undefined && typeof record[field] !== "string") {
    errors.push(`${source}: ${label} must be a string`);
  }
}

function validateOptionalTimestamp(
  record: Record<string, unknown>,
  field: string,
  source: string,
  errors: string[],
  label: string
): void {
  const value = record[field];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${source}: ${label} must be an ISO timestamp string`);
  }
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  source: string,
  errors: string[],
  label: string
): void {
  for (const field of Object.keys(record)) {
    if (!allowedFields.has(field)) {
      errors.push(`${source}: ${label}.${field} is not a supported field`);
    }
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

function reviewTemplate(
  task: AutonomousTaskDefinition,
  condition: AutonomousCondition,
  runDir: string,
  promptPath: string,
  reviewTemplatePath: string,
  preparedAt: string,
  reviewTemplateWrittenAt: string
): AutonomousReviewRecord {
  return {
    taskId: task.id,
    condition,
    success: "fail",
    quality: 1,
    firstUsefulFile: null,
    firstUsefulTool: null,
    specialToolHelped: "ignored",
    tests: "not-run",
    failureMode: null,
    indexing: {},
    dependencySetup: {},
    telemetry: {
      schemaVersion: 1,
      metadata: {
        taskId: task.id,
        condition,
        repo: task.repo,
        taskKind: task.kind,
        commit: task.commit,
        testCommand: task.testCommand
      },
      artifacts: {
        runDir,
        promptPath,
        reviewTemplatePath,
        generatedPaths: [promptPath, reviewTemplatePath]
      },
      timestamps: {
        preparedAt,
        reviewTemplateWrittenAt
      }
    },
    wallTimeMinutes: undefined,
    filesOpened: undefined,
    contextTokens: undefined,
    outputTokens: undefined,
    agentTurns: undefined,
    toolCalls: undefined,
    notes: ""
  };
}

function annotateLoadedReviewTelemetry(
  review: AutonomousReviewRecord,
  reviewPath: string,
  reviewWrittenAt: string,
  validationStartedAt: string,
  validationCompletedAt: string
): AutonomousReviewRecord {
  const telemetry = review.telemetry ?? { schemaVersion: 1 };
  return {
    ...review,
    telemetry: {
      ...telemetry,
      artifacts: {
        ...telemetry.artifacts,
        reviewPath
      },
      timestamps: {
        ...telemetry.timestamps,
        reviewWrittenAt,
        validationStartedAt,
        validationCompletedAt
      }
    }
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
