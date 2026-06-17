import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { classifyFileRole, scanCodeFiles, scanPythonFiles } from "../../src/core/scanner.js";

async function fixtureDir() {
  return mkdtemp(path.join(tmpdir(), "agent-index-scanner-"));
}

describe("scanPythonFiles", () => {
  test("finds Python files with stable relative paths and skips generated directories", async () => {
    const root = await fixtureDir();
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, ".git"), { recursive: true });
    await mkdir(path.join(root, ".codeindex"), { recursive: true });
    await mkdir(path.join(root, "__pycache__"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });

    await writeFile(path.join(root, "pkg", "service.py"), "def run():\n    return 1\n");
    await writeFile(path.join(root, "README.md"), "# ignore me\n");
    await writeFile(path.join(root, ".git", "hidden.py"), "def hidden(): pass\n");
    await writeFile(path.join(root, ".codeindex", "index.py"), "def generated(): pass\n");
    await writeFile(path.join(root, "__pycache__", "cached.py"), "def cached(): pass\n");
    await writeFile(path.join(root, "node_modules", "dep", "vendored.py"), "def vendored(): pass\n");
    await writeFile(path.join(root, "dist", "generated.py"), "def generated(): pass\n");

    const files = await scanPythonFiles(root);

    expect(files).toEqual([
      {
        absolutePath: path.join(root, "pkg", "service.py"),
        relativePath: "pkg/service.py",
        language: "python",
        role: "source",
        text: "def run():\n    return 1\n"
      }
    ]);
  });

  test("classifies file roles from path segments", () => {
    expect(classifyFileRole("pkg/service.py")).toBe("source");
    expect(classifyFileRole("tests/test_service.py")).toBe("test");
    expect(classifyFileRole("__tests__/service.test.ts")).toBe("test");
    expect(classifyFileRole("spec/service.spec.js")).toBe("test");
    expect(classifyFileRole("specs/browser/http.spec.ts")).toBe("test");
    expect(classifyFileRole("src/client/api.test.ts")).toBe("test");
    expect(classifyFileRole("src/client/checkout.spec.tsx")).toBe("test");
    expect(classifyFileRole("pkg/server/handler_test.go")).toBe("test");
    expect(classifyFileRole("Tests/AppTests/CheckoutViewModelTests.swift")).toBe("test");
    expect(classifyFileRole("_tests/test_service.py")).toBe("test");
    expect(classifyFileRole("pkg/type_tests/cases.py")).toBe("test");
    expect(classifyFileRole("testing/test_service.py")).toBe("test");
    expect(classifyFileRole("t/unit/test_tasks.py")).toBe("test");
    expect(classifyFileRole("docs/topics/snippet.py")).toBe("docs");
    expect(classifyFileRole("docs_src/tutorial/example.py")).toBe("docs");
    expect(classifyFileRole("examples/demo.py")).toBe("example");
    expect(classifyFileRole("samples/sample.py")).toBe("example");
    expect(classifyFileRole("fixtures/data.py")).toBe("fixture");
    expect(classifyFileRole("tools/gen.py")).toBe("tool");
    expect(classifyFileRole("_tools/gen.py")).toBe("tool");
    expect(classifyFileRole("scripts/build.py")).toBe("tool");
    expect(classifyFileRole("worked/demo.py")).toBe("tool");
    expect(classifyFileRole("benchmarks/bench_runtime.py")).toBe("benchmark");
    expect(classifyFileRole("asv_benchmarks/benchmarks/bench_model.py")).toBe("benchmark");
  });

  test("can scan mixed Python, Go, Rust, Cython template, TypeScript, JSON, and Swift source files for indexing", async () => {
    const root = await fixtureDir();
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "cmd", "server"), { recursive: true });
    await mkdir(path.join(root, "internal", "config"), { recursive: true });
    await mkdir(path.join(root, "core", "src"), { recursive: true });
    await mkdir(path.join(root, "sklearn", "metrics"), { recursive: true });
    await mkdir(path.join(root, "src", "views"), { recursive: true });
    await mkdir(path.join(root, "src", "compiler"), { recursive: true });
    await mkdir(path.join(root, "src", "client"), { recursive: true });
    await mkdir(path.join(root, "Sources", "App"), { recursive: true });
    await mkdir(path.join(root, "Tests", "AppTests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "service.py"), "def run():\n    return 1\n");
    await writeFile(path.join(root, "cmd", "server", "main.go"), "package main\nfunc main() {}\n");
    await writeFile(path.join(root, "internal", "config", "loader_test.go"), "package config\nfunc TestLoad(t *testing.T) {}\n");
    await writeFile(path.join(root, "core", "src", "serializer.rs"), "pub struct ComputedFields {}\n");
    await writeFile(path.join(root, "sklearn", "metrics", "_radius_neighbors.pyx.tp"), "cdef class RadiusNeighbors{{name_suffix}}:\n    pass\n");
    await writeFile(path.join(root, "src", "compiler", "diagnosticMessages.json"), "{\"key\":\"TS2304\"}\n");
    await writeFile(path.join(root, "src", "client", "api.mts"), "export function createClient() { return {} }\n");
    await writeFile(path.join(root, "src", "client", "api.test.ts"), "test('createClient', () => createClient())\n");
    await writeFile(path.join(root, "src", "views", "DashboardScreen.tsx"), "export function DashboardScreen() { return null }\n");
    await writeFile(path.join(root, "Sources", "App", "CheckoutViewModel.swift"), "struct CheckoutViewModel {}\n");
    await writeFile(path.join(root, "Tests", "AppTests", "CheckoutViewModelTests.swift"), "final class CheckoutViewModelTests {}\n");
    await writeFile(path.join(root, "benchmark.json"), "[]\n");
    await writeFile(path.join(root, "misses-benchmark.json"), "[]\n");
    await writeFile(path.join(root, "graphify-results.json"), "[]\n");

    const files = await scanCodeFiles(root);

    expect(files.map((file) => ({ relativePath: file.relativePath, language: file.language }))).toEqual([
      { relativePath: "cmd/server/main.go", language: "go" },
      { relativePath: "core/src/serializer.rs", language: "rust" },
      { relativePath: "internal/config/loader_test.go", language: "go" },
      { relativePath: "pkg/service.py", language: "python" },
      { relativePath: "sklearn/metrics/_radius_neighbors.pyx.tp", language: "cython" },
      { relativePath: "Sources/App/CheckoutViewModel.swift", language: "swift" },
      { relativePath: "src/client/api.mts", language: "typescript" },
      { relativePath: "src/client/api.test.ts", language: "typescript" },
      { relativePath: "src/compiler/diagnosticMessages.json", language: "json" },
      { relativePath: "src/views/DashboardScreen.tsx", language: "typescript" },
      { relativePath: "Tests/AppTests/CheckoutViewModelTests.swift", language: "swift" }
    ]);
    expect(files.find((file) => file.relativePath === "src/client/api.test.ts")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "internal/config/loader_test.go")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "Tests/AppTests/CheckoutViewModelTests.swift")?.role).toBe("test");
  });

  test("can skip tests and tools for source-only benchmark indexing", async () => {
    const root = await fixtureDir();
    await mkdir(path.join(root, "graphify"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "__tests__"), { recursive: true });
    await mkdir(path.join(root, "spec"), { recursive: true });
    await mkdir(path.join(root, "specs", "browser"), { recursive: true });
    await mkdir(path.join(root, "_tests"), { recursive: true });
    await mkdir(path.join(root, "pkg", "type_tests"), { recursive: true });
    await mkdir(path.join(root, "testing"), { recursive: true });
    await mkdir(path.join(root, "tools", "skillgen"), { recursive: true });
    await mkdir(path.join(root, "_tools", "internal"), { recursive: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await mkdir(path.join(root, "worked", "mixed-corpus"), { recursive: true });
    await mkdir(path.join(root, "examples"), { recursive: true });
    await mkdir(path.join(root, "fixtures"), { recursive: true });
    await mkdir(path.join(root, "docs", "topics"), { recursive: true });
    await mkdir(path.join(root, "docs_src", "tutorial"), { recursive: true });
    await mkdir(path.join(root, "benchmarks"), { recursive: true });
    await mkdir(path.join(root, "asv_benchmarks", "benchmarks"), { recursive: true });
    await mkdir(path.join(root, "t", "unit"), { recursive: true });

    await writeFile(path.join(root, "graphify", "cache.py"), "def product():\n    return 1\n");
    await writeFile(path.join(root, "tests", "test_cache.py"), "def test_product():\n    return 1\n");
    await writeFile(path.join(root, "tests", "metadata.json"), "{\"kind\":\"test-support\"}\n");
    await writeFile(path.join(root, "__tests__", "cache.test.js"), "export function testProduct() { return 1 }\n");
    await writeFile(path.join(root, "spec", "cache.spec.js"), "export function specProduct() { return 1 }\n");
    await writeFile(path.join(root, "specs", "browser", "cache.spec.ts"), "export function browserSpecProduct() { return 1 }\n");
    await writeFile(path.join(root, "_tests", "test_cache.py"), "def test_private_product():\n    return 1\n");
    await writeFile(path.join(root, "pkg", "type_tests", "typing_cases.py"), "def test_types():\n    return 1\n");
    await writeFile(path.join(root, "testing", "test_cache.py"), "def test_product_alt():\n    return 1\n");
    await writeFile(path.join(root, "tools", "skillgen", "gen.py"), "def helper():\n    return 1\n");
    await writeFile(path.join(root, "_tools", "internal", "gen.py"), "def private_helper():\n    return 1\n");
    await writeFile(path.join(root, "scripts", "docs.py"), "def build_docs():\n    return 1\n");
    await writeFile(path.join(root, "worked", "mixed-corpus", "demo.py"), "def demo():\n    return 1\n");
    await writeFile(path.join(root, "examples", "example.py"), "def example():\n    return 1\n");
    await writeFile(path.join(root, "fixtures", "fixture.py"), "def fixture():\n    return 1\n");
    await writeFile(path.join(root, "docs", "topics", "snippet.py"), "def docs_snippet():\n    return 1\n");
    await writeFile(path.join(root, "docs_src", "tutorial", "example.py"), "def docs_example():\n    return 1\n");
    await writeFile(path.join(root, "benchmarks", "bench_runtime.py"), "def bench_runtime():\n    return 1\n");
    await writeFile(path.join(root, "asv_benchmarks", "benchmarks", "bench_model.py"), "def bench_model():\n    return 1\n");
    await writeFile(path.join(root, "t", "unit", "test_tasks.py"), "def test_celery_style():\n    return 1\n");

    const files = await scanPythonFiles(root, { includeSupportCode: false });

    expect(files.map((file) => file.relativePath)).toEqual(["graphify/cache.py"]);
  });
});
