import { readFile } from "node:fs/promises";
import type {
  AutonomousCondition,
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

export async function loadAutonomousTaskManifest(manifestPath: string): Promise<AutonomousTaskManifest> {
  return validateAutonomousTaskManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
    manifestPath
  );
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

  if (typeof task.prompt === "string" && isExpectedEvidence(task.expectedEvidence)) {
    const leaked = leakedEvidence(task as unknown as AutonomousTaskDefinition);
    if (leaked.length > 0) {
      errors.push(`${source}: ${taskLabel}: prompt leaks expected evidence: ${leaked.join(", ")}`);
    }
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
