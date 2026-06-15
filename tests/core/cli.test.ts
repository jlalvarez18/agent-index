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

    expect(output[2].split("\n")[0]).toBe("1 pkg/cache.py:1-3 function load_value");
    expect(output[2]).not.toContain("why");
    expect(output[2]).not.toContain("neighbors");
    expect(output[2].length).toBeLessThan(output[1].length);
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
      'Invalid --kind value: property. Expected one of: function, method, class, module.'
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
