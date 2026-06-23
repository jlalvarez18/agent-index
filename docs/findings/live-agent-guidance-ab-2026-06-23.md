# Live Agent Guidance A/B Slice

Date: 2026-06-23

Artifact root: `/tmp/agent-index-live-guidance-ab`

This was a live autonomous slice against three real-world tasks from
`benchmarks/autonomous/graphify-agent-index-pilot.json`:

- `click-color-default-behavior`
- `httpx-redirect-history`
- `fastapi-response-serialization`

Each task ran under three conditions:

- `agent-index-guided`: required starting with `agent-index task ... --agent-guidance`
- `agent-index-baseline`: required starting with `agent-index task ...` without guidance
- `no-special-tool`: ordinary shell/file tools only

All runs used isolated temporary git worktrees under
`/tmp/agent-index-live-guidance-ab/worktrees`.

## Summary

| Condition | Runs | Pass | Partial | First useful tool | Avg inspected files | Avg tool calls | Avg commands | Avg minutes |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| agent-index-guided | 3 | 2 | 1 | agent-index 3/3 | 7.7 | 29.7 | 27.3 | 8.7 |
| agent-index-baseline | 3 | 3 | 0 | agent-index 3/3 | 7.0 | 22.7 | 23.7 | 8.7 |
| no-special-tool | 3 | 2 | 1 | rg 3/3 | 5.3 | 11.3 | 18.0 | 5.1 |

## Per-Task Results

| Task | Condition | Outcome | First useful file | Tests | Files edited |
| --- | --- | --- | --- | --- | ---: |
| click-color-default-behavior | guided | pass | `src/click/globals.py` | passed | 2 |
| click-color-default-behavior | baseline | pass | `src/click/globals.py` | passed | 4 |
| click-color-default-behavior | no-special-tool | pass | `src/click/globals.py` | passed | 2 |
| httpx-redirect-history | guided | partial | `httpx/_client.py` | not-run | 3 |
| httpx-redirect-history | baseline | pass | `httpx/_client.py` | passed | 1 |
| httpx-redirect-history | no-special-tool | partial | `httpx/_client.py` | failed | 2 |
| fastapi-response-serialization | guided | pass | `fastapi/routing.py` | not-applicable | 0 |
| fastapi-response-serialization | baseline | pass | `fastapi/routing.py` | not-applicable | 0 |
| fastapi-response-serialization | no-special-tool | pass | `fastapi/routing.py` | not-applicable | 0 |

## Interpretation

This slice does not show a broad autonomous win for guidance yet. The strongest
positive signal is Click: calibrated guidance marked the initial `testing.py`
hit as medium confidence, and the agent inspected onward to `globals.py`,
finishing with a smaller edit set than the baseline agent-index run.

HTTPX is the counterexample. Guided navigation reached the right file, but the
agent over-edited and did not find the working offline pytest command. Baseline
agent-index produced the best HTTPX outcome: a smaller test-focused change and
`33 passed`.

FastAPI shows both agent-index conditions and the no-tool condition can solve a
straight explanation task. Baseline agent-index was especially efficient in this
single run, but the sample is too small to treat that as stable.

The honest read: calibrated guidance is behaving more safely than raw high
confidence, but live-agent outcomes are currently dominated by task strategy and
verification behavior. The next performance work should focus on making
guidance actionable after a medium-confidence result, for example by emitting a
specific refine command or "do not edit this helper yet" instruction.

## Telemetry Limits

Turn, tool-call, command, file-inspection, file-edit, test, and wall-time fields
were recorded in all nine `review.json` files. Exact context and output token
counters were not available from most subagents during this run, so token fields
are missing or agent-estimated rather than measured. Treat the token data as
insufficient for a claim; use files inspected, tool calls, command invocations,
and wall-clock estimates as the stronger telemetry for this slice.

## Raw Artifacts

Aggregate JSON: `/tmp/agent-index-live-guidance-ab/summary.json`

Per-run reviews live at:

- `/tmp/agent-index-live-guidance-ab/click-color-default-behavior/agent-index-guided/review.json`
- `/tmp/agent-index-live-guidance-ab/click-color-default-behavior/agent-index-baseline/review.json`
- `/tmp/agent-index-live-guidance-ab/click-color-default-behavior/no-special-tool/review.json`
- `/tmp/agent-index-live-guidance-ab/httpx-redirect-history/agent-index-guided/review.json`
- `/tmp/agent-index-live-guidance-ab/httpx-redirect-history/agent-index-baseline/review.json`
- `/tmp/agent-index-live-guidance-ab/httpx-redirect-history/no-special-tool/review.json`
- `/tmp/agent-index-live-guidance-ab/fastapi-response-serialization/agent-index-guided/review.json`
- `/tmp/agent-index-live-guidance-ab/fastapi-response-serialization/agent-index-baseline/review.json`
- `/tmp/agent-index-live-guidance-ab/fastapi-response-serialization/no-special-tool/review.json`
