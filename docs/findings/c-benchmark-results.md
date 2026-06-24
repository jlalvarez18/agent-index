# C Benchmark Results

Date: 2026-06-17

## Scope

This note tracks the first C language slice:

- `redis-c`: Redis dictionary resize/rehash navigation through `src/dict.c` and `src/dict.h`.
- `sqlite-c`: SQLite B-tree cursor and insert navigation through `src/btree.c` and `src/btree.h`.
- `curl-c`: curl HTTP request setup/completion navigation through `lib/http.c` and `lib/http.h`.

The fixtures are registered in `benchmarks/navigation/suite.json` with repository URLs.

## Verification In This Workspace

The focused C unit and workflow tests passed:

```bash
npm test -- tests/core/c-extractor.test.ts
npm test -- tests/core/scanner.test.ts --testNamePattern "classifies file roles|scan mixed"
npm test -- tests/core/indexer.test.ts --testNamePattern "indexes C source"
npm test -- tests/core/query.test.ts --testNamePattern "C implementation"
npm test -- tests/core/related-tests.test.ts --testNamePattern "C source files"
```

Coverage added by those checks:

- `.c` and plain C `.h` scanner support, with C++-looking headers left to the C++ language path.
- C extraction for includes, macros, typedefs, structs/enums/unions, functions, prototypes, call-name edges, and Make/CMake/Meson ownership symbols.
- SQLite indexing for C source, headers, C tests, and Makefile ownership.
- Hybrid query ranking for C implementation functions.
- Related-test discovery through C header includes, direct call names, source stems, and task terms.

## Benchmark Command

The real-repo slice command was:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-c-indexes \
  --artifacts-dir /tmp/agent-index-c-artifacts \
  --repo redis-c \
  --repo sqlite-c \
  --repo curl-c \
  --reindex \
  --repos
```

## Results

| Suite entry | Files | Symbols | agent-index completion | broad rg completion | optimized rg completion | agent tokens | broad rg tokens | optimized rg tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `redis-c` | 1,305 | 19,716 | 1.00 | 1.00 | 0.00 | 500 | 285,811 | 2,857 |
| `sqlite-c` | 457 | 19,503 | 1.00 | 1.00 | 1.00 | 488 | 348,258 | 3,350 |
| `curl-c` | 1,067 | 14,712 | 1.00 | 1.00 | 0.00 | 517 | 518,711 | 3,754 |

Aggregate result:

- agent-index completion: 1.00
- broad `rg` completion: 1.00
- optimized `rg` completion: 0.33
- agent-index average context: 502 tokens
- broad `rg` average context: 384,260 tokens
- optimized `rg` average context: 3,320 tokens
- wins: agent-index 3, broad `rg` 0, optimized `rg` 0

Misses fixed during the run:

- SQLite upstream no longer has `sqlite3BtreeMovetoUnpacked`; the benchmark now uses the current `sqlite3BtreeIndexMoveto` and `sqlite3BtreeTableMoveto` APIs.
- The C extractor now captures multi-line public C function definitions such as SQLite's `sqlite3BtreeIndexMoveto`.
- Hybrid query now adds exact code-shaped symbol candidates, so explicit C API terms such as `Curl_http` are not crowded out by earlier prefix matches.

## Quality-Bar Update: 2026-06-23

The C slice now includes an authored tool-use expectation on the realistic bugfix fixture `curl-http-request-c`. The case requires an agent-index-first workflow, a first useful result by command 1, completion by command 2, first-useful context under 800 tokens, and completion context under 900 tokens.

Updated fixture:

- `benchmarks/navigation/curl-http-request-c.json`

Focused validation command:

```bash
node /Users/juan/Repos/agent-index/dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-c-evidence-indexes \
  --artifacts-dir /tmp/agent-index-c-evidence-artifacts \
  --repo curl-c \
  --reindex \
  --repos
```

Result:

| Suite entry | Tool-use cases | Tool-use satisfied | First useful command | Completion command | First useful tokens | Completion tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `curl-c` | 1 | 1.00 | 1 | 2 | 290 | 519 |

The focused curl run still completed with agent-index and beat broad and optimized `rg` on context:

- agent-index completion: 1.00
- broad `rg` completion: 1.00
- optimized `rg` completion: 0.00
- agent-index context: 519 tokens
- broad `rg` context: 518,711 tokens
- optimized `rg` context: 3,748 tokens

The full C slice was also rerun with `--repo redis-c --repo sqlite-c --repo curl-c`. All three agent-index workflows completed, agent-index won all three cases against broad and optimized `rg`, and the aggregate tool-use satisfied rate was 1.00 for the single curl tool-use case.

## Source/Test Discovery Check

I probed curl test discovery before adding a source/test step to the fixture:

```bash
node /Users/juan/Repos/agent-index/dist/cli.js related-tests \
  --target /Users/juan/Repos/curl \
  --index-path /tmp/agent-index-c-evidence-curl.sqlite \
  --source lib/http.c \
  --symbol Curl_http \
  --term request \
  --term headers \
  --term body \
  --limit 8
```

The command returned HTTP integration tests such as `tests/http/test_07_upload.py` and `tests/http/test_01_basic.py`, but the signal was broad across many HTTP behavior tests rather than a tight source-to-test route for `Curl_http`. I did not add `related-tests` to the curl fixture because it would make the benchmark look more precise than the current C/curl test topology supports. The existing unit test coverage still verifies the C related-test heuristic on a representative C source/header/test layout.

## Live-Agent C Trial

A worker subagent performed a live C bugfix trial in a small representative fixture at `/tmp/agent-index-c-live-trial`.

Task:

- Fix `cache_lookup` so a missing key returns `NULL` instead of an existing entry.

Setup:

- Prebuilt index: `/tmp/agent-index-c-live-trial/index.sqlite`
- Verification command: `cc -Iinclude src/cache.c tests/test_cache_lookup.c -o /tmp/agent-index-c-live-trial/cache_test && /tmp/agent-index-c-live-trial/cache_test`
- Initial failure: `test_cache_lookup_missing_key` asserted `cache_lookup(&first, "missing") == 0`.

Observed agent behavior:

- First navigation tool: agent-index.
- First useful hit: `cache_lookup` in `src/cache.c`.
- Files inspected: `src/cache.c`, `include/cache.h`, and `tests/test_cache_lookup.c`.
- Files edited: `src/cache.c`.
- Broad `rg` fallback: none.

The subagent changed the cache-miss path from returning `head` to returning `NULL`. Independent verification after the subagent completed passed with exit code 0.

This live trial is intentionally smaller than the Redis, SQLite, and curl real-repo navigation benchmarks above. It proves that an autonomous worker chose agent-index first for a C bugfix loop with source and test files available, but it does not replace mature-repo C coding evidence.

## Dogfood Notes

For this update, I dogfooded agent-index on the `agent-index` repository itself:

```bash
node /Users/juan/Repos/agent-index/dist/cli.js index \
  /Users/juan/.codex/worktrees/c8cd/agent-index \
  --index-path /tmp/agent-index-self-c-evidence.sqlite

node /Users/juan/Repos/agent-index/dist/cli.js query \
  --target /Users/juan/.codex/worktrees/c8cd/agent-index \
  --index-path /tmp/agent-index-self-c-evidence.sqlite \
  --mode hybrid \
  --term agentToolUse \
  --term curl \
  --term http \
  --term navigation \
  --role benchmark \
  --role docs \
  --limit 8
```

The first useful implementation/doc hit was `benchmarks/navigation/curl-http-request-c.json`. Exact `rg` remained useful for line-level checks and for finding all existing `related-tests` and `agentToolUse` examples.
