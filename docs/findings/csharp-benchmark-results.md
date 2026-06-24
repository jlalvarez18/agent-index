# C# Benchmark Results

Date: 2026-06-17
Updated: 2026-06-23

## Scope

This run validates the first C# navigation slice against Dapper:

- `dapper-csharp`: mature .NET library source plus xUnit tests.

The original repository was shallow-cloned from `https://github.com/DapperLib/Dapper.git` into `/tmp/agent-index-csharp-repos/Dapper`.
The 2026-06-23 refresh used Dapper commit `72a54c4` under `/tmp/agent-index-csharp-repos-2976/Dapper`.

## Command

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-csharp-repos-2976 \
  --index-root /tmp/agent-index-csharp-indexes-2976 \
  --artifacts-dir /tmp/agent-index-csharp-artifacts-2976 \
  --repo dapper-csharp \
  --reindex \
  --repos
```

## Indexed Corpus

| Suite entry | Files | Symbols | Edges |
| --- | ---: | ---: | ---: |
| `dapper-csharp` | 169 | 3,103 | 12,433 |

## Result

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Agent tool-use cases | 1 | n/a | n/a |
| Agent tool-use satisfied rate | 1.00 | n/a | n/a |
| Average commands | 2.00 | 2.00 | 3.00 |
| Average latency | 270 ms | 44 ms | 21 ms |
| Average first useful latency | 104 ms | 31 ms | 10 ms |
| Average context tokens | 533 | 21,258 | 1,761 |
| Average first useful context tokens | 280 | 14,778 | 31 |
| Wins | 1 | 0 | 0 |

Average savings were 20,725 tokens versus broad `rg` and 1,228 tokens versus optimized `rg`.

## Case

| Case | agent complete | broad rg complete | optimized rg complete | agent tokens | broad rg tokens | optimized rg tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `dapper-queryfirst-csharp-row-flow` | 1.00 | 0.00 | 0.00 | 533 | 21,258 | 1,761 |

## Agent Tool-Use Expectation

The Dapper case now includes an authored `agentToolUse` expectation:

- `expected`: `agent-index-first`
- `maxFirstUsefulCommand`: 1
- `maxCompletionCommand`: 2
- `maxCompletionContextTokens`: 800

The 2026-06-23 run satisfied the expectation. The first agent-index command returned `Dapper/SqlMapper.cs` and the overload-qualified `Dapper.SqlMapper.IDbConnection.QueryFirst(IDbConnection,string,object?,IDbTransaction?,int?,CommandType?)` symbol at rank 1. The second command returned `tests/Dapper.Tests/SingleRowTests.cs` and `Dapper.Tests.SingleRowTests.QueryFirst_PerformanceAndCorrectness` at rank 1. Completion context was 533 tokens.

## Live Subagent Trial

On 2026-06-23, a read-only subagent trial used the prompt: "Trace Dapper QueryFirst row-selection behavior through SqlMapper and locate the xUnit coverage for QueryFirst correctness. Start with code navigation before broad text search. Do not edit files."

Trial result:

- First tool used: `node dist/cli.js query --target /tmp/agent-index-csharp-repos-2976/Dapper --index-path /tmp/agent-index-csharp-indexes-2976/dapper-csharp.sqlite --mode hybrid --term QueryFirst --term SqlMapper --term row --role source --kind method --expand callees`
- Agent-index before broad `rg`: yes.
- First useful source: `Dapper/SqlMapper.cs`, symbol `Dapper.SqlMapper.IDbConnection.QueryFirst(...)`, which calls `QueryRowImpl<T>(cnn, Row.First, ...)`.
- Related test: `tests/Dapper.Tests/SingleRowTests.cs`, symbol `Dapper.Tests.SingleRowTests.QueryFirst_PerformanceAndCorrectness`.
- Files inspected: `Dapper/SqlMapper.cs`, `tests/Dapper.Tests/SingleRowTests.cs`.
- Files edited: none.
- Tests run: none; this was a navigation-only trial.
- `rg` fallback: none. Agent-index found both implementation and xUnit coverage directly.
- Outcome: the subagent found both required files and traced `QueryFirst` through `Row.First` to `QueryRowImpl`, then to the xUnit coverage for synchronous, asynchronous, full-table, top-one, and trailing-error behavior.

## Notes

The C# extractor is intentionally line-based. For this Dapper slice, it produced enough structure for first-class navigation: namespace ownership, partial `SqlMapper` class symbols, overload-qualified extension-method-shaped APIs on `IDbConnection`, xUnit test methods, simple call edges, and source/test role classification.

Recent improvements addressed the initial limitations: overloaded methods now carry compact parameter signatures when needed, record primary-constructor parameters are emitted as property-like member symbols, and related-test discovery can use indexed source namespaces for C# import matching instead of relying only on path-derived module names.

Known limitations remain: overload signatures are line-based and type-text only, so they do not perform Roslyn-style alias or fully qualified type resolution; generated property symbols for records are intentionally property-like `method` symbols because the shared schema has no property kind yet.
