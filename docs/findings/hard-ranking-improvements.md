# Hard Ranking Improvements

Date: 2026-06-22

## Summary

This change adds a targeted file-cluster ranking signal for compact behavior queries where the implementation file path names the domain and the matched symbol/evidence names the behavior. The motivating failure was a Pydantic behavior-only bugfix task: user terms said "serializer computed fields exclude", while the useful Rust implementation lives in `pydantic-core/src/serializers/computed_fields.rs` behind Python API and serializer layers.

Result: measurable task-specific gain. The Pydantic hard case moved from incomplete to complete, and the focused 16-case suite improved agent-index completion from 93.75% to 100% without weakening existing expectations.

## Implementation

Changed:

- `src/core/file-clusters.ts`: adds `implementationPathCoverageBoost`.
- `tests/core/file-clusters.test.ts`: pins implementation path coverage behavior.
- `benchmarks/navigation/pydantic-computed-fields.json`: updates the behavior-only computed-fields case to a bugfix task.
- `benchmarks/navigation/react-use-sync-external-store.json`: adds a source-to-test hard case.
- `benchmarks/navigation/nextjs-router-component-navigation.json`: adds a code-explanation hard case.
- `tests/core/navigation-suite.test.ts`: updates TypeScript/JavaScript task-kind coverage expectations.

The boost is intentionally narrow:

- source files only
- 3 to 6 normalized query terms
- at least 3 query terms matched by the full path
- at least 2 query terms matched by the basename
- at least 1 query term matched by symbol names or evidence

This avoids broad framework tracing queries over-promoting generic files such as `app-router.tsx`.

## Benchmark Artifacts

Before artifacts, old ranking with updated benchmark cases:

- `/tmp/agent-index-hard-before-newcases/summary.json`
- `/tmp/agent-index-hard-before-newcases/repos/*.json`

After artifacts:

- `/tmp/agent-index-hard-after/summary.json`
- `/tmp/agent-index-hard-after/repos/*.json`

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-hard-after-indexes \
  --artifacts-dir /tmp/agent-index-hard-after \
  --reindex \
  --repo axios \
  --repo redux-toolkit \
  --repo tanstack-query \
  --repo next.js \
  --repo react \
  --repo pytest \
  --repo pydantic \
  --json
```

## Before vs After

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Cases | 16 | 16 | 0 |
| Agent-index completion rate | 93.75% | 100% | +6.25 pp |
| Broad rg completion rate | 68.75% | 68.75% | 0 |
| Optimized rg completion rate | 31.25% | 37.50% | +6.25 pp |
| Agent-index wins vs broad rg | 16 | 16 | 0 |
| Broad rg wins | 0 | 0 | 0 |
| Agent-index wins vs optimized rg | 16 | 16 | 0 |
| Optimized rg wins | 0 | 0 | 0 |
| Agent-index avg first useful command | 1.0 | 1.0 | 0 |
| Agent-index avg commands | 1.4375 | 1.4375 | 0 |
| Agent-index avg first useful context tokens | 185.94 | 184.00 | -1.94 |
| Agent-index avg total context tokens | 230.94 | 229.00 | -1.94 |
| Agent-index avg completion context tokens | 231.79 | 229.00 | -2.79 |
| Agent-index avg latency | 237.01 ms | 235.87 ms | -1.15 ms |

## Notable Cases

### Bugfix: Pydantic computed fields

`pydantic-computed-fields-serializer-behavior-only`

| Metric | Before | After |
| --- | ---: | ---: |
| Agent-index complete | false | true |
| First useful command | 1 | 1 |
| First useful context tokens | 225 | 218 |
| Total context tokens | 225 | 218 |
| Completion context tokens | n/a | 218 |
| Latency | 28.21 ms | 32.10 ms |
| Files surfaced | 5 | 5 |

After:

- Agent-index: complete, 218 tokens, 1 command.
- Broad rg: incomplete, 194,422 tokens, 1 command.
- Optimized rg: incomplete, 806 tokens, 2 commands, 25 files surfaced.

### Source-to-test: React external store snapshots

`react-external-store-snapshot-hydration-source-to-test`

- Agent-index: complete, 182 tokens, 1 command, 7 files surfaced.
- Broad rg: complete, 534,500 tokens, 2 commands.
- Optimized rg: complete, 1,653 tokens, 4 commands, 7 files surfaced.

### Code explanation: Next.js redirect errors

`nextjs-redirect-error-code-explanation`

- Agent-index: complete, 283 tokens, 1 command, 6 files surfaced.
- Broad rg: complete, 1,937,743 tokens, 2 commands.
- Optimized rg: complete, 1,294 tokens, 2 commands, 25 files surfaced.

### Existing bugfix and feature checks

`redux-toolkit-create-slice-selector-bugfix`

- Agent-index: complete, 112 tokens, 1 command, 8 files surfaced.
- Broad rg: complete, 146,933 tokens, 2 commands.
- Optimized rg: complete, 2,532 tokens, 4 commands, 33 files surfaced.

`tanstack-query-infinite-query-feature-tracing`

- Agent-index: complete, 142 tokens, 1 command, 8 files surfaced.
- Broad rg: complete, 157,993 tokens, 2 commands.
- Optimized rg: incomplete, 3,049 tokens, 4 commands, 44 files surfaced.

## Interpretation

The gain is task-specific, not a sweeping ranking overhaul. It improves cases where:

- user words name behavior or product-facing concepts
- implementation paths encode the domain more strongly than individual symbols
- generic helper files have many lexical hits but are not the best implementation locus

It did not materially change exact-symbol or already-strong workflows. The final suite shows small average token/latency improvements because only one pre-existing hard miss changed outcome.

## No-Special-Tool Baseline

This run did not execute a live autonomous no-tool agent. The deterministic navigation suite compares broad `rg` and optimized multi-step `rg`; those are the practical no-special-tool proxies for this measurement. A live autonomous comparison would require recording a separate agent trace for these exact tasks, which was not done in this pass.

## Verification

Passed:

```bash
npm test
npm run build
node dist/cli.js nav-suite benchmarks/navigation/suite.json --repo-root /Users/juan/Repos --index-root /tmp/agent-index-hard-after-indexes --artifacts-dir /tmp/agent-index-hard-after --reindex --repo axios --repo redux-toolkit --repo tanstack-query --repo next.js --repo react --repo pytest --repo pydantic --json
```
