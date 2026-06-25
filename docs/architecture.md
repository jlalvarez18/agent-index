# Architecture

This document explains how `agent-index` is organized and how data moves through the system.

## Goal

`agent-index` gives coding agents a compact, symbol-first map of a local repository. It is not an LLM and does not try to infer intent by itself. The agent supplies code-shaped query terms and constraints; `agent-index` returns ranked files, symbols, line ranges, short evidence, and nearby graph relationships.

The product bet is simple: for many coding tasks, a compact code map beats raw matching lines. Broad `rg` is still a baseline, but it can force an agent to read thousands or millions of tokens before reaching the edit location.

## High-Level Flow

```text
target repo
  |
  v
scanner.ts
  discovers files, assigns language + role
  |
  v
extractors/*
  produce symbols, chunks, and edges
  |
  v
indexer.ts
  writes SQLite tables + FTS index, resolves cross-file edges
  |
  v
query/file-clusters/source-tests/related-tests
  retrieve compact navigation context
  |
  v
navigation-eval/navigation-suite
  compare agent-index workflows with broad and optimized rg
```

## Core Data Model

The shared types live in [src/core/schema.ts](../src/core/schema.ts).

- `SourceFile`: absolute path, repo-relative path, language, file role, and text.
- `CodeSymbol`: a named code object such as a module, class, function, method, or type alias.
- `CodeChunk`: searchable text tied to a file and optionally to a symbol.
- `CodeEdge`: a relationship such as file contains symbol, symbol contains symbol, imports module, calls name, or conforms to another symbol.
- `AgentQuery`: structured query terms, symbol kinds, path hints, roles, expansion settings, and limits.

SQLite tables are created in [src/core/indexer.ts](../src/core/indexer.ts):

- `files`: one row per scanned file with language and role.
- `symbols`: extracted symbols and parent relationships.
- `chunks`: searchable text ranges.
- `edges`: symbol and name relationships.
- `chunk_fts`: FTS5 index over chunk text, symbol names, and file paths.

## Scanner

[src/core/scanner.ts](../src/core/scanner.ts) recursively scans the target repository.

Responsibilities:

- Ignore generated or dependency-heavy directories such as `.git`, `node_modules`, `dist`, `build`, `.codeindex`, and caches.
- Map file suffixes to `Language`.
- Assign file roles: `source`, `test`, `docs`, `example`, `fixture`, `tool`, or `benchmark`.
- Respect `includeSupportCode`; source-only indexes skip tests, docs, tools, examples, fixtures, samples, and benchmark directories.

Role classification matters because agent queries often use `--role source` for implementation and `--role test` for test discovery. Language-specific layouts sometimes need special handling. For example, Android/Kotlin source packages can contain path segments like `samples`; those are package names under `src/main/kotlin`, not examples.

## Extractors

Extractors live in [src/core/extractors](../src/core/extractors).

Each extractor returns an `ExtractionResult`:

```ts
interface ExtractionResult {
  file: SourceFile;
  symbols: CodeSymbol[];
  chunks: CodeChunk[];
  edges: CodeEdge[];
}
```

Current extractors include:

- Python via Tree-sitter.
- Line-based source extraction for Go, Rust, Cython, C, C++, TypeScript/JavaScript, Dart, Swift, Kotlin, Java, Ruby, PHP, and C#.
- Structured build/config extraction for JSON, XML, TOML, and YAML.

Language support is not all the same shape:

- First-class or active first-class tracks have scanner support, extractor dispatch, role detection, tests, and real-repo navigation coverage. Current tracks include Python, TypeScript/JavaScript, Go, Rust, Cython, Swift, Kotlin, Java, Ruby, PHP, C#, C, C++, and Dart.
- Dart has Dart/Flutter extraction, fixture-backed Flutter navigation coverage, a public `json_serializable.dart` real-repository benchmark, and a live agent-style trial. Larger Flutter application benchmarks remain useful future evidence if Flutter-specific ranking grows beyond ordinary Dart symbols and widget `build` methods.
- Config/build-file support is intentionally narrower. JSON, XML, TOML, and YAML extract ownership and wiring signals for package/build/service metadata; they are not full document-semantic parsers.
- Most non-Python extractors are deterministic and line-based. First-class support means useful navigation for common agent tasks, not complete compiler semantics.

Extractor output should be stable and compact. A good extractor does not need to fully compile the language. It should capture the code objects agents navigate to and enough edges to orient follow-up queries.

Common symbol patterns:

- File/module symbol for the whole file.
- Class/object/interface symbols.
- Function and method symbols.
- Build metadata symbols such as `gradle.plugin.kotlin_multiplatform`, `gradle.sourceSet.commonMain`, or `maven.project.kotlin_maven_plugin`.

Common edge patterns:

- `file_contains_symbol` from a module/file symbol to contained symbols.
- `symbol_contains_symbol` from class/module to methods or nested declarations.
- `symbol_imports_module` for import statements.
- `symbol_calls_name` for call-like names or structured metadata references.
- `symbol_conforms_to` for inheritance, protocol/interface implementation, or similar hierarchy relationships.

## Indexer

[src/core/indexer.ts](../src/core/indexer.ts) coordinates indexing.

Responsibilities:

- Validate the target directory.
- Create the output SQLite database.
- Call `scanCodeFiles`.
- Dispatch each `SourceFile` to the right extractor.
- Insert files, symbols, chunks, FTS rows, and edges.
- Resolve intra-file parent relationships.
- Resolve some cross-file conformance/implementation relationships after all symbols are written.

The default index path is:

```text
<target>/.codeindex/index.sqlite
```

Use `--index-path` for benchmark runs and temporary indexes so evaluated repositories stay clean.

## Query Pipeline

[src/core/query.ts](../src/core/query.ts) powers `agent-index query`.

The query path has four broad phases:

1. Build query text from `AgentQuery.terms`.
2. Retrieve candidates from FTS, intent rules, and exact path-hint candidate seeding.
3. Apply structured filters such as `symbolKinds`, `roles`, and source-only constraints.
4. Score, sort, deduplicate, and expand graph neighbors.

Modes:

- `symbol`: rank symbol/chunk candidates with scoring rules.
- `fts`: return plain lexical FTS results.
- `hybrid`: combine lexical retrieval with symbol-aware scoring and hybrid adjustments.

Ranking is intentionally pragmatic. It includes generic rules plus domain-specific signals for common agent tasks: owner/name matches, exact symbol matches, file context, build metadata, Kotlin coroutine/Flow clues, extension functions, DI annotations, and path hints.

Path hints are normally soft ranking signals. Exact file path hints also seed candidates so a precise known file is not lost behind a noisy FTS cap. Use `pathMode: "filter"` only when the path should be a hard constraint.

## File Clusters

[src/core/file-clusters.ts](../src/core/file-clusters.ts) returns file-level summaries instead of individual symbols.

Use it when an agent needs a cheap map of likely files before choosing a precise symbol. It groups matching chunks by file, reports representative symbols, reasons, compact evidence, and approximate context cost.

## Source And Test Navigation

[src/core/source-tests.ts](../src/core/source-tests.ts) and [src/core/related-tests.ts](../src/core/related-tests.ts) help agents move between implementation and tests.

- `source-tests` finds source/test bundles from structured query terms.
- `related-tests` starts from a known source file or prior step output and ranks likely test files using path tokens, imports, call names, symbols, and task terms.

These tools are intentionally heuristic. The benchmark suite is the guardrail for whether the heuristics are useful in real workflows.

## Navigation Benchmarks

Navigation evaluation lives in:

- [src/core/navigation-eval.ts](../src/core/navigation-eval.ts)
- [src/core/navigation-suite.ts](../src/core/navigation-suite.ts)
- [docs/navigation-eval.md](navigation-eval.md)
- `benchmarks/navigation/*.json`

Navigation benchmarks model a workflow, not just a one-shot query. Each case can run multiple `agent-index` steps, broad `rg`, and optimized multi-step `rg`. The output compares:

- completion rate
- first useful result
- commands
- latency
- context tokens
- wins/losses against baselines

Use findings docs under [docs/findings](findings) to record real benchmark runs and corrections made while adapting fixtures to current upstream repositories.

## CLI Surface

The public CLI is defined in [src/cli.ts](../src/cli.ts). Important commands:

- `index`: build a SQLite index.
- `query`: retrieve ranked symbols/chunks.
- `file-clusters`: retrieve file-level navigation summaries.
- `source-tests`: find source/test bundles.
- `related-tests`: find tests related to known source files.
- `benchmark`: run single-query benchmark cases.
- `nav-eval`: run one navigation workflow file.
- `nav-suite`: run a multi-repo navigation suite.
- `nav-compare`: compare saved navigation artifacts.

## Design Trade-Offs

- Deterministic retrieval over semantic embeddings. This keeps the prototype local and inspectable.
- Compact code objects over raw matching lines. The agent should read less before acting.
- Lightweight extractors over full compiler integration. First-class support means useful navigation, not complete language semantics.
- Real benchmarks over synthetic confidence. If a fixture is stale, fix it against the current real repository and document the correction.
