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

  test("uses fixture arguments that match the source file stem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-fixture-stem-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "cache.py"), "def load_value(key):\n    return key\n");
    await writeFile(
      path.join(root, "tests", "test_runtime_behavior.py"),
      `def test_runtime_cache(cache):
    assert cache.load_value("x") == "x"
`
    );
    await writeFile(
      path.join(root, "tests", "test_unrelated.py"),
      `def test_unrelated(other):
    assert other
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/cache.py"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_runtime_behavior.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toContain("test uses related fixture");
  });

  test("uses fixture arguments that match noun-like source symbol suffixes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-fixture-symbol-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "factory.py"), "def create_client():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "test_runtime_behavior.py"),
      `def test_runtime_client(client):
    assert client is not None
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/factory.py",
      symbol: "create_client"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_runtime_behavior.py",
      firstLine: 1
    });
    expect(result.matches[0].why).toContain("test uses related fixture");
  });

  test("uses parametrized cases to disambiguate related tests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-parametrize-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client.py"), "def send_request():\n    return 'ok'\n");
    await writeFile(
      path.join(root, "tests", "test_auth.py"),
      `from pkg import client

def test_auth_flow():
    assert client.send_request() == "ok"
`
    );
    await writeFile(
      path.join(root, "tests", "test_redirects.py"),
      `import pytest
from pkg import client

@pytest.mark.parametrize(
    "status, expected",
    [(302, "redirect-history"), (303, "redirect-history")],
    ids=["redirect-history-302", "redirect-history-303"],
)
def test_redirect_history(status, expected):
    assert client.send_request() == "ok"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client.py",
      symbol: "send_request",
      terms: ["redirect", "history"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_redirects.py",
      firstLine: 2
    });
    expect(result.matches[0].why).toEqual(
      expect.arrayContaining(["parametrized cases match task terms", "test body matches task terms"])
    );
  });

  test("uses parametrized cases that mention source target aliases", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-parametrize-target-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "factory.py"), "def create_client():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "test_factory_cases.py"),
      `import pytest

@pytest.mark.parametrize("kind", ["client", "client-alias"])
def test_runtime_factory(kind):
    assert kind
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/factory.py",
      symbol: "create_client"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_factory_cases.py",
      firstLine: 3
    });
    expect(result.matches[0].why).toContain("parametrized cases mention source target");
  });

  test("uses mirrored package layout when test filenames do not name the source file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-layout-"));
    await mkdir(path.join(root, "pkg", "client"), { recursive: true });
    await mkdir(path.join(root, "tests", "client"), { recursive: true });
    await mkdir(path.join(root, "tests", "server"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client", "session.py"), "def open_session():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "client", "test_runtime_behavior.py"),
      `def test_runtime_behavior():
    assert True
`
    );
    await writeFile(
      path.join(root, "tests", "server", "test_runtime_behavior.py"),
      `def test_runtime_behavior():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client/session.py"
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/client/test_runtime_behavior.py"
    });
    expect(result.matches[0].why).toContain("test path mirrors source package layout");
    expect(result.matches.map((match) => match.file)).not.toContain("tests/server/test_runtime_behavior.py");
  });

  test("ignores generic mirrored layout tokens", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-layout-stopwords-"));
    await mkdir(path.join(root, "pkg", "core"), { recursive: true });
    await mkdir(path.join(root, "tests", "core"), { recursive: true });
    await writeFile(path.join(root, "pkg", "core", "engine.py"), "def run_engine():\n    return object()\n");
    await writeFile(
      path.join(root, "tests", "core", "test_runtime_behavior.py"),
      `def test_runtime_behavior():
    assert True
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/core/engine.py"
    });

    expect(result.matches).toEqual([]);
  });

  test("uses Rust integration-test imports and calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-rust-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "src", "cache.rs"),
      `pub fn load_value(key: &str) -> String {
    key.to_string()
}
`
    );
    await writeFile(
      path.join(root, "tests", "cache_integration.rs"),
      `use crate::cache::load_value;

#[test]
fn preserves_loaded_value() {
    assert_eq!(load_value("x"), "x");
}
`
    );
    await writeFile(
      path.join(root, "tests", "noise.rs"),
      `#[test]
fn mentions_cache_without_calling_source() {
    let cache_label = "cache";
    assert_eq!(cache_label, "cache");
}
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "src/cache.rs",
      symbol: "load_value",
      terms: ["loaded", "value"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/cache_integration.rs",
      firstLine: 1
    });
    expect(result.matches[0].why).toEqual(expect.arrayContaining(["test imports source module", "test calls source symbol"]));
  });
});
