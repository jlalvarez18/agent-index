import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { indexTarget } from "../../src/core/indexer.js";
import { queryIndex, rankHybridMatches } from "../../src/core/query.js";
import type { QueryMatch } from "../../src/core/schema.js";

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

  test("can return plain FTS results without symbol boosts or graph expansion", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const result = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "fts" });

    expect(result.mode).toBe("fts");
    expect(result.matches[0].why).toEqual(["plain FTS match"]);
    expect(result.matches[0].neighbors).toEqual([]);
  });

  test("hybrid mode can keep lexical FTS candidates while adding graph context", async () => {
    const root = await fixtureProject();
    await indexTarget(root);

    const fts = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "fts" });
    const hybrid = await queryIndex("where is semantic cache loaded?", { target: root, limit: 5, mode: "hybrid" });

    expect(hybrid.mode).toBe("hybrid");
    expect(hybrid.matches.map((match) => match.symbol).sort()).toEqual(
      fts.matches.map((match) => match.symbol).sort()
    );
    expect(hybrid.matches.some((match) => match.neighbors.length > 0)).toBe(true);
    expect(hybrid.matches[0].why).toContain("matched source text");
  });

  test("hybrid ranking boosts lexical function hits without blocking stronger precise symbols", () => {
    const matches = [
      hybridItem(match("support_notes", "function", 9), 1),
      hybridItem(match("pkg/module.py", "module", 12), 2),
      hybridItem(match("Client.send", "method", 14), undefined)
    ];

    const ranked = rankHybridMatches(matches, 3);

    expect(ranked.map((item) => item.symbol)).toEqual(["Client.send", "support_notes", "pkg/module.py"]);
  });

  test("hybrid ranking lifts precise owner/name methods over broad class containers", () => {
    const classContainer = match("Command", "class", 20.5);
    const preciseMethod = {
      ...match("Option.consume_value", "method", 19.5),
      why: ["matched source text", "symbol name match", "method owner/name match"]
    };

    const ranked = rankHybridMatches([hybridItem(classContainer, undefined), hybridItem(preciseMethod, undefined)], 2);

    expect(ranked.map((item) => item.symbol)).toEqual(["Option.consume_value", "Command"]);
  });

  test("hybrid mode can add an entrypoint intent candidate outside plain FTS matches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-entrypoint-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "__main__.py"),
      `def main():
    return run_app()

def run_app():
    return "ok"
`
    );
    await writeFile(
      path.join(root, "pkg", "notes.py"),
      `def describe_command_line_entrypoint():
    command_line_entrypoint_notes = "documentation only"
    return command_line_entrypoint_notes
`
    );
    await indexTarget(root);

    const fts = await queryIndex("where is the command line entrypoint?", {
      target: root,
      limit: 5,
      mode: "fts"
    });
    const hybrid = await queryIndex("where is the command line entrypoint?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(fts.matches[0].symbol).toBe("describe_command_line_entrypoint");
    expect(hybrid.matches[0]).toMatchObject({
      symbol: "main",
      file: "pkg/__main__.py"
    });
    expect(hybrid.matches[0].why).toContain("entrypoint intent match");
  });

  test("hybrid mode does not treat command line value handling as an entrypoint query", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-command-line-values-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "core.py"),
      `class Command:
    def main(self):
        command_line_entrypoint = "main command line entrypoint"
        return command_line_entrypoint

class Option:
    def consume_value(self, opts):
        command_line_values_defaults_prompts_environment_variables = opts
        return command_line_values_defaults_prompts_environment_variables
`
    );
    await indexTarget(root);

    const result = await queryIndex(
      "where does an option consume command line values, defaults, prompts, and environment variables?",
      {
        target: root,
        limit: 5,
        mode: "hybrid"
      }
    );

    expect(result.matches[0]).toMatchObject({
      symbol: "Option.consume_value",
      kind: "method",
      file: "pkg/core.py"
    });
    expect(result.matches[0].why).not.toContain("entrypoint intent match");
  });

  test("hybrid mode does not treat CliRunner helper questions as entrypoint queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-cli-runner-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "core.py"),
      `class Command:
    def main(self, args=None):
        command_line_entrypoint = "main command invocation entrypoint"
        return command_line_entrypoint
`
    );
    await writeFile(
      path.join(root, "pkg", "testing.py"),
      `class CliRunner:
    def isolation(self):
        isolated_environment = "isolated test command environment"
        return isolated_environment

    def invoke(self, cli, args=None):
        command_in_isolation = self.isolation()
        return cli.main(args=args)
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does the test CliRunner invoke a command in isolation?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "CliRunner.invoke",
      kind: "method",
      file: "pkg/testing.py"
    });
    expect(result.matches[0].why).not.toContain("entrypoint intent match");
  });

  test("hybrid mode prefers matching child methods over broad class containers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-child-methods-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "core.py"),
      `class Option:
    """Options handle command line values, defaults, prompts, environment variables, and parsing."""

    command_line_values_defaults_prompts_environment_variables = "class overview"

    def consume_value(self, ctx, opts):
        value_source = "command line values defaults prompts environment variables"
        return value_source
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does an option consume command line values, defaults, prompts, and environment variables?", {
      target: root,
      limit: 5,
      mode: "hybrid"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Option.consume_value",
      kind: "method",
      file: "pkg/core.py"
    });
    expect(result.matches[0].why).toContain("method owner/name match");
  });

  test("hybrid mode boosts high-signal implementation intents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-intents-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "export.py"),
      `def to_json(graph):
    return graph.to_json()
`
    );
    await writeFile(
      path.join(root, "pkg", "report.py"),
      `def generate():
    return "report"
`
    );
    await writeFile(
      path.join(root, "pkg", "cluster.py"),
      `def cluster_communities(graph):
    return graph
`
    );
    await writeFile(
      path.join(root, "pkg", "serve.py"),
      `def serve():
    return "mcp"
`
    );
    await writeFile(
      path.join(root, "pkg", "notes.py"),
      `def graph_json_export_notes():
    return "graph json export notes"

def report_generation_notes():
    return "report generation notes"

def community_detection_notes():
    return "community detection notes"

def mcp_server_notes():
    return "mcp server notes"
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where is graph json export handled?", "to_json");
    await expectTopHybridSymbol(root, "where is report generation?", "generate");
    await expectTopHybridSymbol(root, "where is community detection?", "cluster_communities");
    await expectTopHybridSymbol(root, "where is mcp server?", "serve");
  });

  test("hybrid mode expands generic action aliases for remaining implementation queries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-action-aliases-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "extract.py"),
      `def extract_python(source):
    return source
`
    );
    await writeFile(
      path.join(root, "pkg", "build.py"),
      `def build(graph_data):
    return graph_data
`
    );
    await writeFile(
      path.join(root, "pkg", "serve.py"),
      `def _pick_seeds(graph):
    return list(graph)[:3]
`
    );
    await writeFile(
      path.join(root, "pkg", "notes.py"),
      `def code_extraction_notes():
    return "code extraction discussion"

def graph_built_notes():
    return "graph built discussion"

def query_seed_selection_notes():
    return "query seed selection discussion"
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where does code extraction happen?", "extract_python");
    await expectTopHybridSymbol(root, "where is the graph built?", "build");
    await expectTopHybridSymbol(root, "where are query seeds selected?", "_pick_seeds");
  });

  test("hybrid mode prefers core implementation symbols over nearby helpers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-core-symbols-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "extract.py"),
      `def extract_python(source):
    return source

def _extract_python_rationale(source):
    code_extraction_rationale = "why extraction works"
    return code_extraction_rationale
`
    );
    await writeFile(
      path.join(root, "pkg", "cluster.py"),
      `def cluster(graph):
    return _split_community(graph)

def _split_community(graph):
    community_detection_split = graph
    return community_detection_split
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where does code extraction happen?", "extract_python");
    await expectTopHybridSymbol(root, "where does community detection run?", "cluster");
  });

  test("hybrid mode prefers incremental change detection over watcher orchestration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-incremental-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "watch.py"),
      `def watch():
    incremental_indexing_decide_changed = "orchestrates incremental indexing when files changed"
    return incremental_indexing_decide_changed
`
    );
    await writeFile(
      path.join(root, "pkg", "detect.py"),
      `def detect_incremental(root):
    manifest = load_manifest(root)
    return manifest

def load_manifest(root):
    return {}

def save_manifest(files):
    return None
`
    );
    await indexTarget(root);

    await expectTopHybridSymbol(root, "where does incremental indexing decide what changed?", "detect_incremental");
  });

  test("symbol mode adds exact dotted API references as candidates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-dotted-api-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "api.py"),
      `def request(method, url):
    return send(method, url)

def get(url):
    return request("GET", url)
`
    );
    await writeFile(
      path.join(root, "pkg", "transport.py"),
      `class BaseTransport:
    def handle_request(self, request):
        request_metadata = "request handling"
        return request_metadata
`
    );
    await indexTarget(root);

    const result = await queryIndex("where is the module-level pkg.request convenience function defined?", {
      target: root,
      limit: 5,
      mode: "symbol"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "request",
      kind: "function",
      file: "pkg/api.py"
    });
    expect(result.matches[0].why).toContain("dotted API reference match");
  });

  test("symbol mode prefers methods whose owner and name both match the question", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-index-query-owner-method-"));
    await mkdir(path.join(root, "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "pkg", "models.py"),
      `class Response:
    def json(self):
        return parse_json(self.content)

def _parse_content_type_charset(value):
    response_parse_content_notes = "parse response content"
    return response_parse_content_notes
`
    );
    await writeFile(
      path.join(root, "pkg", "content.py"),
      `def encode_response(response):
    json_content_notes = "response json content"
    return json_content_notes
`
    );
    await indexTarget(root);

    const result = await queryIndex("where does a response parse JSON content?", {
      target: root,
      limit: 5,
      mode: "symbol"
    });

    expect(result.matches[0]).toMatchObject({
      symbol: "Response.json",
      kind: "method",
      file: "pkg/models.py"
    });
    expect(result.matches[0].why).toContain("method owner/name match");
  });
});

async function expectTopHybridSymbol(root: string, question: string, symbol: string): Promise<void> {
  const result = await queryIndex(question, { target: root, limit: 5, mode: "hybrid" });

  expect(result.matches[0].symbol).toBe(symbol);
  expect(result.matches[0].why).toContain("query intent match");
}

function match(symbol: string, kind: QueryMatch["kind"], score: number): QueryMatch {
  return {
    symbol,
    kind,
    file: "pkg/example.py",
    lines: [1, 1],
    score,
    why: ["matched source text"],
    neighbors: []
  };
}

function hybridItem(match: QueryMatch, ftsPosition: number | undefined) {
  return { match, ftsPosition, inputIndex: ftsPosition ?? 99 };
}
