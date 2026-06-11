# agent-index Prototype Design

## Goal

Build a small TypeScript/Node prototype that tests whether a symbol-first local index helps coding agents traverse a codebase better than plain text search.

The first benchmark corpus is the Graphify `v8` repository already cloned under `work/graphify-v8`.

The first success metric is simple:

```text
Given a natural-language question, does the tool return the expected symbol or file in the top 5 results?
```

## Scope

v1 includes:

- TypeScript/Node project
- reusable library core plus thin CLI
- Python-only scanner and extractor
- Tree-sitter Python parsing behind a replaceable extractor interface
- local index stored at `<target>/.codeindex/index.sqlite` by default
- SQLite tables plus FTS5 lexical search
- symbol-first query results with chunks as supporting context
- basic graph edges for nearby traversal
- 10 manual golden benchmark questions
- CLI commands: `index`, `query`, `benchmark`

v1 excludes:

- embeddings
- MCP server
- background watcher
- multi-language extraction
- editor extension
- global cache as the default
- LLM-generated benchmark questions
- visual graph UI
- exact full call-graph resolution

These exclusions are intentional. The prototype should prove the retrieval shape before adding product surface.

## Architecture

The prototype uses a TypeScript core with a thin CLI.

```text
src/core/scanner.ts
  Finds indexable `.py` files.

src/core/extractors/python.ts
  Uses Tree-sitter to extract Python modules, classes, functions, methods,
  chunks, imports, and name-based calls.

src/core/schema.ts
  Defines File, Symbol, Chunk, Edge, QueryResult, and BenchmarkResult types.

src/core/indexer.ts
  Writes extracted records into SQLite and updates FTS rows.

src/core/query.ts
  Runs FTS search, ranks symbols/chunks, expands nearby graph edges, and
  returns compact cited context.

src/core/benchmark.ts
  Runs golden questions and reports Hit@1, Hit@5, MRR, partial file hits,
  and latency.

src/cli.ts
  Parses command-line arguments and calls core functions.
```

CLI shape:

```bash
agent-index index ./work/graphify-v8
agent-index query "where is semantic cache handled?"
agent-index benchmark ./benchmarks/graphify-python.json
```

## Data Model

SQLite v1 tables:

```text
files(
  id,
  path,
  hash,
  language
)

symbols(
  id,
  file_id,
  name,
  kind,
  start_line,
  end_line,
  parent_symbol_id
)

chunks(
  id,
  file_id,
  symbol_id,
  start_line,
  end_line,
  text
)

edges(
  id,
  source_symbol_id,
  target_symbol_id,
  kind
)

chunk_fts(
  chunk_id,
  text,
  symbol_name,
  file_path
)
```

Initial edge types:

```text
file_contains_symbol
symbol_contains_symbol
symbol_imports_module
symbol_calls_name
```

`symbol_calls_name` is intentionally name-based in v1. It may not always resolve a call to one exact target symbol across the repo. That is acceptable for the first benchmark as long as results label the edge clearly.

## Query Flow

The agent begins with search, then traverses nearby structure.

```text
1. Normalize the user question.
2. Run SQLite FTS5 over chunk text, symbol names, and file paths.
3. Convert matching chunks into symbol candidates.
4. Rank candidates.
5. Expand each top symbol through nearby graph edges.
6. Return compact cited context with file paths and line ranges.
```

Ranking v1:

```text
score =
  FTS BM25 score
  + symbol-name boost
  + file-path boost
  + exact identifier boost
  + nearby-edge boost
```

Traversal depth:

```text
depth 0: exact matching symbols/chunks
depth 1: callers, callees, parent symbol, containing file
depth 2: reserved for later impact-style queries
```

The graph should act like a flashlight around strong matches, not flood the agent with the whole repository.

Example query result:

```json
{
  "query": "where is semantic cache handled?",
  "matches": [
    {
      "symbol": "check_semantic_cache",
      "kind": "function",
      "file": "graphify/cache.py",
      "lines": [351, 410],
      "score": 0.92,
      "why": ["matched semantic cache", "function name match"],
      "neighbors": [
        {
          "relation": "called_by",
          "symbol": "main",
          "file": "graphify/__main__.py"
        }
      ]
    }
  ]
}
```

## Benchmark

Start with 10 manually written golden questions for the Graphify Python codebase.

Golden benchmark format:

```json
[
  {
    "id": "semantic-cache",
    "question": "where is semantic cache handled?",
    "expected": {
      "files": ["graphify/cache.py"],
      "symbols": ["check_semantic_cache"]
    }
  }
]
```

Scoring:

```text
Full credit: expected symbol appears in top 5.
Partial credit: expected file appears in top 5 when symbol does not.
Hit@1: expected symbol or file is first, with symbol preferred.
Hit@5: expected symbol or file appears in top 5.
MRR: reciprocal rank of the first expected symbol/file match.
Latency: query time in milliseconds.
```

Example benchmark output:

```text
Questions: 10
Hit@1: 0.40
Hit@5: 0.70
MRR: 0.52
Partial file hits: 0.20
Avg latency: 18ms
```

## Implementation Notes

Tree-sitter is important for symbol-first retrieval, but it must stay behind an extractor interface:

```ts
interface LanguageExtractor {
  language: string
  extensions: string[]
  extract(file: SourceFile): ExtractionResult
}
```

This keeps the architecture language-neutral. Later languages should map into the same generic concepts:

```text
File
Symbol
Chunk
Edge
```

TypeScript/Node is the v1 implementation language because it matches the preferred tooling and should be fast enough for this benchmark. SQLite and Tree-sitter do the heavy native work. If performance becomes a bottleneck, a Rust parser/indexing core can replace internals later without changing the CLI or benchmark contract.

## Open Follow-Up

After v1 proves or disproves the symbol-first retrieval idea, the likely next benchmark layers are:

```text
v2: FTS5 + graph expansion improvements
v3: FTS5 + graph expansion + embeddings
v4: MCP server using the same core query functions
```

