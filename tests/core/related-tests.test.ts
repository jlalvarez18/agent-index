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

  test("prunes unrelated test files before scoring full text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-pruned-candidates-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests", "client"), { recursive: true });
    await mkdir(path.join(root, "tests", "noise"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client.py"), "def send_redirect():\n    return 'redirect'\n");
    await writeFile(
      path.join(root, "tests", "client", "test_redirects.py"),
      `from pkg import client

def test_redirect_history():
    assert client.send_redirect() == "redirect"
`
    );
    for (let index = 0; index < 40; index += 1) {
      await writeFile(
        path.join(root, "tests", "noise", `test_noise_${index}.py`),
        `def test_noise_${index}():
    unrelated_payload = "${"noise ".repeat(200)}"
    assert unrelated_payload
`
      );
    }
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client.py",
      symbol: "send_redirect",
      terms: ["redirect", "history"],
      limit: 1
    });

    expect(result.candidateFilesScored).toBeLessThan(10);
    expect(result.matches[0]).toMatchObject({
      file: "tests/client/test_redirects.py"
    });
  });

  test("does not let broad task terms or package roots flood candidate tests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-broad-path-prune-"));
    await mkdir(path.join(root, "networkx", "classes"), { recursive: true });
    await mkdir(path.join(root, "networkx", "classes", "tests"), { recursive: true });
    await mkdir(path.join(root, "networkx", "algorithms", "tests"), { recursive: true });
    await writeFile(path.join(root, "networkx", "classes", "function.py"), "def path_weight():\n    return 1\n");
    await writeFile(
      path.join(root, "networkx", "classes", "tests", "test_function.py"),
      `from networkx.classes import function

def test_pathweight():
    assert function.path_weight() == 1
`
    );
    for (let index = 0; index < 30; index += 1) {
      await writeFile(
        path.join(root, "networkx", "algorithms", "tests", `test_weight_path_${index}.py`),
        `def test_weight_path_${index}():
    assert "path weight default"
`
      );
    }
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "networkx/classes/function.py",
      symbol: "path_weight",
      terms: ["path", "cost", "edge", "weight", "missing", "default", "invalid"],
      limit: 1
    });

    expect(result.candidateFilesScored).toBeLessThan(5);
    expect(result.matches[0]).toMatchObject({
      file: "networkx/classes/tests/test_function.py"
    });
  });

  test("falls back to all tests when pruned candidates do not score", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-prune-fallback-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests", "noise"), { recursive: true });
    await mkdir(path.join(root, "tests", "regression"), { recursive: true });
    await writeFile(path.join(root, "pkg", "client.py"), "def send_redirect():\n    return 'redirect'\n");
    await writeFile(
      path.join(root, "tests", "noise", "test_redirect_placeholder.py"),
      `def test_placeholder():
    assert True
`
    );
    await writeFile(
      path.join(root, "tests", "regression", "test_behavior.py"),
      `from pkg import client

def test_history_behavior():
    assert client.send_redirect() == "redirect"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/client.py",
      symbol: "send_redirect",
      terms: ["redirect"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/regression/test_behavior.py"
    });
    expect(result.candidateFilesScored).toBeGreaterThan(1);
  });

  test("merges related tests across multiple plausible source files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-multi-source-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "reporting.py"),
      `def format_report_section(phase):
    return f"Captured stdout during {phase}"
`
    );
    await writeFile(
      path.join(root, "pkg", "capture.py"),
      `def route_captured_output(phase):
    return f"captured stdout stderr {phase}"
`
    );
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
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/reporting.py",
      sourceFiles: ["pkg/reporting.py", "pkg/capture.py"],
      terms: ["captured", "stdout", "stderr", "setup", "call", "teardown", "report", "section"],
      limit: 1
    });

    expect(result.sourceFile).toBe("pkg/reporting.py");
    expect(result.sourceFiles).toEqual(["pkg/reporting.py", "pkg/capture.py"]);
    expect(result.matches[0]).toMatchObject({
      file: "tests/test_capture.py"
    });
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

  test("uses task terms in test paths to rank behavior-focused test files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-task-path-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "pkg", "routing.py"), "def serialize_response(value):\n    return value\n");
    await writeFile(
      path.join(root, "tests", "test_custom_route_class.py"),
      `from pkg import routing

def test_custom_route_class_response_model():
    assert routing.serialize_response({"name": "x"})
`
    );
    await writeFile(
      path.join(root, "tests", "test_serialize_response_model.py"),
      `def test_response_model_return_value_is_serialized():
    response_model = {"name": "x"}
    serialized = "endpoint return response model"
    assert response_model and serialized
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/routing.py",
      terms: ["validate", "serialize", "endpoint", "return", "response", "model"],
      limit: 2
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/test_serialize_response_model.py"
    });
    expect(result.matches[0].why).toContain("test path matches task terms");
  });

  test("uses dense task-term coverage to find behavior tests outside mirrored source paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-task-term-candidates-"));
    await mkdir(path.join(root, "pkg", "engine"), { recursive: true });
    await mkdir(path.join(root, "tests", "engine"), { recursive: true });
    await mkdir(path.join(root, "tests", "sql"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "engine", "default.py"),
      `def setup_result_proxy(cursor):
    return cursor.rowcount
`
    );
    await writeFile(
      path.join(root, "tests", "engine", "test_execute.py"),
      `from pkg.engine import default

def test_execute_cursor():
    assert default.setup_result_proxy(object())
`
    );
    await writeFile(
      path.join(root, "tests", "sql", "test_resultset.py"),
      `def test_rowcount_always_called_when_preserved():
    cursor = "cursor"
    rowcount = "rowcount"
    statements = ["select", "insert", "update", "delete"]
    preserve = "preserve"
    assert cursor and rowcount and statements and preserve
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/engine/default.py",
      terms: ["cursor", "rowcount", "preserve", "select", "insert", "update", "delete"],
      limit: 2
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/sql/test_resultset.py"
    });
    expect(result.matches[0].why).toContain("strong task-term coverage");
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

  test("prefers external regression tests over package test helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-related-tests-external-root-"));
    await mkdir(path.join(root, "pkg", "http"), { recursive: true });
    await mkdir(path.join(root, "pkg", "test"), { recursive: true });
    await mkdir(path.join(root, "tests", "httpwrappers"), { recursive: true });
    await writeFile(path.join(root, "pkg", "http", "response.py"), "def stream_response():\n    return 'streaming response'\n");
    await writeFile(
      path.join(root, "pkg", "test", "client.py"),
      `from pkg.http import response

def test_client_response_helper():
    assert response.stream_response()
`
    );
    await writeFile(
      path.join(root, "tests", "httpwrappers", "tests.py"),
      `from pkg.http import response

def test_streaming_response_cleanup():
    assert response.stream_response() == "streaming response"
`
    );
    await indexTarget(root);

    const result = findRelatedTests({
      target: root,
      sourceFile: "pkg/http/response.py",
      terms: ["streaming", "response", "cleanup"]
    });

    expect(result.matches[0]).toMatchObject({
      file: "tests/httpwrappers/tests.py"
    });
    expect(result.matches[0].why).toContain("external test root");
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
