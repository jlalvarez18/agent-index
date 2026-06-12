# agent-index

`agent-index` is a TypeScript/Node prototype for local, symbol-first code search.

The v1 scope is intentionally narrow: Python files are scanned with Tree-sitter, stored in a local SQLite/FTS5 index, queried with lexical, symbol, or hybrid ranking, and evaluated with golden benchmark questions.

Think of it as a library catalog for code. Plain text search finds pages with matching words; `agent-index` tries to return the function, class, file, and nearby code relationships that make those pages useful to a coding agent.

## Status

Prototype, dogfood stage.

Current benchmark shape, using hybrid mode:

| Corpus | Questions | Symbol Hit@1 | Symbol Hit@5 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Graphify v8 | 10 | 1.00 | 1.00 | 1.00 | 57ms |
| HTTPX | 13 | 1.00 | 1.00 | 1.00 | 13ms |
| Click | 14 | 1.00 | 1.00 | 1.00 | 18ms |

These numbers are useful, but not final product claims. The current golden sets are small and now saturated, answer keys were source-audited, and ranking still uses hand-built query-intent rules.

## Install

```bash
npm install
npm run build
```

After building, the package bin points at:

```text
dist/cli.js
```

The npm package allowlist includes the built CLI, benchmark JSON files, docs, and this README. Check it with:

```bash
npm pack --dry-run
```

You can run the development CLI with:

```bash
npm run agent-index -- --help
```

Or run the built CLI directly:

```bash
node dist/cli.js --help
```

## Index A Repo

```bash
npm run agent-index -- index /path/to/python/repo --source-only
```

By default, the index is written to:

```text
<target>/.codeindex/index.sqlite
```

Use `--index-path /path/to/index.sqlite` with `index`, `query`, and `benchmark` when the index should live outside the target tree.

`--source-only` skips common support directories such as tests, tools, examples, fixtures, samples, and worked corpora. That is the recommended mode for benchmark-style source retrieval.

The success message includes the index mode, for example `(mode: source-only)`, so benchmark notes can record how the index was built.

## Query

```bash
npm run agent-index -- query "where is the command entrypoint handled?" --target /path/to/python/repo
```

The query command returns JSON with ranked matches, line ranges, scores, reasons, and nearby graph context.

By default, `query` uses `symbol` mode. You can inspect the other ranking modes with:

```bash
npm run agent-index -- query "where is semantic cache loaded?" --target /path/to/python/repo --mode hybrid
npm run agent-index -- query "where is semantic cache loaded?" --target /path/to/python/repo --mode fts
```

## Benchmark

```bash
npm run agent-index -- benchmark ./benchmarks/graphify-python.json --target /path/to/graphify --mode hybrid
```

Available benchmark modes:

- `fts`: plain SQLite FTS ranking.
- `symbol`: symbol ranking plus graph expansion.
- `hybrid`: lexical recall plus symbol-aware reranking.

Use `--json` for per-question details:

```bash
npm run agent-index -- benchmark ./benchmarks/click-python.json --target /path/to/click --mode hybrid --json
```

## Development

```bash
npm test
npm run build
git diff --check
```

The test suite covers scanner filtering, Python extraction, SQLite indexing, query ranking, benchmark metrics, CLI smoke behavior, and package build layout.

## Current Limits

- Python only.
- Full reindex only.
- No embeddings.
- No MCP server.
- No file watcher.
- Name-based call/import edges are approximate.
- Query-intent rules are hand-built and need broader validation.
- The benchmark corpora are local checkouts, not vendored into this repository.

## Findings

The running lab notebook lives in:

- `docs/findings/agent-index-process.md`
- `docs/findings/experiment-log.md`
- `docs/findings/graphify-benchmark-results.md`
- `docs/findings/httpx-benchmark-results.md`
- `docs/findings/click-benchmark-results.md`
- `docs/findings/agent-index-readiness.md`
- `docs/findings/publishing-outline.md`
