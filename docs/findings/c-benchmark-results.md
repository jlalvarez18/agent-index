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
