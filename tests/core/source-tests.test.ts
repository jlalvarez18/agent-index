import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { findSourceTests } from "../../src/core/source-tests.js";

describe("findSourceTests", () => {
  test("prefers source/test pairs with matching behavior evidence over source-only term density", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-source-tests-pair-ranking-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "lockfile.py"),
      `def parse_lock_file_entries(data):
    lock_file = data
    source_repository = data.get("source")
    environment_marker = data.get("marker")
    install_operations = []
    same_version_entries = [lock_file, source_repository, environment_marker]
    return same_version_entries, install_operations

def dump_lock_file_entries(entries):
    return [
        (entry.source_repository, entry.environment_marker, entry.install_operations)
        for entry in entries
    ]
`
    );
    await writeFile(
      path.join(root, "pkg", "selection.py"),
      `def choose_install_entry(entries, platform):
    for entry in entries:
        if entry.source == "linux-wheels" and entry.marker == platform:
            return entry
    return entries[0]
`
    );
    await writeFile(
      path.join(root, "tests", "test_install_selection.py"),
      `from pkg.selection import choose_install_entry

def test_same_version_entries_use_source_and_marker_for_install():
    entries = [
        type("Entry", (), {"source": "pypi", "marker": "darwin"})(),
        type("Entry", (), {"source": "linux-wheels", "marker": "linux"})(),
    ]
    assert choose_install_entry(entries, "linux").source == "linux-wheels"
`
    );
    await indexTarget(root);

    const result = findSourceTests(
      {
        terms: ["lock file", "same version", "source", "repository", "environment marker", "install operations"],
        roles: ["source"]
      },
      { target: root, limit: 2, testLimit: 1 }
    );

    expect(result.bundles[0].source.file).toBe("pkg/selection.py");
    expect(result.bundles[0].tests[0]).toMatchObject({
      file: "tests/test_install_selection.py"
    });
  });
});
