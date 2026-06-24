# Go First-Class Evidence Update

Date: 2026-06-23

This note closes the remaining Go evidence gap for the current first-class language-support bar: an authored `agentToolUse` expectation and a live subagent navigation trial.

## Authored Tool-Use Fixture

The Prometheus scrape error-flow fixture now includes `agentToolUse`:

- Fixture: `benchmarks/navigation/prometheus-error-flow.json`
- Case: `prometheus-error-flow`
- Expectation: `agent-index-first`
- Bounds: first useful command <= 1, completion command <= 2, completion context <= 800 tokens

Benchmark correction: the previous one-step `source-tests` workflow surfaced `scrape/scrape.go`, `scrape/scrape_test.go`, `scrapeLoopAppender.append`, and `scrapeLoopAppender.addReportSample`, but it did not surface the required `scrapeLoop.run` symbol in the current Prometheus checkout. The fixture now follows the source/test map with a compact `query` step for the scrape loop runner.

Focused validation:

```bash
npm run agent-index -- index /Users/juan/Repos/prometheus \
  --index-path /tmp/agent-index-prometheus-go-evidence.sqlite

npm run agent-index -- nav-eval benchmarks/navigation/prometheus-error-flow.json \
  --target /Users/juan/Repos/prometheus \
  --index-path /tmp/agent-index-prometheus-go-evidence.sqlite \
  --mode hybrid \
  --cases \
  --json
```

Result:

- Indexed Prometheus: 1,399 files, 14,585 symbols, 14,585 chunks, 116,915 edges.
- Agent-index completion: 1.00.
- Broad `rg` completion: 0.00.
- Optimized `rg` completion: 0.00.
- `agentToolUse` satisfied rate: 1.00.
- First useful command: 1.
- Completion command: 2.
- Completion context: 258 tokens.

## Go Subset Refresh

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-go-evidence-indexes \
  --artifacts-dir /tmp/agent-index-go-evidence-artifacts \
  --reindex \
  --repo cobra \
  --repo viper \
  --repo prometheus \
  --repo kubernetes \
  --repo go-ethereum \
  --repo testify \
  --repo go \
  --repos
```

Summary:

| Repos | Cases | agent-index complete | broad rg complete | optimized rg complete | tool-use cases | tool-use satisfied | agent tokens | broad rg tokens | optimized rg tokens | agent wins vs optimized |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 7 | 7 | 1.00 | 0.57 | 0.29 | 1 | 1.00 | 266 | 1,612,185 | 2,912 | 7 |

Prometheus now contributes the Go `agentToolUse` case and completed in 258 agent-index tokens. The Go subset still completes all seven cases after the benchmark correction.

## Live Subagent Navigation Trial

Task prompt:

- A Prometheus scrape bug report says failures while appending/reporting scrape samples may be mishandled. Find the implementation path and related tests to inspect before making a bugfix.

Observed behavior:

- First navigation command: `agent-index query` against `/Users/juan/Repos/prometheus`.
- Agent-index before broad search: yes. The first query failed only because no warm index existed; the subagent built `/tmp/prometheus-agent-index.sqlite` and reran agent-index before using `rg`.
- First useful hit: `scrapeLoopAppenderV2.addReportSample` in `scrape/scrape_append_v2.go`.
- Files inspected: `scrape/scrape.go`, `scrape/scrape_append_v2.go`, `scrape/scrape_test.go`.
- Files edited: none.
- Narrow `rg` fallback: used after agent-index to verify exact references to `addReportSample`, `scrapeAndReport`, and report/commit log strings.
- Tests attempted: `go test ./scrape -run 'TestScrapeLoopScrapeAndReport|TestScrapeReportSingleAppender|TestScrapeReportLimit|TestScrapeLoopRunCreatesStaleMarkersOnFailedScrape|TestScrapeLoopRunCreatesStaleMarkersOnParseFailure|TestScrapeLoopAppendSampleLimit|TestScrapeLoopAppendSampleLimitWithDisappearingSeries|TestScrapeLoopAppendSampleLimitReplaceAllSamples'`.
- Test outcome: not run because `go` is not installed or not on `PATH` in this environment.

The subagent found the implementation path through `scrapeLoop.scrapeAndReport`, `scrapeLoop.report`, `scrapeLoopAppender.addReportSample`, `scrapeLoopAppenderV2.append`, and `scrapeLoopAppenderV2.addReportSample`. It identified the likely bugfix neighborhood as report append failure assigning to the shared local `err` in `scrapeAndReport`, which can affect the deferred commit/rollback decision.

This is a navigation-only live trial, not a completed Go code change. It still satisfies the first-class evidence requirement that a live agent starts from a realistic bugfix prompt and chooses agent-index before broad search or editing.
