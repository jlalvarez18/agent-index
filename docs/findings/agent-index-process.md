# Agent Index Process Notes

## Purpose

This prototype tests a narrow claim: a local symbol-first index can give coding agents better starting points than plain text search alone.

The working analogy is a library catalog. Text search finds pages with matching words; the symbol index adds the catalog cards that say which function, class, and nearby references those pages belong to.

## Decisions

- Use TypeScript/Node for the v1 prototype because it keeps CLI, tests, and package setup simple.
- Use SQLite plus FTS5 as the live query store because it is one local file and does not require a server.
- Keep Tree-sitter behind a language extractor interface so Python is the first language, not the permanent architecture.
- Store unresolved call/import targets by name. This is less precise than a full call graph, but it is honest and good enough for retrieval expansion.
- Default the index to `<target>/.codeindex/index.sqlite`, matching the design spec.
- Rebuild the index fully in v1. Incremental indexing is deliberately out of scope.

## Findings So Far

- Tree-sitter extraction gives useful structure quickly: modules, classes, methods, functions, and line ranges are enough to produce cited results.
- SQLite FTS needs normalized identifier text. Without it, natural-language queries like "semantic cache loaded" can miss identifiers such as `semantic_cache` and `load_value`.
- Exact-match boosts must be careful. A single generic symbol like `Cache` should not beat a more specific function just because the question contains "cache."
- One-hop graph expansion is useful as supporting context, but it should not flood the result. In v1 it is a flashlight around the match, not the whole map.
- Tree-sitter's Node binding can reject large Python source strings with `Invalid argument`. Feeding the parser through its callback API avoids that native string-argument failure.
- Running against Graphify showed a major benchmark hygiene issue: indexing `tests/` and `tools/` lets helper code outrank product code for broad natural-language questions.
- Source-only indexing improved Graphify Hit@5 from 0.20 to 0.30 and average latency from 65ms to 48ms by reducing the corpus from 142 Python files to 51.
- When invoking the CLI through npm, pass arguments after `--`; otherwise npm may consume options such as `--target`.

## Rejected Ideas

- Embeddings: useful later, but they would make the first experiment harder to interpret.
- MCP server: useful product surface, but not needed to prove retrieval shape.
- Background watcher: useful ergonomics, but full rebuild is simpler for a benchmark prototype.
- Multi-language extraction: important eventually, but Python-only keeps the first benchmark contained.

## Open Questions

- How much does symbol-first ranking improve Hit@5 over plain FTS on the same corpus?
- Which edge types matter most for agent navigation: contains, imports, calls, or callers?
- Does normalized lexical search cover enough natural-language phrasing before embeddings are added?
- How large can the SQLite-only approach get before query latency or index time becomes a problem?
- Should the default scanner include tests, or should benchmark/query modes support source-only filtering?
