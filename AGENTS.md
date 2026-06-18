# AGENTS.md

Guidance for coding agents working in this repository.

## Project Summary

`agent-index` is a TypeScript/Node prototype for local, symbol-first code navigation. It scans source files, extracts symbols and relationships, stores them in SQLite/FTS5, and exposes CLI workflows that help coding agents find compact, ranked code context instead of reading large `rg` result sets.

Think of it like a library catalog for code: `rg` can find pages containing words, while `agent-index` tries to return the most useful shelf, book, chapter, and nearby references.

Start with these docs:

- [README.md](README.md) for install, CLI usage, and benchmark status.
- [docs/architecture.md](docs/architecture.md) for the system architecture and data flow.
- [docs/adding-language-support.md](docs/adding-language-support.md) for the checklist to add a new language.
- [docs/agent-query-cookbook.md](docs/agent-query-cookbook.md) for query patterns agents should use.
- [docs/navigation-eval.md](docs/navigation-eval.md) for navigation benchmark design.

## Commands

Use these from the repo root.

```bash
npm install
npm run build
npm test
```

Useful development commands:

```bash
npm run agent-index -- --help
npm run agent-index -- index /path/to/repo --index-path /tmp/agent-index.sqlite
node dist/cli.js query "semantic cache" --target /path/to/repo --index-path /tmp/agent-index.sqlite --mode hybrid
npm run nav:suite -- --repo-root /path/to/repos --index-root /tmp/agent-index-indexes --artifacts-dir /tmp/agent-index-artifacts --repos
```

Before committing code changes, run:

```bash
npm test
npm run build
```

For documentation-only changes, a full test run is usually optional, but run `npm run build` if examples or public CLI references changed.

## Repository Map

- `src/cli.ts`: CLI command definitions and argument parsing.
- `src/core/schema.ts`: shared data model for files, symbols, chunks, edges, queries, and benchmarks.
- `src/core/scanner.ts`: recursive file discovery, suffix-to-language mapping, and file role classification.
- `src/core/extractors/`: language and structured-file extractors.
- `src/core/indexer.ts`: SQLite schema creation, extractor dispatch, chunk/FTS writing, and cross-file edge resolution.
- `src/core/query.ts`: query execution, candidate retrieval, graph expansion, and ranking.
- `src/core/file-clusters.ts`: file-level navigation summaries.
- `src/core/source-tests.ts` and `src/core/related-tests.ts`: source/test navigation helpers.
- `src/core/navigation-eval.ts` and `src/core/navigation-suite.ts`: workflow benchmarks against broad and optimized `rg`.
- `benchmarks/`: benchmark fixtures and navigation suite entries.
- `docs/findings/`: benchmark results and dogfood notes.
- `tests/core/`: unit and workflow tests.

## Engineering Rules

- Prefer small, focused changes that match existing local patterns.
- Dogfood agent-index when navigating this repository. For non-trivial codebase exploration, especially first-class language work, load/use the `using-agent-index` workflow before falling back to broad `rg`. Use `rg` for exact text checks, quick file listing, or when agent-index lacks coverage, but do not let `rg` replace the product's own navigation loop.
- Keep extractors deterministic and dependency-light. Most non-Python extractors are line-based by design.
- Update tests with behavior changes. Add extractor tests for syntax extraction, indexer tests for storage/edges, and query/navigation tests for ranking behavior.
- Do not weaken benchmark expectations to make a result pass. If a real repo changed, update the fixture to match the current repo and document the correction.
- Keep benchmark queries fair: no exact expected-file leakage in behavior-only cases, and model optimized `rg` as a realistic multi-step workflow.
- For every first-class language addition or material language-support update, include both navigation workflow coverage and an end-to-end agent-use check when practical:
  - Authored workflow evals with `agentToolUse` expectations measure whether a scripted agent-index workflow reaches useful context quickly. They are valuable, but they do not prove an autonomous agent will choose agent-index.
  - A live-agent or subagent coding trial should give an agent a realistic bugfix or feature task in a real or representative repo, make agent-index available, and record whether the agent actually calls agent-index before broad search/editing. Capture first tool used, time/context to first useful file, files inspected, files edited, tests run, outcome, and where `rg` was still needed.
- Do not commit generated local indexes, temporary benchmark artifacts, or cloned benchmark repositories.

## Adding Language Support

Use [docs/adding-language-support.md](docs/adding-language-support.md). The short version:

1. Extend `Language` in [src/core/schema.ts](src/core/schema.ts).
2. Add suffix and role handling in [src/core/scanner.ts](src/core/scanner.ts).
3. Add an extractor under `src/core/extractors/`.
4. Dispatch it from [src/core/indexer.ts](src/core/indexer.ts).
5. Add extractor, scanner, indexer, query, and navigation tests.
6. Add at least one real-world benchmark if the language is meant to be first-class.
7. Add a dogfood note or findings entry describing how agent-index was used during the implementation itself, including any places where `rg` was still necessary.
8. Add at least one bugfix or feature-style authored workflow eval with `agentToolUse` expectations, ideally on a real repository. This records first-useful latency, completion latency, first-useful context, and completion context for a scripted agent-index workflow.
9. Run and document at least one live-agent or subagent coding trial for the language when practical. The trial should start from only a bugfix or feature request, not a prewritten agent-index query plan, and should report whether the agent chose agent-index before broad `rg`, what it found, what it edited, and whether verification passed.
10. Document benchmark results and live-agent findings under `docs/findings/`.

## Query And Benchmark Guidance

Agent-facing retrieval should usually use structured queries:

```bash
node dist/cli.js query \
  --target /path/to/repo \
  --mode hybrid \
  --term ViewModel \
  --term StateFlow \
  --kind class \
  --kind method \
  --path feature/foryou \
  --role source \
  --expand callers \
  --expand callees
```

Use:

- `terms` for code-shaped clues such as symbols, constants, API names, or distinctive behavior words.
- `pathHints` for directory/module/file clues.
- `roles` for hard source/test/docs/example/tool/benchmark filtering.
- `pathMode: "filter"` or `--path-filter` only when the path clue must be a hard constraint.
- `expand` for nearby graph context, not as a substitute for good terms.

See [docs/agent-query-cookbook.md](docs/agent-query-cookbook.md) for more examples.

## Git Hygiene

- The worktree may already contain user changes. Do not revert changes you did not make.
- Check `git status --short` before staging.
- Stage related changes together. Keep docs, implementation, and benchmark-result commits coherent.
- Avoid destructive git commands unless the user explicitly asks for them.

## Current Quality Bar

The project has first-class tracks for multiple languages and evaluates them with real repositories. New first-class language work should meet the same standard: extraction coverage, ranking behavior, source-to-test navigation, and real-world navigation benchmarks showing materially lower context than broad or optimized `rg`.
