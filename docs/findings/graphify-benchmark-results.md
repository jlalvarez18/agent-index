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
- Keep comparing every ranking change against `--mode fts`.
- Improve ranking so symbol/file boosts rerank FTS candidates without pushing valid FTS symbol hits out of the top five.
- Consider reciprocal rank fusion between plain FTS order and symbol-first boost order instead of replacing FTS order with additive boosts.
