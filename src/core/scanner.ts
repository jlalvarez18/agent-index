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
  "benches",
  "fixtures",
  "fixture",
  "samples",
  "sample"
]);

const TOP_LEVEL_SUPPORT_CODE_DIRS = new Set(["t"]);

const TEST_DIRS = new Set(["tests", "test", "__tests__", "spec", "specs", "_tests", "type_tests", "testing"]);
const TEST_FILE_NAME_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const GO_TEST_FILE_NAME_PATTERN = /_test\.go$/u;
const RUST_TEST_FILE_NAME_PATTERN = /(?:^test_|_test|_tests|tests)\.rs$/u;
const C_TEST_FILE_NAME_PATTERN = /(?:^test_|_test|_tests|Test|Tests)\.[ch]$/u;
const CPP_TEST_FILE_NAME_PATTERN = /(?:^test_|_test|_tests|Test|Tests)\.(?:cc|cpp|cxx|hpp|hh|hxx|h)$/u;
const CYTHON_TEST_FILE_NAME_PATTERN = /(?:^test_|_test)(?:[A-Za-z0-9_]*)(?:\.pyx|\.pxd|\.pxi)(?:\.(?:tp|in))?$/u;
const KOTLIN_TEST_FILE_NAME_PATTERN = /(?:Test|Tests|Spec)\.kts?$/u;
const JAVA_TEST_FILE_NAME_PATTERN = /(?:Test|Tests|IT|ITCase)\.java$/u;
const PHP_TEST_FILE_NAME_PATTERN = /(?:Test|Tests|Spec)\.php$/u;
const DOCS_DIRS = new Set(["docs", "docs_src"]);
const EXAMPLE_DIRS = new Set(["examples", "example", "samples", "sample"]);
const FIXTURE_DIRS = new Set(["fixtures", "fixture"]);
const TOOL_DIRS = new Set(["tools", "_tools", "scripts", "worked"]);
const BENCHMARK_DIRS = new Set(["benchmarks", "asv_benchmarks", "benches"]);
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
    ".cc",
    ".cpp",
    ".cxx",
    ".hpp",
    ".hh",
    ".hxx",
    ".c",
    ".h",
    ".mk",
    "Makefile",
    "BUILD",
    "BUILD.bazel",
    "CMakeLists.txt",
    "meson.build",
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
    ".pyx.in",
    ".pxd.in",
    ".pxi.in",
    ".swift",
    ".kt",
    ".kts",
    ".java",
    ".rb",
    ".rake",
    ".gemspec",
    ".feature",
    "Gemfile",
    "Rakefile",
    "config.ru",
    "rails",
    ".php",
    ".xml",
    ".toml",
    ".yaml",
    ".yml"
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
        language: languageForFile(suffix, relativePath, text),
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
  if (isCppSuffix(suffix) || suffix === "BUILD" || suffix === "BUILD.bazel") {
    return "cpp";
  }
  if (suffix === ".c" || suffix === ".h" || suffix === ".mk" || suffix === "Makefile" || suffix === "CMakeLists.txt" || suffix === "meson.build") {
    return "c";
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
  if (
    suffix === ".rb" ||
    suffix === ".rake" ||
    suffix === ".gemspec" ||
    suffix === ".feature" ||
    suffix === "Gemfile" ||
    suffix === "Rakefile" ||
    suffix === "config.ru" ||
    suffix === "rails"
  ) {
    return "ruby";
  }
  if (suffix === ".php") {
    return "php";
  }
  if (suffix === ".xml") {
    return "xml";
  }
  if (suffix === ".toml") {
    return "toml";
  }
  if (suffix === ".yaml" || suffix === ".yml") {
    return "yaml";
  }
  if (
    suffix === ".pyx" ||
    suffix === ".pxd" ||
    suffix === ".pxi" ||
    suffix === ".pyx.tp" ||
    suffix === ".pxd.tp" ||
    suffix === ".pxi.tp" ||
    suffix === ".pyx.in" ||
    suffix === ".pxd.in" ||
    suffix === ".pxi.in"
  ) {
    return "cython";
  }
  return "python";
}

function languageForFile(suffix: string, relativePath: string, text: string): Language {
  if (isCppSuffix(suffix) || (suffix === ".h" && looksLikeCppHeader(text)) || isCppBuildFile(suffix, relativePath, text)) {
    return "cpp";
  }
  return languageForSuffix(suffix);
}

function isCppSuffix(suffix: string): boolean {
  return [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"].includes(suffix);
}

function looksLikeCppHeader(text: string): boolean {
  return /\b(?:class|namespace|template|public|private|protected)\b/u.test(text) || /\bstd::|[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_~]/u.test(text);
}

function isCppBuildFile(suffix: string, relativePath: string, text: string): boolean {
  if (suffix === "BUILD" || suffix === "BUILD.bazel") {
    return /\bcc_(?:library|binary|test|proto_library)\b/u.test(text);
  }
  if (suffix === "CMakeLists.txt" || suffix === "meson.build") {
    return /\.(?:cc|cpp|cxx|hpp|hh|hxx)\b/u.test(text) || /\bcc_(?:library|binary|test)\b|\bCXX\b/u.test(text);
  }
  return path.posix.basename(relativePath) === "CMakeLists.txt" && /\bCXX\b/u.test(text);
}

export function classifyFileRole(relativePath: string): FileRole {
  const segments = relativePath.split("/").filter(Boolean);
  if (
    segments.some((segment, index) => TEST_DIRS.has(segment) || (index === 0 && segment === "t")) ||
    (segments[0] === "features" && path.posix.basename(relativePath).endsWith(".feature")) ||
    isJavaScriptTestFile(relativePath) ||
    isGoTestFile(relativePath) ||
    isRustTestFile(relativePath) ||
    isCppTestFile(relativePath) ||
    isCTestFile(relativePath) ||
    isCythonTestFile(relativePath) ||
    isSwiftTestFile(relativePath) ||
    isKotlinTestFile(relativePath) ||
    isJavaTestFile(relativePath) ||
    isPhpTestFile(relativePath)
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
  if (segments[0] === "bin" && path.posix.basename(relativePath) !== "console") {
    return "tool";
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

function isRustTestFile(relativePath: string): boolean {
  return RUST_TEST_FILE_NAME_PATTERN.test(path.posix.basename(relativePath));
}

function isCppTestFile(relativePath: string): boolean {
  return CPP_TEST_FILE_NAME_PATTERN.test(path.posix.basename(relativePath));
}

function isCTestFile(relativePath: string): boolean {
  return C_TEST_FILE_NAME_PATTERN.test(path.posix.basename(relativePath));
}

function isCythonTestFile(relativePath: string): boolean {
  return CYTHON_TEST_FILE_NAME_PATTERN.test(path.posix.basename(relativePath));
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

function isPhpTestFile(relativePath: string): boolean {
  return PHP_TEST_FILE_NAME_PATTERN.test(path.posix.basename(relativePath));
}
