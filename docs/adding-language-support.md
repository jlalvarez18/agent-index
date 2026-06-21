# Adding Language Support

This guide explains how to add or upgrade language support in `agent-index`.

The goal is not to build a perfect compiler front end. The goal is to give coding agents a compact, reliable map of the files, symbols, relationships, and tests they actually need for code changes.

## Quality Bar

A language is first-class when it has:

- scanner support for file suffixes and test/source role detection
- an extractor that emits useful symbols, chunks, and edges
- indexer dispatch
- unit tests for extraction and indexing
- query or file-cluster ranking tests for common tasks
- source-to-test or related-test coverage when the ecosystem has tests
- real-world navigation benchmarks that beat broad and optimized `rg` on context/completion
- documented findings under `docs/findings/`

Small support for config or build files can be narrower. For example, TOML and XML support focuses on version catalogs and Maven POM ownership rather than arbitrary document semantics.

## Implementation Checklist

### 1. Extend Shared Types

Edit [src/core/schema.ts](../src/core/schema.ts):

- Add the language to `Language`.
- Add a symbol kind only if existing `module`, `class`, `function`, `method`, and `typealias` cannot represent the language reasonably.
- Add an edge kind only if existing edge types cannot model the relationship.

Prefer reusing existing kinds. Every new kind affects scanner, query, benchmarks, output formatting, and tests.

### 2. Add Scanner Support

Edit [src/core/scanner.ts](../src/core/scanner.ts):

- Add file suffixes to `scanCodeFiles`.
- Map suffixes in `languageForSuffix`.
- Add test-file detection if the ecosystem has naming conventions.
- Adjust role classification for language-specific layouts.

Examples:

- Go tests use `_test.go`.
- Swift tests often end with `Tests.swift`.
- Kotlin tests can live under `src/test`, `src/androidTest`, or have names ending in `Test.kt`, `Tests.kt`, or `Spec.kt`.
- Dart/Flutter tests commonly live under `test/` or `integration_test/` and often use `_test.dart` filenames.
- JVM/Android package paths under `src/main/kotlin` or `src/main/java` should not be misclassified just because a package segment is named `sample`, `samples`, or `tools`.

Add scanner tests in [tests/core/scanner.test.ts](../tests/core/scanner.test.ts).

### 3. Create An Extractor

Add a file under `src/core/extractors/<language>.ts`.

The extractor receives a `SourceFile` and returns:

```ts
{
  file,
  symbols,
  chunks,
  edges
}
```

Start with the smallest useful map:

- A file/module symbol for the whole file.
- Top-level classes/functions/declarations.
- Methods inside classes or objects.
- Chunks for every symbol.
- Container edges from file to symbols and parent symbols to children.
- Import edges.
- Call-name edges when cheap and useful.
- Conformance/inheritance edges when the language has interfaces, protocols, traits, or base classes.

Line-based extraction is acceptable when it is robust enough for the benchmark target. Use structured parsers when the repo already has a dependency or the syntax is too hard to scan safely. Python currently uses Tree-sitter; many other languages use deterministic line-based extraction.

### 4. Emit Useful Qualified Names

Qualified names are the addresses agents use.

Good names:

- `package.module.Class.method`
- `com.acme.checkout.CheckoutViewModel.refresh`
- `gradle.plugin.kotlin_multiplatform`
- `maven.project.kotlin_maven_plugin`

Avoid names that are too generic to rank well, such as only `refresh` or only `plugin`, unless the language genuinely lacks namespace context.

### 5. Add Chunks And Evidence

Chunks are the text that FTS searches and compact output cites. Keep chunks:

- bounded to the symbol or declaration
- large enough to show useful evidence
- small enough to avoid noisy context

For large declarations, use the declaration body range when available. For structured files such as TOML/XML, a small block around the relevant declaration is usually better than the whole file.

### 6. Add Edges

Edges make follow-up navigation possible.

Use these existing edge kinds where possible:

- `file_contains_symbol`: file/module owns a symbol.
- `symbol_contains_symbol`: class/module owns a child symbol.
- `symbol_imports_module`: symbol or file imports a module.
- `symbol_calls_name`: symbol mentions or calls a target name.
- `symbol_conforms_to`: class/object/protocol/type conforms to or extends another named type.

Use `confidence: "exact"` when the target name is fully resolved inside the file. Use `confidence: "name"` when it is a name-only relationship that may resolve later.

### 7. Wire The Indexer

Edit [src/core/indexer.ts](../src/core/indexer.ts):

- Import the extractor.
- Dispatch based on `file.language`.
- Add any cross-file resolution if needed after all symbols are written.

The indexer writes:

- `files`
- `symbols`
- `chunks`
- `edges`
- `chunk_fts`

If the language creates useful conformance or implementation relationships, check whether the generic cross-file conformance logic already handles it before adding special code.

### 8. Improve Ranking Only After Evidence

Do not add ranking rules preemptively. First create a failing query/navigation test or real benchmark miss.

Ranking changes usually belong in:

- [src/core/query.ts](../src/core/query.ts) for symbol-level retrieval.
- [src/core/file-clusters.ts](../src/core/file-clusters.ts) for file-level retrieval.
- [src/core/source-tests.ts](../src/core/source-tests.ts) or [src/core/related-tests.ts](../src/core/related-tests.ts) for source/test navigation.

For source/test navigation, check ecosystem import aliases as well as file names. Dart package imports such as `package:app/src/foo.dart` should normalize to source paths such as `lib/src/foo.dart`; otherwise related-test scoring can see text mentions and calls but miss import evidence.

Good ranking rules are narrow and explainable. They should add `why` reasons that help debug results, such as `Kotlin navigation signal match`, `build tool ownership match`, or `path hint match`.

### 9. Add Tests

Add tests at the right level:

- Extractor tests: `tests/core/<language>-extractor.test.ts`
- Scanner tests: `tests/core/scanner.test.ts`
- Indexer tests: `tests/core/indexer.test.ts`
- Query tests: `tests/core/query.test.ts`
- File-cluster tests: `tests/core/file-clusters.test.ts`
- Source/test tests: `tests/core/source-tests.test.ts` or `tests/core/related-tests.test.ts`
- Navigation-suite tests: `tests/core/navigation-suite.test.ts`

Run:

```bash
npm test
npm run build
```

For focused work, run the smallest relevant test file first, then the full suite before committing.

### 10. Add Real-World Benchmarks

First-class support needs real repositories, not just fixtures.

Add navigation cases under `benchmarks/navigation/` and register them in `benchmarks/navigation/suite.json`.

Good benchmark cases are tasks agents really ask:

- "Where is this ViewModel tested?"
- "What implements this interface?"
- "Which extension function is being called?"
- "Where does this suspend/Flow path go?"
- "Which module owns this API?"
- "What build target wires this together?"

Each case should include:

- `agentIndexSteps`
- broad `rgQueries`
- an explicit optimized `rgOptimizedPlan`
- `expected.files` and `expected.symbols`
- `requiredFiles` and `requiredSymbols` for task completion

See [docs/navigation-eval.md](navigation-eval.md) for the fixture format.

### 11. Run And Record Findings

Run a slice with local repos and saved artifacts:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /path/to/repos \
  --index-root /tmp/agent-index-indexes \
  --artifacts-dir /tmp/agent-index-artifacts \
  --repo <suite-entry-name> \
  --reindex \
  --repos
```

For repeated runs against existing indexes, omit `--reindex`.

Document real results under `docs/findings/`. Include:

- command
- repository and URL
- indexed file/symbol/edge counts when available
- case id and task
- completion/context/latency/win metrics
- any benchmark corrections made because upstream repository layout changed

Do not hide misses. A miss is useful evidence for the next extractor, scanner, ranking, or benchmark-fairness fix.

## Common Pitfalls

- Treating docs/examples/tools as source by accident, or treating real source package paths as examples/tools.
- Emitting symbols without chunks, which makes them hard to retrieve.
- Emitting chunks without stable symbol names, which weakens graph expansion.
- Overusing generic call-name edges that add noise.
- Adding ranking rules without a failing test or benchmark artifact.
- Making benchmark expectations easier instead of making retrieval better or correcting stale paths.
- Letting optimized `rg` cheat with expected file paths in behavior-only cases.

## A Practical Order Of Work

1. Add suffix and scanner role support.
2. Add a minimal extractor that emits file/module symbols and top-level declarations.
3. Add extractor and indexer tests.
4. Index a real repository and inspect symbols with SQLite or `agent-index query`.
5. Add hierarchy/import/call/conformance edges.
6. Add query tests for real agent tasks.
7. Add source/test navigation if the ecosystem needs it.
8. Add real navigation benchmarks.
9. Tune ranking based on benchmark misses.
10. Document results.

That order keeps the work honest. The extractor creates the map, the query tests prove individual routes, and the navigation suite proves the map helps agents travel with less context than `rg`.
