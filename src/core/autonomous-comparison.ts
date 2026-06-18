import { readFile } from "node:fs/promises";
import type {
  AutonomousCondition,
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
