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

node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-nav-suite \
  --repos \
  --reindex
```

## Summary

Multi-repo `nav-suite` result:

| Repos | Cases | agent-index useful | rg useful | agent-index complete | rg complete | agent-index avg tokens | rg avg tokens | Avg token savings | agent-index wins | rg wins |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 8 | 1.00 | 1.00 | 1.00 | 0.75 | 211 | 194,814 | 194,603 | 8 | 0 |

The current suite was run with `--reindex`, rebuilding:

- Click: 64 files, 1,305 symbols.
- NetworkX: 690 files, 8,348 symbols.
- Pydantic: 529 files, 9,439 symbols.
- HTTPX: 60 files, 1,206 symbols.
- Rich: 213 files, 2,076 symbols.

Per-repo results:

| Repo | Cases | agent-index useful | rg useful | agent-index complete | rg complete | agent-index avg tokens | rg avg tokens | Avg token savings | agent-index wins | rg wins |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Click | 2 | 1.00 | 1.00 | 1.00 | 1.00 | 114 | 12,820 | 12,706 | 2 | 0 |
| NetworkX | 2 | 1.00 | 1.00 | 1.00 | 1.00 | 360 | 472,427 | 472,068 | 2 | 0 |
| Pydantic | 2 | 1.00 | 1.00 | 1.00 | 0.50 | 157 | 67,546 | 67,389 | 2 | 0 |
| HTTPX | 1 | 1.00 | 1.00 | 1.00 | 0.00 | 205 | 30,232 | 30,027 | 1 | 0 |
| Rich | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 225 | 422,698 | 422,473 | 1 | 0 |

## Per-Case Notes

- `click-no-color-source`: 134 agent-index tokens vs 24,629 rg tokens.
- `click-no-color-tests`: 94 agent-index tokens vs 1,011 rg tokens.
- `networkx-path-weight-default`: 354 agent-index tokens vs 647,717 rg tokens, using `file-clusters` then `related-tests`.
- `networkx-weighted-mixing-expansion`: 365 agent-index tokens vs 297,137 rg tokens, using `file-clusters` then `related-tests`.
- `pydantic-computed-fields-python-api`: 197 agent-index tokens vs 40,134 rg tokens.
- `pydantic-computed-fields-rust-core`: 116 agent-index tokens vs 94,957 rg tokens.
- `httpx-redirect-history-manual-next-request`: 205 agent-index tokens vs 30,232 rg tokens, using `file-clusters` then task-term-biased `related-tests`.
- `rich-print-json-file-stream`: 225 agent-index tokens vs 422,698 rg tokens, using `file-clusters` then `related-tests`.

## Lessons

- The current compact result format is already enough to show large token savings on noisy real repositories.
- `nav-eval` now supports explicit `agentIndexSteps`, so workflows can measure `query`, `file-clusters`, and `related-tests` as separate agent navigation commands. The NetworkX fixture now uses file mapping followed by source-to-test discovery.
- `nav-eval` now reports required task completion in addition to first useful hit: each workflow includes found/missing required files and symbols, plus `taskComplete` and suite-level completion rates. Fixtures still keep broader `expected` files/symbols for useful-hit credit.
- The NetworkX multi-step workflow now has `agent-index completion rate: 1.00` and `rg completion rate: 1.00`, so the token win is no longer just first-hit evidence; both workflows found the required source/test locations and symbols.
- Click completion is also 1.00 for both workflows with agent-index using 114 average tokens vs 12,820 for rg. Pydantic exposes a mixed-language advantage: agent-index completion is 1.00 while rg completion is 0.50 because the Rust core symbol is surfaced structurally by the index.
- `nav-suite` now runs five real repos from the checked-in `benchmarks/navigation/suite.json` manifest and can rebuild every index with `--reindex`. Current aggregate: agent-index completion 1.00 vs rg 0.75, agent-index 211 average context tokens vs rg 194,814, with 8 agent-index wins and 0 rg wins.
- The new `file-clusters` map view put `networkx/algorithms/cuts.py` first for weighted mixing expansion and `httpx/_client.py` first for redirect-history handling, keeping broad behavior prompts under 150 tokens before the test follow-up.
- Path-filtered test discovery matters for keeping test-navigation output small.
- Minimal Rust indexing is enough to make the Pydantic Rust serializer case visible to `agent-index`.
- `rg` remains faster on raw latency in these runs, but the broad matched-line baseline emits far more text for behavior-shaped tasks. That extra text is the measured cost for agents in this scripted comparison; future baselines should also model `rg -l`, globs, staged narrowing, and selected file reads.
- The new `related-tests` helper ranked `networkx/algorithms/tests/test_cuts.py` first for `networkx/algorithms/cuts.py` / `mixing_expansion`, validating the first source-to-test shortcut on a real repo. It now also uses import and call-name edges so tests can be found when filenames do not mirror source filenames.
- After adding import/call-name evidence, `related-tests` still ranked NetworkX `test_cuts.py` first and Click `tests/test_globals.py` first for `src/click/globals.py` / `resolve_color_default`, with call-name reasons surfaced in the compact output.
- HTTPX exposed an important test-navigation failure: many `tests/client/*` files import `httpx._client`, so import evidence alone ranked generic client tests ahead of redirect-specific tests. Adding optional task terms to `related-tests` let the agent pass behavior hints (`next_request`, `redirect`, `history`), ranking `tests/client/test_redirects.py` first in 65 estimated tokens and raising HTTPX agent-index completion from 0.00 to 1.00.
- Multi-step fixtures now use `sourceFromStep` where possible, so `related-tests` derives its source from the prior `file-clusters` output instead of being handed the exact source file by the fixture.
- `related-tests` now strips common source roots such as `src/` when matching import evidence, so `src/pkg/service.py` can match tests that import `pkg.service` or `from pkg import service`.

## Next Retrieval Improvements

- Expand `related-tests` with framework conventions, parametrized test names, fixture references, and source/test package layout rules.
- Add benchmark cases where the correct test file is selected by behavior terms but the exact source symbol is absent from test bodies.
- Add an optimized rg baseline that measures filename-only narrowing plus selected file-open context, not just broad matched-line stdout.
- Persist navigation-eval JSON output in CI-style artifacts so regressions can be tracked over time.
- Add more real-world fixtures beyond Python/Rust once the Python suite remains stable across repeated runs.
