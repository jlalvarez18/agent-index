import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { isCliEntrypoint, runCli } from "../../src/cli.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-cli-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  const benchmarkPath = path.join(root, "benchmark.json");
  await writeFile(
    benchmarkPath,
    JSON.stringify([
      {
        id: "semantic-cache",
        question: "where is semantic cache loaded?",
        agentQuery: {
          terms: ["semantic", "cache", "load"],
          symbolKinds: ["function"],
          pathHints: ["cache"],
          excludeSupportCode: true
        },
        expected: { files: ["pkg/cache.py"], symbols: ["load_value"] }
      }
    ])
  );
  return { root, benchmarkPath };
}

async function taskGuidanceFixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-cli-task-guidance-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  await writeFile(
    path.join(root, "tests", "test_cache.py"),
    `from pkg.cache import load_value

def test_load_value():
    assert load_value("ok") == "ok"
`
  );
  return root;
}

async function mediumTaskGuidanceFixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-cli-medium-task-guidance-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "testing.py"),
    `class CliRunner:
    pass

def resolve_color_default(color=None):
    if color is not None:
        return color
    return "NO_COLOR" not in {}
`
  );
  return root;
}

async function writeGraphifyResults(root: string) {
  const graphifyResultsPath = path.join(root, "graphify-results.json");
  await writeFile(
    graphifyResultsPath,
    JSON.stringify([
      {
        id: "semantic-cache",
        text: "NODE load_value() [src=pkg/cache.py loc=L1]"
      }
    ])
  );
  return graphifyResultsPath;
}

async function writeNavigationEval(root: string) {
  const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-cli-navigation-eval-"));
  const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
  await writeFile(
    navigationEvalPath,
    JSON.stringify([
      {
        id: "semantic-cache-navigation",
        task: "Find the semantic cache implementation for a bug fix.",
        kind: "bugfix",
        agentIndexQueries: [
          {
            terms: ["semantic", "cache", "load"],
            symbolKinds: ["function"],
            roles: ["source"],
            pathHints: ["cache"],
            expand: []
          }
        ],
        rgQueries: [["semantic", "cache", "load"]],
        expected: { files: ["pkg/cache.py"], symbols: ["load_value"] }
      }
    ])
  );
  return navigationEvalPath;
}

describe("runCli", () => {
  test("detects npm bin symlinks as CLI entrypoints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-cli-entrypoint-"));
    await mkdir(path.join(root, "dist"), { recursive: true });
    await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
    const realCliPath = path.join(root, "dist", "cli.js");
    const binPath = path.join(root, "node_modules", ".bin", "agent-index");
    await writeFile(realCliPath, "");
    await symlink(realCliPath, binPath);

    expect(isCliEntrypoint(pathToFileURL(realCliPath).href, binPath)).toBe(true);
  });

  test("prints help without treating it as a command failure", async () => {
    const output: string[] = [];

    await expect(runCli(["--help"], { write: (line) => output.push(line) })).resolves.toBeUndefined();

    expect(output.join("\n")).toContain("Usage: agent-index");
    expect(output.join("\n")).toContain("Commands:");
  });

  test("indexes, queries, and benchmarks through the public commands", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const output: string[] = [];
    const write = (line: string) => output.push(line);

    await runCli(["index", root], { write });
    await runCli(["query", "where is semantic cache loaded?", "--target", root], { write });
    await runCli(["benchmark", benchmarkPath, "--target", root], { write });

    expect(output[0]).toContain("Indexed 1 files");
    const queryJson = JSON.parse(output[1]);
    expect(queryJson.matches[0].symbol).toBe("load_value");
    expect(output[2]).toContain("Questions: 1");
    expect(output[2]).toContain("Mode: symbol");
    expect(output[2]).toContain("Symbol Hit@5: 1.00");
    expect(output[2]).toContain("File Hit@5: 1.00");
  });

  test("supports plain FTS benchmark mode", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["benchmark", benchmarkPath, "--target", root, "--mode", "fts"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Mode: fts");
    expect(output[1]).toContain("Symbol Hit@5:");
  });

  test("supports query mode selection", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["query", "where is semantic cache loaded?", "--target", root, "--mode", "fts"], {
      write: (line) => output.push(line)
    });

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.mode).toBe("fts");
    expect(queryJson.matches[0].symbol).toBe("load_value");
  });

  test("supports compact query output for lower-token agent navigation", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["query", "where is semantic cache loaded?", "--target", root], {
      write: (line) => output.push(line)
    });
    await runCli(["query", "where is semantic cache loaded?", "--target", root, "--format", "compact"], {
      write: (line) => output.push(line)
    });

    expect(output[2].split("\n")[0]).toContain("1 pkg/cache.py:1-3 function load_value evidence=");
    expect(output[2]).toContain("semantic_cache");
    expect(output[2]).toContain("why:");
    expect(output[2]).toContain("next: open pkg/cache.py:1");
    expect(output[2]).not.toContain("neighbors");
    expect(output[2].length).toBeLessThan(output[1].length);
  });

  test("keeps compact task output unchanged unless agent guidance is requested", async () => {
    const root = await taskGuidanceFixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["task", "bugfix", "semantic cache load regression", "--target", root, "--format", "compact"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Task bugfix: semantic cache load regression");
    expect(output[1]).toContain("Step 1 source-map file-clusters");
    expect(output[1]).not.toContain("Guidance:");
  });

  test("prints task warnings when test discovery runs against a source-only index", async () => {
    const root = await taskGuidanceFixtureProject();
    const output: string[] = [];

    await runCli(["index", root, "--source-only"], { write: (line) => output.push(line) });
    await runCli(["task", "bugfix", "semantic cache load regression", "--target", root, "--format", "compact"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Warning: source-only index");
    expect(output[1]).toContain("Warning: index has no test-role files");
    expect(output[1]).toContain("Task bugfix: semantic cache load regression");
  });

  test("prints source-test warnings when test role files are missing from the index", async () => {
    const root = await taskGuidanceFixtureProject();
    const output: string[] = [];

    await runCli(["index", root, "--source-only"], { write: (line) => output.push(line) });
    await runCli(["source-tests", "--target", root, "--term", "semantic", "--term", "cache", "--role", "source"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Warning: source-only index");
    expect(output[1]).toContain("Warning: index has no test-role files");
    expect(output[1]).toContain("1 pkg/cache.py:1");
  });

  test("prints compact agent guidance when requested", async () => {
    const root = await taskGuidanceFixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      ["task", "bugfix", "semantic cache load regression", "--target", root, "--format", "compact", "--agent-guidance"],
      { write: (line) => output.push(line) }
    );

    expect(output[1]).toContain("Guidance: open-top-result confidence=high");
    expect(output[1]).toContain("open: pkg/cache.py:1");
    expect(output[1]).toContain(
      "why: source hit rank 1, evidence available, implementation query corroborated, related tests found"
    );
    expect(output[1]).toContain("next: inspect source before broad rg");
    expect(output[1]).toContain("Task bugfix: semantic cache load regression");
  });

  test("emits structured JSON agent guidance when requested", async () => {
    const root = await taskGuidanceFixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["task", "bugfix", "semantic cache load regression", "--target", root, "--format", "json", "--agent-guidance"], {
      write: (line) => output.push(line)
    });

    const result = JSON.parse(output[1]);
    expect(result.guidance).toMatchObject({
      recommendedNextAction: "open-top-result",
      confidence: "high",
      openFirst: { file: "pkg/cache.py", line: 1 }
    });
    expect(result.plan.kind).toBe("bugfix");
    expect(result.steps).toHaveLength(3);
  });

  test("prints actionable compact guidance for medium-confidence helper results", async () => {
    const root = await mediumTaskGuidanceFixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "task",
        "bugfix",
        "NO_COLOR should disable color by default",
        "--target",
        root,
        "--format",
        "compact",
        "--agent-guidance"
      ],
      { write: (line) => output.push(line) }
    );

    expect(output[1]).toContain("Guidance: open-top-result confidence=medium");
    expect(output[1]).toContain("open: pkg/testing.py:");
    expect(output[1]).toContain("why: source hit rank 1");
    expect(output[1]).toContain("support/artifact path");
    expect(output[1]).toContain("before-edit: do not edit this support/artifact result yet");
    expect(output[1]).toContain("run the refine command to find the owning source file before broad rg");
    expect(output[1]).toContain("--expand callers --expand callees --expand parents");
    expect(output[1]).toContain(`--target ${root}`);
    expect(output[1]).toContain("--mode hybrid");
    expect(output[1]).not.toContain("task source-to-tests --source pkg/testing.py");
  });

  test("keeps JSON task output unchanged unless agent guidance is requested", async () => {
    const root = await mediumTaskGuidanceFixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["task", "bugfix", "NO_COLOR should disable color by default", "--target", root, "--format", "json"], {
      write: (line) => output.push(line)
    });

    const result = JSON.parse(output[1]);
    expect(result).not.toHaveProperty("guidance");
    expect(JSON.stringify(result)).not.toContain("beforeEditing");
  });

  test("emits structured medium-confidence JSON guidance before editing", async () => {
    const root = await mediumTaskGuidanceFixtureProject();
    const indexPath = path.join(root, "task-guidance.sqlite");
    const output: string[] = [];

    await runCli(["index", root, "--index-path", indexPath], { write: (line) => output.push(line) });
    await runCli(
      [
        "task",
        "bugfix",
        "NO_COLOR should disable color by default",
        "--target",
        root,
        "--index-path",
        indexPath,
        "--format",
        "json",
        "--agent-guidance"
      ],
      { write: (line) => output.push(line) }
    );

    const result = JSON.parse(output[1]);
    expect(result.guidance).toMatchObject({
      recommendedNextAction: "open-top-result",
      confidence: "medium",
      beforeEditing: [
        "do not edit this support/artifact result yet",
        "run the refine command to find the owning source file before broad rg"
      ]
    });
    expect(result.guidance.followUpCommands[0]).toContain("--expand callers --expand callees --expand parents");
    expect(result.guidance.followUpCommands[0]).toContain(`--target ${root}`);
    expect(result.guidance.followUpCommands[0]).toContain(`--index-path ${indexPath}`);
    expect(result.guidance.followUpCommands[0]).toContain("--mode hybrid");
    expect(result.guidance.followUpCommands.join("\n")).not.toContain("task source-to-tests --source pkg/testing.py");
  });

  test("lists autonomous comparison tasks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-cli-list-"));
    const manifestPath = path.join(root, "pilot.json");
    const output: string[] = [];

    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        name: "pilot",
        tasks: [
          {
            id: "click-color-default-behavior",
            repo: "click",
            kind: "bugfix",
            prompt: "Find and fix where Click decides default color behavior from environment state.",
            successCriteria: ["NO_COLOR disables color by default."],
            expectedEvidence: {
              files: ["src/click/globals.py"],
              symbols: ["resolve_color_default"]
            }
          }
        ]
      })
    );

    await runCli(["autonomous-list", manifestPath], { write: (line) => output.push(line) });

    expect(output.join("\n")).toContain("pilot");
    expect(output.join("\n")).toContain("click-color-default-behavior");
    expect(output.join("\n")).toContain("graphify, agent-index, no-special-tool");
  });

  test("prepares an autonomous run packet", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-cli-prepare-"));
    const manifestPath = path.join(root, "pilot.json");
    const artifactsDir = path.join(root, "artifacts");
    const output: string[] = [];

    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        name: "pilot",
        tasks: [
          {
            id: "click-color-default-behavior",
            repo: "click",
            kind: "bugfix",
            prompt: "Find and fix where Click decides default color behavior from environment state.",
            successCriteria: ["NO_COLOR disables color by default."],
            expectedEvidence: {
              files: ["src/click/globals.py"],
              symbols: ["resolve_color_default"]
            }
          }
        ]
      })
    );

    await runCli(
      [
        "autonomous-prepare",
        manifestPath,
        "--task",
        "click-color-default-behavior",
        "--condition",
        "agent-index",
        "--artifacts-dir",
        artifactsDir
      ],
      { write: (line) => output.push(line) }
    );

    expect(output.join("\n")).toContain("prompt.md");
    const prompt = await readFile(
      path.join(artifactsDir, "click-color-default-behavior", "agent-index", "prompt.md"),
      "utf8"
    );
    expect(prompt).toContain("agent-index is available");
  });

  test("rejects invalid autonomous prepare time limits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-cli-time-limit-"));
    const manifestPath = path.join(root, "pilot.json");
    const artifactsDir = path.join(root, "artifacts");

    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        name: "pilot",
        tasks: [
          {
            id: "click-color-default-behavior",
            repo: "click",
            kind: "bugfix",
            prompt: "Find and fix where Click decides default color behavior from environment state.",
            successCriteria: ["NO_COLOR disables color by default."],
            expectedEvidence: {
              files: ["src/click/globals.py"],
              symbols: ["resolve_color_default"]
            }
          }
        ]
      })
    );

    await expect(
      runCli([
        "autonomous-prepare",
        manifestPath,
        "--task",
        "click-color-default-behavior",
        "--condition",
        "agent-index",
        "--artifacts-dir",
        artifactsDir,
        "--time-limit-minutes",
        "abc"
      ])
    ).rejects.toThrow("Invalid --time-limit-minutes value: abc. Expected a positive integer.");
  });

  test("summarizes autonomous review artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-autonomous-cli-summary-"));
    const artifactsDir = path.join(root, "artifacts");
    const reviewDir = path.join(artifactsDir, "task-a", "agent-index");
    const output: string[] = [];

    await mkdir(reviewDir, { recursive: true });
    await writeFile(
      path.join(reviewDir, "review.json"),
      JSON.stringify({
        taskId: "task-a",
        condition: "agent-index",
        success: "pass",
        quality: 5,
        firstUsefulFile: null,
        firstUsefulTool: "agent-index",
        specialToolHelped: "yes",
        tests: "passed",
        failureMode: null,
        wallTimeMinutes: 12,
        filesOpened: 4,
        contextTokens: 900,
        outputTokens: 250,
        agentTurns: 6,
        toolCalls: 14,
        telemetry: {
          schemaVersion: 1,
          metrics: {
            wallTimeSeconds: {
              value: 720,
              source: "measured",
              method: "coordinator stopwatch"
            },
            contextTokens: {
              value: 900,
              source: "estimated",
              method: "transcript chars divided by four"
            }
          }
        },
        notes: "good"
      })
    );

    await runCli(["autonomous-summary", artifactsDir], { write: (line) => output.push(line) });

    expect(output.join("\n")).toContain("Runs: 1");
    expect(output.join("\n")).toContain("agent-index");
    expect(output.join("\n")).toContain("pass=1");
    expect(output.join("\n")).toContain("medianTurns=6");
    expect(output.join("\n")).toContain("medianToolCalls=14");
    expect(output.join("\n")).toContain("medianContextTokens=900");
    expect(output.join("\n")).toContain("telemetry=wallTimeMinutes measured=1 estimated=0 missing=0");
    expect(output.join("\n")).toContain("contextTokens measured=0 estimated=1 missing=0");
  });

  test("supports file-cluster summaries for low-token repository mapping", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];
    await writeFile(
      path.join(root, "pkg", "cache.py"),
      `def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]

def store_value(key, value):
    semantic_cache = {key: value}
    return semantic_cache
`
    );

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "file-clusters",
        "semantic cache",
        "--target",
        root,
        "--term",
        "load_value",
        "--role",
        "source",
        "--path",
        "pkg/cache.py"
      ],
      { write: (line) => output.push(line) }
    );
    await runCli(
      [
        "file-clusters",
        "semantic cache",
        "--target",
        root,
        "--term",
        "load_value",
        "--role",
        "source",
        "--path",
        "pkg/cache.py",
        "--json"
      ],
      { write: (line) => output.push(line) }
    );

    expect(output[1]).toContain("1 pkg/cache.py role=source");
    expect(output[1]).toContain("evidence=");
    expect(output[1]).toContain("why:");
    expect(output[1]).toContain("next: open pkg/cache.py:1");
    expect(output[1]).not.toContain("; ");
    expect(output[1]).not.toContain("score=");
    expect(output[1]).not.toContain("tokens=");
    expect(output[1]).not.toContain("why=");
    const json = JSON.parse(output[2]);
    expect(json.clusters[0]).toMatchObject({
      file: "pkg/cache.py",
      role: "source",
      score: expect.any(Number),
      contextTokens: expect.any(Number),
      why: expect.any(Array)
    });
  });

  test("supports compact source and test bundles for one-step navigation", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `from pkg.cache import load_value

def test_load_value():
    assert load_value("x") == "x"
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["source-tests", "semantic cache", "--target", root, "--term", "load_value", "--role", "source"], {
      write: (line) => output.push(line)
    });
    await runCli(["source-tests", "semantic cache", "--target", root, "--term", "load_value", "--role", "source", "--test-fanout-limit", "1", "--json"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("1 pkg/cache.py:1 load_value -> tests/test_cache.py");
    expect(output[1]).toContain("why:");
    expect(output[1]).toContain("next: open pkg/cache.py:1");
    const json = JSON.parse(output[2]);
    expect(json.bundles[0].source.file).toBe("pkg/cache.py");
    expect(json.bundles[0].tests[0].file).toBe("tests/test_cache.py");
  });

  test("supports compact JSON for source and related test navigation", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `from pkg.cache import load_value

def test_load_value():
    assert load_value("x") == "x"
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["source-tests", "semantic cache", "--target", root, "--term", "load_value", "--role", "source", "--json"], {
      write: (line) => output.push(line)
    });
    await runCli(
      ["source-tests", "semantic cache", "--target", root, "--term", "load_value", "--role", "source", "--format", "compact-json"],
      { write: (line) => output.push(line) }
    );
    await runCli(
      ["related-tests", "--target", root, "--source", "pkg/cache.py", "--symbol", "load_value", "--format", "compact-json"],
      { write: (line) => output.push(line) }
    );

    const fullSourceJson = JSON.parse(output[1]);
    const compactSourceJson = JSON.parse(output[2]);
    const compactRelatedJson = JSON.parse(output[3]);

    expect(output[2].length).toBeLessThan(output[1].length);
    expect(compactSourceJson.bundles[0]).toMatchObject({
      source: {
        file: "pkg/cache.py",
        symbol: "load_value",
        line: 1,
        why: expect.any(String),
        next: "open pkg/cache.py:1"
      },
      tests: [
        {
          file: "tests/test_cache.py",
          firstLine: 1,
          symbols: ["test_load_value"],
          why: expect.any(String),
          next: "open tests/test_cache.py:1"
        }
      ]
    });
    expect(compactSourceJson.bundles[0]).not.toHaveProperty("contextChars");
    expect(compactSourceJson.bundles[0]).not.toHaveProperty("why");
    expect(fullSourceJson.bundles[0].source).toHaveProperty("contextChars");

    expect(compactRelatedJson.matches[0]).toMatchObject({
      file: "tests/test_cache.py",
      firstLine: 1,
      symbols: ["test_load_value"],
      why: expect.any(String),
      next: "open tests/test_cache.py:1"
    });
    expect(compactRelatedJson.matches[0]).not.toHaveProperty("score");
  });

  test("runs task presets as compact multi-step agent workflows", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `from pkg.cache import load_value

def test_load_value():
    assert load_value("x") == "x"
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["task", "bugfix", "semantic cache load regression", "--target", root, "--format", "compact"], {
      write: (line) => output.push(line)
    });
    await runCli(["task", "bugfix", "semantic cache load regression", "--target", root, "--format", "json"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Task bugfix: semantic cache load regression");
    expect(output[1]).toContain("Step 1 source-map file-clusters");
    expect(output[1]).toContain("pkg/cache.py");
    expect(output[1]).toContain("Step 3 related-tests source-tests");
    expect(output[1]).toContain("tests/test_cache.py");
    expect(output[1]).not.toContain("\"clusters\"");

    const json = JSON.parse(output[2]);
    expect(json.plan.steps.map((step: { purpose: string }) => step.purpose)).toEqual([
      "source-map",
      "implementation-context",
      "related-tests"
    ]);
    expect(json.steps[0]).toMatchObject({
      purpose: "source-map",
      type: "file-clusters"
    });
  });

  test("task bugfix routes blind default-disabling tasks to default resolver symbols", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-cli-default-decision-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "globals.py"),
      `def resolve_color_default(color=None):
    """Get the default value of the color flag from context."""
    if color is not None:
        return color
    return current_context().color
`
    );
    await writeFile(
      path.join(root, "pkg", "_compat.py"),
      `def should_strip_ansi(stream=None, color=None):
    if color is None:
        if os.environ.get("NO_COLOR"):
            return True
        return not isatty(stream)
    return not color
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["task", "bugfix", "NO_COLOR should disable color by default", "--target", root, "--format", "compact"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Task bugfix: NO_COLOR should disable color by default");
    expect(output[1]).toContain("pkg/globals.py");
    expect(output[1]).toContain("resolve_color_default");
  });

  test("supports navigation workflow evaluation through the public command", async () => {
    const { root } = await fixtureProject();
    const navigationEvalPath = await writeNavigationEval(root);
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["nav-eval", navigationEvalPath, "--target", root, "--cases"], {
      write: (line) => output.push(line)
    });
    await runCli(["nav-eval", navigationEvalPath, "--target", root, "--json"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Cases: 1");
    expect(output[1]).toContain("agent-index useful rate: 1.00");
    expect(output[1]).toContain("rg broad useful rate: 1.00");
    expect(output[1]).toContain("rg optimized useful rate: 1.00");
    expect(output[1]).toContain("agent-index completion rate: 1.00");
    expect(output[1]).toContain("rg broad completion rate: 1.00");
    expect(output[1]).toContain("rg optimized completion rate: 1.00");
    expect(output[1]).toContain("semantic-cache-navigation");
    expect(output[1]).toContain("agentComplete=yes");
    expect(output[1]).toContain("rgOptimizedComplete=yes");
    const json = JSON.parse(output[2]);
    expect(json.caseResults[0]).toMatchObject({
      id: "semantic-cache-navigation",
      agentIndex: {
        foundUseful: true,
        taskComplete: true,
        firstUsefulCommand: 1
      },
      rg: {
        foundUseful: true,
        taskComplete: true
      },
      rgOptimized: {
        foundUseful: true,
        taskComplete: true
      }
    });
  });

  test("supports navigation suite evaluation through the public command", async () => {
    const { root } = await fixtureProject();
    const navigationEvalPath = await writeNavigationEval(root);
    const suiteRoot = await mkdtemp(path.join(tmpdir(), "agent-index-cli-navigation-suite-"));
    const suitePath = path.join(suiteRoot, "suite.json");
    const indexRoot = path.join(suiteRoot, "indexes");
    const artifactsDir = path.join(suiteRoot, "artifacts");
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await writeFile(
      suitePath,
      JSON.stringify([
        {
          name: "fixture",
          evalPath: navigationEvalPath,
          target: root
        }
      ])
    );
    await runCli(["nav-suite", suitePath, "--repos", "--reindex", "--artifacts-dir", artifactsDir], {
      write: (line) => output.push(line)
    });
    await runCli(["nav-suite", suitePath, "--json", "--runs", "3"], {
      write: (line) => output.push(line)
    });
    await runCli(["nav-suite", suitePath, "--repos", "--runs", "3"], {
      write: (line) => output.push(line)
    });
    await runCli(["nav-suite", suitePath, "--repo", "fixture", "--case", "semantic-cache-navigation", "--json"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Repos: 1");
    expect(output[1]).toContain("Cases: 1");
    expect(output[1]).toContain("agent-index completion rate: 1.00");
    expect(output[1]).toContain("rg optimized completion rate: 1.00");
    expect(output[1]).toContain("fixture");
    expect(output[1]).toContain("indexed=1files/");
    const json = JSON.parse(output[2]);
    expect(json.runs).toBe(3);
    expect(json.repoResults[0]).toMatchObject({
      name: "fixture",
      runs: 3,
      runResults: expect.arrayContaining([
        expect.objectContaining({
          cases: 1
        })
      ]),
      runStats: {
        agentIndexAvgLatencyMs: {
          min: expect.any(Number),
          median: expect.any(Number),
          max: expect.any(Number),
          spread: expect.any(Number)
        }
      },
      result: {
        cases: 1,
        agentIndexCompletionRate: 1
      }
    });
    const summary = JSON.parse(await readFile(path.join(artifactsDir, "summary.json"), "utf8"));
    expect(summary).toMatchObject({
      repos: 1,
      repoResults: [
        {
          name: "fixture",
          result: {
            cases: 1
          }
        }
      ]
    });
    expect(output[3]).toContain("agentLatency=");
    const filteredJson = JSON.parse(output[4]);
    expect(filteredJson).toMatchObject({
      repos: 1,
      cases: 1,
      repoResults: [
        {
          name: "fixture",
          result: {
            caseResults: [
              {
                id: "semantic-cache-navigation"
              }
            ]
          }
        }
      ]
    });
  });

  test("supports portable navigation suite manifests with repo-root and index-root", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "agent-index-cli-navigation-suite-repos-"));
    const root = path.join(repoRoot, "fixture");
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(path.join(root, "pkg", "cache.py"), "def load_value(key):\n    return key\n");
    const evalRoot = await mkdtemp(path.join(tmpdir(), "agent-index-cli-navigation-suite-portable-"));
    const navigationEvalPath = path.join(evalRoot, "navigation-eval.json");
    const suitePath = path.join(evalRoot, "suite.json");
    const indexRoot = path.join(evalRoot, "indexes");
    const output: string[] = [];

    await writeFile(
      navigationEvalPath,
      JSON.stringify([
        {
          id: "semantic-cache",
          task: "Find semantic cache implementation.",
          kind: "bugfix",
          agentIndexQueries: [
            {
              terms: ["load_value"],
              roles: ["source"],
              pathHints: ["pkg/cache.py"]
            }
          ],
          rgQueries: [["load_value"]],
          expected: {
            files: ["pkg/cache.py"],
            symbols: ["load_value"]
          }
        }
      ])
    );
    await writeFile(
      suitePath,
      JSON.stringify([
        {
          name: "fixture",
          evalPath: path.basename(navigationEvalPath),
          target: "fixture"
        }
      ])
    );

    await runCli(["nav-suite", suitePath, "--repo-root", repoRoot, "--index-root", indexRoot, "--reindex", "--repos"], {
      write: (line) => output.push(line)
    });

    expect(output[0]).toContain("Repos: 1");
    expect(output[0]).toContain("indexed=1files/");
  });

  test("compares navigation suite artifacts through the public command", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-cli-navigation-compare-"));
    const baseline = path.join(root, "baseline");
    const current = path.join(root, "current");
    await mkdir(baseline);
    await mkdir(current);
    const summary = {
      repos: 1,
      cases: 1,
      agentIndexUsefulRate: 1,
      rgUsefulRate: 1,
      rgOptimizedUsefulRate: 1,
      agentIndexCompletionRate: 1,
      rgCompletionRate: 0,
      rgOptimizedCompletionRate: 0,
      agentToolUseCases: 1,
      agentToolUseSatisfiedRate: 1,
      agentToolUseAvgFirstUsefulLatencyMs: 8,
      agentToolUseAvgCompletionLatencyMs: 10,
      agentToolUseAvgFirstUsefulContextTokens: 80,
      agentToolUseAvgCompletionContextTokens: 100,
      agentIndexAvgCommands: 1,
      rgAvgCommands: 1,
      rgOptimizedAvgCommands: 2,
      agentIndexAvgLatencyMs: 10,
      rgAvgLatencyMs: 5,
      rgOptimizedAvgLatencyMs: 4,
      agentIndexAvgFirstUsefulLatencyMs: 8,
      rgAvgFirstUsefulLatencyMs: 5,
      rgOptimizedAvgFirstUsefulLatencyMs: 4,
      agentIndexAvgContextTokens: 100,
      rgAvgContextTokens: 1000,
      rgOptimizedAvgContextTokens: 200,
      agentIndexAvgFirstUsefulContextTokens: 80,
      rgAvgFirstUsefulContextTokens: 1000,
      rgOptimizedAvgFirstUsefulContextTokens: 200,
      avgTokenSavings: 900,
      avgOptimizedRgTokenSavings: 100,
      agentIndexWins: 1,
      rgWins: 0,
      ties: 0,
      inconclusive: 0,
      agentIndexWinsVsOptimizedRg: 1,
      rgOptimizedWins: 0,
      optimizedRgTies: 0,
      optimizedRgInconclusive: 0,
      repoResults: []
    };
    await writeFile(path.join(baseline, "summary.json"), JSON.stringify(summary));
    await writeFile(path.join(current, "summary.json"), JSON.stringify({ ...summary, agentIndexAvgContextTokens: 104 }));
    const output: string[] = [];

    await runCli(["nav-compare", baseline, current, "--max-agent-token-increase", "5"], {
      write: (line) => output.push(line)
    });
    expect(output[0]).toContain("Navigation artifact comparison: pass");

    await writeFile(path.join(current, "summary.json"), JSON.stringify({ ...summary, agentIndexAvgLatencyMs: 20 }));
    await expect(
      runCli(["nav-compare", baseline, current, "--max-agent-latency-increase-ms", "5"], { write: (line) => output.push(line) })
    ).rejects.toThrow("Navigation artifact comparison failed with 1 regression(s).");
    expect(output.at(-1)).toContain("agentIndexAvgLatencyMs increased");

    await writeFile(path.join(current, "summary.json"), JSON.stringify({ ...summary, agentIndexCompletionRate: 0 }));
    await expect(runCli(["nav-compare", baseline, current], { write: (line) => output.push(line) })).rejects.toThrow(
      "Navigation artifact comparison failed with 1 regression(s)."
    );
    expect(output.at(-1)).toContain("agentIndexCompletionRate dropped");

    await writeFile(
      path.join(baseline, "summary.json"),
      JSON.stringify({ ...summary, agentIndexWinsVsOptimizedRg: 0, agentIndexAvgContextTokens: 300, rgOptimizedAvgContextTokens: 200 })
    );
    await writeFile(
      path.join(current, "summary.json"),
      JSON.stringify({ ...summary, agentIndexWinsVsOptimizedRg: 0, agentIndexAvgContextTokens: 300, rgOptimizedAvgContextTokens: 200 })
    );
    await expect(runCli(["nav-compare", baseline, current, "--require-agent-dominance"], { write: (line) => output.push(line) })).rejects.toThrow(
      "Navigation artifact comparison failed"
    );
    expect(output.at(-1)).toContain("dominance.agentIndexWinsVsOptimizedRg");

    await writeFile(path.join(baseline, "summary.json"), JSON.stringify({ ...summary, agentToolUseCases: 0, agentToolUseSatisfiedRate: 0 }));
    await writeFile(path.join(current, "summary.json"), JSON.stringify({ ...summary, agentToolUseCases: 0, agentToolUseSatisfiedRate: 0 }));
    await expect(runCli(["nav-compare", baseline, current, "--require-agent-tool-use"], { write: (line) => output.push(line) })).rejects.toThrow(
      "Navigation artifact comparison failed"
    );
    expect(output.at(-1)).toContain("agentToolUseCases");
  });

  test("supports related test discovery from a source file and symbol", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `def test_load_value():
    assert load_value("x") == "x"
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "related-tests",
        "--target",
        root,
        "--source",
        "pkg/cache.py",
        "--symbol",
        "load_value"
      ],
      { write: (line) => output.push(line) }
    );
    await runCli(
      [
        "related-tests",
        "--target",
        root,
        "--source",
        "pkg/cache.py",
        "--symbol",
        "load_value",
        "--json"
      ],
      { write: (line) => output.push(line) }
    );

    expect(output[1]).toContain("1 tests/test_cache.py:1");
    expect(output[1]).toContain("score=");
    expect(output[1]).toContain("why:");
    expect(output[1]).toContain("test body mentions source symbol");
    expect(output[1]).toContain("next: open tests/test_cache.py:1");
    expect(output[1]).not.toContain("why=");
    const json = JSON.parse(output[2]);
    expect(json.matches[0]).toMatchObject({
      file: "tests/test_cache.py",
      why: expect.arrayContaining(["test body mentions source symbol"])
    });
  });

  test("supports related test discovery from multiple source candidates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-cli-related-tests-multi-source-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "reporting.py"), "def format_report_section(phase):\n    return phase\n");
    await writeFile(path.join(root, "pkg", "capture.py"), "def route_captured_output(phase):\n    return phase\n");
    await writeFile(
      path.join(root, "tests", "test_reporting.py"),
      `from pkg.reporting import format_report_section

def test_report_section_label():
    assert format_report_section("setup")
`
    );
    await writeFile(
      path.join(root, "tests", "test_capture.py"),
      `from pkg.capture import route_captured_output

def test_captured_stdout_stderr_setup_call_teardown():
    for phase in ["setup", "call", "teardown"]:
        assert route_captured_output(phase)
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "related-tests",
        "--target",
        root,
        "--source",
        "pkg/reporting.py",
        "--source",
        "pkg/capture.py",
        "--term",
        "captured,stdout,stderr,setup,call,teardown,report,section",
        "--limit",
        "1",
        "--json"
      ],
      { write: (line) => output.push(line) }
    );

    const json = JSON.parse(output[1]);
    expect(json.sourceFiles).toEqual(["pkg/reporting.py", "pkg/capture.py"]);
    expect(json.matches[0]).toMatchObject({ file: "tests/test_capture.py" });
  });

  test("supports structured agent query JSON through the public query command", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "query",
        "--agent-query",
        JSON.stringify({
          terms: ["semantic", "cache", "load"],
          symbolKinds: ["function"],
          pathHints: ["cache"],
          excludeSupportCode: true,
          expand: []
        }),
        "--target",
        root,
        "--mode",
        "hybrid"
      ],
      { write: (line) => output.push(line) }
    );

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.query).toBe("semantic cache load");
    expect(queryJson.matches[0]).toMatchObject({
      symbol: "load_value",
      kind: "function",
      file: "pkg/cache.py",
      neighbors: []
    });
  });

  test("supports structured query shorthand flags", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "query",
        "--term",
        "semantic",
        "--term",
        "cache",
        "--term",
        "load",
        "--kind",
        "function",
        "--path",
        "cache",
        "--expand",
        "parents",
        "--target",
        root,
        "--mode",
        "hybrid"
      ],
      { write: (line) => output.push(line) }
    );

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.query).toBe("semantic cache load");
    expect(queryJson.matches[0]).toMatchObject({
      symbol: "load_value",
      kind: "function",
      file: "pkg/cache.py"
    });
  });

  test("supports comma-separated shorthand values", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "query",
        "--term",
        "semantic,cache,load",
        "--kind",
        "function,method",
        "--path",
        "pkg,cache",
        "--expand",
        "parents,callees",
        "--target",
        root,
        "--mode",
        "hybrid"
      ],
      { write: (line) => output.push(line) }
    );

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.query).toBe("semantic cache load");
    expect(queryJson.matches[0]).toMatchObject({
      symbol: "load_value",
      file: "pkg/cache.py"
    });
  });

  test("supports --index as a query alias for --index-path", async () => {
    const { root } = await fixtureProject();
    const indexPath = path.join(root, "custom-index.sqlite");
    const output: string[] = [];

    await runCli(["index", root, "--index-path", indexPath], { write: (line) => output.push(line) });
    await runCli(
      [
        "query",
        "--target",
        root,
        "--index",
        indexPath,
        "--term",
        "semantic",
        "--term",
        "cache",
        "--kind",
        "function"
      ],
      { write: (line) => output.push(line) }
    );

    expect(JSON.parse(output[1]).matches[0]).toMatchObject({
      symbol: "load_value",
      file: "pkg/cache.py"
    });
  });

  test("supports --repo as a query alias for --target", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["query", "semantic cache", "--repo", root, "--mode", "hybrid"], {
      write: (line) => output.push(line)
    });

    expect(JSON.parse(output[1]).matches[0]).toMatchObject({
      symbol: "load_value",
      file: "pkg/cache.py"
    });
  });

  test("supports --db as a query alias for --index-path", async () => {
    const { root } = await fixtureProject();
    const indexPath = path.join(root, "agent-index.sqlite");
    const output: string[] = [];

    await runCli(["index", root, "--index-path", indexPath], { write: (line) => output.push(line) });
    await runCli(["query", "semantic cache", "--target", root, "--db", indexPath, "--mode", "hybrid"], {
      write: (line) => output.push(line)
    });

    expect(JSON.parse(output[1]).matches[0]).toMatchObject({
      symbol: "load_value",
      file: "pkg/cache.py"
    });
  });

  test("rejects conflicting query target aliases", async () => {
    const { root } = await fixtureProject();
    const otherRoot = await mkdtemp(path.join(tmpdir(), "agent-index-cli-other-target-"));

    await expect(runCli(["query", "semantic cache", "--target", root, "--repo", otherRoot])).rejects.toThrow(
      `Conflicting target paths: --target ${root} and --repo ${otherRoot}.`
    );
  });

  test("rejects conflicting query index aliases", async () => {
    const { root } = await fixtureProject();
    const indexPath = path.join(root, "agent-index.sqlite");
    const otherIndexPath = path.join(root, "other-agent-index.sqlite");

    await expect(
      runCli(["query", "semantic cache", "--target", root, "--index-path", indexPath, "--db", otherIndexPath])
    ).rejects.toThrow(`Conflicting index paths: --index-path ${indexPath} and --db ${otherIndexPath}.`);

    await expect(
      runCli(["query", "semantic cache", "--target", root, "--index", indexPath, "--db", otherIndexPath])
    ).rejects.toThrow(`Conflicting index paths: --index ${indexPath} and --db ${otherIndexPath}.`);
  });

  test("supports shorthand exclude-support-code filtering", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `def test_semantic_cache():
    semantic_cache = "test"
    return semantic_cache
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "query",
        "--target",
        root,
        "--term",
        "semantic",
        "--term",
        "cache",
        "--kind",
        "function",
        "--exclude-support-code"
      ],
      { write: (line) => output.push(line) }
    );

    const files = JSON.parse(output[1]).matches.map((match: { file: string }) => match.file);
    expect(files).not.toContain("tests/test_cache.py");
  });

  test("supports shorthand role filtering for test discovery", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `def test_load_value():
    semantic_cache = "test"
    return semantic_cache
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "query",
        "--target",
        root,
        "--term",
        "semantic",
        "--term",
        "cache",
        "--kind",
        "function",
        "--role",
        "test",
        "--path",
        "tests",
        "--mode",
        "hybrid"
      ],
      { write: (line) => output.push(line) }
    );

    const files = JSON.parse(output[1]).matches.map((match: { file: string }) => match.file);
    expect(files).toEqual(["tests/test_cache.py"]);
  });

  test("supports source and comma-separated role filters", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "fixtures"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "fixtures", "cache_fixture.py"), "def semantic_cache_fixture():\n    return 1\n");
    await writeFile(path.join(root, "tests", "test_cache.py"), "def semantic_cache_test():\n    return 1\n");
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["query", "--target", root, "--term", "semantic", "--role", "source", "--kind", "function"], {
      write: (line) => output.push(line)
    });
    await runCli(["query", "--target", root, "--term", "semantic", "--role", "test,fixture", "--kind", "function"], {
      write: (line) => output.push(line)
    });

    expect(JSON.parse(output[1]).matches.map((match: { file: string }) => match.file)).toEqual(["pkg/cache.py"]);
    expect(JSON.parse(output[2]).matches.map((match: { file: string }) => match.file).sort()).toEqual([
      "fixtures/cache_fixture.py",
      "tests/test_cache.py"
    ]);
  });

  test("rejects invalid and conflicting role filters", async () => {
    const { root } = await fixtureProject();
    await runCli(["index", root], { write: () => undefined });

    await expect(runCli(["query", "--target", root, "--term", "semantic", "--role", "vendor"])).rejects.toThrow(
      "Invalid --role value: vendor. Expected one of: source, test, docs, example, fixture, tool, benchmark."
    );
    await expect(
      runCli(["query", "--target", root, "--term", "semantic", "--role", "test", "--exclude-support-code"])
    ).rejects.toThrow("Use either --role or --exclude-support-code, not both.");
  });

  test("supports positional query refined with structured flags", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      ["query", "semantic cache", "--target", root, "--mode", "hybrid", "--path", "cache", "--kind", "function"],
      { write: (line) => output.push(line) }
    );

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.query).toBe("semantic cache");
    expect(queryJson.matches[0]).toMatchObject({
      symbol: "load_value",
      kind: "function",
      file: "pkg/cache.py"
    });
  });

  test("supports path-filter shorthand for hard path filtering", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "query",
        "semantic cache",
        "--target",
        root,
        "--mode",
        "hybrid",
        "--path",
        "pkg/cache.py",
        "--path-filter",
        "--kind",
        "function"
      ],
      { write: (line) => output.push(line) }
    );

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.matches.map((match: { file: string }) => match.file)).toEqual(["pkg/cache.py"]);
  });

  test("supports positional query refined with exclude-support-code", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `def test_semantic_cache():
    semantic_cache = "test"
    return semantic_cache
`
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["query", "semantic cache", "--target", root, "--mode", "hybrid", "--exclude-support-code"], {
      write: (line) => output.push(line)
    });

    const files = JSON.parse(output[1]).matches.map((match: { file: string }) => match.file);
    expect(files).not.toContain("tests/test_cache.py");
  });

  test("combines positional query words with explicit shorthand terms", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["query", "semantic", "--target", root, "--mode", "hybrid", "--term", "cache", "--kind", "function"], {
      write: (line) => output.push(line)
    });

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.query).toBe("semantic cache");
    expect(queryJson.matches[0]).toMatchObject({
      symbol: "load_value",
      file: "pkg/cache.py"
    });
  });

  test("rejects mixed structured JSON and shorthand query flags", async () => {
    const { root } = await fixtureProject();
    await runCli(["index", root], { write: () => undefined });

    await expect(
      runCli([
        "query",
        "--target",
        root,
        "--agent-query",
        JSON.stringify({ terms: ["semantic"] }),
        "--term",
        "cache"
      ])
    ).rejects.toThrow("Use either --agent-query JSON or shorthand query flags, not both.");
  });

  test("explains agent-query JSON that uses query instead of terms", async () => {
    const { root } = await fixtureProject();
    await runCli(["index", root], { write: () => undefined });

    await expect(
      runCli(["query", "--target", root, "--agent-query", JSON.stringify({ query: "semantic cache" })])
    ).rejects.toThrow(
      'Invalid --agent-query JSON: use {"terms":["semantic","cache"]}, not {"query":"semantic cache"}. Shorthand equivalent: --term semantic --term cache'
    );
  });

  test("rejects invalid shorthand kind and expand values", async () => {
    const { root } = await fixtureProject();
    await runCli(["index", root], { write: () => undefined });

    await expect(runCli(["query", "--target", root, "--term", "semantic", "--kind", "property"])).rejects.toThrow(
      'Invalid --kind value: property. Expected one of: function, method, class, module, typealias.'
    );
    await expect(runCli(["query", "--target", root, "--term", "semantic", "--expand", "siblings"])).rejects.toThrow(
      'Invalid --expand value: siblings. Expected one of: callers, callees, imports, parents, children.'
    );
  });

  test("suggests the query subcommand for query-like root flags", async () => {
    await expect(runCli(["--index", "/tmp/index.sqlite", "--term", "semantic"])).rejects.toThrow(
      "Did you mean: agent-index query --index /tmp/index.sqlite --term semantic"
    );
  });

  test("supports query debug diagnostics for ranking audits", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["query", "where is semantic cache loaded?", "--target", root, "--mode", "hybrid", "--debug"], {
      write: (line) => output.push(line)
    });

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.matches[0]).toMatchObject({
      symbol: "load_value",
      debug: {
        candidateSources: expect.arrayContaining(["fts"]),
        ftsPosition: expect.any(Number),
        hybrid: {
          adjustedScore: expect.any(Number),
          lexicalBoost: expect.any(Number),
          specificityBoost: expect.any(Number),
          containerAdjustment: expect.any(Number)
        }
      }
    });
  });

  test("supports query profile diagnostics in JSON output", async () => {
    const { root } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["query", "where is semantic cache loaded?", "--target", root, "--mode", "hybrid", "--profile"], {
      write: (line) => output.push(line)
    });

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.matches[0].debug).toBeUndefined();
    expect(queryJson.profile).toMatchObject({
      phases: {
        fts: { durationMs: expect.any(Number), rowCount: expect.any(Number) },
        exactSymbol: { durationMs: expect.any(Number), rowCount: expect.any(Number) },
        pathHints: { durationMs: expect.any(Number), rowCount: expect.any(Number) },
        intentCandidates: { durationMs: expect.any(Number), rowCount: expect.any(Number) },
        ranking: { durationMs: expect.any(Number), rowCount: expect.any(Number) },
        expansion: { durationMs: expect.any(Number), rowCount: expect.any(Number) }
      }
    });
  });

  test("appends a trace event for query without changing JSON stdout", async () => {
    const { root } = await fixtureProject();
    const tracePath = path.join(root, "trace.jsonl");
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "query",
        "semantic cache",
        "--target",
        root,
        "--mode",
        "hybrid",
        "--trace",
        tracePath,
        "--trace-task",
        "semantic-cache-task",
        "--limit",
        "3"
      ],
      { write: (line) => output.push(line) }
    );

    const queryJson = JSON.parse(output[1]);
    expect(queryJson.matches[0].symbol).toBe("load_value");

    const traceLines = (await readFile(tracePath, "utf8")).trim().split("\n");
    expect(traceLines).toHaveLength(1);
    const traceEvent = JSON.parse(traceLines[0]);
    expect(traceEvent).toMatchObject({
      type: "agent-index-query",
      taskId: "semantic-cache-task",
      target: root,
      mode: "hybrid",
      query: {
        text: "semantic cache",
        normalized: "semantic cache"
      },
      excludeSupportCode: false,
      outcome: "unreviewed"
    });
    expect(traceEvent.topMatches[0]).toMatchObject({
      rank: 1,
      symbol: "load_value",
      kind: "function",
      file: "pkg/cache.py",
      lines: [1, 3]
    });
    expect(traceEvent.latencyMs).toEqual(expect.any(Number));
    expect(traceEvent.timestamp).toEqual(expect.any(String));
  });

  test("trace events include structured query shape and append multiple queries", async () => {
    const { root } = await fixtureProject();
    const tracePath = path.join(root, "trace.jsonl");
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      ["query", "--target", root, "--trace", tracePath, "--term", "semantic", "--kind", "function", "--path", "cache"],
      { write: (line) => output.push(line) }
    );
    await runCli(
      [
        "query",
        "--target",
        root,
        "--trace",
        tracePath,
        "--agent-query",
        JSON.stringify({ terms: ["semantic", "cache"], symbolKinds: ["function"], excludeSupportCode: true })
      ],
      { write: (line) => output.push(line) }
    );

    const events = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      query: {
        agentQuery: {
          terms: ["semantic"],
          symbolKinds: ["function"],
          pathHints: ["cache"]
        }
      },
      excludeSupportCode: false
    });
    expect(events[1]).toMatchObject({
      query: {
        agentQuery: {
          terms: ["semantic", "cache"],
          symbolKinds: ["function"],
          excludeSupportCode: true
        }
      },
      excludeSupportCode: true
    });
  });

  test("reports a friendly error when trace cannot be written", async () => {
    const { root } = await fixtureProject();
    const tracePath = path.join(root, "missing-dir", "trace.jsonl");

    await runCli(["index", root], { write: () => undefined });

    await expect(
      runCli(["query", "semantic cache", "--target", root, "--trace", tracePath])
    ).rejects.toThrow(`Could not write trace event to ${tracePath}:`);
  });

  test("summarizes trace report metrics", async () => {
    const { root } = await fixtureProject();
    const tracePath = path.join(root, "trace.jsonl");
    const output: string[] = [];
    await writeFile(
      tracePath,
      [
        JSON.stringify({
          type: "agent-index-query",
          timestamp: "2026-06-14T10:00:00.000Z",
          taskId: "task-1",
          latencyMs: 20,
          outcome: "useful",
          usefulRank: 2,
          topMatches: []
        }),
        JSON.stringify({
          type: "agent-index-query",
          timestamp: "2026-06-14T10:00:03.000Z",
          taskId: "task-1",
          latencyMs: 40,
          outcome: "bad-result",
          topMatches: []
        }),
        JSON.stringify({
          type: "agent-index-query",
          timestamp: "2026-06-14T10:00:05.000Z",
          taskId: "task-1",
          latencyMs: 60,
          outcome: "unreviewed",
          topMatches: []
        }),
        JSON.stringify({
          type: "rg-fallback",
          timestamp: "2026-06-14T10:00:08.000Z",
          taskId: "task-1",
          command: "rg semantic"
        }),
        JSON.stringify({
          type: "verification",
          timestamp: "2026-06-14T10:00:10.000Z",
          taskId: "task-1",
          command: "npm test",
          result: "passed"
        })
      ].join("\n") + "\n"
    );

    await runCli(["trace-report", tracePath], { write: (line) => output.push(line) });

    expect(output[0]).toContain("Trace events: 5");
    expect(output[0]).toContain("Query events: 3");
    expect(output[0]).toContain("Avg query latency: 40ms");
    expect(output[0]).toContain("First useful hit rank: 2");
    expect(output[0]).toContain("rg fallbacks: 1");
    expect(output[0]).toContain("Bad results: 1");
    expect(output[0]).toContain("Unreviewed queries: 1");
    expect(output[0]).toContain("Elapsed wall time: 10s");
  });

  test("trace-note appends a lesson event", async () => {
    const { root } = await fixtureProject();
    const tracePath = path.join(root, "trace.jsonl");
    const output: string[] = [];

    await runCli([
      "trace-note",
      tracePath,
      "--task",
      "task-1",
      "--lesson",
      "Agent-index found implementation but needed a refinement query for tests.",
      "--next-step",
      "Improve trace reporting before ranking changes.",
      "--evidence",
      "First useful implementation hit was rank 7."
    ], { write: (line) => output.push(line) });

    expect(output).toEqual([`Appended lesson to ${tracePath}`]);
    const traceLines = (await readFile(tracePath, "utf8")).trim().split("\n");
    expect(traceLines).toHaveLength(1);
    const event = JSON.parse(traceLines[0]);
    expect(event).toMatchObject({
      type: "lesson",
      taskId: "task-1",
      lesson: "Agent-index found implementation but needed a refinement query for tests.",
      nextStep: "Improve trace reporting before ranking changes.",
      evidence: "First useful implementation hit was rank 7."
    });
    expect(event.timestamp).toEqual(expect.any(String));
  });

  test("trace-report includes query path details, bad results, and lessons", async () => {
    const { root } = await fixtureProject();
    const tracePath = path.join(root, "trace.jsonl");
    const output: string[] = [];
    await writeFile(
      tracePath,
      [
        JSON.stringify({
          type: "agent-index-query",
          timestamp: "2026-06-14T10:00:00.000Z",
          taskId: "task-1",
          latencyMs: 20,
          outcome: "bad-result",
          query: { normalized: "weighted mixing graph cost" },
          topMatches: [
            {
              rank: 1,
              symbol: "attribute_mixing_matrix",
              kind: "function",
              file: "networkx/algorithms/assortativity/mixing.py",
              lines: [10, 20],
              score: 12,
              why: ["symbol name"]
            }
          ]
        }),
        JSON.stringify({
          type: "agent-index-query",
          timestamp: "2026-06-14T10:00:03.000Z",
          taskId: "task-1",
          latencyMs: 40,
          outcome: "useful",
          usefulRank: 1,
          query: { normalized: "mixing expansion cut cost" },
          topMatches: [
            {
              rank: 1,
              symbol: "mixing_expansion",
              kind: "function",
              file: "networkx/algorithms/cuts.py",
              lines: [100, 120],
              score: 30,
              why: ["symbol name"]
            }
          ]
        }),
        JSON.stringify({
          type: "lesson",
          timestamp: "2026-06-14T10:00:06.000Z",
          taskId: "task-1",
          lesson: "Overloaded domain words need refinement evidence.",
          nextStep: "Improve trace reporting before tuning retrieval.",
          evidence: "The first query went to assortativity mixing tests."
        })
      ].join("\n") + "\n"
    );

    await runCli(["trace-report", tracePath], { write: (line) => output.push(line) });

    expect(output[0]).toContain("Trace events: 3");
    expect(output[0]).toContain("Bad results: 1");
    expect(output[0]).toContain("Lessons: 1");
    expect(output[0]).toContain("Query path:");
    expect(output[0]).toContain("#1 bad-result query=\"weighted mixing graph cost\" top=attribute_mixing_matrix networkx/algorithms/assortativity/mixing.py:10");
    expect(output[0]).toContain("#2 useful rank=1 query=\"mixing expansion cut cost\" top=mixing_expansion networkx/algorithms/cuts.py:100");
    expect(output[0]).toContain("Bad-result details:");
    expect(output[0]).toContain("#1 weighted mixing graph cost");
    expect(output[0]).toContain("1. attribute_mixing_matrix networkx/algorithms/assortativity/mixing.py:10");
    expect(output[0]).toContain("Lessons learned:");
    expect(output[0]).toContain("Overloaded domain words need refinement evidence.");
    expect(output[0]).toContain("Recommended next step:");
    expect(output[0]).toContain("Improve trace reporting before tuning retrieval.");
  });

  test("trace-report rejects empty and malformed trace files", async () => {
    const { root } = await fixtureProject();
    const emptyPath = path.join(root, "empty.jsonl");
    const malformedPath = path.join(root, "malformed.jsonl");
    await writeFile(emptyPath, "");
    await writeFile(malformedPath, "{\"type\":\"agent-index-query\"}\nnot-json\n");

    await expect(runCli(["trace-report", emptyPath])).rejects.toThrow(`Trace file ${emptyPath} is empty.`);
    await expect(runCli(["trace-report", malformedPath])).rejects.toThrow(
      `Could not parse trace file ${malformedPath} at line 2:`
    );
  });

  test("supports custom index paths across index, query, and benchmark", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const indexPath = path.join(root, "custom-index.sqlite");
    const output: string[] = [];

    await runCli(["index", root, "--index-path", indexPath], { write: (line) => output.push(line) });
    await runCli(["query", "where is semantic cache loaded?", "--target", root, "--index-path", indexPath], {
      write: (line) => output.push(line)
    });
    await runCli(["benchmark", benchmarkPath, "--target", root, "--index-path", indexPath], {
      write: (line) => output.push(line)
    });

    expect(output[0]).toContain(indexPath);
    expect(JSON.parse(output[1]).matches[0].symbol).toBe("load_value");
    expect(output[2]).toContain("Symbol Hit@5: 1.00");
  });

  test("reports a friendly error when querying before an index exists", async () => {
    const { root } = await fixtureProject();
    const missingIndexPath = path.join(root, "missing-index.sqlite");

    await expect(
      runCli(["query", "where is semantic cache loaded?", "--target", root, "--index-path", missingIndexPath])
    ).rejects.toThrow(`No agent-index database found at ${missingIndexPath}. Run "agent-index index ${root} --index-path ${missingIndexPath}" first.`);
  });

  test("reports a friendly error when the index file is not initialized", async () => {
    const { root } = await fixtureProject();
    const emptyIndexPath = path.join(root, "empty-index.sqlite");
    await writeFile(emptyIndexPath, "");

    await expect(
      runCli(["benchmark", path.join(root, "benchmark.json"), "--target", root, "--index-path", emptyIndexPath])
    ).rejects.toThrow(`The agent-index database at ${emptyIndexPath} is missing required tables. Rebuild it with "agent-index index ${root} --index-path ${emptyIndexPath}".`);
  });

  test("supports hybrid benchmark mode", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["benchmark", benchmarkPath, "--target", root, "--mode", "hybrid"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Mode: hybrid");
  });

  test("supports JSON benchmark output with per-question details", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["benchmark", benchmarkPath, "--target", root, "--mode", "hybrid", "--json"], {
      write: (line) => output.push(line)
    });

    const result = JSON.parse(output[1]);
    expect(result.mode).toBe("hybrid");
    expect(result.cases[0]).toMatchObject({
      id: "semantic-cache",
      symbolRank: 1,
      fileRank: 1,
      topMatches: expect.arrayContaining([
        expect.objectContaining({
          rank: 1,
          symbol: "load_value",
          file: "pkg/cache.py"
        })
      ])
    });
  });

  test("supports structured agent benchmark mode with an rg-style baseline in JSON output", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "benchmark",
        benchmarkPath,
        "--target",
        root,
        "--mode",
        "hybrid",
        "--query-style",
        "agent",
        "--include-rg-baseline",
        "--json"
      ],
      { write: (line) => output.push(line) }
    );

    const result = JSON.parse(output[1]);
    expect(result.queryStyle).toBe("agent");
    expect(result.rgBaseline).toMatchObject({
      baselineKind: "lexical",
      questions: 1,
      fileHitAt1: 1,
      fileHitAt5: 1,
      avgContextTokens: expect.any(Number)
    });
    expect(result.rgBaseline.cases[0].topFiles[0]).toMatchObject({
      file: "pkg/cache.py",
      rank: 1
    });
  });

  test("prints rg-style baseline metrics in text benchmark output", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "benchmark",
        benchmarkPath,
        "--target",
        root,
        "--mode",
        "hybrid",
        "--query-style",
        "agent",
        "--include-rg-baseline"
      ],
      { write: (line) => output.push(line) }
    );

    expect(output[1]).toContain("Query style: agent");
    expect(output[1]).toContain("Avg context tokens:");
    expect(output[1]).toContain("rg-style File Hit@1: 1.00");
    expect(output[1]).toContain("rg-style File Hit@5: 1.00");
    expect(output[1]).toContain("rg-style Avg context tokens:");
  });

  test("supports real rg command baseline in benchmark output", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "benchmark",
        benchmarkPath,
        "--target",
        root,
        "--mode",
        "hybrid",
        "--query-style",
        "agent",
        "--include-rg-baseline",
        "--baseline",
        "command",
        "--json"
      ],
      { write: (line) => output.push(line) }
    );

    const result = JSON.parse(output[1]);
    expect(result.rgBaseline).toMatchObject({
      baselineKind: "command",
      questions: 1
    });
    expect(result.rgBaseline.cases[0]).toMatchObject({
      command: expect.stringContaining("rg"),
      exitCode: expect.any(Number)
    });
  });

  test("supports concise benchmark miss output for triage", async () => {
    const { root } = await fixtureProject();
    const benchmarkPath = path.join(root, "misses-benchmark.json");
    await writeFile(
      benchmarkPath,
      JSON.stringify([
        {
          id: "missing-symbol",
          question: "where is semantic cache loaded?",
          expected: { files: ["pkg/cache.py"], symbols: ["missing_symbol"] }
        }
      ])
    );
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["benchmark", benchmarkPath, "--target", root, "--misses"], {
      write: (line) => output.push(line)
    });

    expect(output[1]).toContain("Misses:");
    expect(output[1]).toContain("missing-symbol");
    expect(output[1]).toContain("symbolRank=-");
    expect(output[1]).toContain("fileRank=1");
    expect(output[1]).toContain("top=load_value");
    expect(output[1]).toContain("file=pkg/cache.py");
  });

  test("supports benchmark debug diagnostics in JSON output", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(["benchmark", benchmarkPath, "--target", root, "--mode", "hybrid", "--json", "--debug"], {
      write: (line) => output.push(line)
    });

    const result = JSON.parse(output[1]);
    expect(result.cases[0].topMatches[0]).toMatchObject({
      symbol: "load_value",
      debug: {
        candidateSources: expect.arrayContaining(["fts"]),
        ftsPosition: expect.any(Number),
        hybrid: {
          adjustedScore: expect.any(Number),
          lexicalBoost: expect.any(Number),
          specificityBoost: expect.any(Number),
          containerAdjustment: expect.any(Number)
        }
      }
    });
  });

  test("compares agent-index benchmark results with Graphify query text", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const graphifyResultsPath = await writeGraphifyResults(root);
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      ["agent-eval", benchmarkPath, "--target", root, "--graphify-results", graphifyResultsPath],
      { write: (line) => output.push(line) }
    );

    expect(output[1]).toContain("Mode: symbol");
    expect(output[1]).toContain("Questions: 1");
    expect(output[1]).toContain("agent-index Symbol Hit@1: 1.00");
    expect(output[1]).toContain("Graphify symbol mention rate: 1.00");
    expect(output[1]).toContain("Graphify file mention rate: 1.00");
  });

  test("supports JSON agent-eval output", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const graphifyResultsPath = await writeGraphifyResults(root);
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      ["agent-eval", benchmarkPath, "--target", root, "--graphify-results", graphifyResultsPath, "--json"],
      { write: (line) => output.push(line) }
    );

    const result = JSON.parse(output[1]);
    expect(result).toMatchObject({
      questions: 1,
      mode: "symbol",
      graphify: {
        symbolMentionRate: 1,
        fileMentionRate: 1
      },
      cases: [
        {
          id: "semantic-cache",
          agentIndexSymbolRank: 1,
          graphifySymbolMention: true,
          winner: "tie"
        }
      ]
    });
  });

  test("supports structured agent query style in agent-eval output", async () => {
    const { root, benchmarkPath } = await fixtureProject();
    const graphifyResultsPath = await writeGraphifyResults(root);
    const output: string[] = [];

    await runCli(["index", root], { write: (line) => output.push(line) });
    await runCli(
      [
        "agent-eval",
        benchmarkPath,
        "--target",
        root,
        "--graphify-results",
        graphifyResultsPath,
        "--query-style",
        "agent",
        "--json"
      ],
      { write: (line) => output.push(line) }
    );

    const result = JSON.parse(output[1]);
    expect(result.agentIndex.queryStyle).toBe("agent");
  });

  test("supports source-only indexing that skips tests and tools", async () => {
    const { root } = await fixtureProject();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "tools"), { recursive: true });
    await writeFile(path.join(root, "tests", "test_noise.py"), "def noisy_test_symbol():\n    return 1\n");
    await writeFile(path.join(root, "tools", "helper.py"), "def noisy_tool_symbol():\n    return 1\n");
    const output: string[] = [];

    await runCli(["index", root, "--source-only"], { write: (line) => output.push(line) });

    expect(output[0]).toContain("Indexed 1 files");
    expect(output[0]).toContain("mode: source-only");
  });
});
