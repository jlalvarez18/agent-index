import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FileRole, Language, SourceFile } from "./schema.js";

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  ".next",
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
  return scanFiles(target, options, [".py"]);
}

export async function scanCodeFiles(target: string, options: ScanOptions = {}): Promise<SourceFile[]> {
  return scanFiles(target, options, [".py", ".rs", ".ts", ".tsx", ".pyx", ".pxd", ".pxi", ".pyx.tp", ".pxd.tp", ".pxi.tp"]);
}

async function scanFiles(target: string, options: ScanOptions, suffixes: string[]): Promise<SourceFile[]> {
  const root = path.resolve(target);
  const files: SourceFile[] = [];
  const includeSupportCode = options.includeSupportCode ?? true;
  const suffixSet = new Set(suffixes);

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

      if (!entry.isFile()) {
        continue;
      }

      const suffix = codeSuffix(entry.name, suffixSet);
      if (!suffix) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const text = await readFile(absolutePath, "utf8");
      files.push({
        absolutePath,
        relativePath,
        language: languageForSuffix(suffix),
        role: classifyFileRole(relativePath),
        text
      });
    }
  }

  await visit(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function codeSuffix(fileName: string, suffixes: Set<string>): string | undefined {
  return [...suffixes].sort((a, b) => b.length - a.length).find((suffix) => fileName.endsWith(suffix));
}

function languageForSuffix(suffix: string): Language {
  if (suffix === ".rs") {
    return "rust";
  }
  if (suffix === ".ts" || suffix === ".tsx") {
    return "typescript";
  }
  if (suffix === ".pyx" || suffix === ".pxd" || suffix === ".pxi" || suffix === ".pyx.tp" || suffix === ".pxd.tp" || suffix === ".pxi.tp") {
    return "cython";
  }
  return "python";
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
