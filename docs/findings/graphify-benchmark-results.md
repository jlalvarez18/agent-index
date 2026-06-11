# Graphify Benchmark Results

## Current Status

The benchmark was run against the local Graphify checkout at `/Users/juan/Repos/graphify` on branch `v8`.

## Benchmark Setup

Command once the corpus exists:

```bash
npm run agent-index -- index /Users/juan/Repos/graphify --source-only
npm run agent-index -- benchmark ./benchmarks/graphify-python.json --target /Users/juan/Repos/graphify
```

Metrics:

- Hit@1: expected symbol or file appears first, with symbol preferred.
- Hit@5: expected symbol or file appears in the top 5.
- MRR: reciprocal rank of the first expected symbol/file match.
- Partial file hits: expected file appears in top 5 when the expected symbol does not.
- Average latency: mean query time in milliseconds.

## Golden Questions

The seed set contains 10 questions covering cache behavior, CLI entrypoint, code extraction, graph construction, incremental indexing, query seeds, export, MCP serving, report generation, and community detection.

## Results

Run date: 2026-06-11

All-files index summary:

```text
Indexed 142 files, 3081 symbols, 3081 chunks, 15924 edges at /Users/juan/Repos/graphify/.codeindex/index.sqlite
```

All-files benchmark summary:

```text
Questions: 10
Hit@1: 0.10
Hit@5: 0.20
MRR: 0.15
Partial file hits: 0.10
Avg latency: 65ms
```

Source-only index summary:

```text
Indexed 51 files, 978 symbols, 978 chunks, 7014 edges at /Users/juan/Repos/graphify/.codeindex/index.sqlite
```

Source-only benchmark summary before truth-set audit:

```text
Questions: 10
Hit@1: 0.20
Hit@5: 0.30
MRR: 0.22
Partial file hits: 0.20
Avg latency: 48ms
```

Source-only benchmark summary after truth-set audit, using blended symbol/file scoring:

```text
Questions: 10
Hit@1: 0.20
Hit@5: 0.50
MRR: 0.29
Partial file hits: 0.30
Avg latency: 47ms
```

Source-only filtering improved every metric in the first run. Correcting the golden expected symbols improved Hit@5 again, from 0.30 to 0.50, which means part of the earlier low score was benchmark-label noise rather than retrieval quality.

Split benchmark summary after separating exact symbol hits from file hits:

```text
Questions: 10
Symbol Hit@1: 0.10
Symbol Hit@5: 0.20
Symbol MRR: 0.13
File Hit@1: 0.20
File Hit@5: 0.50
File MRR: 0.29
Partial file hits: 0.30
Avg latency: 45ms
```

This is the most honest metric shape so far. The prototype often lands in the right file, but it is still weak at ranking the exact expected symbol.

Plain FTS baseline:

```text
Mode: fts
Questions: 10
Symbol Hit@1: 0.00
Symbol Hit@5: 0.40
Symbol MRR: 0.14
File Hit@1: 0.10
File Hit@5: 0.50
File MRR: 0.25
Partial file hits: 0.10
Avg latency: 6ms
```

Symbol-first ranking is not yet a clear win. It improves Symbol Hit@1 from 0.00 to 0.10 and File MRR from 0.25 to 0.29, but it reduces Symbol Hit@5 from 0.40 to 0.20 and is slower because it expands graph neighbors. The ranking boosts are helping a few first-place results while pushing some valid expected symbols out of the top five.

Hybrid conservative rerank:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 0.10
Symbol Hit@5: 0.40
Symbol MRR: 0.19
File Hit@1: 0.20
File Hit@5: 0.50
File MRR: 0.29
Partial file hits: 0.10
Avg latency: 43ms
```

Hybrid protects the plain FTS top-five candidate set, then reranks that protected set with symbol/file/edge signals. This preserved FTS Symbol Hit@5 at 0.40 while matching symbol mode's Symbol Hit@1 and File MRR. In practical terms, FTS remains the recall backbone and symbol context becomes a conservative ordering signal.

Detailed hybrid output is available with:

```bash
npm run agent-index -- benchmark ./benchmarks/graphify-python.json --target /Users/juan/Repos/graphify --mode hybrid --json
```

Hybrid per-question detail:

```text
semantic-cache        symbolRank=1     fileRank=1     top=save_semantic_cache      file=graphify/cache.py
main-entrypoint       symbolRank=null  fileRank=null  top=extract_bash             file=graphify/extract.py
extract-code          symbolRank=null  fileRank=null  top=graphify/validate.py     file=graphify/validate.py
build-graph           symbolRank=null  fileRank=null  top=graphify/watch.py        file=graphify/watch.py
incremental-cache     symbolRank=3     fileRank=3     top=graphify/watch.py        file=graphify/watch.py
query-seeds           symbolRank=null  fileRank=null  top=select_diagram_nodes     file=graphify/callflow_html.py
graph-export          symbolRank=null  fileRank=1     top=to_graphml               file=graphify/export.py
mcp-server            symbolRank=3     fileRank=3     top=graphify/mcp_ingest.py   file=graphify/mcp_ingest.py
report-generation     symbolRank=null  fileRank=null  top=graphify/callflow_html.py file=graphify/callflow_html.py
community-detection   symbolRank=4     fileRank=5     top=generate                 file=graphify/report.py
```

Source-only hygiene v2 excluded fixture/sample corpora (`worked/`, `examples/`, `fixtures/`, `samples/`) in addition to tests/tools. The Graphify source-only index changed from:

```text
Indexed 51 files, 978 symbols, 978 chunks, 7014 edges
```

to:

```text
Indexed 37 files, 779 symbols, 779 chunks, 6416 edges
```

The headline hybrid metrics stayed flat, but the detail output got cleaner because fixture/sample results no longer compete:

```text
semantic-cache        symbolRank=1     fileRank=1     top=save_semantic_cache      file=graphify/cache.py
main-entrypoint       symbolRank=null  fileRank=null  top=extract_bash             file=graphify/extract.py
extract-code          symbolRank=null  fileRank=null  top=graphify/llm.py          file=graphify/llm.py
build-graph           symbolRank=null  fileRank=null  top=graphify/watch.py        file=graphify/watch.py
incremental-cache     symbolRank=3     fileRank=3     top=graphify/watch.py        file=graphify/watch.py
query-seeds           symbolRank=null  fileRank=null  top=select_diagram_nodes     file=graphify/callflow_html.py
graph-export          symbolRank=null  fileRank=1     top=to_graphml               file=graphify/export.py
mcp-server            symbolRank=4     fileRank=4     top=graphify/mcp_ingest.py   file=graphify/mcp_ingest.py
report-generation     symbolRank=null  fileRank=null  top=graphify/callflow_html.py file=graphify/callflow_html.py
community-detection   symbolRank=3     fileRank=3     top=generate                 file=graphify/report.py
```

The detail output makes the next bottlenecks clearer:

- `main-entrypoint` is lost because generic command-line terms match shell/code extraction helpers before `graphify/__main__.py`.
- `extract-code`, `build-graph`, `query-seeds`, and `report-generation` are broad natural-language questions where topical support modules outrank implementation symbols.
- `graph-export` lands in the right file at rank 1 but picks the wrong export function, so symbol ranking within the file needs work.
- `community-detection` finds the expected symbols in top five, but unrelated reporting code still beats them.

Hybrid with query-intent candidate expansion:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 0.50
Symbol Hit@5: 0.70
Symbol MRR: 0.58
File Hit@1: 0.60
File Hit@5: 0.70
File MRR: 0.63
Partial file hits: 0.00
Avg latency: 56ms
```

This adds a narrow hand-built intent layer for high-signal terms such as `entrypoint`, `export json`, `report`, `community detection`, and `mcp server`. The key change is candidate expansion, not just reranking: if the likely symbol is not in the FTS top five, the query can add a small set of likely file/symbol matches before hybrid scoring.

Intent-expanded hybrid detail:

```text
semantic-cache        symbolRank=1     fileRank=1     top=save_semantic_cache      file=graphify/cache.py
main-entrypoint       symbolRank=1     fileRank=1     top=main                     file=graphify/__main__.py
extract-code          symbolRank=null  fileRank=null  top=graphify/llm.py          file=graphify/llm.py
build-graph           symbolRank=null  fileRank=null  top=graphify/watch.py        file=graphify/watch.py
incremental-cache     symbolRank=3     fileRank=3     top=graphify/watch.py        file=graphify/watch.py
query-seeds           symbolRank=null  fileRank=null  top=select_diagram_nodes     file=graphify/callflow_html.py
graph-export          symbolRank=1     fileRank=1     top=to_json                  file=graphify/export.py
mcp-server            symbolRank=1     fileRank=1     top=serve                    file=graphify/serve.py
report-generation     symbolRank=1     fileRank=1     top=generate                 file=graphify/report.py
community-detection   symbolRank=2     fileRank=1     top=_split_community         file=graphify/cluster.py
```

This is the strongest prototype result so far, but it is also less general than the previous hybrid mode. The improvement comes from explicit code-search priors, so it should be treated as evidence that agents benefit from query understanding, not proof that this exact rule list will transfer unchanged to every repository.

Hybrid with generic action-alias candidate expansion:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 0.70
Symbol Hit@5: 1.00
Symbol MRR: 0.83
File Hit@1: 0.90
File Hit@5: 1.00
File MRR: 0.93
Partial file hits: 0.00
Avg latency: 60ms
```

This extends query-intent expansion with more general action aliases: `extraction` maps toward extract files/symbols, `built` maps toward build files/symbols, and query `seeds` maps toward seed-picking/scoring symbols. This improved the remaining broad implementation questions without adding Graphify path literals beyond conventional file/symbol names.

Action-alias hybrid detail:

```text
semantic-cache        symbolRank=1     fileRank=1     top=save_semantic_cache      file=graphify/cache.py
main-entrypoint       symbolRank=1     fileRank=1     top=main                     file=graphify/__main__.py
extract-code          symbolRank=2     fileRank=1     top=_extract_python_rationale file=graphify/extract.py
build-graph           symbolRank=1     fileRank=1     top=build                    file=graphify/build.py
incremental-cache     symbolRank=3     fileRank=3     top=graphify/watch.py        file=graphify/watch.py
query-seeds           symbolRank=1     fileRank=1     top=_pick_seeds              file=graphify/serve.py
graph-export          symbolRank=1     fileRank=1     top=to_json                  file=graphify/export.py
mcp-server            symbolRank=1     fileRank=1     top=serve                    file=graphify/serve.py
report-generation     symbolRank=1     fileRank=1     top=generate                 file=graphify/report.py
community-detection   symbolRank=2     fileRank=1     top=_split_community         file=graphify/cluster.py
```

At this point, every golden question has the expected file and symbol in the top five. The two remaining exact Hit@1 misses are ordering problems inside the right neighborhood: extraction ranks `_extract_python_rationale` over the expected extraction functions, and community detection ranks `_split_community` over `cluster`/`_partition`.

Hybrid with core-symbol ordering:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 0.90
Symbol Hit@5: 1.00
Symbol MRR: 0.93
File Hit@1: 0.90
File Hit@5: 1.00
File MRR: 0.93
Partial file hits: 0.00
Avg latency: 61ms
```

This adds a small intra-file ordering rule: prefer function/method symbols that match the file stem, and demote explanatory helper names like `rationale`, `notes`, or `describe`. The rule is intentionally narrow; an earlier broad version boosted classes such as `Cache` over more specific functions and had to be restricted to function-like symbols.

Core-symbol hybrid detail:

```text
semantic-cache        symbolRank=1     fileRank=1     top=save_semantic_cache      file=graphify/cache.py
main-entrypoint       symbolRank=1     fileRank=1     top=main                     file=graphify/__main__.py
extract-code          symbolRank=1     fileRank=1     top=extract_python           file=graphify/extract.py
build-graph           symbolRank=1     fileRank=1     top=build                    file=graphify/build.py
incremental-cache     symbolRank=3     fileRank=3     top=watch                    file=graphify/watch.py
query-seeds           symbolRank=1     fileRank=1     top=_pick_seeds              file=graphify/serve.py
graph-export          symbolRank=1     fileRank=1     top=to_json                  file=graphify/export.py
mcp-server            symbolRank=1     fileRank=1     top=serve                    file=graphify/serve.py
report-generation     symbolRank=1     fileRank=1     top=generate                 file=graphify/report.py
community-detection   symbolRank=1     fileRank=1     top=cluster                  file=graphify/cluster.py
```

The remaining exact miss is `incremental-cache`, where `watch` and rebuild orchestration still outrank the expected incremental manifest/cache symbols. This is a different problem from the earlier broad query misses: the index is in the right area, but needs better task-specific ordering for state/cache maintenance symbols.

Hybrid with incremental change-detection intent:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 53ms
```

The last miss was `incremental-cache`. Inspection showed the benchmark expectation was fair: `watch()` observes filesystem events and triggers rebuilds, but `detect_incremental()` is where Graphify loads the manifest and decides which files changed. The ranking fix adds a narrow intent rule for queries that combine `incremental` with change/indexing terms, boosting `detect_incremental` and manifest symbols over watcher orchestration.

Final Graphify hybrid detail:

```text
semantic-cache        symbolRank=1     fileRank=1     top=save_semantic_cache      file=graphify/cache.py
main-entrypoint       symbolRank=1     fileRank=1     top=main                     file=graphify/__main__.py
extract-code          symbolRank=1     fileRank=1     top=extract_python           file=graphify/extract.py
build-graph           symbolRank=1     fileRank=1     top=build                    file=graphify/build.py
incremental-cache     symbolRank=1     fileRank=1     top=detect_incremental       file=graphify/detect.py
query-seeds           symbolRank=1     fileRank=1     top=_pick_seeds              file=graphify/serve.py
graph-export          symbolRank=1     fileRank=1     top=to_json                  file=graphify/export.py
mcp-server            symbolRank=1     fileRank=1     top=serve                    file=graphify/serve.py
report-generation     symbolRank=1     fileRank=1     top=generate                 file=graphify/report.py
community-detection   symbolRank=1     fileRank=1     top=cluster                  file=graphify/cluster.py
```

This saturates the current 10-question Graphify benchmark. Further Graphify-only ranking work is no longer informative; the next useful evidence should come from another repository or a larger golden set.

## Qualitative Examples

Strong partial success:

- Query: `where is semantic cache handled?`
- Top result: `save_semantic_cache` in `graphify/cache.py`
- Expected result: `check_semantic_cache` or `save_semantic_cache` in `graphify/cache.py`
- Finding: the corrected truth set treats both semantic-cache directions as valid because the wording says "handled" rather than "checked" or "saved."

Miss caused by broad wording:

- Query: `where is the command line entrypoint?`
- Top result before intent expansion: `extract_bash` in `graphify/extract.py`
- Top result after intent expansion: `main` in `graphify/__main__.py`
- Expected result: `main` in `graphify/__main__.py`
- Finding: generic terms like "command line" match unrelated helpers unless the query layer knows that entrypoints often live in `__main__.py` and symbols named `main`.

Strong intent success:

- Query: `where is mcp server exposed?`
- Top result after intent expansion: `serve` in `graphify/serve.py`
- Expected result: `serve` or `_build_server` in `graphify/serve.py`
- Finding: candidate expansion fixes a case where plain lexical matching preferred MCP ingestion/configuration code over the server implementation.

Miss with relevant pipeline context:

- Query: `where does community detection run?`
- Top result after intent expansion: `_split_community` in `graphify/cluster.py`
- Expected result: `cluster` or `_partition` in `graphify/cluster.py`
- Finding: the file-level answer is now correct, but exact symbol ranking still needs nuance because an adjacent helper outranks the two expected implementation symbols.

Alias expansion success:

- Query: `where is the graph built?`
- Top result after action-alias expansion: `build` in `graphify/build.py`
- Expected result: `build` or `build_from_json` in `graphify/build.py`
- Finding: a light verb alias for `built` -> `build` is enough to move this from a watch/rebuild support result to the implementation function.

Core-symbol ordering success:

- Query: `where does community detection run?`
- Top result before core-symbol ordering: `_split_community` in `graphify/cluster.py`
- Top result after core-symbol ordering: `cluster` in `graphify/cluster.py`
- Expected result: `cluster` or `_partition` in `graphify/cluster.py`
- Finding: once the right file is found, the file-stem function is often the better agent starting point than a nearby helper with more matching words.

Incremental change-detection success:

- Query: `where does incremental indexing decide what changed?`
- Top result before incremental intent: `watch` in `graphify/watch.py`
- Top result after incremental intent: `detect_incremental` in `graphify/detect.py`
- Expected result: `detect_incremental`, `load_manifest`, or `save_manifest` in `graphify/detect.py`
- Finding: event orchestration and change-decision logic are easy to conflate lexically. The query needs enough intent to prefer the function that performs the manifest comparison.

Truth-set corrections:

- `extract-code`: `graphify/extract.py` with `extract`, `_extract_single_file`, or `extract_python`
- `build-graph`: `graphify/build.py` with `build_from_json` or `build`
- `incremental-cache`: `graphify/detect.py` with `detect_incremental`, `load_manifest`, or `save_manifest`
- `query-seeds`: `graphify/serve.py` with `_pick_seeds` or `_score_nodes`
- `graph-export`: `graphify/export.py` with `to_json`
- `mcp-server`: `graphify/serve.py` with `serve` or `_build_server`
- `report-generation`: `graphify/report.py` with `generate`
- `community-detection`: `graphify/cluster.py` with `cluster` or `_partition`

## Next Benchmark Improvements

- Keep using `--source-only` for product-code benchmarks unless the question is explicitly about tests or tooling.
- Treat `--mode hybrid` as the current best prototype ranking mode.
- Keep comparing every ranking change against both `--mode fts` and `--mode hybrid`.
- Do not keep tuning against the current Graphify set; it is saturated.
- Next benchmark work should add a second repository or expand the golden set before more ranking changes.
- Use `--json` detail output before every ranking change to verify which questions moved and why.
- Corpus hygiene is now probably good enough for the Graphify experiment; the remaining misses are exact-symbol ordering problems.
