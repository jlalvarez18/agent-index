# Dart First-Class Support

Date: 2026-06-21

## Scope

This pass adds Dart as a first-class `agent-index` language track for ordinary Dart and Flutter-style repositories:

- `.dart` scanner support and role classification for `lib/`, `test/`, `integration_test/`, `example/`, `tool/`, `benchmark/`, docs, and fixtures.
- Deterministic line-based Dart extraction for imports, typedefs, classes, mixins, enums, extensions, constructors, methods, getters, setters, fields, Flutter widget `build` methods, and `test`/`testWidgets` declarations.
- Indexer dispatch, query ranking coverage, source-to-test discovery, a representative Flutter fixture, navigation eval coverage, and a live agent-style trial.

Flutter is covered as part of Dart support rather than as a separate language track. The current support includes Flutter-style project roles, widget `build` methods, `testWidgets` declarations, `flutter_test` imports, and Dart package-import normalization for source-to-test discovery.

## Dogfood

I used `agent-index` before broad search to map this repository:

```bash
node dist/cli.js index /Users/juan/Repos/agent-index --index-path /tmp/agent-index-self.sqlite
node dist/cli.js query --target /Users/juan/Repos/agent-index --index-path /tmp/agent-index-self.sqlite --mode hybrid --term extract --term language --term dispatch --kind function --kind class --role source --limit 10 --format compact
node dist/cli.js query --target /Users/juan/Repos/agent-index --index-path /tmp/agent-index-self.sqlite --mode hybrid --term scanner --term role --term suffix --role source --limit 10 --format compact
```

First useful implementation hits:

- `src/core/scanner.ts`
- `src/core/indexer.ts`
- `src/core/extractors/kotlin.ts`
- `src/core/extractors/swift.ts`
- `src/core/related-tests.ts`

`rg` was still useful for exact insertion points and for listing benchmark/schema references after agent-index identified the relevant subsystem.

## Navigation Fixture

The new suite entry is `flutter-shop-dart`, backed by an authored representative fixture:

- `benchmarks/fixtures/flutter_shop/lib/src/checkout/checkout_controller.dart`
- `benchmarks/fixtures/flutter_shop/lib/src/checkout/checkout_button.dart`
- `benchmarks/fixtures/flutter_shop/lib/src/payments/payment_repository.dart`
- `benchmarks/fixtures/flutter_shop/test/checkout/*_test.dart`

Cases cover:

- bugfix-style checkout submission flow
- feature-style widget behavior
- code-explanation payment repository flow
- source-to-test discovery

## Navigation Results

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo flutter-shop-dart \
  --reindex \
  --index-root /tmp/agent-index-dart-indexes \
  --artifacts-dir /tmp/agent-index-dart-artifacts \
  --repos
```

Indexed corpus:

| Files | Symbols | Edges |
| ---: | ---: | ---: |
| 7 | 43 | 114 |

Results:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Agent tool-use satisfied rate | 1.00 | n/a | n/a |
| Average commands | 1.50 | 1.75 | 2.75 |
| Average latency | 8 ms | 23 ms | 15 ms |
| Average context tokens | 155 | 571 | 305 |
| Average completion context tokens | 141 | 0 | 0 |
| Wins | 4 | 0 | 0 |
| Wins vs optimized rg | 4 | n/a | 0 |

Interpretation:

- `agent-index` completed all four Dart/Flutter navigation tasks with materially less context than broad and optimized `rg`.
- Broad and optimized `rg` both found useful files but did not complete the required file/symbol sets in this fixture.
- The agent-tool-use expectations were satisfied for all four cases: agent-index was first and reached useful results within the expected command/context budgets.

## Real-World Navigation Benchmark

Repository:

- URL: https://github.com/google/json_serializable.dart.git
- Local target: `/Users/juan/Repos/json_serializable.dart`
- Local commit: `833327e`
- Suite entry: `json-serializable-dart`
- Fixture: `benchmarks/navigation/json-serializable-dart-enum-fallback.json`

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-dart-real-indexes-local \
  --artifacts-dir /tmp/agent-index-dart-real-artifacts-local \
  --repo json-serializable-dart \
  --reindex \
  --repos
```

Indexed corpus:

| Files | Symbols | Chunks | Edges |
| ---: | ---: | ---: | ---: |
| 264 | 5,158 | 5,158 | 11,210 |

Case:

- `json-serializable-dart-enum-unknown-value-fallback`
- Task: find the enum decoding helper that handles `unknownEnumValue`, nullable fallback behavior, and the generator test input proving the emitted fallback.
- Required files:
  - `json_serializable/lib/src/type_helpers/enum_helper.dart`
  - `json_serializable/test/src/unknown_enum_value_test_input.dart`
- Required symbol: `EnumHelper`

Results:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Agent tool-use satisfied rate | 1.00 | n/a | n/a |
| Average commands | 2.00 | 2.00 | 3.00 |
| Average latency | 165 ms | 50 ms | 11 ms |
| Average context tokens | 319 | 27,335 | 2,004 |
| Average first-useful context tokens | 167 | 23,957 | 292 |
| Average completion context tokens | 319 | 0 | 0 |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- `agent-index` found `EnumHelper` in `json_serializable/lib/src/type_helpers/enum_helper.dart` at rank 1, then found `json_serializable/test/src/unknown_enum_value_test_input.dart` through `related-tests` at rank 3.
- Broad `rg` found useful files, but its first useful output appeared after about 23,957 context tokens and it did not surface the required `EnumHelper` symbol.
- Optimized `rg` found the source file in the candidate list, but did not complete the source plus test fixture workflow. Its snippet refinement did not expose useful test-search terms, so the final test step produced no output.
- No benchmark corrections were needed for the local checkout. The query terms avoid expected-file and exact-symbol leakage: they use behavior terms such as `unknownEnumValue`, `enum`, `decode`, `fallback`, and `nullable`.
- No broad `rg` fallback was needed for the agent-index workflow. `rg` was used only as the benchmark baseline.

## Live Agent-Style Trial

Task:

> Find the checkout submission path that authorizes a cart, updates paid status, notifies listeners, and identify related Flutter tests.

First tool used: `agent-index`.

Commands:

```bash
node dist/cli.js index benchmarks/fixtures/flutter_shop --index-path /tmp/agent-index-dart-live.sqlite
node dist/cli.js query --target benchmarks/fixtures/flutter_shop --index-path /tmp/agent-index-dart-live.sqlite --mode hybrid --term submit --term authorize --term notifyListeners --term paid --kind method --role source --path lib/src/checkout --expand parents --expand callees --limit 5 --format compact
node dist/cli.js related-tests --target benchmarks/fixtures/flutter_shop --index-path /tmp/agent-index-dart-live.sqlite --source lib/src/checkout/checkout_controller.dart --symbol CheckoutController.submit --term authorizes --term notifies --term paid --limit 3 --format compact-json
```

First useful file: `lib/src/checkout/checkout_controller.dart`

First useful symbol: `CheckoutController.submit` at rank 1.

Files opened:

- `benchmarks/fixtures/flutter_shop/lib/src/checkout/checkout_controller.dart`
- `benchmarks/fixtures/flutter_shop/test/checkout/checkout_controller_test.dart`

Files edited: none; the task was navigation/explanation only.

Tests run:

- focused Dart support tests
- Dart navigation suite entry

Outcome:

- The live trial found `CheckoutController.submit` first, then related tests:
  - `test/checkout/checkout_controller_test.dart`
  - `test/checkout/checkout_button_test.dart`
- No broad `rg` was needed for the Dart fixture trial.
- One command-shape correction was needed: `related-tests` accepts `text`, `json`, or `compact-json`, not `compact`.

Approximate context:

- First useful query output: under 200 tokens.
- Related-test output: under 200 tokens.
- Opened snippets: about 500 tokens combined.

## Notes And Limits

- The Dart extractor is line-based and intentionally dependency-light. It is designed to be upgraded to a structured parser later without changing the index schema.
- Dart fields and constructors are represented as `method` symbols because the shared schema currently has no `field`, `property`, or `constructor` symbol kind.
- Querying exact owner names can make constructors rank strongly. Behavior-shaped terms such as `submit`, `authorize`, `notifyListeners`, and `receipt` produce better method navigation.
- Related-test discovery now normalizes Dart package imports, so `package:flutter_shop/src/checkout/checkout_controller.dart` can match `lib/src/checkout/checkout_controller.dart`.
- The track now has both a representative Flutter fixture and a public-repository Dart benchmark. Future work should add a larger Flutter application benchmark if the extractor grows Flutter-specific ranking beyond ordinary Dart symbols and widget `build` methods.
