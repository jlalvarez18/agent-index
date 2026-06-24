# agent-index

`agent-index` is a TypeScript/Node prototype for local, symbol-first code search by LLM agents.

The v1 scope is intentionally narrow: Python files are scanned with Tree-sitter, while Go, Rust, Cython, C, C++, TypeScript/JavaScript, Dart, Swift, Kotlin, Java, Ruby, PHP, and C# use deterministic line-based extraction. JSON, XML, TOML, and YAML are indexed for structured build/config metadata rather than arbitrary document understanding. Results are stored in a local SQLite/FTS5 index, queried with lexical, symbol, or hybrid ranking, and evaluated with golden benchmark cases. The product model is that the LLM translates user intent into explicit search terms and constraints; `agent-index` is the fast code map, not an embedded LLM.

Think of it as a library catalog for code. Plain text search finds pages with matching words; `agent-index` tries to return the function, class, file, and nearby code relationships that make those pages useful to a coding agent.

## Status

Prototype, dogfood stage.

Current benchmark shape, using hybrid mode:

| Corpus | Questions | Symbol Hit@1 | Symbol Hit@5 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Graphify v8 | 10 | 1.00 | 1.00 | 1.00 | 78ms |
| HTTPX | 13 | 1.00 | 1.00 | 1.00 | 24ms |
| Click | 14 | 1.00 | 1.00 | 1.00 | 31ms |
| Rich | 12 | 1.00 | 1.00 | 1.00 | 46ms |
| Pytest | 16 | 1.00 | 1.00 | 1.00 | 52ms |
| FastAPI | 12 | 1.00 | 1.00 | 1.00 | 38ms |
| Pydantic | 14 | 1.00 | 1.00 | 1.00 | 65ms |
| Poetry | 12 | 1.00 | 1.00 | 1.00 | 53ms |
| NetworkX | 14 | 1.00 | 1.00 | 1.00 | 80ms |
| NetworkX adversarial | 13 | 1.00 | 1.00 | 1.00 | 84ms |
| SQLAlchemy | 16 | 1.00 | 1.00 | 1.00 | 247ms |
| SQLAlchemy adversarial | 13 | 1.00 | 1.00 | 1.00 | 247ms |
| Scikit-learn | 16 | 1.00 | 1.00 | 1.00 | 220ms |
| Scikit-learn adversarial | 13 | 1.00 | 1.00 | 1.00 | 201ms |
| Django | 16 | 1.00 | 1.00 | 1.00 | 250ms |
| Django adversarial | 16 | 1.00 | 1.00 | 1.00 | 246ms |
| Celery | 16 | 1.00 | 1.00 | 1.00 | 46ms |

These numbers are useful, but not final product claims. The current golden sets are small, answer keys were source-audited, and ranking still uses hand-built query-intent rules. The current corpus suite is now saturated, which is good dogfood evidence but weak discovery pressure. The next retrieval evidence should come from a harder golden set or another larger corpus.

Structured agent-query checks compare `agent-index` against an rg-style file baseline over the same agent-supplied terms. The benchmark command can also run a real `rg` command baseline with `--baseline command` and report approximate context-token payloads for both sides.

| Corpus | Questions | agent-index Symbol Hit@1 | agent-index File Hit@1 | rg-style File Hit@1 | rg-style File Hit@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Graphify v8 | 10 | 1.00 | 1.00 | 0.20 | 0.80 |
| HTTPX | 13 | 1.00 | 1.00 | 0.31 | 1.00 |
| Click | 14 | 1.00 | 1.00 | 0.64 | 1.00 |
| Rich | 12 | 1.00 | 1.00 | 0.58 | 0.92 |
| Pytest | 16 | 1.00 | 1.00 | 0.81 | 1.00 |
| FastAPI | 12 | 1.00 | 1.00 | 0.67 | 0.92 |
| Pydantic | 14 | 1.00 | 1.00 | 0.14 | 0.79 |
| Poetry | 12 | 1.00 | 1.00 | 0.33 | 0.75 |
| NetworkX | 14 | 1.00 | 1.00 | 0.57 | 0.86 |
| SQLAlchemy | 16 | 1.00 | 1.00 | 0.31 | 0.69 |
| Scikit-learn | 16 | 1.00 | 1.00 | 0.69 | 1.00 |
| Django | 16 | 1.00 | 1.00 | 0.44 | 0.81 |
| Django adversarial | 16 | 1.00 | 1.00 | 0.38 | 0.69 |
| Celery | 16 | 1.00 | 1.00 | 0.31 | 0.88 |
| Celery adversarial | 16 | 1.00 | 1.00 | 0.44 | 0.88 |
| Black | 12 | 1.00 | 1.00 | 0.50 | 0.92 |
| Jinja | 12 | 1.00 | 1.00 | 0.42 | 0.75 |
| attrs | 10 | 1.00 | 1.00 | 0.40 | 1.00 |
| h11 | 12 | 1.00 | 1.00 | 0.58 | 1.00 |
| wsproto | 12 | 1.00 | 1.00 | 0.67 | 1.00 |
| Trio | 18 | 1.00 | 1.00 | 0.67 | 1.00 |
| urllib3 | 12 | 1.00 | 1.00 | 0.58 | 0.92 |

## Install

```bash
npm install
npm run build
```

After building, the package bin points at:

```text
dist/cli.js
```

The npm package allowlist includes the built CLI, benchmark JSON files, docs, and this README. Check it with:

```bash
npm pack --dry-run
```

If the local npm cache has permission problems, use a temp cache:

```bash
npm pack --dry-run --cache /tmp/agent-index-npm-cache
```

You can run the development CLI with:

```bash
npm run agent-index -- --help
```

Or run the built CLI directly:

```bash
node dist/cli.js --help
```

## Index A Repo

```bash
npm run agent-index -- index /path/to/python/repo --source-only
```

By default, the index is written to:

```text
<target>/.codeindex/index.sqlite
```

Use `--index-path /path/to/index.sqlite` with `index`, `query`, and `benchmark` when the index should live outside the target tree.

`--source-only` skips common support directories such as tests, testing, docs, tools, examples, fixtures, samples, and worked corpora. That is the recommended mode for benchmark-style source retrieval.

All-files indexes store a file role for every indexed code file: `source`, `test`, `docs`, `example`, `fixture`, `tool`, or `benchmark`. Use `--role` at query time when you want an exact category filter.

The success message includes the index mode, for example `(mode: source-only)`, so benchmark notes can record how the index was built.

## Query

For coding agents, the easiest first move is often task mode. It translates a
task kind plus a natural task into a compact workflow over existing query,
file-cluster, source-test, and related-test primitives:

```bash
npm run agent-index -- task bugfix "NO_COLOR should disable color by default" \
  --target /path/to/python/repo \
  --index-path /tmp/index.sqlite \
  --format compact
```

Available presets:

- `bugfix`: source map -> likely implementation symbols/files -> related tests.
- `feature`: source map -> nearby APIs/components -> likely tests/examples.
- `explain`: source map -> core symbols/files with callers, callees, imports, and parent context.
- `find-tests`: source/test relation discovery from a behavior or API clue.
- `source-to-tests`: direct related-test lookup from a known `--source` file.

Task mode still accepts structured refinements such as `--term`, `--kind`,
`--path`, `--role`, `--expand`, `--limit`, and `--test-limit`. Use
`--format json` when benchmark tooling needs to inspect the generated
underlying steps.

```bash
npm run agent-index -- task find-tests "CheckoutController submit" \
  --target /path/to/flutter_shop \
  --term CheckoutController \
  --test-limit 3

npm run agent-index -- task source-to-tests \
  --target /path/to/flutter_shop \
  --source lib/src/checkout/checkout_controller.dart \
  --term CheckoutController \
  --term submit
```

For agents, prefer shorthand structured query flags:

```bash
npm run agent-index -- query \
  --target /path/to/python/repo \
  --term webhook \
  --term signature \
  --term verify \
  --kind function \
  --kind method \
  --path webhook \
  --path auth \
  --path security \
  --expand callers \
  --expand callees \
  --role source \
  --mode hybrid
```

Comma-separated values also work:

```bash
npm run agent-index -- query \
  --target /path/to/python/repo \
  --term webhook,signature,verify \
  --kind function,method \
  --path webhook,auth,security \
  --expand callers,callees \
  --mode hybrid
```

Use `--index /path/to/index.sqlite` as a short alias for `--index-path /path/to/index.sqlite` on `query`. The `query` command also accepts `--repo` as an alias for `--target` and `--db` as an alias for `--index-path`; these are compatibility rails for agent-generated commands, while docs prefer the canonical flags.

Use `--role` when the category matters. `--path` is only a ranking hint; `--role test` is the filter that returns only test files:

```bash
npm run agent-index -- query \
  --target /path/to/python/repo \
  --term webhook \
  --term signature \
  --term verify \
  --kind function \
  --path tests \
  --role test \
  --mode hybrid
```

Short positional phrases can be refined with structured flags:

```bash
npm run agent-index -- query "webhook signature" \
  --target /path/to/python/repo \
  --path webhook \
  --kind function \
  --mode hybrid
```

The structured query flags are intentionally close to how agents already use `rg`: choose terms, constrain the search space, and ask for compact ranked code objects instead of raw matching lines.

For more examples and anti-patterns, see [Agent Query Cookbook](docs/agent-query-cookbook.md).

Agent query guidance:

- Use discriminating implementation terms the code is likely to contain, not every word from the user request.
- Prefer exact API nouns and verbs when the agent can infer them: `Path`, `convert`, `readable`, `writable` is better than broad words like `validate` and `parameter`.
- Put directory/module clues in `pathHints` instead of repeating them as vague search terms.
- Use `--path-filter` when a path clue is meant to be a hard file-path constraint, for example after a source hit reveals the likely test file or directory.
- Use `--role source` for implementation-only search on an all-files index, and `--role test` when looking for tests.
- Use `symbolKinds` to remove whole classes of noise when the task is clearly about a function, method, or class.
- Use `--exclude-support-code` for legacy edit-location searches when no explicit `--role` is provided. Do not combine it with `--role`.
- Keep free-text query mode for debugging or interactive exploration; benchmark the agent path with `--query-style agent`.

Advanced callers can still pass the full structured JSON shape:

```bash
npm run agent-index -- query \
  --target /path/to/python/repo \
  --agent-query '{"terms":["webhook","signature","verify"],"symbolKinds":["function","method"],"pathHints":["webhook","auth","security"],"roles":["source"],"expand":["callers","callees"],"limit":10}' \
  --mode hybrid
```

Free-text lexical query remains available for debugging and human convenience:

```bash
npm run agent-index -- query "where is the command entrypoint handled?" --target /path/to/python/repo
```

The query command returns JSON with ranked matches, line ranges, scores, reasons, and nearby graph context. Agents should prefer compact output for first-pass navigation, then use full JSON only for ranking audits, integrations, or debugging:

```bash
npm run agent-index -- query "where is semantic cache loaded?" \
  --target /path/to/python/repo \
  --mode hybrid \
  --format compact
```

Compact output is designed to be decision-ready: each match includes an address, capped evidence, short reasons, at most a couple of related symbols, and the next file target to inspect. For example, the existing Flutter checkout fixture query:

```bash
node dist/cli.js query \
  --target benchmarks/fixtures/flutter_shop \
  --index-path /tmp/flutter-shop.sqlite \
  --mode hybrid \
  --term submit \
  --term authorize \
  --term paid \
  --term failed \
  --term notifyListeners \
  --kind method \
  --kind function \
  --role source \
  --path lib/src/checkout \
  --expand parents \
  --expand callees \
  --limit 3 \
  --format compact
```

Returns output shaped like:

```text
1 lib/src/checkout/checkout_controller.dart:24-41 method CheckoutController.submit evidence="notifyListeners();"
  why: symbol name match, method name match, nearby graph edge
  related: calls authorize, calls notifyListeners
  next: open lib/src/checkout/checkout_controller.dart:24
```

For that representative query, compact output was 943 bytes versus 3,431 bytes for full JSON. The JSON output is still available with `--format json`.

By default, `query` uses `symbol` mode. You can inspect the other ranking modes with:

```bash
npm run agent-index -- query "where is semantic cache loaded?" --target /path/to/python/repo --mode hybrid
npm run agent-index -- query "where is semantic cache loaded?" --target /path/to/python/repo --mode fts
```

For ranking audits, add `--debug` to include candidate source, FTS position, intent reasons, and hybrid score components in the JSON output:

```bash
npm run agent-index -- query "where is markup parsed?" --target /path/to/python/repo --mode hybrid --debug
```

## Dogfood Tracing

Record real agent navigation during feature or bug work with `--trace`:

```bash
npm run agent-index -- query "redirect history" \
  --target /path/to/python/repo \
  --index /tmp/repo-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/repo-dogfood-trace.jsonl \
  --trace-task redirect-history
```

Summarize the trace with:

```bash
npm run agent-index -- trace-report /tmp/repo-dogfood-trace.jsonl
```

See [Dogfood Tracing](docs/dogfood-tracing.md) for the JSONL event format and annotation workflow.

## Benchmark

```bash
npm run agent-index -- benchmark ./benchmarks/graphify-python.json --target /path/to/graphify --mode hybrid
```

Benchmarks can use structured agent queries from `agentQuery` fields and include an rg-style lexical file baseline over the same terms:

```bash
npm run agent-index -- benchmark ./benchmarks/graphify-python.json \
  --target /path/to/graphify \
  --mode hybrid \
  --query-style agent \
  --include-rg-baseline
```

For a real `rg` command baseline, add `--baseline command`:

```bash
npm run agent-index -- benchmark ./benchmarks/graphify-python.json \
  --target /path/to/graphify \
  --mode hybrid \
  --query-style agent \
  --include-rg-baseline \
  --baseline command
```

Benchmark output includes average context-token estimates. These are deterministic `ceil(chars / 4)` estimates of what an agent would need to read from the ranked `agent-index` matches versus baseline matched-line output.

For agent workflow comparisons, use `nav-eval`. This evaluates scripted, realistic navigation tasks as small sequences of compact `agent-index` queries versus real `rg` commands:

```bash
npm run agent-index -- nav-eval ./path/to/navigation-eval.json \
  --target /path/to/repo \
  --mode hybrid \
  --cases
```

Navigation eval reports useful-hit rate, task-completion coverage, command count, latency, and approximate context-token payload for agent-index, broad matched-line `rg`, and optional optimized rg workflows that use filename narrowing plus bounded snippets. This is the main product metric: helping agents find useful code with much less reading, not beating `rg` at raw exact-string scanning.
New navigation fixtures should use `agentIndexSteps` to model realistic workflows with `query`, `file-clusters`, and `related-tests` steps. Older `agentIndexQueries` fixtures still work as direct query steps.

To run several real repos as one benchmark suite, use a manifest:

```bash
npm run nav:prepare -- \
  --repo-root /path/to/local/repos \
  --repo swift-argument-parser \
  --repo swift-collections \
  --repo swift-nio \
  --repo swift-composable-architecture \
  --repo alamofire \
  --repo swift-package-manager \
  --repo swift

npm run nav:suite -- \
  --repo-root /path/to/local/repos \
  --index-root /tmp/agent-index-nav-suite \
  --artifacts-dir /tmp/agent-index-nav-artifacts \
  --reindex
```

`nav:prepare` clones missing repositories declared with `repoUrl` in the suite manifest and skips existing directories. The suite includes real-repo navigation entries for Python, TypeScript/JavaScript, Go, Rust, Cython, Swift, Kotlin, Java, Ruby, PHP, C#, C, and C++, plus build/config ownership cases that exercise JSON, XML, TOML, and YAML extraction. The Dart entry uses an authored Flutter-style fixture under `benchmarks/fixtures/flutter_shop` so it can run without network or cloned-repo setup; a real Dart/Flutter repository remains follow-up evidence before calling that track complete under the current language-support bar.

To fail CI when a new run regresses completion, wins, or context-token budget, compare artifact summaries:

```bash
npm run nav:compare -- /path/to/baseline-artifacts /tmp/agent-index-nav-artifacts \
  --max-agent-token-increase-percent 5 \
```

`nav:compare` always includes `--require-agent-dominance`, which fails when the current artifact no longer beats broad and optimized `rg` on task completion, case wins, and average context-token payload.

When the agent needs a low-token map before choosing a symbol, use file clusters:

```bash
npm run agent-index -- file-clusters "weighted mixing expansion" \
  --target /path/to/repo \
  --term mixing_expansion \
  --role source \
  --path algorithms/cuts.py
```

This groups matching chunks by file and returns top files with representative symbols, matched chunk counts, and compact token estimates.

After finding a likely source file, agents can ask for related tests without handcrafting a second search:

```bash
npm run agent-index -- related-tests \
  --target /path/to/repo \
  --source pkg/cache.py \
  --source pkg/cache_backend.py \
  --symbol load_value \
  --term cache \
  --term stale
```

`related-tests` uses path, symbol, import, call-name, and optional task-term evidence to keep source-to-test navigation compact. Add `--term` values when many tests import the same source module and the agent needs behavior-specific tests. Repeat or comma-separate `--source` when a map step returns several plausible implementation files; the tool scores each source candidate and returns one capped test list. In navigation fixtures, prefer `sourceFromStep` when a prior `file-clusters` or `query` step already found likely source files.

Available benchmark modes:

- `fts`: plain SQLite FTS ranking.
- `symbol`: symbol ranking plus graph expansion.
- `hybrid`: lexical recall plus symbol-aware reranking.

Use `--json` for per-question details:

```bash
npm run agent-index -- benchmark ./benchmarks/click-python.json --target /path/to/click --mode hybrid --json
```

For batch ranking audits, combine `--json` and `--debug` to include the same candidate-source and hybrid-score diagnostics that `query --debug` returns:

```bash
npm run agent-index -- benchmark ./benchmarks/django-adversarial-python.json --target /path/to/django --mode hybrid --json --debug
```

For quick triage without dumping the full JSON payload, add `--misses` to append concise top-one miss rows:

```bash
npm run agent-index -- benchmark ./benchmarks/rich-python.json --target /path/to/rich --mode hybrid --misses
```

## Graphify Comparison

`agent-eval` compares `agent-index` benchmark results with captured Graphify query text. Use `--query-style agent` when the benchmark has `agentQuery` fields:

```bash
npm run agent-index -- agent-eval ./benchmarks/urllib3-python.json \
  --target /path/to/urllib3-source-only \
  --mode hybrid \
  --query-style agent \
  --graphify-results /tmp/urllib3-graphify-query-results.json \
  --misses
```

This reports exact `agent-index` Hit@K metrics beside Graphify expected-symbol and expected-file mention rates. It does not replace Graphify's token-reduction benchmark; it answers the narrower agent-navigation question.

- [Autonomous comparison pilot](docs/autonomous-comparison.md) describes the raw agent-work trial comparing Graphify, agent-index, and no-special-tool conditions.

## Development

```bash
npm test
npm run build
git diff --check
```

The test suite covers scanner filtering, language extraction, SQLite indexing, query ranking, source-to-test discovery, benchmark metrics, CLI smoke behavior, and package build layout.

## Current Limits

- First-class or active first-class navigation tracks now cover Python, TypeScript/JavaScript, Go, Rust, Cython, Swift, Kotlin, Java, Ruby, PHP, C#, C, and C++ through extractor/indexer support plus real-repo navigation evidence.
- Dart has Dart/Flutter extraction, source/test handling, fixture-backed navigation coverage, and a live agent-style trial, but still needs a real-repository benchmark follow-up before treating the track as fully complete under the current quality bar.
- JSON, XML, TOML, and YAML support is intentionally narrower: it targets build/config ownership such as package metadata, Gradle/Cargo/Maven/Symfony service wiring, and version catalogs, not full general-purpose document semantics.
- Most non-Python extractors are line-based and dependency-light. They aim for useful navigation symbols, chunks, and edges rather than compiler-grade parsing.
- Full reindex only.
- No embeddings.
- No MCP server.
- No file watcher.
- Name-based call/import edges are approximate.
- Query-intent rules are hand-built and need broader validation.
- The benchmark corpora are local checkouts, not vendored into this repository.

## Findings

The running lab notebook lives in:

- `docs/agent-query-cookbook.md`
- `docs/findings/agent-index-process.md`
- `docs/findings/dart-first-class-support.md`
- `docs/findings/experiment-log.md`
- `docs/findings/graphify-benchmark-results.md`
- `docs/findings/httpx-benchmark-results.md`
- `docs/findings/click-benchmark-results.md`
- `docs/findings/click-no-color-dogfood.md`
- `docs/findings/rich-benchmark-results.md`
- `docs/findings/pytest-benchmark-results.md`
- `docs/findings/fastapi-benchmark-results.md`
- `docs/findings/pydantic-benchmark-results.md`
- `docs/findings/poetry-benchmark-results.md`
- `docs/findings/networkx-benchmark-results.md`
- `docs/findings/sqlalchemy-benchmark-results.md`
- `docs/findings/sklearn-benchmark-results.md`
- `docs/findings/django-benchmark-results.md`
- `docs/findings/celery-benchmark-results.md`
- `docs/findings/attrs-benchmark-results.md`
- `docs/findings/h11-benchmark-results.md`
- `docs/findings/wsproto-benchmark-results.md`
- `docs/findings/trio-benchmark-results.md`
- `docs/findings/urllib3-benchmark-results.md`
- `docs/findings/cython-first-class-support.md`
- `docs/findings/rust-benchmark-results.md`
- `docs/findings/kotlin-benchmark-results.md`
- `docs/findings/java-benchmark-results.md`
- `docs/findings/ruby-benchmark-results.md`
- `docs/findings/php-benchmark-results.md`
- `docs/findings/csharp-benchmark-results.md`
- `docs/findings/c-benchmark-results.md`
- `docs/findings/cpp-benchmark-results.md`
- `docs/findings/agent-index-readiness.md`
- `docs/findings/publishing-outline.md`
