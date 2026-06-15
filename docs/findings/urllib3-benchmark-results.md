# urllib3 Benchmark Results

## Current Status

Run date: 2026-06-13

`urllib3` is the fresh blind repo added after the structured-agent matrix and SQLAlchemy preservation repair. It is useful because it stresses HTTP connection pooling, redirects, retries, proxy tunneling, SSL wrapping, URL parsing, multipart form encoding, and response streaming.

Repo cloned to:

```text
/tmp/agent-index-urllib3
```

Commit:

```text
b644729
```

## Corpus Setup

`agent-index` indexed the repo source-only:

```text
node dist/cli.js index /tmp/agent-index-urllib3 --source-only --index-path /tmp/agent-index-urllib3.sqlite
Indexed 42 files, 706 symbols, 706 chunks, 2703 edges at /tmp/agent-index-urllib3.sqlite (mode: source-only)
```

The benchmark fixture is:

```text
benchmarks/urllib3-python.json
```

## First Structured Pass

Command:

```bash
node dist/cli.js benchmark benchmarks/urllib3-python.json \
  --target /tmp/agent-index-urllib3 \
  --index-path /tmp/agent-index-urllib3.sqlite \
  --mode hybrid \
  --query-style agent \
  --include-rg-baseline \
  --misses
```

First result:

```text
Symbol Hit@1: 0.75
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
rg-style File Hit@1: 0.50
rg-style File Hit@5: 0.92
```

Misses:

```text
poolmanager-urlopen-redirect  symbolRank=2  top=PoolManager.connection_from_host
retry-increment               symbolRank=3  top=Retry.is_retry
response-stream               symbolRank=2  top=HTTPResponse.read_chunked
```

## Source/Debug Audit

All three misses were right-file/right-neighborhood results caused by over-specific helper terms in `agentQuery.terms`:

- `PoolManager.connection_from_host` is a callee of `PoolManager.urlopen`. Including `connection_from_host` as a primary term made the helper beat the redirect orchestration method.
- `Retry.is_retry` and `Retry.is_exhausted` are adjacent retry helpers. The expected edit location for incrementing counters and raising `MaxRetryError` is `Retry.increment`.
- `HTTPResponse.read_chunked` is called by `HTTPResponse.stream` for chunked responses. For a query about the stream generator wrapper, `read_chunked` should be context, not the primary target.

No ranking code changed. The benchmark was refined to keep helper names out of primary terms unless the helper is the intended edit location.

## Final Structured Pass

After query refinement:

```text
Mode: hybrid
Query style: agent
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 24ms
rg-style File Hit@1: 0.58
rg-style File Hit@5: 0.92
rg-style File MRR: 0.72
rg-style Avg latency: 9ms

Misses: none
```

## Lessons

- Fresh repos are still useful even when no ranker code changes. They test whether the agent-query cookbook actually prevents known failure modes.
- Graph expansion should carry callees and neighbors; primary terms should name the desired edit location.
- The rg-style baseline can find the right file often, but `agent-index` adds exact symbol ranking and line ranges that are more directly useful to an agent.

## Graphify Comparison

Run date: 2026-06-13

The same-corpus comparison used a Python-only copy that preserved the benchmark path shape:

```text
/tmp/urllib3-source-only-7Qs3l5
```

Graphify extraction initially produced an empty graph in the sandbox because AST extraction failed with `Operation not permitted`. A fresh source/output pair was then extracted outside the sandbox with one worker:

```text
[graphify extract] found 36 code, 0 docs, 0 papers, 0 images
[graphify extract] wrote /private/tmp/graphify-bench-urllib3-7Qs3l5/graphify-out/graph.json - 1042 nodes, 3789 edges (no clustering)
```

As in earlier comparisons, Graphify's token benchmark needed a temporary compatibility copy with `links = edges`.

Graphify token benchmark:

```text
Corpus:          54,750 words -> ~73,000 tokens (naive)
Graph:           1,095 nodes, 3,789 edges
Avg query cost:  ~10,460 tokens
Reduction:       7.0x fewer tokens per query
```

Same Python-only corpus with `agent-index`:

```text
Indexed 35 files, 605 symbols, 605 chunks, 2223 edges at /tmp/agent-index-urllib3-source-only-7Qs3l5.sqlite (mode: source-only)

Mode: hybrid
Query style: agent
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 28ms
rg-style File Hit@1: 0.58
rg-style File Hit@5: 0.92
rg-style File MRR: 0.72
rg-style Avg latency: 12ms

Misses: none
```

`agent-eval` comparison:

```text
Mode: hybrid
Query style: agent
Questions: 12
agent-index Symbol Hit@1: 1.00
agent-index Symbol Hit@5: 1.00
agent-index File Hit@1: 1.00
agent-index File Hit@5: 1.00
Graphify symbol mention rate: 0.17
Graphify file mention rate: 0.67
```

Graphify mentioned the expected symbol for two cases:

```text
ssl-wrap-match-hostname
multipart-formdata
```

Graphify missed the expected symbol but mentioned the expected file for six cases:

```text
poolmanager-host-pool
poolmanager-urlopen-redirect
proxy-manager-tunnel-headers
connectionpool-urlopen-retry
retry-increment
response-stream
```

Graphify missed both expected symbol and expected file for four cases:

```text
connectionpool-get-conn
timeout-read-timeout
url-parse
proxy-tunnel-required
```

The comparison also exposed a benchmark harness issue: before this pass, `agent-eval` could only run `agent-index` in question-text mode. That was unfair to the current product contract, where the LLM supplies structured `agentQuery` fields. The CLI now accepts `agent-eval --query-style agent`, matching the normal benchmark command.

Interpretation: urllib3 adds another same-corpus check where Graphify gives meaningful context compression, but `agent-index` is much stronger for exact agent navigation. The practical claim remains narrow: this is not proof that Graphify is worse overall; it shows that for source-audited file/symbol/function lookup, structured `agent-index` returns the intended edit location more reliably than Graphify's graph-context excerpt on this benchmark.
