# Graphify Benchmark Results

## Current Status

The benchmark was run against the local Graphify checkout at `/Users/juan/Repos/graphify` on branch `v8`.

## Benchmark Setup

Command once the corpus exists:

```bash
npm run agent-index -- index /Users/juan/Repos/graphify
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

Index summary:

```text
Indexed 142 files, 3081 symbols, 3081 chunks, 15924 edges at /Users/juan/Repos/graphify/.codeindex/index.sqlite
```

Benchmark summary:

```text
Questions: 10
Hit@1: 0.10
Hit@5: 0.20
MRR: 0.15
Partial file hits: 0.10
Avg latency: 65ms
```

## Qualitative Examples

Strong partial success:

- Query: `where is semantic cache handled?`
- Top result: `save_semantic_cache` in `graphify/cache.py`
- Expected result: `check_semantic_cache` in `graphify/cache.py`
- Finding: the right file and topic rank at the top, but sibling functions tie closely. This suggests the benchmark expectation may need to allow related symbols or the ranker needs stronger action-word discrimination.

Miss caused by test/helper noise:

- Query: `where is the command line entrypoint?`
- Top result: `_is_chunk_cleanup_line` in `tools/skillgen/gen.py`
- Expected result: `main` in `graphify/__main__.py`
- Finding: generic terms like "line" and "entrypoint" match helper/test code too easily. The scanner likely needs default ignore rules for tests/tools or query ranking needs production-path boosts.

Miss with relevant pipeline context:

- Query: `where does community detection run?`
- Top result: `test_obsidian_dangling_community_member_does_not_crash` in `tests/test_obsidian_dangling_member.py`
- Best visible relevant result in top 3: `run_pipeline` in `tests/test_pipeline.py`, with graph neighbors including `cluster` and `detect`
- Finding: tests dominate this query. The graph edges are useful, but retrieval needs corpus filtering before graph expansion.

## Next Benchmark Improvements

- Add scanner options or defaults to exclude `tests/`, `tools/`, and generated output when benchmarking product code.
- Revisit golden expected symbols against the actual `v8` source; several seed names were plausible placeholders before the corpus was available.
- Add a plain FTS baseline so the symbol-first approach can be compared against something concrete.
- Improve ranking so exact symbol intent beats broad source-text matches.
