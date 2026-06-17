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
  "__tests__",
  "spec",
  "specs",
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

const TEST_DIRS = new Set(["tests", "test", "__tests__", "spec", "specs", "_tests", "type_tests", "testing"]);
const TEST_FILE_NAME_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const GO_TEST_FILE_NAME_PATTERN = /_test\.go$/u;
const KOTLIN_TEST_FILE_NAME_PATTERN = /(?:Test|Tests|Spec)\.kts?$/u;
const JAVA_TEST_FILE_NAME_PATTERN = /(?:Test|Tests|IT|ITCase)\.java$/u;
const DOCS_DIRS = new Set(["docs", "docs_src"]);
const EXAMPLE_DIRS = new Set(["examples", "example", "samples", "sample"]);
const FIXTURE_DIRS = new Set(["fixtures", "fixture"]);
const TOOL_DIRS = new Set(["tools", "_tools", "scripts", "worked"]);
const BENCHMARK_DIRS = new Set(["benchmarks", "asv_benchmarks"]);
const SUPPORT_ARTIFACT_JSON_FILES = new Set(["benchmark.json", "graphify-results.json", "navigation-eval.json", "suite.json"]);

export interface ScanOptions {
  includeSupportCode?: boolean;
}

export async function scanPythonFiles(target: string, options: ScanOptions = {}): Promise<SourceFile[]> {
  return scanFiles(target, options, [".py"]);
}

export async function scanCodeFiles(target: string, options: ScanOptions = {}): Promise<SourceFile[]> {
  return scanFiles(target, options, [
    ".py",
    ".go",
    ".rs",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".pyx",
    ".pxd",
    ".pxi",
    ".pyx.tp",
    ".pxd.tp",
    ".pxi.tp",
    ".swift",
    ".kt",
    ".kts",
    ".java",
    ".xml",
    ".toml"
  ]);
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
      if (isSupportArtifactFile(relativePath)) {
        continue;
      }
      const text = await readFile(absolutePath, "utf8");
      const role = classifyFileRole(relativePath);
      if (!includeSupportCode && role !== "source") {
        continue;
      }
      files.push({
        absolutePath,
        relativePath,
        language: languageForSuffix(suffix),
        role,
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
  if (suffix === ".go") {
    return "go";
  }
  if (suffix === ".rs") {
    return "rust";
  }
  if (suffix === ".ts" || suffix === ".tsx" || suffix === ".mts" || suffix === ".cts") {
    return "typescript";
  }
  if (suffix === ".js" || suffix === ".jsx" || suffix === ".mjs" || suffix === ".cjs") {
    return "javascript";
  }
  if (suffix === ".json") {
    return "json";
  }
  if (suffix === ".swift") {
    return "swift";
  }
  if (suffix === ".kt" || suffix === ".kts") {
    return "kotlin";
  }
  if (suffix === ".java") {
    return "java";
  }
  if (suffix === ".xml") {
    return "xml";
  }
  if (suffix === ".toml") {
    return "toml";
  }
  if (suffix === ".pyx" || suffix === ".pxd" || suffix === ".pxi" || suffix === ".pyx.tp" || suffix === ".pxd.tp" || suffix === ".pxi.tp") {
    return "cython";
  }
  return "python";
}

export function classifyFileRole(relativePath: string): FileRole {
  const segments = relativePath.split("/").filter(Boolean);
  if (
    segments.some((segment, index) => TEST_DIRS.has(segment) || (index === 0 && segment === "t")) ||
    isJavaScriptTestFile(relativePath) ||
    isGoTestFile(relativePath) ||
    isSwiftTestFile(relativePath) ||
    isKotlinTestFile(relativePath) ||
    isJavaTestFile(relativePath)
  ) {
    return "test";
  }
  if (segments.some((segment, index) => isSupportRoleSegment(segments, index, DOCS_DIRS))) {
    return "docs";
  }
  if (segments.some((segment, index) => isSupportRoleSegment(segments, index, EXAMPLE_DIRS))) {
    return "example";
  }
  if (segments.some((segment, index) => isSupportRoleSegment(segments, index, FIXTURE_DIRS))) {
    return "fixture";
  }
  if (segments.some((segment, index) => isSupportRoleSegment(segments, index, TOOL_DIRS))) {
    return "tool";
  }
  if (segments.some((segment, index) => isSupportRoleSegment(segments, index, BENCHMARK_DIRS))) {
    return "benchmark";
  }
  return "source";
}

function isSupportRoleSegment(segments: string[], index: number, roleDirs: Set<string>): boolean {
  return roleDirs.has(segments[index]) && !isInsideJvmSourcePackagePath(segments, index);
}

function isInsideJvmSourcePackagePath(segments: string[], index: number): boolean {
  const srcIndex = segments.lastIndexOf("src", index);
  if (srcIndex === -1 || index <= srcIndex + 2) {
    return false;
  }
  const sourceSet = segments[srcIndex + 1];
  const languageRoot = segments[srcIndex + 2];
  return (
    typeof sourceSet === "string" &&
    /^(?:main|commonMain|jvmMain|androidMain|iosMain|jsMain|nativeMain|wasmJsMain)$/u.test(sourceSet) &&
    (languageRoot === "kotlin" || languageRoot === "java")
  );
}

function isSupportArtifactFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return SUPPORT_ARTIFACT_JSON_FILES.has(basename) || basename.endsWith("-benchmark.json");
}

function isJavaScriptTestFile(relativePath: string): boolean {
  return TEST_FILE_NAME_PATTERN.test(path.posix.basename(relativePath));
}

function isGoTestFile(relativePath: string): boolean {
  return GO_TEST_FILE_NAME_PATTERN.test(path.posix.basename(relativePath));
}

function isSwiftTestFile(relativePath: string): boolean {
  return path.posix.basename(relativePath).endsWith("Tests.swift");
}

function isKotlinTestFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return KOTLIN_TEST_FILE_NAME_PATTERN.test(basename) || relativePath.includes("/src/test/") || relativePath.includes("/src/androidTest/");
}

function isJavaTestFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return JAVA_TEST_FILE_NAME_PATTERN.test(basename) || relativePath.includes("/src/test/") || relativePath.includes("/src/androidTest/");
}
