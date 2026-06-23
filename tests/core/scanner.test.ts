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

  test("honors gitignore files when scanning code", async () => {
    const root = await fixtureDir();
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, ".worktrees", "old", "pkg"), { recursive: true });
    await mkdir(path.join(root, "generated"), { recursive: true });
    await mkdir(path.join(root, "nested", "tmp"), { recursive: true });
    await mkdir(path.join(root, "nested", "src"), { recursive: true });

    await writeFile(path.join(root, ".gitignore"), ".worktrees/\ngenerated/*.ts\n");
    await writeFile(path.join(root, "nested", ".gitignore"), "tmp/\n");
    await writeFile(path.join(root, "pkg", "service.ts"), "export function run() { return 1; }\n");
    await writeFile(path.join(root, ".worktrees", "old", "pkg", "service.ts"), "export function stale() { return 1; }\n");
    await writeFile(path.join(root, "generated", "client.ts"), "export function generated() { return 1; }\n");
    await writeFile(path.join(root, "nested", "tmp", "scratch.ts"), "export function scratch() { return 1; }\n");
    await writeFile(path.join(root, "nested", "src", "kept.ts"), "export function kept() { return 1; }\n");

    const files = await scanCodeFiles(root);

    expect(files.map((file) => file.relativePath)).toEqual(["nested/src/kept.ts", "pkg/service.ts"]);
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
    expect(classifyFileRole("src/cache_test.c")).toBe("test");
    expect(classifyFileRole("include/CacheTests.h")).toBe("test");
    expect(classifyFileRole("pkg/_fast_test.pyx")).toBe("test");
    expect(classifyFileRole("pkg/test_fast.pxd.in")).toBe("test");
    expect(classifyFileRole("Tests/AppTests/CheckoutViewModelTests.swift")).toBe("test");
    expect(classifyFileRole("app/src/test/java/com/acme/CheckoutViewModelTest.kt")).toBe("test");
    expect(classifyFileRole("app/src/androidTest/java/com/acme/CheckoutScreenTest.kt")).toBe("test");
    expect(classifyFileRole("app/src/test/java/com/acme/CheckoutServiceTest.java")).toBe("test");
    expect(classifyFileRole("lib/src/checkout_controller.dart")).toBe("source");
    expect(classifyFileRole("test/widgets/checkout_button_test.dart")).toBe("test");
    expect(classifyFileRole("integration_test/app_test.dart")).toBe("test");
    expect(classifyFileRole("example/lib/main.dart")).toBe("example");
    expect(classifyFileRole("tool/generate_routes.dart")).toBe("tool");
    expect(classifyFileRole("benchmark/checkout_benchmark.dart")).toBe("benchmark");
    expect(classifyFileRole("fixtures/golden_case.dart")).toBe("fixture");
    expect(classifyFileRole("docs/snippets/widget.dart")).toBe("docs");
    expect(classifyFileRole("app/Http/Controllers/CheckoutController.php")).toBe("source");
    expect(classifyFileRole("src/Service/CheckoutService.php")).toBe("source");
    expect(classifyFileRole("config/services.php")).toBe("source");
    expect(classifyFileRole("config/services.yaml")).toBe("source");
    expect(classifyFileRole("database/migrations/2024_01_01_000000_create_orders_table.php")).toBe("source");
    expect(classifyFileRole("routes/web.php")).toBe("source");
    expect(classifyFileRole("public/index.php")).toBe("source");
    expect(classifyFileRole("bin/console")).toBe("source");
    expect(classifyFileRole("scripts/import_orders.php")).toBe("tool");
    expect(classifyFileRole("vendor/acme/package/src/CheckoutService.php")).toBe("source");
    expect(classifyFileRole("tests/Feature/CheckoutControllerTest.php")).toBe("test");
    expect(classifyFileRole("test/CheckoutServiceTest.php")).toBe("test");
    expect(classifyFileRole("spec/CheckoutServiceSpec.php")).toBe("test");
    expect(classifyFileRole("app/TestsShouldNotWin/CheckoutService.php")).toBe("source");
    expect(classifyFileRole("app/src/androidTest/java/com/acme/CheckoutInstrumentedTest.java")).toBe("test");
    expect(classifyFileRole("app/controllers/admin/users_controller.rb")).toBe("source");
    expect(classifyFileRole("lib/tasks/reindex.rb")).toBe("source");
    expect(classifyFileRole("db/migrate/20260617000000_create_users.rb")).toBe("source");
    expect(classifyFileRole("config/routes.rb")).toBe("source");
    expect(classifyFileRole("bin/rails")).toBe("tool");
    expect(classifyFileRole("spec/models/user_spec.rb")).toBe("test");
    expect(classifyFileRole("test/controllers/users_controller_test.rb")).toBe("test");
    expect(classifyFileRole("features/sign_in.feature")).toBe("test");
    expect(classifyFileRole("src/features/payments/index.ts")).toBe("source");
    expect(classifyFileRole("src/Checkout.Api/Controllers/CheckoutController.cs")).toBe("source");
    expect(classifyFileRole("src/samples/Acme.Checkout/CheckoutService.cs")).toBe("source");
    expect(classifyFileRole("test/Checkout.Api.Tests/CheckoutControllerTests.cs")).toBe("test");
    expect(classifyFileRole("tests/Checkout.Api.UnitTests/CheckoutControllerSpec.cs")).toBe("test");
    expect(classifyFileRole("src/Checkout.Api.Tests/CheckoutControllerFixture.cs")).toBe("test");
    expect(classifyFileRole("samples/Checkout.Sample/Program.cs")).toBe("example");
    expect(classifyFileRole("examples/Checkout.Example/Program.cs")).toBe("example");
    expect(classifyFileRole("benchmarks/Checkout.Benchmarks/CheckoutBenchmarks.cs")).toBe("benchmark");
    expect(classifyFileRole("tools/Generator/Program.cs")).toBe("tool");
    expect(classifyFileRole("source/common/router/checkout_service_test.cc")).toBe("test");
    expect(classifyFileRole("test/common/router/checkout_service_test.cpp")).toBe("test");
    expect(classifyFileRole("tests/router/route_matcher_test.cxx")).toBe("test");
    expect(classifyFileRole("include/acme/checkout_service.hpp")).toBe("source");
    expect(classifyFileRole("CMakeLists.txt")).toBe("source");
    expect(classifyFileRole("BUILD.bazel")).toBe("source");
    expect(classifyFileRole("meson.build")).toBe("source");
    expect(classifyFileRole("crates/runtime/src/lib.rs")).toBe("source");
    expect(classifyFileRole("crates/runtime/src/bin/server.rs")).toBe("source");
    expect(classifyFileRole("crates/runtime/src/tests.rs")).toBe("test");
    expect(classifyFileRole("crates/runtime/tests/runtime_tests.rs")).toBe("test");
    expect(classifyFileRole("crates/runtime/benches/scheduler.rs")).toBe("benchmark");
    expect(classifyFileRole("crates/runtime/examples/echo.rs")).toBe("example");
    expect(classifyFileRole("core/src/main/kotlin/com/acme/PaymentRepository.kt")).toBe("source");
    expect(classifyFileRole("core/src/main/java/com/acme/PaymentRepository.java")).toBe("source");
    expect(classifyFileRole("feature/foryou/impl/src/main/kotlin/com/google/samples/apps/nowinandroid/feature/foryou/impl/ForYouViewModel.kt")).toBe("source");
    expect(classifyFileRole("feature/foryou/impl/src/main/java/com/google/samples/apps/nowinandroid/feature/foryou/impl/ForYouController.java")).toBe("source");
    expect(classifyFileRole("app/build.gradle.kts")).toBe("source");
    expect(classifyFileRole("pom.xml")).toBe("source");
    expect(classifyFileRole("gradle/libs.versions.toml")).toBe("source");
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

  test("can scan mixed Python, C++, Java, PHP, YAML, Go, Rust, Cython template, TypeScript, JSON, Swift, and Ruby source files for indexing", async () => {
    const root = await fixtureDir();
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "cmd", "server"), { recursive: true });
    await mkdir(path.join(root, "include", "acme"), { recursive: true });
    await mkdir(path.join(root, "include"), { recursive: true });
    await mkdir(path.join(root, "internal", "config"), { recursive: true });
    await mkdir(path.join(root, "source", "common", "router"), { recursive: true });
    await mkdir(path.join(root, "core", "src"), { recursive: true });
    await mkdir(path.join(root, "crates", "runtime", "src", "bin"), { recursive: true });
    await mkdir(path.join(root, "crates", "runtime", "tests"), { recursive: true });
    await mkdir(path.join(root, "sklearn", "metrics"), { recursive: true });
    await mkdir(path.join(root, "sklearn", "utils"), { recursive: true });
    await mkdir(path.join(root, "src", "views"), { recursive: true });
    await mkdir(path.join(root, "src", "compiler"), { recursive: true });
    await mkdir(path.join(root, "src", "client"), { recursive: true });
    await mkdir(path.join(root, "Sources", "App"), { recursive: true });
    await mkdir(path.join(root, "Tests", "AppTests"), { recursive: true });
    await mkdir(path.join(root, "app", "src", "main", "java", "com", "acme"), { recursive: true });
    await mkdir(path.join(root, "app", "src", "test", "java", "com", "acme"), { recursive: true });
    await mkdir(path.join(root, "lib", "src", "checkout"), { recursive: true });
    await mkdir(path.join(root, "test", "checkout"), { recursive: true });
    await mkdir(path.join(root, "integration_test"), { recursive: true });
    await mkdir(path.join(root, "example", "lib"), { recursive: true });
    await mkdir(path.join(root, "tool"), { recursive: true });
    await mkdir(path.join(root, "benchmark"), { recursive: true });
    await mkdir(path.join(root, "app", "controllers", "admin"), { recursive: true });
    await mkdir(path.join(root, "app", "Http", "Controllers"), { recursive: true });
    await mkdir(path.join(root, "spec", "models"), { recursive: true });
    await mkdir(path.join(root, "features"), { recursive: true });
    await mkdir(path.join(root, "config"), { recursive: true });
    await mkdir(path.join(root, "bin"), { recursive: true });
    await mkdir(path.join(root, "php-tests", "Feature"), { recursive: true });
    await mkdir(path.join(root, "src", "Checkout.Api", "Controllers"), { recursive: true });
    await mkdir(path.join(root, "Tests", "Checkout.Api.Tests"), { recursive: true });
    await mkdir(path.join(root, "samples", "Checkout.Sample"), { recursive: true });
    await mkdir(path.join(root, "tools", "Generator"), { recursive: true });
    await writeFile(path.join(root, "pkg", "service.py"), "def run():\n    return 1\n");
    await writeFile(path.join(root, "CMakeLists.txt"), "add_library(checkout_core source/common/router/checkout_service.cc)\n");
    await writeFile(path.join(root, "BUILD.bazel"), "cc_library(name = \"checkout_core\")\n");
    await writeFile(path.join(root, "meson.build"), "library('checkout_core', 'checkout_service.cc')\n");
    await writeFile(path.join(root, "Makefile"), "cache_test: source/common/router/cache.o\n");
    await writeFile(path.join(root, "include", "acme", "checkout_service.hpp"), "class CheckoutService {};\n");
    await writeFile(path.join(root, "include", "acme", "detail.hh"), "struct Detail {};\n");
    await writeFile(path.join(root, "include", "cache.h"), "typedef struct CacheEntry CacheEntry;\nCacheEntry *cache_lookup(const char *key);\n");
    await writeFile(path.join(root, "source", "common", "router", "cache.c"), "#include \"cache.h\"\nCacheEntry *cache_lookup(const char *key) { return 0; }\n");
    await writeFile(path.join(root, "source", "common", "router", "cache_test.c"), "void test_cache_lookup(void) {}\n");
    await writeFile(path.join(root, "source", "common", "router", "checkout_service.cc"), "class CheckoutService {};\n");
    await writeFile(path.join(root, "source", "common", "router", "route_matcher.cpp"), "class RouteMatcher {};\n");
    await writeFile(path.join(root, "source", "common", "router", "codec.cxx"), "class Codec {};\n");
    await writeFile(path.join(root, "source", "common", "router", "config.h"), "class Config {};\n");
    await writeFile(path.join(root, "source", "common", "router", "checkout_service_test.cc"), "TEST(CheckoutServiceTest, FindsPayment) {}\n");
    await writeFile(path.join(root, "cmd", "server", "main.go"), "package main\nfunc main() {}\n");
    await writeFile(path.join(root, "internal", "config", "loader_test.go"), "package config\nfunc TestLoad(t *testing.T) {}\n");
    await writeFile(path.join(root, "core", "src", "serializer.rs"), "pub struct ComputedFields {}\n");
    await writeFile(path.join(root, "crates", "runtime", "src", "lib.rs"), "pub struct Runtime {}\n");
    await writeFile(path.join(root, "crates", "runtime", "src", "bin", "server.rs"), "fn main() {}\n");
    await writeFile(path.join(root, "crates", "runtime", "tests", "runtime_tests.rs"), "#[test]\nfn starts_runtime() {}\n");
    await writeFile(path.join(root, "sklearn", "metrics", "_radius_neighbors.pyx.tp"), "cdef class RadiusNeighbors{{name_suffix}}:\n    pass\n");
    await writeFile(path.join(root, "sklearn", "utils", "_typedefs.pxd.in"), "ctypedef double float64_t\n");
    await writeFile(path.join(root, "sklearn", "utils", "test_fast.pyx"), "def test_fast():\n    pass\n");
    await writeFile(path.join(root, "src", "compiler", "diagnosticMessages.json"), "{\"key\":\"TS2304\"}\n");
    await writeFile(path.join(root, "src", "client", "api.mts"), "export function createClient() { return {} }\n");
    await writeFile(path.join(root, "src", "client", "api.test.ts"), "test('createClient', () => createClient())\n");
    await writeFile(path.join(root, "src", "views", "DashboardScreen.tsx"), "export function DashboardScreen() { return null }\n");
    await writeFile(path.join(root, "Sources", "App", "CheckoutViewModel.swift"), "struct CheckoutViewModel {}\n");
    await writeFile(path.join(root, "Tests", "AppTests", "CheckoutViewModelTests.swift"), "final class CheckoutViewModelTests {}\n");
    await writeFile(path.join(root, "app", "build.gradle.kts"), "plugins { kotlin(\"android\") }\n");
    await writeFile(path.join(root, "app", "src", "main", "java", "com", "acme", "CheckoutViewModel.kt"), "class CheckoutViewModel\n");
    await writeFile(path.join(root, "app", "src", "test", "java", "com", "acme", "CheckoutViewModelTest.kt"), "class CheckoutViewModelTest\n");
    await writeFile(path.join(root, "app", "src", "main", "java", "com", "acme", "CheckoutService.java"), "class CheckoutService {}\n");
    await writeFile(path.join(root, "app", "src", "test", "java", "com", "acme", "CheckoutServiceTest.java"), "class CheckoutServiceTest {}\n");
    await writeFile(path.join(root, "lib", "src", "checkout", "checkout_controller.dart"), "class CheckoutController {}\n");
    await writeFile(path.join(root, "test", "checkout", "checkout_controller_test.dart"), "void main() {}\n");
    await writeFile(path.join(root, "integration_test", "app_test.dart"), "void main() {}\n");
    await writeFile(path.join(root, "example", "lib", "main.dart"), "void main() {}\n");
    await writeFile(path.join(root, "tool", "generate_routes.dart"), "void main() {}\n");
    await writeFile(path.join(root, "benchmark", "checkout_benchmark.dart"), "void main() {}\n");
    await writeFile(path.join(root, "app", "controllers", "admin", "users_controller.rb"), "class Admin::UsersController < ApplicationController\nend\n");
    await writeFile(path.join(root, "app", "Http", "Controllers", "CheckoutController.php"), "<?php\nclass CheckoutController {}\n");
    await writeFile(path.join(root, "spec", "models", "user_spec.rb"), "RSpec.describe User do\nend\n");
    await writeFile(path.join(root, "features", "sign_in.feature"), "Feature: User sign in\n  Scenario: Successful sign in\n");
    await writeFile(path.join(root, "config", "routes.rb"), "Rails.application.routes.draw do\nend\n");
    await writeFile(path.join(root, "config", "services.yaml"), "services:\n  App\\\\Service\\\\CheckoutService: ~\n");
    await writeFile(path.join(root, "Gemfile"), "gem \"rails\"\n");
    await writeFile(path.join(root, "Rakefile"), "task :default\n");
    await writeFile(path.join(root, "bin", "rails"), "#!/usr/bin/env ruby\n");
    await writeFile(path.join(root, "php-tests", "Feature", "CheckoutControllerTest.php"), "<?php\nclass CheckoutControllerTest {}\n");
    await writeFile(path.join(root, "src", "Checkout.Api", "Controllers", "CheckoutController.cs"), "namespace Acme.Checkout.Api;\npublic class CheckoutController {}\n");
    await writeFile(path.join(root, "Tests", "Checkout.Api.Tests", "CheckoutControllerTests.cs"), "public class CheckoutControllerTests {}\n");
    await writeFile(path.join(root, "samples", "Checkout.Sample", "Program.cs"), "public class Program {}\n");
    await writeFile(path.join(root, "tools", "Generator", "Program.cs"), "public class Program {}\n");
    await writeFile(path.join(root, "pom.xml"), "<project><artifactId>checkout-parent</artifactId></project>\n");
    await mkdir(path.join(root, "gradle"), { recursive: true });
    await writeFile(path.join(root, "gradle", "libs.versions.toml"), "[libraries]\ncoroutines = \"org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1\"\n");
    await writeFile(path.join(root, "benchmark.json"), "[]\n");
    await writeFile(path.join(root, "misses-benchmark.json"), "[]\n");
    await writeFile(path.join(root, "graphify-results.json"), "[]\n");

    const files = await scanCodeFiles(root);

    expect(files.map((file) => ({ relativePath: file.relativePath, language: file.language }))).toEqual([
      { relativePath: "app/build.gradle.kts", language: "kotlin" },
      { relativePath: "app/controllers/admin/users_controller.rb", language: "ruby" },
      { relativePath: "app/Http/Controllers/CheckoutController.php", language: "php" },
      { relativePath: "app/src/main/java/com/acme/CheckoutService.java", language: "java" },
      { relativePath: "app/src/main/java/com/acme/CheckoutViewModel.kt", language: "kotlin" },
      { relativePath: "app/src/test/java/com/acme/CheckoutServiceTest.java", language: "java" },
      { relativePath: "app/src/test/java/com/acme/CheckoutViewModelTest.kt", language: "kotlin" },
      { relativePath: "benchmark/checkout_benchmark.dart", language: "dart" },
      { relativePath: "bin/rails", language: "ruby" },
      { relativePath: "BUILD.bazel", language: "cpp" },
      { relativePath: "CMakeLists.txt", language: "cpp" },
      { relativePath: "cmd/server/main.go", language: "go" },
      { relativePath: "config/routes.rb", language: "ruby" },
      { relativePath: "config/services.yaml", language: "yaml" },
      { relativePath: "core/src/serializer.rs", language: "rust" },
      { relativePath: "crates/runtime/src/bin/server.rs", language: "rust" },
      { relativePath: "crates/runtime/src/lib.rs", language: "rust" },
      { relativePath: "crates/runtime/tests/runtime_tests.rs", language: "rust" },
      { relativePath: "example/lib/main.dart", language: "dart" },
      { relativePath: "features/sign_in.feature", language: "ruby" },
      { relativePath: "Gemfile", language: "ruby" },
      { relativePath: "gradle/libs.versions.toml", language: "toml" },
      { relativePath: "include/acme/checkout_service.hpp", language: "cpp" },
      { relativePath: "include/acme/detail.hh", language: "cpp" },
      { relativePath: "include/cache.h", language: "c" },
      { relativePath: "integration_test/app_test.dart", language: "dart" },
      { relativePath: "internal/config/loader_test.go", language: "go" },
      { relativePath: "lib/src/checkout/checkout_controller.dart", language: "dart" },
      { relativePath: "Makefile", language: "c" },
      { relativePath: "meson.build", language: "cpp" },
      { relativePath: "php-tests/Feature/CheckoutControllerTest.php", language: "php" },
      { relativePath: "pkg/service.py", language: "python" },
      { relativePath: "pom.xml", language: "xml" },
      { relativePath: "Rakefile", language: "ruby" },
      { relativePath: "samples/Checkout.Sample/Program.cs", language: "csharp" },
      { relativePath: "sklearn/metrics/_radius_neighbors.pyx.tp", language: "cython" },
      { relativePath: "sklearn/utils/_typedefs.pxd.in", language: "cython" },
      { relativePath: "sklearn/utils/test_fast.pyx", language: "cython" },
      { relativePath: "source/common/router/cache_test.c", language: "c" },
      { relativePath: "source/common/router/cache.c", language: "c" },
      { relativePath: "source/common/router/checkout_service_test.cc", language: "cpp" },
      { relativePath: "source/common/router/checkout_service.cc", language: "cpp" },
      { relativePath: "source/common/router/codec.cxx", language: "cpp" },
      { relativePath: "source/common/router/config.h", language: "cpp" },
      { relativePath: "source/common/router/route_matcher.cpp", language: "cpp" },
      { relativePath: "Sources/App/CheckoutViewModel.swift", language: "swift" },
      { relativePath: "spec/models/user_spec.rb", language: "ruby" },
      { relativePath: "src/Checkout.Api/Controllers/CheckoutController.cs", language: "csharp" },
      { relativePath: "src/client/api.mts", language: "typescript" },
      { relativePath: "src/client/api.test.ts", language: "typescript" },
      { relativePath: "src/compiler/diagnosticMessages.json", language: "json" },
      { relativePath: "src/views/DashboardScreen.tsx", language: "typescript" },
      { relativePath: "test/checkout/checkout_controller_test.dart", language: "dart" },
      { relativePath: "Tests/AppTests/CheckoutViewModelTests.swift", language: "swift" },
      { relativePath: "Tests/Checkout.Api.Tests/CheckoutControllerTests.cs", language: "csharp" },
      { relativePath: "tool/generate_routes.dart", language: "dart" },
      { relativePath: "tools/Generator/Program.cs", language: "csharp" }
    ]);
    expect(files.find((file) => file.relativePath === "src/client/api.test.ts")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "internal/config/loader_test.go")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "source/common/router/cache_test.c")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "sklearn/utils/test_fast.pyx")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "Tests/AppTests/CheckoutViewModelTests.swift")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "app/src/test/java/com/acme/CheckoutViewModelTest.kt")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "app/src/test/java/com/acme/CheckoutServiceTest.java")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "lib/src/checkout/checkout_controller.dart")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "test/checkout/checkout_controller_test.dart")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "integration_test/app_test.dart")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "example/lib/main.dart")?.role).toBe("example");
    expect(files.find((file) => file.relativePath === "tool/generate_routes.dart")?.role).toBe("tool");
    expect(files.find((file) => file.relativePath === "benchmark/checkout_benchmark.dart")?.role).toBe("benchmark");
    expect(files.find((file) => file.relativePath === "app/controllers/admin/users_controller.rb")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "app/Http/Controllers/CheckoutController.php")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "config/routes.rb")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "config/services.yaml")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "Gemfile")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "Rakefile")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "bin/rails")?.role).toBe("tool");
    expect(files.find((file) => file.relativePath === "spec/models/user_spec.rb")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "features/sign_in.feature")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "php-tests/Feature/CheckoutControllerTest.php")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "source/common/router/checkout_service_test.cc")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "crates/runtime/src/bin/server.rs")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "crates/runtime/tests/runtime_tests.rs")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "src/Checkout.Api/Controllers/CheckoutController.cs")?.role).toBe("source");
    expect(files.find((file) => file.relativePath === "Tests/Checkout.Api.Tests/CheckoutControllerTests.cs")?.role).toBe("test");
    expect(files.find((file) => file.relativePath === "samples/Checkout.Sample/Program.cs")?.role).toBe("example");
    expect(files.find((file) => file.relativePath === "tools/Generator/Program.cs")?.role).toBe("tool");
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
