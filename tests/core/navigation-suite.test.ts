import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { validateNavigationEvalCases } from "../../src/core/navigation-eval.js";
import { runNavigationSuite } from "../../src/core/navigation-suite.js";
import type { NavigationEvalCase } from "../../src/core/schema.js";

async function fixtureSuite() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-repo-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  const index = await indexTarget(root);
  const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-eval-"));
  const evalPath = path.join(evalRoot, "navigation-eval.json");
  await writeFile(
    evalPath,
    JSON.stringify([
      {
        id: "semantic-cache",
        task: "Find semantic cache implementation.",
        kind: "bugfix",
        agentIndexSteps: [
          {
            type: "file-clusters",
            query: {
              terms: ["load_value", "semantic", "cache"],
              roles: ["source"],
              pathHints: ["pkg/cache.py"]
            },
            limit: 3
          }
        ],
        rgQueries: [["load_value", "semantic", "cache"]],
        expected: {
          files: ["pkg/cache.py"],
          symbols: ["load_value"],
          requiredFiles: ["pkg/cache.py"],
          requiredSymbols: ["load_value"]
        }
      }
    ])
  );
  const manifestPath = path.join(evalRoot, "suite.json");
  await writeFile(
    manifestPath,
    JSON.stringify([
      {
        name: "fixture",
        evalPath: path.basename(evalPath),
        target: root,
        indexPath: index.indexPath,
        mode: "hybrid"
      }
    ])
  );
  return manifestPath;
}

async function fixtureSuiteWithTwoRepos() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-filter-repos-"));
  const repoA = path.join(root, "repo-a");
  const repoB = path.join(root, "repo-b");
  for (const repo of [repoA, repoB]) {
    await mkdir(path.join(repo, "pkg"), { recursive: true });
    await writeFile(
      path.join(repo, "pkg", "cache.py"),
      `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
    );
  }
  const indexA = await indexTarget(repoA);
  const indexB = await indexTarget(repoB);
  const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-filter-eval-"));
  const evalPath = path.join(evalRoot, "navigation-eval.json");
  await writeFile(
    evalPath,
    JSON.stringify([
      {
        id: "semantic-cache",
        task: "Find semantic cache implementation.",
        kind: "bugfix",
        agentIndexSteps: [
          {
            type: "file-clusters",
            query: {
              terms: ["load_value", "semantic", "cache"],
              roles: ["source"],
              pathHints: ["pkg/cache.py"]
            },
            limit: 3
          }
        ],
        rgQueries: [["load_value", "semantic", "cache"]],
        expected: {
          files: ["pkg/cache.py"],
          symbols: ["load_value"],
          requiredFiles: ["pkg/cache.py"],
          requiredSymbols: ["load_value"]
        }
      },
      {
        id: "missing-case",
        task: "This case should be filtered out.",
        kind: "bugfix",
        agentIndexSteps: [
          {
            type: "file-clusters",
            query: {
              terms: ["does_not_exist"],
              roles: ["source"]
            },
            limit: 3
          }
        ],
        rgQueries: [["does_not_exist"]],
        expected: {
          files: ["pkg/missing.py"],
          requiredFiles: ["pkg/missing.py"]
        }
      }
    ])
  );
  const manifestPath = path.join(evalRoot, "suite.json");
  await writeFile(
    manifestPath,
    JSON.stringify([
      {
        name: "repo-a",
        evalPath: path.basename(evalPath),
        target: repoA,
        indexPath: indexA.indexPath,
        mode: "hybrid"
      },
      {
        name: "repo-b",
        evalPath: path.basename(evalPath),
        target: repoB,
        indexPath: indexB.indexPath,
        mode: "hybrid"
      }
    ])
  );
  return manifestPath;
}

async function fixtureSuiteWithoutIndex() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-reindex-repos-"));
  const root = path.join(repoRoot, "fixture-repo");
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-reindex-eval-"));
  const evalPath = path.join(evalRoot, "navigation-eval.json");
  const indexPath = path.join(evalRoot, "index.sqlite");
  await writeFile(
    evalPath,
    JSON.stringify([
      {
        id: "semantic-cache",
        task: "Find semantic cache implementation.",
        kind: "bugfix",
        agentIndexQueries: [
          {
            terms: ["load_value", "semantic", "cache"],
            roles: ["source"],
            pathHints: ["pkg/cache.py"]
          }
        ],
        rgQueries: [["load_value", "semantic", "cache"]],
        expected: {
          files: ["pkg/cache.py"],
          symbols: ["load_value"]
        }
      }
    ])
  );
  const manifestPath = path.join(evalRoot, "suite.json");
  await writeFile(
    manifestPath,
    JSON.stringify([
      {
        name: "fixture",
        evalPath: path.basename(evalPath),
        target: "fixture-repo",
        mode: "hybrid"
      }
    ])
  );
  return { manifestPath, repoRoot, indexRoot: evalRoot, indexPath };
}

describe("runNavigationSuite", () => {
  test("navigation manifest includes broad TypeScript and JavaScript benchmark coverage", async () => {
    const manifestPath = path.resolve("benchmarks/navigation/suite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Array<{ name: string; evalPath: string; repoUrl?: string }>;
    const tsJsRepos = new Set(["unit-node-sdk", "react", "next.js", "axios", "vite", "typescript", "redux-toolkit", "tanstack-query"]);
    const entries = manifest.filter((entry) => tsJsRepos.has(entry.name));
    const cases = (
      await Promise.all(
        entries.map(async (entry) => JSON.parse(await readFile(path.join(path.dirname(manifestPath), entry.evalPath), "utf8")) as Array<{ kind?: string }>)
      )
    ).flat();

    expect(entries.map((entry) => entry.name)).toEqual([
      "unit-node-sdk",
      "react",
      "next.js",
      "axios",
      "vite",
      "typescript",
      "redux-toolkit",
      "tanstack-query"
    ]);
    expect(new Set(cases.map((navigationCase) => navigationCase.kind))).toEqual(
      new Set([
        "bugfix",
        "test-discovery",
        "source-to-test",
        "component-navigation",
        "code-explanation",
        "sdk-tracing",
        "config-build",
        "exact-string-audit",
        "feature"
      ])
    );
  });

  test("navigation manifest includes broad Go benchmark coverage", async () => {
    const manifestPath = path.resolve("benchmarks/navigation/suite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Array<{ name: string; evalPath: string }>;
    const goRepos = new Set(["cobra", "viper", "prometheus", "kubernetes", "go-ethereum", "testify", "go"]);
    const entries = manifest.filter((entry) => goRepos.has(entry.name));
    const cases = (
      await Promise.all(
        entries.map(async (entry) => JSON.parse(await readFile(path.join(path.dirname(manifestPath), entry.evalPath), "utf8")) as Array<{ kind?: string; id: string }>)
      )
    ).flat();

    expect(entries.map((entry) => entry.name)).toEqual(["cobra", "viper", "prometheus", "kubernetes", "go-ethereum", "testify", "go"]);
    expect(new Set(cases.map((navigationCase) => navigationCase.kind))).toEqual(
      new Set(["bugfix", "test-discovery", "component-navigation", "sdk-tracing", "config-build", "exact-string-audit", "maintenance"])
    );
    expect(cases.map((navigationCase) => navigationCase.id)).toEqual(
      expect.arrayContaining([
        "cobra-cli-command-tracing",
        "viper-config-build-tooling",
        "prometheus-error-flow",
        "kubernetes-interface-implementation",
        "go-ethereum-package-boundary",
        "testify-table-subtest-navigation",
        "go-exact-string-audit"
      ])
    );
  });

  test("navigation manifest includes broad Swift benchmark coverage", async () => {
    const manifestPath = path.resolve("benchmarks/navigation/suite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Array<{ name: string; evalPath: string }>;
    const swiftRepos = new Set([
      "swift-argument-parser",
      "swift-collections",
      "swift-nio",
      "swift-composable-architecture",
      "alamofire",
      "swift-package-manager",
      "swift"
    ]);
    const entries = manifest.filter((entry) => swiftRepos.has(entry.name));
    const cases = (
      await Promise.all(
        entries.map(async (entry) => JSON.parse(await readFile(path.join(path.dirname(manifestPath), entry.evalPath), "utf8")) as Array<{ kind?: string; id: string }>)
      )
    ).flat();

    expect(entries.map((entry) => entry.name)).toEqual([
      "swift-argument-parser",
      "swift-collections",
      "swift-nio",
      "swift-composable-architecture",
      "alamofire",
      "swift-package-manager",
      "swift"
    ]);
    expect(entries.map((entry) => entry.repoUrl)).toEqual([
      "https://github.com/apple/swift-argument-parser.git",
      "https://github.com/apple/swift-collections.git",
      "https://github.com/apple/swift-nio.git",
      "https://github.com/pointfreeco/swift-composable-architecture.git",
      "https://github.com/Alamofire/Alamofire.git",
      "https://github.com/swiftlang/swift-package-manager.git",
      "https://github.com/swiftlang/swift.git"
    ]);
    expect(new Set(cases.map((navigationCase) => navigationCase.kind))).toEqual(
      new Set(["bugfix", "test-discovery", "component-navigation", "config-build", "exact-string-audit", "maintenance"])
    );
    expect(cases.map((navigationCase) => navigationCase.id)).toEqual(
      expect.arrayContaining([
        "swift-argument-parser-cli-build-tooling",
        "swift-collections-source-test-discovery",
        "swift-nio-protocol-extension-error-flow",
        "swift-composable-architecture-view-model-flow",
        "alamofire-bugfix-result-error-flow",
        "swift-package-manager-module-boundary",
        "swift-exact-string-audit"
      ])
    );
  });

  test("Swift navigation benchmark cases pass fairness validation", async () => {
    const manifestPath = path.resolve("benchmarks/navigation/suite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Array<{ name: string; evalPath: string }>;
    const swiftRepos = new Set([
      "swift-argument-parser",
      "swift-collections",
      "swift-nio",
      "swift-composable-architecture",
      "alamofire",
      "swift-package-manager",
      "swift"
    ]);
    const entries = manifest.filter((entry) => swiftRepos.has(entry.name));
    const cases = (
      await Promise.all(
        entries.map(async (entry) => JSON.parse(await readFile(path.join(path.dirname(manifestPath), entry.evalPath), "utf8")) as NavigationEvalCase[])
      )
    ).flat();

    expect(() => validateNavigationEvalCases(cases, "Swift navigation benchmarks")).not.toThrow();
    expect(cases.find((navigationCase) => navigationCase.id === "swift-exact-string-audit")?.expected.requiredFiles).toEqual([
      "test/Concurrency/concurrent_value_checking.swift"
    ]);
  });

  test("navigation manifest includes broad Kotlin benchmark coverage", async () => {
    const manifestPath = path.resolve("benchmarks/navigation/suite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Array<{ name: string; evalPath: string; repoUrl?: string }>;
    const kotlinRepos = new Set([
      "nowinandroid",
      "ktor",
      "kotlinx.coroutines",
      "kotlinpoet",
      "koin",
      "kotlin",
      "kotlin-maven-plugin",
      "gradle-version-catalog"
    ]);
    const entries = manifest.filter((entry) => kotlinRepos.has(entry.name));
    const cases = (
      await Promise.all(
        entries.map(async (entry) => JSON.parse(await readFile(path.join(path.dirname(manifestPath), entry.evalPath), "utf8")) as NavigationEvalCase[])
      )
    ).flat();

    expect(entries.map((entry) => entry.name)).toEqual([
      "nowinandroid",
      "ktor",
      "kotlinx.coroutines",
      "kotlinpoet",
      "koin",
      "kotlin",
      "kotlin-maven-plugin",
      "gradle-version-catalog"
    ]);
    expect(entries.map((entry) => entry.repoUrl)).toEqual([
      "https://github.com/android/nowinandroid.git",
      "https://github.com/ktorio/ktor.git",
      "https://github.com/Kotlin/kotlinx.coroutines.git",
      "https://github.com/square/kotlinpoet.git",
      "https://github.com/InsertKoinIO/koin.git",
      "https://github.com/JetBrains/kotlin.git",
      "https://github.com/JetBrains/kotlin.git",
      "https://github.com/android/nowinandroid.git"
    ]);
    expect(new Set(cases.map((navigationCase) => navigationCase.kind))).toEqual(
      new Set(["test-discovery", "sdk-tracing", "component-navigation", "feature", "config-build"])
    );
    expect(cases.map((navigationCase) => navigationCase.id)).toEqual(
      expect.arrayContaining([
        "nowinandroid-viewmodel-test-flow",
        "ktor-routing-coroutine-service",
        "kotlinx-coroutines-flow-path",
        "kotlinpoet-extension-api",
        "koin-annotation-di-navigation",
        "kotlin-multiplatform-module-boundary",
        "kotlin-maven-plugin-build-tooling",
        "gradle-version-catalog-kotlin-wiring"
      ])
    );
    expect(() => validateNavigationEvalCases(cases, "Kotlin navigation benchmarks")).not.toThrow();
  });

  test("navigation repo preparation script dry-runs clone commands from manifest metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-prepare-"));
    const suitePath = path.join(root, "suite.json");
    const repoRoot = path.join(root, "repos");
    await writeFile(
      suitePath,
      JSON.stringify([
        {
          name: "swift-argument-parser",
          evalPath: "swift-argument-parser-cli-build-tooling.json",
          target: "swift-argument-parser",
          repoUrl: "https://github.com/apple/swift-argument-parser.git",
          mode: "hybrid"
        }
      ])
    );

    const output = execFileSync(
      process.execPath,
      ["scripts/prepare-navigation-repos.mjs", suitePath, "--repo-root", repoRoot, "--repo", "swift-argument-parser", "--dry-run"],
      { cwd: path.resolve("."), encoding: "utf8" }
    );

    expect(output).toContain("clone swift-argument-parser: https://github.com/apple/swift-argument-parser.git");
    expect(output).toContain(`[dry-run] git clone --depth 1 https://github.com/apple/swift-argument-parser.git ${path.join(repoRoot, "swift-argument-parser")}`);
  });

  test("aggregates multi-repository navigation metrics from a manifest", async () => {
    const manifestPath = await fixtureSuite();

    const result = await runNavigationSuite(manifestPath);

    expect(result).toMatchObject({
      repos: 1,
      cases: 1,
      agentIndexUsefulRate: 1,
      rgUsefulRate: 1,
      agentIndexCompletionRate: 1,
      rgCompletionRate: 1,
      agentIndexAvgFirstUsefulLatencyMs: expect.any(Number),
      rgAvgFirstUsefulLatencyMs: expect.any(Number),
      rgOptimizedAvgFirstUsefulLatencyMs: expect.any(Number),
      agentIndexAvgFirstUsefulContextTokens: expect.any(Number),
      rgAvgFirstUsefulContextTokens: expect.any(Number),
      rgOptimizedAvgFirstUsefulContextTokens: expect.any(Number),
      agentIndexWins: 1,
      rgWins: 0
    });
    expect(result.agentIndexAvgContextTokens).toBeLessThan(result.rgAvgContextTokens);
    expect(result.repoResults[0]).toMatchObject({
      name: "fixture",
      result: {
        cases: 1
      }
    });
  });

  test("can rebuild suite indexes before evaluating repositories", async () => {
    const { manifestPath, repoRoot, indexRoot, indexPath } = await fixtureSuiteWithoutIndex();

    const result = await runNavigationSuite(manifestPath, { reindex: true, repoRoot, indexRoot });

    expect(result.repoResults[0].indexStats).toMatchObject({
      files: 1,
      symbols: expect.any(Number),
      chunks: expect.any(Number)
    });
    expect(result.repoResults[0].target).toBe(path.join(repoRoot, "fixture-repo"));
    expect(result.repoResults[0].indexPath).toBe(path.join(indexRoot, "fixture.sqlite"));
    expect(result.repoResults[0].indexPath).not.toBe(indexPath);
    expect(result).toMatchObject({
      cases: 1,
      agentIndexCompletionRate: 1
    });
  });

  test("writes summary and per-repository JSON artifacts", async () => {
    const manifestPath = await fixtureSuite();
    const artifactsDir = await mkdtemp(path.join(tmpdir(), "agent-index-navigation-suite-artifacts-"));

    const result = await runNavigationSuite(manifestPath, { artifactsDir });
    const summary = JSON.parse(await readFile(path.join(artifactsDir, "summary.json"), "utf8"));
    const repo = JSON.parse(await readFile(path.join(artifactsDir, "repos", "fixture.json"), "utf8"));

    expect(summary).toMatchObject({
      repos: 1,
      cases: 1,
      agentIndexCompletionRate: result.agentIndexCompletionRate,
      agentIndexAvgFirstUsefulLatencyMs: result.agentIndexAvgFirstUsefulLatencyMs,
      agentIndexAvgFirstUsefulContextTokens: result.agentIndexAvgFirstUsefulContextTokens,
      repoResults: [
        {
          name: "fixture",
          result: {
            cases: 1,
            caseResults: [
              {
                id: "semantic-cache",
                winner: "agent-index"
              }
            ]
          }
        }
      ]
    });
    expect(repo).toMatchObject({
      name: "fixture",
      result: {
        cases: 1,
        caseResults: [
          {
            id: "semantic-cache",
            agentIndex: {
              taskComplete: true
            }
          }
        ]
      }
    });
  });

  test("can repeat repository evaluations and keep the median latency result", async () => {
    const manifestPath = await fixtureSuite();

    const result = await runNavigationSuite(manifestPath, { runs: 3 });
    const repo = result.repoResults[0];
    const sortedRuns = [...(repo.runResults ?? [])].sort((a, b) => a.agentIndexAvgLatencyMs - b.agentIndexAvgLatencyMs);

    expect(result.runs).toBe(3);
    expect(repo.runs).toBe(3);
    expect(repo.runResults).toHaveLength(3);
    expect(repo.result).toEqual(sortedRuns[1]);
    expect(repo.runStats).toMatchObject({
      agentIndexAvgLatencyMs: {
        min: sortedRuns[0].agentIndexAvgLatencyMs,
        median: sortedRuns[1].agentIndexAvgLatencyMs,
        max: sortedRuns[2].agentIndexAvgLatencyMs,
        spread: sortedRuns[2].agentIndexAvgLatencyMs - sortedRuns[0].agentIndexAvgLatencyMs
      }
    });
  });

  test("filters suite repositories and navigation cases", async () => {
    const manifestPath = await fixtureSuiteWithTwoRepos();

    const result = await runNavigationSuite(manifestPath, { repos: ["repo-b"], cases: ["semantic-cache"] });

    expect(result.repos).toBe(1);
    expect(result.cases).toBe(1);
    expect(result.repoResults[0].name).toBe("repo-b");
    expect(result.repoResults[0].result.caseResults.map((caseResult) => caseResult.id)).toEqual(["semantic-cache"]);
    expect(result.agentIndexCompletionRate).toBe(1);
  });
});
