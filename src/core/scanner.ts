import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FileRole, SourceFile } from "./schema.js";

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "node_modules",
  ".codeindex",
  "__pycache__"
]);

const SUPPORT_CODE_DIRS = new Set([
  "tests",
  "test",
  "_tests",
  "type_tests",
  "testing",
  "tools",
  "_tools",
  "scripts",
  "worked",
  "docs",
  "docs_src",
  "examples",
  "example",
  "benchmarks",
  "asv_benchmarks",
  "fixtures",
  "fixture",
  "samples",
  "sample"
]);

const TOP_LEVEL_SUPPORT_CODE_DIRS = new Set(["t"]);

const TEST_DIRS = new Set(["tests", "test", "_tests", "type_tests", "testing"]);
const DOCS_DIRS = new Set(["docs", "docs_src"]);
const EXAMPLE_DIRS = new Set(["examples", "example", "samples", "sample"]);
const FIXTURE_DIRS = new Set(["fixtures", "fixture"]);
const TOOL_DIRS = new Set(["tools", "_tools", "scripts", "worked"]);
const BENCHMARK_DIRS = new Set(["benchmarks", "asv_benchmarks"]);

export interface ScanOptions {
  includeSupportCode?: boolean;
}

export async function scanPythonFiles(target: string, options: ScanOptions = {}): Promise<SourceFile[]> {
  const root = path.resolve(target);
  const files: SourceFile[] = [];
  const includeSupportCode = options.includeSupportCode ?? true;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const childDirectory = path.join(directory, entry.name);
        const relativeChildDirectory = path.relative(root, childDirectory).split(path.sep).join("/");
        const isTopLevelSupportDir = TOP_LEVEL_SUPPORT_CODE_DIRS.has(relativeChildDirectory);
        const isSupportDir = SUPPORT_CODE_DIRS.has(entry.name) || isTopLevelSupportDir;
        if (!IGNORED_DIRS.has(entry.name) && (includeSupportCode || !isSupportDir)) {
          await visit(childDirectory);
        }
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".py")) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const text = await readFile(absolutePath, "utf8");
      files.push({
        absolutePath,
        relativePath,
        language: "python",
        role: classifyFileRole(relativePath),
        text
      });
    }
  }

  await visit(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function classifyFileRole(relativePath: string): FileRole {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.some((segment, index) => TEST_DIRS.has(segment) || (index === 0 && segment === "t"))) {
    return "test";
  }
  if (segments.some((segment) => DOCS_DIRS.has(segment))) {
    return "docs";
  }
  if (segments.some((segment) => EXAMPLE_DIRS.has(segment))) {
    return "example";
  }
  if (segments.some((segment) => FIXTURE_DIRS.has(segment))) {
    return "fixture";
  }
  if (segments.some((segment) => TOOL_DIRS.has(segment))) {
    return "tool";
  }
  if (segments.some((segment) => BENCHMARK_DIRS.has(segment))) {
    return "benchmark";
  }
  return "source";
}
