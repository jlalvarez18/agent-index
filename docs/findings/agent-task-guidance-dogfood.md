# Agent Task Guidance Dogfood

Date: 2026-06-23

Task: add opt-in agent-facing guidance to `agent-index task` so autonomous
agents get a recommended next action in addition to ranked retrieval steps.

## Why This Exists

Recent autonomous and dogfood trials showed that retrieval quality is only part
of the problem. Agents also need to decide when to trust a result, when to open
the top source file, and when to avoid jumping back to broad `rg`.

The guidance mode keeps existing task output stable by default, then adds a
small playbook when `--agent-guidance` is requested:

```bash
node dist/cli.js task bugfix "semantic cache load regression" \
  --target /path/to/repo \
  --format compact \
  --agent-guidance
```

Expected compact shape:

```text
Guidance: open-top-result confidence=high
  open: pkg/cache.py:1
  why: source hit rank 1, evidence available, implementation query corroborated, related tests found
  next: inspect source before broad rg
```

Medium-confidence compact guidance is more directive. It keeps the top result
available for a quick ownership check, then tells the agent not to edit yet and
prints the refine command to run before broad search:

```text
Guidance: open-top-result confidence=medium
  open: src/click/testing.py:1
  why: source hit rank 1, evidence available, support/artifact path
  next: inspect only to rule out helper/artifact ownership; run the follow-up query before editing
  before-edit: do not edit this support/artifact result yet; run the refine command to find the owning source file before broad rg
  follow-up: agent-index task bugfix 'NO_COLOR should disable color by default' --term resolve_color_default --term NO_COLOR --term disable --term color --path src/click/globals --role source --kind function --kind method --kind class --expand callers --expand callees --expand parents --limit 5 --agent-guidance --target /path/to/click --index-path /tmp/click.sqlite --mode hybrid
```

## Expected Agent Behavior Change

Without guidance, an agent sees useful ranked files but must infer the workflow.
With guidance, the first move is explicit: inspect the top source result before
falling back to broad search. This should improve autonomous runs where the
agent-index result is already good, but the agent would otherwise spend turns
confirming with less focused tools.

## Follow-Up Measurement

The next autonomous comparison should record whether `--agent-guidance` changes:

- first useful tool selection;
- broad `rg` fallback count before opening the top source result;
- files opened before first useful source;
- task success and quality.

## Confidence Calibration Benchmark

Date: 2026-06-23

Follow-up calibration compared the pre-guidance baseline at commit `364ee9f`
against the current branch on the 10-task
`benchmarks/autonomous/graphify-agent-index-pilot.json` slice.

The change did not tune ranking. It only changed when guidance says `high`
versus `medium`.

| Metric | Before calibration | After calibration |
| --- | ---: | ---: |
| Explicit guidance coverage | 10/10 | 10/10 |
| First opened expected file | 5/10 | 5/10 |
| High-confidence outputs | 9/10 | 5/10 |
| High-confidence precision | 5/9 | 5/5 |
| Medium-confidence outputs | 1/10 | 5/10 |
| Low-confidence outputs | 0/10 | 0/10 |
| Average compact token overhead | +74 | +85 |

Per-task result after calibration:

| Task | First open | Confidence | Expected first open? |
| --- | --- | --- | --- |
| click-color-default-behavior | `src/click/testing.py` | medium | no |
| httpx-redirect-history | `httpx/_client.py` | high | yes |
| pydantic-computed-fields-serialization | `pydantic/json_schema.py` | medium | no |
| tanstack-query-infinite-query-flow | `packages/query-core/src/streamedQuery.ts` | medium | no |
| rich-print-json-file-output | `rich/console.py` | high | yes |
| sqlalchemy-rowcount-preservation | `lib/sqlalchemy/engine/cursor.py` | high | yes |
| fastapi-response-serialization | `fastapi/param_functions.py` | medium | no |
| vite-env-prefix-behavior | `packages/vite/src/node/config.ts` | high | yes |
| redux-toolkit-create-slice-bugfix | `_artifacts/domain_map.yaml` | medium | no |
| graphify-query-path-explanation | `graphify/serve.py` | high | yes |

Interpretation: guidance is now better calibrated. It still recommends the same
first file, but it reserves `high` for cases with stronger path/symbol/query
corroboration and same-source test evidence. Remaining wrong first opens are
ranking work, not confidence work.

Follow-up update: medium-confidence results now carry explicit before-edit
instructions and refine commands with caller, callee, and parent expansion.
Support/artifact-looking hits no longer suggest a direct source-to-tests command,
because that can anchor the agent on the helper instead of pushing it toward the
owning implementation. Refine commands also include the active target, index
path when one was supplied, and mode, and support/artifact refinements use the
next ranked non-support source candidate as the path/term anchor.

Redux Toolkit smoke check: the known `_artifacts/domain_map.yaml` medium case now
emits a refine command anchored on `packages/toolkit/src/createSlice`. Running
that command moves the top result to `packages/toolkit/src/createSlice.ts` with
high confidence and related `createSlice` tests.
