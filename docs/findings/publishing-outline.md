# Publishing Outline

## Working Title

Building a Symbol-First Code Index for Coding Agents

## Thesis

Agents do not only need more text search. They need search results tied to code structure: symbols, line ranges, and nearby relationships.

## Outline

1. Problem: plain text search often finds words, not the right code object.
2. Baseline inspiration: Graphify shows the value of code graphs but carries more workflow than a small retrieval experiment needs.
3. Prototype: TypeScript CLI, Tree-sitter Python extraction, SQLite/FTS5, symbol-first ranking.
4. Key lesson: normalize identifiers so natural-language questions can find `snake_case` and dotted paths.
5. Benchmark: 10 Graphify questions, Hit@1, Hit@5, MRR, partial file hits, latency.
6. Results: first Graphify all-files run reached blended Hit@5 0.20; source-only filtering improved blended Hit@5 to 0.30; truth-set auditing improved blended Hit@5 to 0.50; split scoring revealed exact Symbol Hit@5 was only 0.20 while File Hit@5 was 0.50; conservative hybrid plus query-intent candidate expansion later reached Symbol Hit@1 0.50 and Symbol Hit@5 0.70.
7. What worked: cited symbol results, simple local setup, one-hop graph context.
8. What did not: unresolved call names, lexical-only phrasing limits, no incremental updates.
9. Next steps: compare against plain FTS, add embeddings, add MCP, add incremental indexing.

## Current Baseline Comparison

- Symbol mode: Symbol Hit@1 0.10, Symbol Hit@5 0.20, File Hit@5 0.50, Avg 47ms.
- Plain FTS mode: Symbol Hit@1 0.00, Symbol Hit@5 0.40, File Hit@5 0.50, Avg 6ms.
- Hybrid mode: Symbol Hit@1 0.10, Symbol Hit@5 0.40, File Hit@5 0.50, Avg 43ms.
- Hybrid plus query-intent expansion: Symbol Hit@1 0.50, Symbol Hit@5 0.70, File Hit@5 0.70, Avg 56ms.
- Early conclusion: structure is useful as a conservative reranker, and query understanding is needed when the right symbol is not present in the FTS candidate set.
- Detailed benchmark JSON shows the current misses are mostly broad-question ranking misses, not parser/indexing failures.
- Source-only hygiene v2 removed fixture/sample corpora; remaining misses are now cleaner evidence for ranking/query-intent work.
- The write-up should be explicit that the latest jump comes from a small hand-built intent layer, not from a general semantic model.

## Evidence To Include Later

- One screenshot or terminal block for `agent-index query`.
- Benchmark summary table.
- Three qualitative query examples from `docs/findings/graphify-benchmark-results.md`.
- A short comparison table: plain FTS vs symbol-first FTS plus graph expansion.
- One caveat box: "query-intent rules helped Graphify, but need cross-repo validation."
