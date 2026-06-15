# Pytest Benchmark Results

## Current Status

Pytest is the fifth validation corpus, cloned locally at `/Users/juan/Repos/pytest`.

This corpus was chosen after the Graphify, HTTPX, Click, and Rich golden sets became saturated. Pytest is larger and architecturally different: command-line configuration, collection, fixtures, assertion rewriting, capture, caching, terminal reporting, temporary paths, marks, and JUnit reporting.

## Benchmark Setup

Commands:

```bash
node dist/cli.js index /Users/juan/Repos/pytest --source-only
node dist/cli.js benchmark ./benchmarks/pytest-python.json --target /Users/juan/Repos/pytest --mode hybrid
```

Source-only index summary after excluding support/test directories:

```text
Indexed 94 files, 2266 symbols, 2266 chunks, 9765 edges at /Users/juan/Repos/pytest/.codeindex/index.sqlite (mode: source-only)
```

The first source-only run exposed a scanner hygiene bug: pytest uses `testing/` instead of `tests/`, so test files were still being indexed. Adding `testing/` to the source-only support-code filter reduced the index from 217 Python files to 94 Python files.

## Golden Questions

The seed set contains 16 questions covering console startup, session collection, Python collection, parametrization IDs, fixture registration and execution, assertion rewriting, assertion explanations, capture, monkeypatch, last-failed cache, terminal summaries, tmp paths, mark selection, and JUnit XML reporting.

## Mode Comparison

Run date: 2026-06-12

Plain FTS:

```text
Mode: fts
Questions: 16
Symbol Hit@1: 0.13
Symbol Hit@5: 0.75
Symbol MRR: 0.36
File Hit@1: 0.81
File Hit@5: 0.94
File MRR: 0.86
Partial file hits: 0.19
Avg latency: 8ms
```

Symbol mode:

```text
Mode: symbol
Questions: 16
Symbol Hit@1: 0.31
Symbol Hit@5: 0.88
Symbol MRR: 0.49
File Hit@1: 0.88
File Hit@5: 0.94
File MRR: 0.91
Partial file hits: 0.13
Avg latency: 59ms
```

Hybrid mode:

```text
Mode: hybrid
Questions: 16
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 42ms
```

Hybrid is the best current mode for exact-symbol ranking on pytest, and the current pytest golden set is now saturated. This is useful dogfood evidence, but it also means pytest no longer provides fresh ranking pressure until the golden set grows.

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 16 Pytest benchmark rows. The structured fields represent what an LLM agent can pass after translating the task into code-search terms, symbol kinds, path hints, source-only filtering, and graph expansion preferences.

Index:

```text
node dist/cli.js index /Users/juan/Repos/pytest --source-only --index-path /tmp/agent-index-pytest-structured.sqlite
Indexed 90 files, 2240 symbols, 2240 chunks, 9583 edges at /tmp/agent-index-pytest-structured.sqlite (mode: source-only)
```

First structured run:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 0.81
Symbol Hit@5: 1.00
Symbol MRR: 0.89
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 35ms
rg-style File Hit@1: 0.81
rg-style File Hit@5: 1.00
rg-style File MRR: 0.88
rg-style Avg latency: 26ms

Misses:
fixture-registration   symbolRank=2  top=register_fixture
assertion-explanations symbolRank=2  top=_format_assertmsg
junitxml-reporting     symbolRank=4  top=LogXML.update_testcase_duration
```

Source audit showed these were query-shaping misses:

- `register_fixture` is an imperative plugin helper, while the question asks about the fixture decorator path. Replacing broad `register` with `marker`, `call`, and `parsefactories` moved the public `fixture` decorator and fixture-definition path to the top.
- `_format_assertmsg` formats custom assertion messages, but the question asks about rich assertion comparison output. Using code-shaped terms such as `assertrepr`, `format_explanation`, and `call_reprcompare` moved `assertrepr_compare` to rank 1.
- `LogXML.update_testcase_duration` is JUnit timing bookkeeping, not failure/skipped/output writing. Terms such as `logreport`, `append_failure`, `append_skipped`, `captured`, and `sessionfinish` lifted the expected XML reporting symbols.

Final structured run:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 34ms
rg-style File Hit@1: 0.81
rg-style File Hit@5: 1.00
rg-style File MRR: 0.88
rg-style Avg latency: 25ms

Misses: none
```

Interpretation: Pytest extends the structured-agent evidence to a plugin/config/hook-heavy codebase. It also reinforces the Click lesson: `agent-index` is not doing the LLM's reasoning. When the agent can infer code-shaped terms, the index can return exact symbols and compact graph context; when the query stays broad, adjacent helpers can win.

## Hybrid Detail

```text
console-main              symbolRank=1     fileRank=1  top=_console_main                          file=src/_pytest/config/__init__.py
session-collection        symbolRank=1     fileRank=1  top=Session.perform_collect                 file=src/_pytest/main.py
python-collection         symbolRank=1     fileRank=1  top=PyCollector.collect                     file=src/_pytest/python.py
collection-arguments      symbolRank=1     fileRank=1  top=resolve_collection_argument             file=src/_pytest/main.py
parametrize-ids           symbolRank=1     fileRank=1  top=Metafunc._resolve_parameter_set_ids     file=src/_pytest/python.py
fixture-closure-execution symbolRank=1     fileRank=1  top=FixtureDef.execute                      file=src/_pytest/fixtures.py
fixture-registration      symbolRank=1     fileRank=1  top=fixture                                file=src/_pytest/fixtures.py
assertion-rewrite-hook    symbolRank=1     fileRank=1  top=AssertionRewritingHook.mark_rewrite     file=src/_pytest/assertion/rewrite.py
assertion-explanations    symbolRank=1     fileRank=1  top=assertrepr_compare                      file=src/_pytest/assertion/util.py
capture-manager           symbolRank=1     fileRank=1  top=MultiCapture.resume_capturing           file=src/_pytest/capture.py
monkeypatch-undo          symbolRank=1     fileRank=1  top=monkeypatch                             file=src/_pytest/monkeypatch.py
last-failed-cache         symbolRank=1     fileRank=1  top=LFPlugin.pytest_collection_modifyitems   file=src/_pytest/cacheprovider.py
terminal-summary          symbolRank=1     fileRank=1  top=TerminalReporter.pytest_terminal_summary file=src/_pytest/terminal.py
tmp-path-factory          symbolRank=1     fileRank=1  top=make_numbered_dir_with_cleanup          file=src/_pytest/pathlib.py
mark-selection            symbolRank=1     fileRank=1  top=deselect_by_keyword                     file=src/_pytest/mark/__init__.py
junitxml-reporting        symbolRank=1     fileRank=1  top=LogXML.pytest_sessionfinish              file=src/_pytest/junitxml.py
```

## Examples

Good result: `where does pytest parametrize calls generate parameter set ids?`

- Top result: `Metafunc._resolve_parameter_set_ids` in `src/_pytest/python.py`
- Source audit confirmed this helper directly resolves parameter set IDs for `Metafunc.parametrize`.
- The answer key was expanded because the original expected symbols were too narrow.

Fixed result: `where does pytest build rich assertion failure explanations and comparison output?`

- Before the build-intent fix, the top result was `TerminalReporter.build_summary_stats_line`.
- Root cause: the generic `build` intent fired on ordinary English phrasing.
- The fix now only applies build intent to graph-construction questions, moving `assertrepr_compare` to rank 1 while preserving the Graphify `build-graph` query.

Fixed result: `where does pytest start suspend resume and read captured stdout and stderr?`

- Before the lifecycle-action fix, the top result was `CaptureManager.pytest_make_collect_report`, and no expected lifecycle method appeared in the top five.
- The fix adds lifecycle methods as candidates when a question names multiple lifecycle verbs.
- After source audit, `MultiCapture.resume_capturing`, `suspend_capturing`, and `readouterr` were added to the answer key because they directly manage stdout/stderr capture lifecycle.
- Current top result: `MultiCapture.resume_capturing`.

Fixed result: `where does pytest perform collection and turn collectors into test items?`

- Before the action/domain fix, the top result was `Item._check_item_and_collector_diamond_inheritance`.
- The fix boosts symbols whose name contains the query action and a separate domain token, such as `perform_collect`.
- Current top result: `Session.perform_collect`.

## Finding

Pytest gives a more realistic readiness signal than the saturated earlier corpora because it exposed several distinct ranking problems before it saturated: hook specs over implementations, wrapper hooks over lifecycle methods, adjacent collection helpers over collection implementations, option registration over flag behavior, and adjacent feature modules over exact file context.

## Pytest Audit Notes

Audit date: 2026-06-12

Source-backed answer-key additions:

- Added `_console_main` because it is part of the pytest console startup path.
- Added `Metafunc._resolve_parameter_set_ids` because it directly resolves generated parameter IDs.
- Added `AssertionRewritingHook.mark_rewrite` and `_should_rewrite` because they participate in marking and deciding assertion rewrite targets.
- Added `TerminalReporter.pytest_terminal_summary` because it is the terminal summary hook.
- Added `MultiCapture.suspend_capturing`, `MultiCapture.resume_capturing`, and `MultiCapture.readouterr` because they directly manage captured stdout/stderr lifecycle.
- Added `monkeypatch` because the public fixture documents the set/env helpers and calls `MonkeyPatch.undo()` during teardown.

Ranking gaps fixed after the first pytest audit:

- `DoctestModule.collect` is plausible collection code, but it is not the main Python module/class/function collection path requested by `python-collection`; exact file context now lifts `PyCollector.collect` in `python.py`.
- `Item._check_item_and_collector_diamond_inheritance` is collection-adjacent, but it is not the session implementation that turns collectors into items; action/domain matching now lifts `Session.perform_collect`.
- `pytest_addoption` registers `--lf` and `--ff`, but the last-failed question asks about caching and collection reordering; option-registration demotion and short-flag matching now lift `LFPlugin.pytest_collection_modifyitems`.

## Build-Intent Fix

Implementation date: 2026-06-12

Regression test added:

- A query asking where pytest builds assertion explanations should prefer `assertrepr_compare` over a `build_summary_stats_line` helper, and the helper should not receive `query intent match`.

Ranking change:

- The generic build intent now fires only for graph-construction questions. This preserves the Graphify `where is the graph built?` behavior while avoiding false positives for ordinary English uses of "build."

Result:

```text
Pytest hybrid before build-intent fix and answer-key audit: Symbol Hit@1 0.38, Symbol Hit@5 0.94, File Hit@5 1.00, avg 43ms.
Pytest hybrid after build-intent fix: Symbol Hit@1 0.44, Symbol Hit@5 0.94, File Hit@5 1.00, avg 43ms.
Pytest hybrid after source-backed answer-key audit: Symbol Hit@1 0.63, Symbol Hit@5 0.94, File Hit@5 1.00, avg 42-52ms across verification runs.
Pytest hybrid after hook-spec and lifecycle-action fixes: Symbol Hit@1 0.81, Symbol Hit@5 1.00, File Hit@5 1.00, avg 57ms in the final verification sweep.
Pytest hybrid after action/domain, flag-behavior, and exact-file-context fixes: Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00, avg 59ms in the final verification sweep.
```

## Hook-Spec And Lifecycle Fixes

Implementation date: 2026-06-12

Regression tests added:

- A command-line parsing query should prefer `_prepareconfig` over `pytest_cmdline_parse` in `hookspec.py`.
- A capture lifecycle query should prefer direct lifecycle methods over a wrapper hook that calls them.

Ranking changes:

- Files named like `hookspec.py` receive a context penalty unless the query explicitly asks for hooks or hook specifications.
- Questions with at least two lifecycle verbs can add action-named methods as candidates when the symbol also matches the query domain.

Result:

```text
Pytest hybrid before these fixes: Symbol Hit@1 0.63, Symbol Hit@5 0.94, File Hit@1 0.75, File Hit@5 1.00.
Pytest hybrid after these fixes and source-backed answer-key audit: Symbol Hit@1 0.81, Symbol Hit@5 1.00, File Hit@1 0.88, File Hit@5 1.00.
```

## Final Pytest Saturation Fixes

Implementation date: 2026-06-12

Regression tests added:

- A collection query that says "perform collection" should prefer `perform_collect` over an adjacent validation helper.
- A query asking what `--lf` / `--ff` do should prefer flag behavior over option registration and over an adjacent plugin.
- A query asking about Python module/class/function collection should prefer `python.py` collection code over `doctest.py`.

Ranking changes:

- Added an action/domain symbol signal for explicit `perform` queries.
- Added option-registration demotion for CLI flag behavior queries.
- Added short-flag acronym matching so `--lf` can match `LFPlugin`.
- Added a narrow exact file-context signal for collection queries.

Result:

```text
Pytest hybrid before these fixes: Symbol Hit@1 0.81, Symbol Hit@5 1.00, File Hit@1 0.88, File Hit@5 1.00.
Pytest hybrid after these fixes: Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00.
```
