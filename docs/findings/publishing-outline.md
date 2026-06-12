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
6. Results: first Graphify all-files run reached blended Hit@5 0.20; source-only filtering improved blended Hit@5 to 0.30; truth-set auditing improved blended Hit@5 to 0.50; split scoring revealed exact Symbol Hit@5 was only 0.20 while File Hit@5 was 0.50; conservative hybrid plus query-intent candidate expansion later reached Symbol Hit@1 0.50 and Symbol Hit@5 0.70; generic action aliases reached Symbol Hit@1 0.70 and Symbol Hit@5 1.00; core-symbol ordering reached Symbol Hit@1 0.90; incremental change-detection intent saturated the current Graphify set at Symbol Hit@1 1.00.
7. What worked: cited symbol results, simple local setup, one-hop graph context.
8. What did not: unresolved call names, lexical-only phrasing limits, no incremental updates.
9. Next steps: compare against plain FTS, add embeddings, add MCP, add incremental indexing.
10. Cross-corpus check: HTTPX breaks the Graphify-perfect story, then soft hybrid recovers HTTPX without giving up Graphify.
11. Third-corpus check: Click validates hybrid as the best current mode, while exposing exact-method ordering and over-broad intent triggers.

## Current Baseline Comparison

- Symbol mode: Symbol Hit@1 0.10, Symbol Hit@5 0.20, File Hit@5 0.50, Avg 47ms.
- Plain FTS mode: Symbol Hit@1 0.00, Symbol Hit@5 0.40, File Hit@5 0.50, Avg 6ms.
- Hybrid mode: Symbol Hit@1 0.10, Symbol Hit@5 0.40, File Hit@5 0.50, Avg 43ms.
- Hybrid plus query-intent expansion: Symbol Hit@1 0.50, Symbol Hit@5 0.70, File Hit@5 0.70, Avg 56ms.
- Hybrid plus action aliases: Symbol Hit@1 0.70, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 60ms.
- Hybrid plus core-symbol ordering: Symbol Hit@1 0.90, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 61ms.
- Hybrid plus incremental change-detection intent: Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 53ms.
- HTTPX symbol mode baseline: Symbol Hit@1 0.42, Symbol Hit@5 0.83, File Hit@5 0.92, Avg 15ms.
- HTTPX hybrid mode baseline: Symbol Hit@1 0.25, Symbol Hit@5 0.42, File Hit@5 0.83, Avg 11ms.
- HTTPX audited symbol mode: Symbol Hit@1 0.38, Symbol Hit@5 0.85, File Hit@5 1.00, Avg 11ms.
- HTTPX audited hybrid mode: Symbol Hit@1 0.31, Symbol Hit@5 0.46, File Hit@5 0.85, Avg 13ms.
- HTTPX after decorated-definition extraction: symbol mode Symbol Hit@1 0.46, Symbol Hit@5 0.92, File Hit@5 1.00, Avg 13ms; hybrid mode Symbol Hit@1 0.38, Symbol Hit@5 0.54, File Hit@5 0.85, Avg 13ms.
- HTTPX after dotted API and method owner/name ranking: symbol mode Symbol Hit@1 0.69, Symbol Hit@5 1.00, File Hit@1 1.00, Avg 12ms; hybrid mode Symbol Hit@1 0.46, Symbol Hit@5 0.62, File Hit@5 0.92, Avg 12ms.
- HTTPX after soft lexical hybrid ranking: hybrid mode Symbol Hit@1 0.77, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 15ms; Graphify hybrid stayed Symbol Hit@1 1.00.
- Click after scoped entrypoint intent, hybrid method specificity, and shell-completion wording audit: FTS Symbol Hit@1 0.36, Symbol Hit@5 0.79, File Hit@5 0.93, Avg 2ms; symbol mode Symbol Hit@1 0.21, Symbol Hit@5 0.71, File Hit@5 1.00, Avg 17ms; hybrid mode Symbol Hit@1 0.50, Symbol Hit@5 0.93, File Hit@5 1.00, Avg 16ms.
- Early conclusion: structure is useful as a conservative reranker, and query understanding is needed when the right symbol is not present in the FTS candidate set.
- Detailed benchmark JSON saturates the current Graphify set, while HTTPX and Click show cross-corpus behavior is not solved by one benchmark.
- Source-only hygiene v2 removed fixture/sample corpora; remaining misses are now cleaner evidence for ranking/query-intent work.
- The write-up should be explicit that the latest jump comes from a small hand-built intent layer, not from a general semantic model.
- The write-up should frame the 1.00 score as "benchmark exhausted" rather than proof of general retrieval quality.
- The HTTPX section should note that answer-key audits changed the question count from 12 to 13 but did not reverse the cross-corpus conclusion.
- The HTTPX section should include the `main` lesson: before tuning ranking, confirm the target symbols exist in the index.
- The HTTPX section should include the hybrid lesson: hard FTS protection over-constrained results, while soft lexical boosting preserved Graphify and recovered HTTPX.
- The Click section should include the file-vs-symbol lesson: File Hit@5 is strong, but dense framework code still needs better exact-method ordering.
- The Click section should include the intent-scope lesson: "command line" should not automatically imply command entrypoint; narrowing that trigger improved Click without hurting Graphify or HTTPX.
- The Click section should include the method-specificity lesson: a small owner/name method boost improved top-one exact symbols without changing recall.
- The Click section should include the truth-set lesson: the shell-completion miss was mostly vague wording, not a ranking failure.

## Evidence To Include Later

- One screenshot or terminal block for `agent-index query`.
- Benchmark summary table.
- Three qualitative query examples from `docs/findings/graphify-benchmark-results.md`.
- Experiment progression table from `docs/findings/experiment-log.md`.
- HTTPX baseline notes from `docs/findings/httpx-benchmark-results.md`.
- Click baseline notes from `docs/findings/click-benchmark-results.md`.
- A short comparison table: plain FTS vs symbol-first FTS plus graph expansion.
- One caveat box: "query-intent rules helped Graphify and HTTPX, but Click shows they need scope controls."
