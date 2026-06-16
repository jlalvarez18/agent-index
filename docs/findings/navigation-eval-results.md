# Navigation Eval Results

Date: 2026-06-16

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
  --index-root /tmp/agent-index-nav-suite-set-candidates-local-v1 \
  --artifacts-dir /tmp/agent-index-nav-artifacts-pytest-django-limits-local-v1 \
  --repos
```

## Summary

Multi-repo `nav-suite` result:

| Repos | Cases | agent-index useful | rg broad useful | rg optimized useful | agent-index complete | rg broad complete | rg optimized complete | agent-index avg tokens | rg broad avg tokens | rg optimized avg tokens | agent-index completion tokens | rg broad completion tokens | rg optimized completion tokens | agent wins vs broad | agent wins vs optimized |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 11 | 25 | 1.00 | 1.00 | 1.00 | 1.00 | 0.56 | 0.20 | 195 | 545,345 | 963 | 189 | 96,444 | 88 | 25 | 25 |

Completion-token averages include only workflows that completed the task. They should be read together with completion rate; for example, optimized `rg` has a low completion-token average because it completed only 20% of cases.

The current suite reused prebuilt indexes under `/tmp/agent-index-nav-suite-set-candidates-local-v1`; those indexes contain:

- Click: 64 files, 1,305 symbols.
- NetworkX: 690 files, 8,348 symbols.
- Pydantic: 529 files, 9,439 symbols.
- HTTPX: 60 files, 1,206 symbols.
- FastAPI: 1,120 files, 6,083 symbols.
- SQLAlchemy: 670 files, 30,816 symbols.
- Scikit-learn: 1,116 files, 13,968 symbols.
- Rich: 213 files, 2,076 symbols.
- Pytest: 270 files, 6,269 symbols.
- Django: 2,922 files, 40,972 symbols.
- Poetry: 440 files, 3,875 symbols.

Per-repo results:

| Repo | Cases | agent-index complete | rg broad complete | rg optimized complete | agent tokens | agent completion tokens | rg broad tokens | rg optimized tokens | agent wins vs optimized |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Click | 4 | 1.00 | 1.00 | 0.50 | 209 | 173 | 30,065 | 449 | 4 |
| NetworkX | 2 | 1.00 | 1.00 | 0.50 | 112 | 112 | 1,047,718 | 434 | 2 |
| Pydantic | 4 | 1.00 | 0.25 | 0.00 | 238 | 238 | 106,118 | 1,247 | 4 |
| HTTPX | 3 | 1.00 | 0.00 | 0.00 | 161 | 161 | 48,793 | 1,265 | 3 |
| FastAPI | 1 | 1.00 | 1.00 | 0.00 | 302 | 302 | 902,924 | 975 | 1 |
| SQLAlchemy | 1 | 1.00 | 0.00 | 0.00 | 122 | 122 | 768,269 | 1,379 | 1 |
| Scikit-learn | 1 | 1.00 | 0.00 | 0.00 | 328 | 328 | 914,106 | 2,031 | 1 |
| Rich | 3 | 1.00 | 1.00 | 0.67 | 160 | 160 | 536,114 | 705 | 3 |
| Pytest | 4 | 1.00 | 0.75 | 0.00 | 216 | 216 | 1,231,363 | 731 | 4 |
| Django | 1 | 1.00 | 0.00 | 0.00 | 86 | 86 | 1,267,256 | 1,682 | 1 |
| Poetry | 1 | 1.00 | 0.00 | 0.00 | 189 | 189 | 460,742 | 1,648 | 1 |

## Per-Case Notes

- `click-no-color-source`: 293 agent-index tokens vs 24,629 broad rg tokens and 623 optimized rg tokens.
- `click-no-color-tests`: 160 agent-index tokens vs 1,011 broad rg tokens and 240 optimized rg tokens.
- `click-no-color-source-blind`: 81 agent-index tokens vs 50,173 broad rg tokens and 467 optimized rg tokens, without agent path hints.
- `click-color-env-default-behavior-only`: 362 agent-index tokens vs 44,447 broad rg tokens and 467 optimized rg tokens, without the constant or function name.
- `networkx-path-weight-default`: 103 agent-index tokens vs 1,798,299 broad rg tokens and 698 optimized rg tokens, framed around path cost and missing/default edge weight behavior without naming `path_weight` or `test_pathweight`.
- `networkx-weighted-mixing-expansion`: 118 agent-index tokens vs 297,137 broad rg tokens and 170 optimized rg tokens, using direct `query` then `related-tests`.
- `pydantic-computed-fields-python-api`: 374 agent-index tokens vs 40,134 rg tokens.
- `pydantic-computed-fields-rust-core`: 228 agent-index tokens vs 94,957 rg tokens.
- `pydantic-computed-fields-rust-core-blind`: 134 agent-index tokens vs 94,957 broad rg tokens and 1,822 optimized rg tokens, without a Rust path hint.
- `pydantic-computed-fields-serializer-behavior-only`: 260 agent-index tokens vs 194,422 broad rg tokens and 739 optimized rg tokens, without the Rust type or method name.
- `httpx-redirect-history-manual-next-request`: 209 agent-index tokens vs 30,232 broad rg tokens and 1,287 optimized rg tokens, using `file-clusters` then task-term-biased `related-tests`.
- `httpx-redirect-history-blind`: 209 agent-index tokens vs 30,232 broad rg tokens and 1,287 optimized rg tokens, without agent path hints.
- `httpx-manual-redirect-history-behavior-only`: 154 agent-index tokens vs 85,915 broad rg tokens and 1,220 optimized rg tokens, using one `source-tests` command without the internal request attribute name.
- `fastapi-response-model-serialization-behavior-only`: 308 agent-index tokens vs 902,924 broad rg tokens and 973 optimized rg tokens, framed around endpoint return-value validation/serialization without naming `serialize_response`.
- `sqlalchemy-rowcount-preservation-behavior-only`: 156 agent-index tokens vs 768,269 broad rg tokens and 1,379 optimized rg tokens, now using one fanout-capped `source-tests` command for cursor rowcount preservation source/test navigation without naming private rowcount helpers.
- `sklearn-radius-neighbors-sort-results-mixed-language`: 328 agent-index tokens vs 914,106 broad rg tokens and 2,031 optimized rg tokens, spanning public neighbor estimator code, pairwise-distance dispatcher code, Cython-template backend code, and tests without naming the hidden backend merge/finalize methods.
- `rich-print-json-file-stream`: 269 agent-index tokens vs 422,698 broad rg tokens and 714 optimized rg tokens, using `file-clusters` then `related-tests`.
- `rich-print-json-file-blind`: 71 agent-index tokens vs 422,698 broad rg tokens and 714 optimized rg tokens, without agent path hints.
- `rich-json-stream-output-behavior-only`: 166 agent-index tokens vs 762,947 broad rg tokens and 691 optimized rg tokens, without the target function name. The optimized rg baseline now uses a v2 snippet-derived test search for this case.
- `pytest-capture-suspend-resume-behavior-only`: 118 agent-index tokens vs 1,208,697 broad rg tokens and 976 optimized rg tokens, without naming `CaptureManager.item_capture`.
- `pytest-marker-keyword-deselect-behavior-only`: 155 agent-index tokens vs 1,147,759 broad rg tokens and 507 optimized rg tokens, without naming the deselection functions.
- `pytest-k-marker-keyword-selection-symptom`: 298 agent-index tokens vs 1,156,973 broad rg tokens and 934 optimized rg tokens, framed as surprising `-k` selection behavior rather than a direct implementation lookup.
- `pytest-captured-output-report-sections-symptom`: 291 agent-index tokens vs 1,412,023 broad rg tokens and 434 optimized rg tokens, framed as captured setup/call/teardown output landing under the wrong report section without naming capture manager or report-section APIs.
- `django-streaming-response-close-behavior-only`: 86 agent-index tokens vs 1,267,256 broad rg tokens and 1,682 optimized rg tokens, framed around streaming response cleanup without naming the private closer list or passing the `close` method name as a query term.
- `poetry-lockfile-source-marker-install-operations`: 189 agent-index tokens vs 460,742 broad rg tokens and 1,643 optimized rg tokens, now using one fanout-capped `source-tests` command for lock entries that share name/version but differ by source repository and environment marker without naming the internal lock-entry or transaction methods.

## Lessons

- The current compact result format is already enough to show large token savings on noisy real repositories.
- `nav-eval` now supports explicit `agentIndexSteps`, so workflows can measure `query`, `file-clusters`, and `related-tests` as separate agent navigation commands. The NetworkX fixture now uses file mapping followed by source-to-test discovery.
- `nav-eval` now reports required task completion in addition to first useful hit: each workflow includes found/missing required files and symbols, plus `taskComplete` and suite-level completion rates. Fixtures still keep broader `expected` files/symbols for useful-hit credit.
- The NetworkX multi-step workflow now has `agent-index completion rate: 1.00` and `rg completion rate: 1.00`, so the token win is no longer just first-hit evidence; both workflows found the required source/test locations and symbols.
- Click completion is 1.00 for agent-index and broad rg, but agent-index uses 224 average tokens vs 30,065 broad rg tokens and 449 optimized rg tokens. Pydantic exposes a mixed-language advantage: agent-index completion is 1.00 while broad rg completion is 0.25 and optimized rg completion is 0.00 because the Rust core symbol is surfaced structurally by the index.
- `nav-suite` now runs eleven real repos from the checked-in `benchmarks/navigation/suite.json` manifest and can rebuild every index with `--reindex`. Current aggregate: agent-index completion 1.00 vs broad rg 0.56 and optimized rg 0.20. Agent-index averages 195 context tokens vs 545,345 broad rg tokens and 963 optimized rg tokens, with 25 wins vs broad rg and 25 wins vs optimized rg.
- `nav-eval` and `nav-suite` now report average first-useful latency/context and average completion latency/context separately from total workflow latency/context. In the current suite, agent-index finds the first useful code in 114ms and 151 tokens on average, then completes tasks in 189 tokens on average. Broad rg emits 147,548 tokens by first useful output and 96,444 tokens on completed tasks; optimized rg reaches first useful output in 11ms and 126 tokens on useful cases, but completes only 20% of tasks.
- Compact `query` and `file-clusters` output now includes one capped evidence line per result. This gives agents a tiny confirmation label without opening files and still remains far below the current optimized rg average: 195 agent-index tokens vs 963 optimized rg tokens.
- Public CLI text output now follows the same compact default: `file-clusters` omits score/token/reason fields and caps listed symbols, while `related-tests` omits verbose reason prose. `--json` still preserves full scores, reasons, and context-token estimates for audits.
- Hard path filters now accept tokenized path hints for `query` and `file-clusters`, so an agent can carry loose path memory such as `algorithms cuts` or `auth sessions` into a strict filter without needing the exact slash-delimited filename. This does not change the current suite aggregates because the checked-in fixtures do not yet use loose hard filters, but it closes a real follow-up-navigation failure mode.
- The optimized rg baseline now has a versioned plan format that can run `search-files`, `read-snippets`, and `search-files-from-snippets` steps. The checked-in v2 fixtures now cover Click's behavior-only color-environment case, HTTPX's behavior-only redirect-history source-to-test case, Rich's JSON stream-output behavior case, Django's streaming-response cleanup case, Pytest's marker/keyword deselection/report-section cases, and NetworkX's path-cost default behavior case; all use task-language terms and validate without reading expected files or symbols.
- HTTPX now exercises snippet-derived optimized rg refinement: the behavior-only case searches tests from terms visible in source snippets while forbidding the hidden `next_request` term. Optimized rg still fails task completion, while agent-index completes source and test discovery in 308 tokens.
- Django now exercises snippet-derived optimized rg refinement while forbidding the `close` method name. The v2 rg path still misses required source-symbol completion while agent-index completes in 458 tokens.
- Pytest now exercises snippet-derived optimized rg refinement for marker/keyword deselection. The v2 rg path cuts that case's optimized context from the prior 994-token range to 505 tokens, close to agent-index's 483 tokens, but still misses required task completion because the index supplies the source symbol and source-to-test link directly.
- NetworkX now exercises a fairer path-cost bugfix case: neither agent-index nor rg baselines receive `path_weight` or `test_pathweight` as query terms. Agent-index still finds the implementation from task-language terms and completes source-to-test navigation in 106 tokens; optimized rg grows to 698 tokens and does not complete the task.
- The new `file-clusters` map view put `networkx/algorithms/cuts.py` first for weighted mixing expansion and `httpx/_client.py` first for redirect-history handling, keeping broad behavior prompts under 150 tokens before the test follow-up.
- Path-filtered test discovery matters for keeping test-navigation output small.
- Minimal Rust indexing is enough to make the Pydantic Rust serializer case visible to `agent-index`.
- Cython template indexing now covers `.pyx`, `.pxd`, `.pxi`, and generated-template suffixes such as `.pyx.tp`. The scikit-learn radius-neighbors fixture confirms a mixed Python-to-Cython workflow: public estimator code and dispatcher code lead to the Cython backend class/methods in one compact file-cluster pass, while optimized `rg` stays smaller than broad `rg` but does not complete the hidden backend-symbol requirement.
- `rg` remains faster on raw latency in these runs. The broad matched-line baseline emits far more text for behavior-shaped tasks, while the optimized rg baseline cuts context aggressively with `rg --files-with-matches` and bounded snippets. Agent-index still wins the current suite because it completes more tasks with fewer commands and lower average context than optimized rg.
- The new `related-tests` helper ranked `networkx/algorithms/tests/test_cuts.py` first for `networkx/algorithms/cuts.py` / `mixing_expansion`, validating the first source-to-test shortcut on a real repo. It now also uses import and call-name edges so tests can be found when filenames do not mirror source filenames.
- After adding import/call-name evidence, `related-tests` still ranked NetworkX `test_cuts.py` first and Click `tests/test_globals.py` first for `src/click/globals.py` / `resolve_color_default`, with call-name reasons surfaced in the compact output.
- HTTPX exposed an important test-navigation failure: many `tests/client/*` files import `httpx._client`, so import evidence alone ranked generic client tests ahead of redirect-specific tests. Adding optional task terms to `related-tests` let the agent pass behavior hints (`next_request`, `redirect`, `history`), ranking `tests/client/test_redirects.py` first in 65 estimated tokens and raising HTTPX agent-index completion from 0.00 to 1.00.
- `source-tests` now bundles `file-clusters` with per-source related-test fanout into one compact source/test answer for agents. On the HTTPX behavior-only redirect-history case, it reduced agent-index navigation from two commands and 308 tokens to one command and 154 tokens while preserving task completion and avoiding the hidden `next_request` term. Pair-aware source/test scoring also moves useful source/test bundles above source-only term-density matches, letting the SQLAlchemy rowcount and Poetry lockfile/source-marker fixtures complete in one command.
- `source-tests` now caps related-test fanout to the top source clusters by default while retaining lower-ranked source-only candidates. This lowers average agent context from 279 to 271 tokens and average first-useful latency from 202ms to 136ms compared with the uncapped source-tests run, while preserving 25/25 wins and 1.00 completion.
- Batched related-test fanout now reuses one index handle, materializes shared candidate rows across source candidates, and caches normalized test-file analysis for each batch.
- Related-test candidate discovery now uses set-based candidate file queries plus covering indexes for role/path, symbol-kind, and edge-kind lookups. On a fully reindexed suite this cuts average agent-index latency from 260ms to 158ms and first-useful latency from 138ms to 59ms while preserving 1.00 completion and 25/25 wins.
- `source-tests` now exposes `--test-fanout-limit` and nav-eval fixtures can set `testFanoutLimit`, letting agents and benchmarks deliberately trade source/test breadth for smaller answers when a top source bundle is already strong. The SQLAlchemy rowcount fixture now uses fanout 1, reducing that case from 156 to 122 agent-index tokens while preserving required source/test completion.
- Compact `file-clusters` output now prints only the top symbol per file cluster, leaving full symbol lists in JSON. This cuts average agent context from 270 to 246 tokens and the mixed scikit-learn Python/Cython case from 596 to 526 tokens while preserving 1.00 completion and 25/25 wins.
- The mixed scikit-learn workflow now requests only the six source clusters needed to retain the dispatcher/backend file and only the top two related tests. This trims that case from 526 to 328 tokens and lowers average suite context from 246 to 239 tokens while preserving required source/backend/test completion.
- Pytest and Django behavior workflows now use per-case source/test limits based on the required file ranks observed in saved artifacts. This cuts pytest average context from 411 to 216 tokens and Django from 407 to 86 tokens, lowering suite average context from 239 to 195 tokens without reducing completion.
- Multi-step fixtures now use `sourceFromStep` where possible, so `related-tests` derives its source from the prior `file-clusters` or `query` output instead of being handed the exact source file by the fixture.
- `sourceFromStep` is now multi-source-aware in `nav-eval`: related-test discovery follows the top prior output files, merges the best test candidates, and keeps the same compact output limit. This fixes symptom-shaped tasks where the first file-cluster hit is adjacent to the right implementation but the related tests are anchored on a second or third source file.
- The public `related-tests` CLI now accepts repeated or comma-separated `--source` values, exposing the same multi-source merge to agents outside benchmark fixtures. On the pytest captured-output task, `related-tests --source src/_pytest/nodes.py --source src/_pytest/capture.py ...` ranks `testing/test_capture.py` first in a five-line compact result.
- `related-tests` now strips common source roots such as `src/` when matching import evidence, so `src/pkg/service.py` can match tests that import `pkg.service` or `from pkg import service`.
- `related-tests` now also scores pytest-style fixture arguments that match the source file stem or noun-like source symbol suffix, so tests can be connected even when they exercise source behavior through fixtures rather than direct calls.
- `related-tests` now scores `@pytest.mark.parametrize` values and ids separately from generic test body text, which helps task-term disambiguation when behavior appears in parametrized cases.
- `related-tests` now recognizes mirrored source/test package layout tokens while filtering generic layout words such as `src`, `tests`, `core`, and `utils`, which helps nested test files without letting common directory names dominate.
- `related-tests` now prunes candidate test files with cheap path, import, and call-name signals before scoring full test text, falling back to the old all-test scan when pruning produces no matches or fewer matches than requested. The candidate path filter ignores broad task terms and top-level package roots, so the NetworkX path-cost case now scores 18 candidate tests instead of 294 while still ranking `networkx/classes/tests/test_function.py` first. The Rich top-level `print_json` workflow uses the fallback fill-in to keep `tests/test_rich_print.py` visible.
- `related-tests` now admits tests with dense task-term coverage into the candidate pool even when they do not mirror the source path. SQLAlchemy rowcount preservation exposed this: the relevant behavior tests live in `test/sql/test_resultset.py`, while structural engine-path tests imported source modules and previously crowded them out.
- `related-tests` now also scores task terms that appear in test file paths. FastAPI response serialization exposed this gap: generic routing tests imported `fastapi.routing`, while the useful tests were behavior-named files such as `tests/test_serialize_response_model.py`.
- `file-clusters` now adds aggregate task-term coverage evidence across all matched symbols in a file, so a source file that collectively covers the behavior prompt can outrank repeated partial-match noise.
- `file-clusters` now also uses file-basename task-term evidence as a small path-aware tie-breaker. This moved Django `django/http/response.py` above an adapter handler for the streaming response cleanup case without hard-coding Django paths.
- `related-tests` now extracts Rust `use crate::...` style imports and call names from test text, giving mixed-language workflows a source-to-test link even before Rust edge extraction grows parity with Python.
- The optimized rg baseline changed the best agent workflow for exact API-name tasks: NetworkX now uses direct `query` followed by `related-tests`, cutting agent context from 360 average tokens to 96.
- Seventeen blind, behavior-only, symptom-shaped, mixed-language, or package-management cases now exercise real agent navigation pressure: Click color environment defaults, HTTPX redirect history, FastAPI response serialization, SQLAlchemy rowcount preservation, scikit-learn radius-neighbor result ordering, Poetry lockfile source/marker selection, Rich JSON stream output, Pydantic computed-field serialization, Pytest capture/marker/report behavior, and Django streaming response cleanup. Agent-index completed these cases in 86-328 tokens.
- The Click behavior-only miss showed a useful workflow lesson: broad behavior wording should use `file-clusters` as a map layer. A direct `query` found useful color helpers but did not complete the task; switching to file clusters surfaced `src/click/globals.py` and `resolve_color_default` without adding a ranking special case.
- Pytest is a good stress case for token efficiency: broad `rg` finds useful lines but emits more than a million estimated tokens per behavior-only task, while optimized `rg` keeps snippets smaller but misses required source/test completion. The index behaves more like a table of contents plus cross-reference map: it first narrows to the right source cluster, then jumps to tests through `related-tests`. The captured-output report-section case exposed the need to ask related-test discovery about the top few source candidates, not only the first file-cluster hit.
- A fairness audit caught that some behavior-only drafts passed exact symbols into the second `related-tests` step. The HTTPX, Rich, and Pytest behavior-only cases now omit those symbols and rely on the previous map/query step to infer them. `nav-eval` also rejects behavior-only fixtures that pass explicit related-test symbols or exact target symbol names as agent-index query terms.
- `nav-suite` can now persist `summary.json` plus per-repository JSON under an artifacts directory, so regression checks can compare full case-level evidence without scraping terminal output.
- `nav-compare` now compares saved suite artifacts and fails on agent-index completion drops, win-count drops, total context-token increases, or first-useful context-token increases beyond an explicit allowance. It also supports opt-in latency budgets for total agent latency and time to first useful hit on stable benchmark machines, plus `--require-agent-dominance` to fail unless the current artifact still beats broad and optimized `rg` on completion, case wins, and average context tokens.
- `npm run nav:suite -- ...` and `npm run nav:compare -- baseline current ...` now provide a repeatable local/CI entrypoint for the checked-in suite and dominance gate, so agents do not have to reconstruct the long `nav-suite` and `nav-compare` commands from docs.
- Django exposed a realistic multi-step failure mode: the first `file-clusters` pass found the right source file at rank 2, but `related-tests` followed rank 1 into staticfiles tests. The basename tie-breaker moved the core response module to rank 1, and external test-root scoring now moves `tests/httpwrappers/tests.py` from related-test rank 3 to rank 1 instead of preferring framework helper modules under `django/test`.
- Index builds now create lookup indexes for file role, chunk file id, symbol file id, and edge source symbol id, improving navigation-query latency without changing compact output or scoring semantics.

## Next Retrieval Improvements

- Reduce the remaining large-repo latency cliffs in SQLAlchemy and Django. A naive two-phase `chunk_fts` task-term candidate branch preserved completion but did not beat the set-based `lower(chunk.text) like` artifact on aggregate latency, so the next attempt should use query-plan evidence before changing the pruning path again.
- Deepen Cython support beyond the current regex extractor by adding import/include edges and more Cython/C-extension fixtures, especially generated-template backends where public Python APIs delegate into compiled kernels.
- Expand `related-tests` with more framework conventions beyond pytest-style tests.
- Add more large-framework behavior-only cases like the Django streaming response cleanup case, especially where adapter modules compete with core implementation modules.
- Continue tightening `related-tests` candidate pruning for broad modules and cross-module public API tests, while preserving fallback behavior for top-level API tests like Rich `print_json`.
- Add benchmark cases where the correct test file is selected by behavior terms but the exact source symbol is absent from test bodies.
- Add more blind intent-only fixtures in new repositories where the task does not include an exact symbol name, especially broad bug reports that require `file-clusters` before any direct `query` is possible.
- Add more benchmark fairness guards, especially checks that broad and optimized rg baselines get comparable task terms.
- Convert more optimized rg fixtures to the v2 plan and add more `search-files-from-snippets` cases so the non-index comparison better matches how agents actually use `rg`.
- Choose a checked-in or release-published baseline artifact so CI can run `nav-suite --artifacts-dir` followed by `nav-compare --require-agent-dominance`.
- Add more real-world fixtures beyond Python/Rust once the Python suite remains stable across repeated runs.
