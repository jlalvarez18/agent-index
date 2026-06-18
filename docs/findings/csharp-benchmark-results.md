# C# Benchmark Results

Date: 2026-06-17

## Scope

This run validates the first C# navigation slice against Dapper:

- `dapper-csharp`: mature .NET library source plus xUnit tests.

The repository was shallow-cloned from `https://github.com/DapperLib/Dapper.git` into `/tmp/agent-index-csharp-repos/Dapper`.

## Command

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-csharp-repos \
  --index-root /tmp/agent-index-csharp-indexes \
  --artifacts-dir /tmp/agent-index-csharp-artifacts \
  --repo dapper-csharp \
  --reindex \
  --repos
```

## Indexed Corpus

| Suite entry | Files | Symbols | Edges |
| --- | ---: | ---: | ---: |
| `dapper-csharp` | 163 | 3,097 | 12,433 |

## Result

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Average commands | 2.00 | 2.00 | 3.00 |
| Average latency | 253 ms | 41 ms | 21 ms |
| Average first useful latency | 94 ms | 14 ms | 9 ms |
| Average context tokens | 533 | 21,258 | 1,761 |
| Average first useful context tokens | 280 | 14,778 | 31 |
| Wins | 1 | 0 | 0 |

Average savings were 20,725 tokens versus broad `rg` and 1,228 tokens versus optimized `rg`.

## Case

| Case | agent complete | broad rg complete | optimized rg complete | agent tokens | broad rg tokens | optimized rg tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `dapper-queryfirst-csharp-row-flow` | 1.00 | 0.00 | 0.00 | 533 | 21,258 | 1,761 |

## Notes

The C# extractor is intentionally line-based. For this Dapper slice, it produced enough structure for first-class navigation: namespace ownership, partial `SqlMapper` class symbols, overload-qualified extension-method-shaped APIs on `IDbConnection`, xUnit test methods, simple call edges, and source/test role classification.

Recent improvements addressed the initial limitations: overloaded methods now carry compact parameter signatures when needed, record primary-constructor parameters are emitted as property-like member symbols, and related-test discovery can use indexed source namespaces for C# import matching instead of relying only on path-derived module names.

Known limitations remain: overload signatures are line-based and type-text only, so they do not perform Roslyn-style alias or fully qualified type resolution; generated property symbols for records are intentionally property-like `method` symbols because the shared schema has no property kind yet.
