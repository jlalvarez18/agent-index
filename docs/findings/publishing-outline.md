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
6. Results: first Graphify all-files run reached Hit@1 0.10, Hit@5 0.20, MRR 0.15; source-only filtering improved this to Hit@1 0.20, Hit@5 0.30, MRR 0.22; auditing the truth set improved source-only Hit@5 to 0.50 and MRR to 0.29.
7. What worked: cited symbol results, simple local setup, one-hop graph context.
8. What did not: unresolved call names, lexical-only phrasing limits, no incremental updates.
9. Next steps: compare against plain FTS, add embeddings, add MCP, add incremental indexing.

## Evidence To Include Later

- One screenshot or terminal block for `agent-index query`.
- Benchmark summary table.
- Three qualitative query examples from `docs/findings/graphify-benchmark-results.md`.
- A short comparison table: plain FTS vs symbol-first FTS plus graph expansion.
