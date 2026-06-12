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
- Auditing the golden truth set against real Graphify v8 symbols improved source-only Hit@5 from 0.30 to 0.50. Several initial benchmark expectations were plausible guesses but not real v8 symbol names.
- Splitting benchmark metrics showed the sharper truth: source-only file Hit@5 is 0.50, but exact symbol Hit@5 is only 0.20. The index finds neighborhoods better than exact functions right now.
- The plain FTS baseline beat current symbol ranking on Symbol Hit@5, 0.40 vs 0.20. Symbol boosts improved Symbol Hit@1 and File MRR slightly, but they also pushed valid FTS candidates down.
- Hybrid ranking fixed that specific regression by protecting the FTS top five before reranking. It kept Symbol Hit@5 at 0.40 while improving Symbol Hit@1 from FTS 0.00 to Hybrid 0.10.
- Adding JSON benchmark details made the remaining misses concrete: broad questions often land in topical support modules, while some right-file hits still miss the exact expected function.
- Source-only hygiene v2 removed fixture/sample corpora from the benchmark index, reducing Graphify from 51 indexed Python files to 37. Metrics stayed flat, but noisy `worked/` results disappeared from the miss table.
- Query-intent candidate expansion changed the best hybrid result from Symbol Hit@1 0.10 / Symbol Hit@5 0.40 to Symbol Hit@1 0.50 / Symbol Hit@5 0.70. The win came from adding likely candidates for high-signal terms such as `entrypoint`, `export json`, `report`, `community detection`, and `mcp server` before reranking.
- The query-intent layer is deliberately labeled as a hand-built retrieval prior. It is useful evidence that agents need query understanding, but it is not yet evidence that a fixed rule list generalizes across repositories.
- General action aliases for `extraction`, `built`, and query `seeds` improved hybrid to Symbol Hit@1 0.70 / Symbol Hit@5 1.00. This suggests a small vocabulary of coding verbs can recover implementation candidates that plain FTS misses or under-ranks.
- The remaining Graphify misses are no longer file-retrieval misses. They are exact-symbol ordering misses inside the right file or immediate neighborhood.
- Core-symbol ordering improved hybrid to Symbol Hit@1 0.90 / Symbol Hit@5 1.00 by preferring file-stem function matches and demoting explanatory helper names. A first version was too broad and boosted classes, so the rule is now limited to function-like symbols.
- The only remaining Graphify miss is `incremental-cache`, where orchestration code in `watch.py` outranks the expected manifest/cache symbols.
- Inspecting the incremental-cache miss confirmed the golden label: `watch()` orchestrates file events, while `detect_incremental()` decides what changed by comparing the manifest. Adding a narrow incremental change-detection intent rule saturated the current Graphify benchmark at Symbol Hit@1 1.00 / Symbol Hit@5 1.00.
- The current Graphify set is no longer useful for additional ranking optimization by itself. The next evidence should come from another repository or a larger golden set.
- HTTPX is now the second corpus. Its first baseline reverses the Graphify conclusion: symbol mode beats hybrid on exact symbol retrieval, with Symbol Hit@5 0.83 vs hybrid 0.42. This is useful evidence that the hybrid strategy is corpus-sensitive.
- Auditing the HTTPX truth set preserved that conclusion. The cleaned 13-question set gives symbol mode Symbol Hit@5 0.85 and File Hit@5 1.00, while hybrid gives Symbol Hit@5 0.46 and File Hit@5 0.85. The remaining symbol-mode misses are mostly module/class containers outranking exact functions, such as `main`, `request`, and `Response.json`.
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
- Which hybrid ranking signals can improve Symbol Hit@1 without reducing protected FTS top-five recall?
- Can query-intent terms like "entrypoint", "export", and "report" be mapped to likely file/symbol patterns without overfitting to Graphify?
- Should the intent layer be rule-based, learned from repo structure, or supplied by the calling agent as explicit search hints?
- Should query mode prefer exact function/method matches over module/class containers when both are in the same high-confidence file?
