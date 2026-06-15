import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { findRelatedTests } from "../../src/core/related-tests.js";

describe("findRelatedTests", () => {
  test("ranks tests by source path and symbol evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "cache.py"), "def load_value(key):\n    return key\n");
    await writeFile(
      path.join(root, "tests", "test_cache.py"),
      `def test_load_value():
    assert load_value("x") == "x"
`
    );
    await writeFile(
      path.join(root, "tests", "test_other.py"),
      `def test_unrelated():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/cache.py",
      symbol: "load_value"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_cache.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["test path includes source stem", "test body mentions source symbol", "test calls source symbol"])
    );
    expect(result.matches.map((match) => match.file)).not.toContain("tests/test_other.py");
  });

  test("uses import evidence when test filenames do not match source filenames", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-imports-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "service.py"), "def create_client():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "test_api_behavior.py"),
      `from pkg import service

def test_client_factory():
    assert service.create_client() is not None
`
    );
    await writeFile(
      path.join(root, "tests", "test_unrelated.py"),
      `def test_unrelated():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/service.py"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_api_behavior.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toContain("test imports source module");
  });

  test("uses task terms to disambiguate tests that import the same source module", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-task-terms-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests", "client"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client.py"), "def send_redirect():\n    return 'redirect'\n");
    await writeFile(
      path.join(root, "tests", "client", "test_auth.py"),
      `from pkg import client

def test_auth_flow():
    assert client.send_redirect()
`
    );
    await writeFile(
      path.join(root, "tests", "client", "test_redirects.py"),
      `from pkg import client

def test_next_request_preserves_redirect_history():
    next_request = client.send_redirect()
    assert next_request == "redirect"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client.py",
      symbol: "send_redirect",
      terms: ["next_request", "redirect", "history"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/client/test_redirects.py"
    });
    expect(result.matches[0].why).toContain("test body matches task terms");
  });

  test("matches imports for common src package layouts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-src-layout-"));
    await mkdir(path.join(root, "src", "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "src", "pkg", "service.py"), "def create_client():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "test_api_behavior.py"),
      `from pkg import service

def test_client_factory():
    assert service.create_client() is not None
`
    );
    await writeFile(
      path.join(root, "tests", "test_unrelated.py"),
      `def test_unrelated():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/pkg/service.py"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_api_behavior.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toContain("test imports source module");
  });
});
