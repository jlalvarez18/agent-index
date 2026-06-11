import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runCli } from "../../src/cli.js";

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
        expected: { files: ["pkg/cache.py"], symbols: ["load_value"] }
      }
    ])
  );
  return { root, benchmarkPath };
}

describe("runCli", () => {
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
    expect(output[2]).toContain("Symbol Hit@5: 1.00");
    expect(output[2]).toContain("File Hit@5: 1.00");
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
  });
});
