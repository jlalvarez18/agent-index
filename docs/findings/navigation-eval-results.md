# Navigation Eval Results

Date: 2026-06-15

These runs use the new `nav-eval` runner. The metric is coding-agent navigation efficiency: useful-code discovery with lower context/token payload. It is not a claim that `agent-index` beats `rg` at raw exact-string scan latency.

## Commands

```bash
node dist/cli.js index /Users/juan/Repos/click --index-path /tmp/agent-index-click-nav.sqlite
node dist/cli.js nav-eval benchmarks/navigation/click-no-color.json \
  --target /Users/juan/Repos/click \
  --index-path /tmp/agent-index-click-nav.sqlite \
  --mode hybrid \
  --cases

node dist/cli.js index /Users/juan/Repos/networkx --index-path /tmp/agent-index-networkx-nav.sqlite
node dist/cli.js nav-eval benchmarks/navigation/networkx-path-and-cuts.json \
  --target /Users/juan/Repos/networkx \
  --index-path /tmp/agent-index-networkx-nav.sqlite \
  --mode hybrid \
  --cases

node dist/cli.js index /Users/juan/Repos/pydantic --index-path /tmp/agent-index-pydantic-nav.sqlite
node dist/cli.js nav-eval benchmarks/navigation/pydantic-computed-fields.json \
  --target /Users/juan/Repos/pydantic \
  --index-path /tmp/agent-index-pydantic-nav.sqlite \
  --mode hybrid \
  --cases

node dist/cli.js index /Users/juan/Repos/pytest --index-path /tmp/agent-index-nav-pytest.sqlite
node dist/cli.js nav-eval benchmarks/navigation/pytest-behavior-navigation.json \
  --target /Users/juan/Repos/pytest \
  --index-path /tmp/agent-index-nav-pytest.sqlite \
  --mode hybrid \
  --cases

node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-nav-suite-evidence-lines \
  --artifacts-dir /tmp/agent-index-nav-artifacts-evidence-lines \
  --repos \
  --reindex
```

## Summary

Multi-repo `nav-suite` result:

| Repos | Cases | agent-index useful | rg broad useful | rg optimized useful | agent-index complete | rg broad complete | rg optimized complete | agent-index avg tokens | rg broad avg tokens | rg optimized avg tokens | agent wins vs broad | agent wins vs optimized |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 7 | 20 | 1.00 | 1.00 | 1.00 | 1.00 | 0.60 | 0.15 | 259 | 401,250 | 941 | 20 | 20 |

The current suite was run with `--reindex`, rebuilding:

- Click: 64 files, 1,305 symbols.
- NetworkX: 690 files, 8,348 symbols.
- Pydantic: 529 files, 9,439 symbols.
- HTTPX: 60 files, 1,206 symbols.
- Rich: 213 files, 2,076 symbols.
- Pytest: 270 files, 6,269 symbols.
- Django: 2,922 files, 40,972 symbols.

Per-repo results:

| Repo | Cases | agent-index complete | rg broad complete | rg optimized complete | agent tokens | rg broad tokens | rg optimized tokens | agent wins vs optimized |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Click | 4 | 1.00 | 1.00 | 0.50 | 224 | 30,065 | 449 | 4 |
| NetworkX | 2 | 1.00 | 1.00 | 0.50 | 112 | 472,427 | 268 | 2 |
| Pydantic | 4 | 1.00 | 0.25 | 0.00 | 249 | 106,118 | 1,244 | 4 |
| HTTPX | 3 | 1.00 | 0.00 | 0.00 | 242 | 48,793 | 1,417 | 3 |
| Rich | 3 | 1.00 | 1.00 | 0.00 | 168 | 536,114 | 718 | 3 |
| Pytest | 3 | 1.00 | 0.67 | 0.00 | 460 | 1,171,143 | 995 | 3 |
| Django | 1 | 1.00 | 0.00 | 0.00 | 458 | 1,267,256 | 2,117 | 1 |

## Per-Case Notes

- `click-no-color-source`: 293 agent-index tokens vs 24,629 broad rg tokens and 623 optimized rg tokens.
- `click-no-color-tests`: 160 agent-index tokens vs 1,011 broad rg tokens and 240 optimized rg tokens.
- `click-no-color-source-blind`: 81 agent-index tokens vs 50,173 broad rg tokens and 467 optimized rg tokens, without agent path hints.
- `click-color-env-default-behavior-only`: 362 agent-index tokens vs 44,447 broad rg tokens and 467 optimized rg tokens, without the constant or function name.
- `networkx-path-weight-default`: 105 agent-index tokens vs 647,717 broad rg tokens and 366 optimized rg tokens, using direct `query` then `related-tests`.
- `networkx-weighted-mixing-expansion`: 118 agent-index tokens vs 297,137 broad rg tokens and 170 optimized rg tokens, using direct `query` then `related-tests`.
- `pydantic-computed-fields-python-api`: 374 agent-index tokens vs 40,134 rg tokens.
- `pydantic-computed-fields-rust-core`: 228 agent-index tokens vs 94,957 rg tokens.
- `pydantic-computed-fields-rust-core-blind`: 134 agent-index tokens vs 94,957 broad rg tokens and 1,896 optimized rg tokens, without a Rust path hint.
- `pydantic-computed-fields-serializer-behavior-only`: 260 agent-index tokens vs 194,422 broad rg tokens and 773 optimized rg tokens, without the Rust type or method name.
- `httpx-redirect-history-manual-next-request`: 209 agent-index tokens vs 30,232 broad rg tokens and 1,287 optimized rg tokens, using `file-clusters` then task-term-biased `related-tests`.
- `httpx-redirect-history-blind`: 209 agent-index tokens vs 30,232 broad rg tokens and 1,287 optimized rg tokens, without agent path hints.
- `httpx-manual-redirect-history-behavior-only`: 308 agent-index tokens vs 85,915 broad rg tokens and 1,678 optimized rg tokens, without the internal request attribute name.
- `rich-print-json-file-stream`: 269 agent-index tokens vs 422,698 broad rg tokens and 713 optimized rg tokens, using `file-clusters` then `related-tests`.
- `rich-print-json-file-blind`: 71 agent-index tokens vs 422,698 broad rg tokens and 713 optimized rg tokens, without agent path hints.
- `rich-json-stream-output-behavior-only`: 164 agent-index tokens vs 762,947 broad rg tokens and 729 optimized rg tokens, without the target function name.
- `pytest-capture-suspend-resume-behavior-only`: 444 agent-index tokens vs 1,208,697 broad rg tokens and 999 optimized rg tokens, without naming `CaptureManager.item_capture`.
- `pytest-marker-keyword-deselect-behavior-only`: 483 agent-index tokens vs 1,147,759 broad rg tokens and 1,022 optimized rg tokens, without naming the deselection functions.
- `pytest-k-marker-keyword-selection-symptom`: 453 agent-index tokens vs 1,156,973 broad rg tokens and 963 optimized rg tokens, framed as surprising `-k` selection behavior rather than a direct implementation lookup.
- `django-streaming-response-close-behavior-only`: 458 agent-index tokens vs 1,267,256 broad rg tokens and 2,117 optimized rg tokens, framed around streaming response cleanup without naming the private closer list or passing the `close` method name as a query term.

## Lessons

- The current compact result format is already enough to show large token savings on noisy real repositories.
- `nav-eval` now supports explicit `agentIndexSteps`, so workflows can measure `query`, `file-clusters`, and `related-tests` as separate agent navigation commands. The NetworkX fixture now uses file mapping followed by source-to-test discovery.
- `nav-eval` now reports required task completion in addition to first useful hit: each workflow includes found/missing required files and symbols, plus `taskComplete` and suite-level completion rates. Fixtures still keep broader `expected` files/symbols for useful-hit credit.
- The NetworkX multi-step workflow now has `agent-index completion rate: 1.00` and `rg completion rate: 1.00`, so the token win is no longer just first-hit evidence; both workflows found the required source/test locations and symbols.
- Click completion is 1.00 for agent-index, broad rg, and optimized rg, but agent-index uses 91 average tokens vs 25,271 broad rg tokens and 443 optimized rg tokens after adding the blind case. Pydantic exposes a mixed-language advantage: agent-index completion is 1.00 while broad rg completion is 0.33 and optimized rg completion is 0.00 because the Rust core symbol is surfaced structurally by the index.
- `nav-suite` now runs seven real repos from the checked-in `benchmarks/navigation/suite.json` manifest and can rebuild every index with `--reindex`. Current aggregate: agent-index completion 1.00 vs broad rg 0.60 and optimized rg 0.15. Agent-index averages 259 context tokens vs 401,250 broad rg tokens and 941 optimized rg tokens, with 20 wins vs broad rg and 20 wins vs optimized rg. Adding SQLite lookup indexes kept the suite's agent-index average latency near 129ms in this run.
- `nav-eval` and `nav-suite` now report average first-useful latency and first-useful context tokens separately from total workflow latency/context. In the current suite, agent-index finds the first useful code in 24ms and 199 tokens on average vs broad rg at 31ms and 83,413 tokens. Optimized rg reaches first useful output in 12ms and 109 tokens on useful cases, but it completes only 15% of tasks and still averages 941 total context tokens.
- Compact `query` and `file-clusters` output now includes one capped evidence line per result. This intentionally raises agent-index average context from the previous 175-token run to 259 tokens, but gives agents a tiny confirmation label without opening files and still remains far below optimized rg's 941-token average.
- The new `file-clusters` map view put `networkx/algorithms/cuts.py` first for weighted mixing expansion and `httpx/_client.py` first for redirect-history handling, keeping broad behavior prompts under 150 tokens before the test follow-up.
- Path-filtered test discovery matters for keeping test-navigation output small.
- Minimal Rust indexing is enough to make the Pydantic Rust serializer case visible to `agent-index`.
- `rg` remains faster on raw latency in these runs. The broad matched-line baseline emits far more text for behavior-shaped tasks, while the optimized rg baseline cuts context aggressively with `rg --files-with-matches` and bounded snippets. Agent-index still wins the current suite because it completes more tasks with fewer commands and lower average context than optimized rg.
- The new `related-tests` helper ranked `networkx/algorithms/tests/test_cuts.py` first for `networkx/algorithms/cuts.py` / `mixing_expansion`, validating the first source-to-test shortcut on a real repo. It now also uses import and call-name edges so tests can be found when filenames do not mirror source filenames.
- After adding import/call-name evidence, `related-tests` still ranked NetworkX `test_cuts.py` first and Click `tests/test_globals.py` first for `src/click/globals.py` / `resolve_color_default`, with call-name reasons surfaced in the compact output.
- HTTPX exposed an important test-navigation failure: many `tests/client/*` files import `httpx._client`, so import evidence alone ranked generic client tests ahead of redirect-specific tests. Adding optional task terms to `related-tests` let the agent pass behavior hints (`next_request`, `redirect`, `history`), ranking `tests/client/test_redirects.py` first in 65 estimated tokens and raising HTTPX agent-index completion from 0.00 to 1.00.
- Multi-step fixtures now use `sourceFromStep` where possible, so `related-tests` derives its source from the prior `file-clusters` or `query` output instead of being handed the exact source file by the fixture.
- `related-tests` now strips common source roots such as `src/` when matching import evidence, so `src/pkg/service.py` can match tests that import `pkg.service` or `from pkg import service`.
- `related-tests` now also scores pytest-style fixture arguments that match the source file stem or noun-like source symbol suffix, so tests can be connected even when they exercise source behavior through fixtures rather than direct calls.
- `related-tests` now scores `@pytest.mark.parametrize` values and ids separately from generic test body text, which helps task-term disambiguation when behavior appears in parametrized cases.
- `related-tests` now recognizes mirrored source/test package layout tokens while filtering generic layout words such as `src`, `tests`, `core`, and `utils`, which helps nested test files without letting common directory names dominate.
- `file-clusters` now adds aggregate task-term coverage evidence across all matched symbols in a file, so a source file that collectively covers the behavior prompt can outrank repeated partial-match noise.
- `file-clusters` now also uses file-basename task-term evidence as a small path-aware tie-breaker. This moved Django `django/http/response.py` above an adapter handler for the streaming response cleanup case without hard-coding Django paths.
- `related-tests` now extracts Rust `use crate::...` style imports and call names from test text, giving mixed-language workflows a source-to-test link even before Rust edge extraction grows parity with Python.
- The optimized rg baseline changed the best agent workflow for exact API-name tasks: NetworkX now uses direct `query` followed by `related-tests`, cutting agent context from 360 average tokens to 96.
- Twelve blind, behavior-only, or symptom-shaped cases now exercise real agent navigation pressure: Click color environment defaults, HTTPX redirect history, Rich JSON stream output, Pydantic computed-field serialization, Pytest capture/marker behavior, and Django streaming response cleanup. Eight of those avoid exact target symbol names; agent-index completed all eight behavior/symptom cases in 109-331 tokens.
- The Click behavior-only miss showed a useful workflow lesson: broad behavior wording should use `file-clusters` as a map layer. A direct `query` found useful color helpers but did not complete the task; switching to file clusters surfaced `src/click/globals.py` and `resolve_color_default` without adding a ranking special case.
- Pytest is a good stress case for token efficiency: broad `rg` finds useful lines but emits more than a million estimated tokens per behavior-only task, while optimized `rg` keeps snippets smaller but misses required source/test completion. The index behaves more like a table of contents plus cross-reference map: it first narrows to the right source cluster, then jumps to tests through `related-tests`. The new `-k` marker/keyword case adds a more bug-report-like symptom without naming the implementation symbol.
- A fairness audit caught that some behavior-only drafts passed exact symbols into the second `related-tests` step. The HTTPX, Rich, and Pytest behavior-only cases now omit those symbols and rely on the previous map/query step to infer them. `nav-eval` also rejects behavior-only fixtures that pass explicit related-test symbols or exact target symbol names as agent-index query terms.
- `nav-suite` can now persist `summary.json` plus per-repository JSON under an artifacts directory, so regression checks can compare full case-level evidence without scraping terminal output.
- `nav-compare` now compares saved suite artifacts and fails on agent-index completion drops, win-count drops, total context-token increases, or first-useful context-token increases beyond an explicit allowance. It also supports opt-in latency budgets for total agent latency and time to first useful hit on stable benchmark machines.
- Django exposed a realistic multi-step failure mode: the first `file-clusters` pass found the right source file at rank 2, but `related-tests` followed rank 1 into staticfiles tests. The basename tie-breaker moved the core response module to rank 1, and external test-root scoring now moves `tests/httpwrappers/tests.py` from related-test rank 3 to rank 1 instead of preferring framework helper modules under `django/test`.
- Index builds now create lookup indexes for file role, chunk file id, symbol file id, and edge source symbol id, improving navigation-query latency without changing compact output or scoring semantics.

## Next Retrieval Improvements

- Expand `related-tests` with more framework conventions beyond pytest-style tests.
- Add more large-framework behavior-only cases like the Django streaming response cleanup case, especially where adapter modules compete with core implementation modules.
- Add benchmark cases where the correct test file is selected by behavior terms but the exact source symbol is absent from test bodies.
- Add more blind intent-only fixtures in new repositories where the task does not include an exact symbol name, especially broad bug reports that require `file-clusters` before any direct `query` is possible. For pytest, captured setup/call/teardown output landing in the wrong report section remains a good next symptom-shaped case.
- Add more benchmark fairness guards, especially checks that broad and optimized rg baselines get comparable task terms.
- Add an iterative optimized-rg baseline that can refine from prior snippets without reading expected files or symbols, so the non-index comparison better matches how agents actually use `rg`.
- Add CI wiring around `nav-suite --artifacts-dir` and `nav-compare` once a checked-in or release-published baseline artifact is chosen.
- Add more real-world fixtures beyond Python/Rust once the Python suite remains stable across repeated runs.
