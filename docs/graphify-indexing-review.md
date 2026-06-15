# Graphify Indexing Review

## Bottom line

Graphify is more complex than a Cursor-like codebase indexer needs to be. Its `graph.json` idea is reasonable and portable, but the product combines several goals:

- structural code graph
- semantic extraction of docs, PDFs, images, and videos
- community detection and reports
- visualization exports
- MCP serving
- install rules/hooks for many agents
- graph merge and PR workflows

For better agent retrieval, keep the structural graph and incremental cache, but replace the heavy workflow with a local hybrid index:

1. SQLite table for files, chunks, symbols, and edges.
2. SQLite FTS5 for lexical lookup.
3. `sqlite-vec` or LanceDB for embeddings.
4. Optional Kuzu only if you need real Cypher-style graph traversal.
5. MCP or CLI query endpoint that returns ranked snippets plus nearby symbols.

Think of Graphify as a full city map with zoning, transit, traffic reports, and postcards. For agent retrieval, most users need a fast GPS search box first.

## What Graphify Does

The documented pipeline is:

`detect -> extract -> build_graph -> cluster -> analyze -> report -> export`

The architecture stores extractor outputs as plain node and edge dictionaries, builds a NetworkX graph, clusters it, analyzes it, and exports `graph.json`, reports, and visualizations.

Important implementation details:

- Code-only extraction is local AST/tree-sitter based and does not require an API key.
- Docs, papers, and images trigger LLM semantic extraction.
- Incremental mode uses `manifest.json` and `graph.json`.
- Queries scan graph node labels, score seed nodes with IDF-ish heuristics, then BFS/DFS the graph.
- `graph.json` is a portable artifact and is probably fine for small to medium repos.

## Inefficiencies

1. Retrieval starts from node-label matching, not a proper lexical/vector index.

The query path scores every graph node by label/source text, picks up to three seeds, then traverses the graph. This is okay for symbol names, weaker for natural-language questions like "where do we validate Stripe webhook signatures?"

2. NetworkX plus JSON is simple but not query-indexed.

JSON is efficient enough as a portable interchange format. It is not efficient as the live query substrate once the graph gets large, because every query loads/scans in-memory structures unless served by a warmed process.

3. The setup burden is mostly product surface, not the retrieval core.

Installers, agent-specific skills, hooks, always-on rules, visualization, callflow HTML, reports, graph merge drivers, and PR workflows are useful, but they make the first-run story feel heavy.

4. Semantic extraction is expensive and failure-prone for a default code index.

Graphify correctly avoids API keys for code-only corpora, but the moment docs/images enter the corpus, setup becomes provider/API-key/backend management.

5. The graph is doing work that hybrid search should do first.

Graph traversal should expand relevant results, not be the primary retrieval mechanism. First retrieve likely chunks/symbols with BM25/vector search, then expand 1-2 hops via imports/calls/contains.

## Recommended Simpler Architecture

Use a single local index directory:

`.agent-index/index.sqlite`

Schema:

- `files(path, hash, mtime, language)`
- `chunks(id, file, start_line, end_line, text, symbol_id)`
- `symbols(id, name, kind, file, start_line, end_line, signature)`
- `edges(src, dst, kind, confidence)`
- `chunk_fts` using SQLite FTS5
- `chunk_vec` using `sqlite-vec`, or store vectors in LanceDB beside SQLite

Query flow:

1. User asks a question.
2. Run BM25 over FTS5 and vector search over embeddings.
3. Fuse ranks with reciprocal rank fusion.
4. Map top chunks to symbols.
5. Expand nearby graph edges: contains, imports, calls, implements.
6. Return a compact context pack with file paths and line ranges.

This is closer to Cursor's user experience: background indexing, no explicit graph workflow, and retrieval just works.

## Local Graph DB Choice

Best default: SQLite + FTS5 + `sqlite-vec`.

Why: one file, easy install, great incremental metadata, enough graph traversal for code retrieval with recursive CTEs, and no server.

Best if you need real graph queries: Kuzu.

Why: embedded property graph, Cypher, full-text/vector features. Caveat: the upstream repo says KuzuDB is being archived and points users to current docs/releases, so I would be cautious about making it the mandatory default.

Best vector-heavy option: LanceDB.

Why: very good local vector search and metadata filtering. Pair it with SQLite for symbol/edge metadata unless you want LanceDB to own the whole index.

Avoid as default: Neo4j, Memgraph, external services.

Why: they are good graph databases, but they recreate the "complex setup" problem.

## Is Graphify's JSON Efficient?

For interchange: yes.

For live retrieval: only up to a point.

`graph.json` is a good export/cache format. For a small repo, reading it into NetworkX and querying it is fine. For a large monorepo, JSON plus in-memory graph traversal is the wrong primary query path. Keep JSON as an export, but query from SQLite/Kuzu/LanceDB indexes.

## Practical MVP

Build this instead:

```text
agent-index init
agent-index query --agent-query '{
  "terms": ["webhook", "signature", "verify"],
  "symbolKinds": ["function", "method"],
  "pathHints": ["webhook", "auth", "security"],
  "excludeSupportCode": true,
  "expand": ["callers", "callees"]
}'
```

No install hooks. No report generation. No graph visualization by default.

First version:

- tree-sitter or language-server/SCIP extraction for symbols
- chunk source files by symbol and line window
- SQLite FTS5
- optional embeddings with `sqlite-vec`
- JSON export for portability
- background watcher
- MCP tool with `search_code`, `get_symbol`, `neighbors`, `path`

Graphify's main lesson is good: agents need a memory layer. But the simpler version should behave like an index, not like a project ceremony.
