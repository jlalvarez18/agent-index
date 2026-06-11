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

The detail output makes the next bottlenecks clearer:

- `main-entrypoint` is lost because generic command-line terms match shell/code extraction helpers before `graphify/__main__.py`.
- `extract-code`, `build-graph`, `query-seeds`, and `report-generation` are broad natural-language questions where topical support modules outrank implementation symbols.
- `graph-export` lands in the right file at rank 1 but picks the wrong export function, so symbol ranking within the file needs work.
- `community-detection` finds the expected symbols in top five, but unrelated reporting code still beats them.

## Qualitative Examples

Strong partial success:

- Query: `where is semantic cache handled?`
- Top result: `save_semantic_cache` in `graphify/cache.py`
- Expected result: `check_semantic_cache` or `save_semantic_cache` in `graphify/cache.py`
- Finding: the corrected truth set treats both semantic-cache directions as valid because the wording says "handled" rather than "checked" or "saved."

Miss caused by broad wording:

- Query: `where is the command line entrypoint?`
- Top result after source-only filtering: `_env_command_args` in `graphify/detect.py`
- Expected result: `main` in `graphify/__main__.py`
- Finding: generic terms like "command line" still match argument-parsing helpers. Ranking needs stronger file-path and entrypoint-name handling for `__main__.py`.

Miss with relevant pipeline context:

- Query: `where does community detection run?`
- Top result after source-only filtering: module `graphify/watch.py`
- Expected result: `cluster` or `_partition` in `graphify/cluster.py`
- Finding: broad source text mentions of clustering still outrank the implementation file. Ranking needs a stronger exact-file/symbol boost for query terms like "community detection."

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
- Next ranking work should improve Hybrid Symbol Hit@1 without reducing Hybrid Symbol Hit@5.
- Use `--json` detail output before every ranking change to verify which questions moved and why.
