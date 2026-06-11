import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { queryIndex } from "../../src/core/query.js";

async function fixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-"));
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "cache.py"),
    `class Cache:
    def get(self, key):
        return load_value(key)

def load_value(key):
    semantic_cache = {"hit": key}
    return semantic_cache["hit"]
`
  );
  return root;
}

describe("queryIndex", () => {
  test("returns the expected symbol in top results with line citations and nearby edges", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const result = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5 });

    expect(result.query).toBe("where is semantic cache loaded?");
    expect(result.matches[0]).toMatchObject({
      symbol: "load_value",
      kind: "function",
      file: "pkg/cache.py",
      lines: [5, 7]
    });
    expect(result.matches[0].score).toBeGreaterThan(0);
    expect(result.matches[0].why).toEqual(expect.arrayContaining(["matched source text"]));
    expect(result.matches[0].neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "called_by_name",
          symbol: "Cache.get"
        })
      ])
    );
  });
});
