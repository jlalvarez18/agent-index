import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { scanPythonFiles } from "../../src/core/scanner.js";

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

    await writeFile(path.join(root, "pkg", "service.py"), "def run():\n    return 1\n");
    await writeFile(path.join(root, "README.md"), "# ignore me\n");
    await writeFile(path.join(root, ".git", "hidden.py"), "def hidden(): pass\n");
    await writeFile(path.join(root, ".codeindex", "index.py"), "def generated(): pass\n");
    await writeFile(path.join(root, "__pycache__", "cached.py"), "def cached(): pass\n");
    await writeFile(path.join(root, "node_modules", "dep", "vendored.py"), "def vendored(): pass\n");

    const files = await scanPythonFiles(root);

    expect(files).toEqual([
      {
        absolutePath: path.join(root, "pkg", "service.py"),
        relativePath: "pkg/service.py",
        language: "python",
        text: "def run():\n    return 1\n"
      }
    ]);
  });

  test("can skip tests and tools for source-only benchmark indexing", async () => {
    const root = await fixtureDir();
    await mkdir(path.join(root, "graphify"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "tools", "skillgen"), { recursive: true });

    await writeFile(path.join(root, "graphify", "cache.py"), "def product():\n    return 1\n");
    await writeFile(path.join(root, "tests", "test_cache.py"), "def test_product():\n    return 1\n");
    await writeFile(path.join(root, "tools", "skillgen", "gen.py"), "def helper():\n    return 1\n");

    const files = await scanPythonFiles(root, { includeSupportCode: false });

    expect(files.map((file) => file.relativePath)).toEqual(["graphify/cache.py"]);
  });
});
