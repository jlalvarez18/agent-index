#!/usr/bin/env node
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function usage() {
  return `Usage: node scripts/prepare-navigation-repos.mjs <suite-json> --repo-root <path> [--repo <name>] [--dry-run]

Clones missing navigation benchmark repositories declared with repoUrl in the suite manifest.
Existing repository directories are left untouched.`;
}

function parseArgs(values) {
  const options = {
    suitePath: undefined,
    repoRoot: undefined,
    repos: [],
    dryRun: false
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--repo-root") {
      options.repoRoot = values[++index];
    } else if (value === "--repo") {
      options.repos.push(values[++index]);
    } else if (value === "--dry-run") {
      options.dryRun = true;
    } else if (!options.suitePath) {
      options.suitePath = value;
    } else {
      throw new Error(`Unknown argument: ${value}\n${usage()}`);
    }
  }

  if (!options.suitePath || !options.repoRoot) {
    throw new Error(usage());
  }
  return options;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runGit(args, dryRun) {
  const command = `git ${args.join(" ")}`;
  if (dryRun) {
    console.log(`[dry-run] ${command}`);
    return;
  }

  const result = spawnSync("git", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 1}`);
  }
}

function cloneArgs(entry, destination) {
  const args = ["clone", "--depth", "1"];
  if (entry.ref) {
    args.push("--branch", entry.ref);
  }
  args.push(entry.repoUrl, destination);
  return args;
}

async function main() {
  const options = parseArgs(args);
  const suitePath = path.resolve(options.suitePath);
  const repoRoot = path.resolve(options.repoRoot);
  const selectedRepos = new Set(options.repos);
  const manifest = JSON.parse(await readFile(suitePath, "utf8"));
  const entries = manifest.filter((entry) => entry.repoUrl && (selectedRepos.size === 0 || selectedRepos.has(entry.name)));

  if (entries.length === 0) {
    throw new Error("No suite entries with repoUrl matched the requested filters.");
  }

  if (!options.dryRun) {
    await mkdir(repoRoot, { recursive: true });
  }

  for (const entry of entries) {
    const destination = path.resolve(repoRoot, entry.target);
    if (await exists(destination)) {
      console.log(`skip ${entry.name}: ${destination} already exists`);
      continue;
    }
    console.log(`clone ${entry.name}: ${entry.repoUrl} -> ${destination}`);
    runGit(cloneArgs(entry, destination), options.dryRun);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
