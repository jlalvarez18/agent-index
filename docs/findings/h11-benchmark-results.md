# h11 Benchmark Results

## Current Status

Run date: 2026-06-13

`h11` is the first fresh repo added after the attrs recovery. It is useful because it is small, pure Python, and centered on protocol state machines, readers, writers, headers, and byte buffering rather than web routing, ORM, CLI, scientific, or attrs-style class generation.

Repo cloned to:

```text
/tmp/agent-index-eval-h11
```

Fair source-only corpus used by both tools:

```text
/tmp/h11-source-only
```

The source-only corpus contains only top-level `h11/*.py` implementation files, excluding tests, docs, examples, fuzzing, and benchmarks.

## Corpus Setup

`agent-index` indexed:

```text
Indexed 11 files, 144 symbols, 144 chunks, 409 edges at /tmp/agent-index-h11-source-only.sqlite
```

Graphify extracted:

```text
[graphify extract] found 11 code, 0 docs, 0 papers, 0 images
[graphify extract] wrote /private/tmp/graphify-bench-h11/graphify-out/graph.json - 195 nodes, 1138 edges (no clustering)
```

As in earlier runs, Graphify's token benchmark needed a compatibility copy with `links = edges`.

## agent-index Benchmark

Command:

```bash
node dist/cli.js benchmark benchmarks/h11-python.json \
  --target /tmp/h11-source-only \
  --index-path /tmp/agent-index-h11-source-only.sqlite \
  --mode hybrid \
  --misses
```

Result:

```text
Mode: hybrid
Questions: 12
Symbol Hit@1: 0.92
Symbol Hit@5: 1.00
Symbol MRR: 0.96
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 14ms
```

Remaining miss:

```text
keep-alive  symbolRank=2  fileRank=1  top=Connection._clean_up_response_headers_for_sending  file=h11/_connection.py
```

## Graphify Comparison

Graphify token benchmark:

```text
Corpus:          10,000 words -> ~13,333 tokens (naive)
Graph:           200 nodes, 1,138 edges
Avg query cost:  ~5,798 tokens
Reduction:       2.3x fewer tokens per query
```

`agent-eval` comparison:

```text
agent-index Symbol Hit@1: 0.92
agent-index Symbol Hit@5: 1.00
agent-index File Hit@1: 1.00
agent-index File Hit@5: 1.00
Graphify symbol mention rate: 0.25
Graphify file mention rate: 1.00
```

Interpretation: Graphify's traversal reliably reaches the right file on h11, but it usually does not mention the exact expected symbol within the query output. `agent-index` is much stronger for exact ranked navigation on this corpus.

## Fixes From h11

Initial h11 hybrid result on the full checkout source-only index was:

```text
Symbol Hit@1: 0.75
Symbol Hit@5: 0.83
File Hit@1: 0.92
File Hit@5: 0.92
```

The misses showed three general ranking gaps:

- `stay alive` did not map strongly enough to `keep_alive`.
- `parse chunked body` questions did not route to reader modules/classes.
- writer/reader class containers could beat the behavior methods that actually parse or write data.

The test-first fix added:

- `stay`/`keep` lexical equivalence for exact symbol matching;
- guarded reader/writer module-domain routing;
- intent-aware method specificity, including callable-class `__call__` behavior;
- a non-exact class-container penalty when an intent-derived class only wins as a broad container.

An early version over-triggered reader/writer routing and made h11 worse by sending general connection and buffer questions to `_readers.py` or `_writers.py`. The broader suite then caught a Poetry regression where ordinary "read pyproject" and "read poetry.lock" questions were routed to `repositories/parsers`. The final version narrows writer routing to `write`/`writer` wording, requires reader routing from `parse` to include body/header/message/request/response context, and does not treat ordinary `read` as parser intent.

## Examples

Good exact result:

```text
Question: where does h11 parse chunked request or response body data and emit Data events with chunk boundaries?
Top result: ChunkedReader.__call__ in h11/_readers.py
```

Good exact result:

```text
Question: where does h11 write chunked body data with hexadecimal chunk sizes and the terminating zero chunk?
Top result: ChunkedWriter.send_data in h11/_writers.py
```

Remaining near miss:

```text
Question: where does h11 decide whether an HTTP connection can stay alive based on Connection close and HTTP version?
Top result: Connection._clean_up_response_headers_for_sending
Expected: _keep_alive at rank 2
```

The remaining miss is still useful for an agent because the right file is first and `_keep_alive` is second. It also shows a ranking tension: early FTS methods with many overlapping words can still beat an exact private helper when that helper is lower in the lexical candidate list.

## Keep-Alive Completion

The keep-alive miss was fixed in a later pass with a narrow exact-function specificity rule. When a function result has both an exact symbol-name match and symbol-token coverage, it receives a small tie-breaker over broader contextual methods.

Final h11 benchmark:

```text
Mode: hybrid
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
Misses: none
```

The important lesson is not that `_keep_alive` needed a custom rule. It is that agent navigation should prefer a concrete exact function when it ties a broader method that only shares surrounding context.

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 12 h11 benchmark rows. The structured queries use protocol/API-shaped terms such as `_body_framing`, `_keep_alive`, `Connection.next_event`, `Connection.send_with_data_passthrough`, `Connection._clean_up_response_headers_for_sending`, `ConnectionState.process_event`, `ConnectionState._fire_event_triggered_transitions`, `ConnectionState._fire_state_triggered_transitions`, `maybe_read_from_IDLE_client`, `ChunkedReader.__call__`, `ChunkedWriter.send_data`, `ChunkedWriter.send_eom`, `normalize_and_validate`, and `ReceiveBuffer.maybe_extract_lines`.

Index:

```text
node dist/cli.js index /tmp/h11-source-only --source-only --index-path /tmp/agent-index-h11-structured.sqlite
Indexed 11 files, 144 symbols, 144 chunks, 409 edges at /tmp/agent-index-h11-structured.sqlite (mode: source-only)
```

Structured pass:

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
Avg latency: 8ms
rg-style File Hit@1: 0.58
rg-style File Hit@5: 1.00
rg-style File MRR: 0.77
rg-style Avg latency: 4ms

Misses: none
```

Interpretation: h11 adds protocol/state-machine evidence for the structured-agent contract. The same terms let rg-style file ranking recover every expected file by top five, but `agent-index` returns exact methods and functions at rank one, which is the difference between "look in this small file" and "edit this state transition, reader, writer, or buffer helper."
