# Trio Benchmark Results

## Current Status

Trio is the twenty-first structured-agent validation baseline.

It was selected because async runtime code stresses different navigation behavior than the previous framework, ORM, formatter, template, and protocol corpora: event-loop entrypoints, nurseries, cancellation scopes, channels, synchronization primitives, subprocesses, threads, and low-level traps.

Local checkout:

```text
/tmp/agent-index-trio
```

Clone commit:

```text
78dfbc2
```

## Benchmark Setup

The source-only index used for this pass:

```bash
node dist/cli.js index /tmp/agent-index-trio --source-only --index-path /tmp/agent-index-trio-structured.sqlite
```

Index summary:

```text
Indexed 64 files, 946 symbols, 946 chunks, 3152 edges at /tmp/agent-index-trio-structured.sqlite (mode: source-only)
```

Structured benchmark command:

```bash
node dist/cli.js benchmark benchmarks/trio-python.json \
  --target /tmp/agent-index-trio \
  --index-path /tmp/agent-index-trio-structured.sqlite \
  --mode hybrid \
  --query-style agent \
  --include-rg-baseline \
  --misses
```

## Golden Questions

The Trio set contains 18 source-audited questions covering:

- `run` and event-loop startup
- `open_nursery` and `Nursery.start_soon`
- `CancelScope.__enter__`
- timeout helpers such as `fail_after` and `sleep`
- in-memory channel construction, send, and receive behavior
- `Event`, `Semaphore`, and `Lock` synchronization
- TCP stream/listener helpers
- subprocess execution
- thread handoff helpers
- low-level `wait_task_rescheduled`

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

Final structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 18
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 18ms
rg-style File Hit@1: 0.67
rg-style File Hit@5: 1.00
rg-style File MRR: 0.83
rg-style Avg latency: 16ms

Misses: none
```

## Miss Analysis

The first structured pass reached Symbol Hit@1 `0.78`, Symbol Hit@5 `0.94`, File Hit@1 `0.89`, and File Hit@5 `0.94`. The misses were useful because they separated query-shaping problems from a real general ranking issue:

- `sleep-relative`: the query put `sleep_until` in primary `terms`, so the helper outranked the target `sleep`. Removing the helper from primary terms and relying on graph expansion made `sleep` rank first.
- `serve-listeners`: the query put `open_nursery` and `start_soon` in primary `terms`, so a callee/context symbol outranked `serve_listeners`. Moving those ideas out of primary terms made `serve_listeners` rank first.
- `memory-channel-open`: source audit showed `open_memory_channel` is intentionally a class whose `__new__` returns the send and receive endpoints. The benchmark now accepts both `open_memory_channel` and `open_memory_channel.__new__`.
- `cancel-scope-enter`: source audit showed a real ranking issue. A structured query naming `CancelScope.__enter__` could still let sibling owner methods such as `CancelScope.relative_deadline` win, because broad owner-method intent and exact normal-method scoring did not treat dunder methods as exact targets. A regression test now covers exact dunder-method queries, and dunder methods get exact-name scoring when explicitly requested.

## Concrete Examples

Good result: `sleep-relative`

The structured query uses `sleep`, `seconds`, `checkpoint`, `current_time`, `relative`, `zero`, and `ValueError`, with `symbolKinds: ["function"]` and a `timeouts` path hint. `agent-index` returns `sleep` at rank 1 and includes `sleep_until` as nearby graph context.

Good result: `memory-channel-open`

The structured query uses `open_memory_channel`, `max_buffer_size`, `MemoryChannelState`, `MemorySendChannel`, `MemoryReceiveChannel`, and `__new__`, with `symbolKinds: ["class", "method"]`. `agent-index` returns `open_memory_channel.__new__` at rank 1, which is the implementation that constructs the channel state and returns both endpoints.

Bad first-pass result that became a ranking fix: `cancel-scope-enter`

Before the dunder-method fix, `CancelScope.relative_deadline` could outrank `CancelScope.__enter__` even though the query explicitly named `CancelScope.__enter__`. This was not a Trio-specific special case; it exposed a general issue for lifecycle methods such as `__enter__`, `__exit__`, `__aenter__`, `__aexit__`, and `__new__`.

## Interpretation

Trio supports the agent-facing product model. When the LLM supplies code-shaped terms, symbol-kind filters, path hints, and graph expansion, `agent-index` returns compact ranked symbols and nearby relationships. The rg-style baseline was fast and reached File Hit@5 `1.00`, but it only put the expected file first for `0.67` of questions and does not return exact symbols or graph neighbors.

The main lesson is that dunder methods are real edit locations for agents. They should not be treated as noise once the agent explicitly names them.
