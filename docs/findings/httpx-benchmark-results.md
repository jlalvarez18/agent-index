# HTTPX Benchmark Results

## Current Status

HTTPX was cloned as the second benchmark corpus at `/Users/juan/Repos/httpx`.

Repository: `https://github.com/encode/httpx`

## Why HTTPX

HTTPX is a good cross-check because it is a different kind of Python project than Graphify. It is a library with sync and async APIs, transports, authentication, response models, URL handling, content encoding, and a small CLI. That gives the index a different shape to search.

## Benchmark Setup

Index command:

```bash
npm run agent-index -- index /Users/juan/Repos/httpx --source-only
```

Index summary:

```text
Indexed 23 files, 544 symbols, 544 chunks, 1851 edges at /Users/juan/Repos/httpx/.codeindex/index.sqlite
```

Benchmark command:

```bash
npm run agent-index -- benchmark ./benchmarks/httpx-python.json --target /Users/juan/Repos/httpx --mode <fts|symbol|hybrid>
```

The audited golden set contains 13 questions covering CLI entrypoint, top-level request API, sync and async clients, redirects, basic auth, timeout config, proxy routing, ASGI/WSGI transports, response helpers, and multipart encoding.

## Truth-Set Audit

Run date: 2026-06-12

The first HTTPX baseline had 12 questions. Two prompts needed cleanup before ranking work:

- `top-level-request-api` expected `httpx/_api.py::request`, but the wording "send a request" also matched lower-level transport handling. It now asks where the module-level `httpx.request` convenience function is defined.
- `response-json-status` asked for two behaviors in one question. It is now split into `response-json` and `response-status-errors`.
- `cli-entrypoint` now names the Click CLI function directly, while keeping the same expected `main` symbol.

No ranking code changed during this audit.

## Audited Results

Run date: 2026-06-12

Plain FTS:

```text
Mode: fts
Questions: 13
Symbol Hit@1: 0.31
Symbol Hit@5: 0.46
Symbol MRR: 0.36
File Hit@1: 0.54
File Hit@5: 0.85
File MRR: 0.64
Partial file hits: 0.38
Avg latency: 2ms
```

Symbol mode:

```text
Mode: symbol
Questions: 13
Symbol Hit@1: 0.38
Symbol Hit@5: 0.85
Symbol MRR: 0.60
File Hit@1: 0.92
File Hit@5: 1.00
File MRR: 0.95
Partial file hits: 0.15
Avg latency: 11ms
```

Hybrid mode:

```text
Mode: hybrid
Questions: 13
Symbol Hit@1: 0.31
Symbol Hit@5: 0.46
Symbol MRR: 0.38
File Hit@1: 0.85
File Hit@5: 0.85
File MRR: 0.85
Partial file hits: 0.38
Avg latency: 13ms
```

The audited HTTPX result keeps the same conclusion as the first run. On this corpus, symbol mode is currently stronger than hybrid for exact symbols: Symbol Hit@5 is `0.85` for symbol mode but only `0.46` for hybrid. Symbol mode also reaches File Hit@5 `1.00`, which means the remaining misses are mostly intra-file or container-vs-method ordering problems.

## Decorated Definition Extraction

Run date: 2026-06-12

The `cli-entrypoint` miss was not only a ranking problem. Inspecting the HTTPX SQLite index showed no `main` function symbol in `httpx/_main.py`; only the module symbol existed. The root cause was Python Tree-sitter wrapping decorated functions and methods in `decorated_definition`, which the extractor ignored.

After extracting decorated functions and methods, the HTTPX source-only index changed from `466` symbols / `1675` edges to `544` symbols / `1851` edges.

Plain FTS after reindex:

```text
Mode: fts
Questions: 13
Symbol Hit@1: 0.31
Symbol Hit@5: 0.54
Symbol MRR: 0.40
File Hit@1: 0.54
File Hit@5: 0.85
File MRR: 0.63
Partial file hits: 0.31
Avg latency: 3ms
```

Symbol mode after reindex:

```text
Mode: symbol
Questions: 13
Symbol Hit@1: 0.46
Symbol Hit@5: 0.92
Symbol MRR: 0.66
File Hit@1: 0.92
File Hit@5: 1.00
File MRR: 0.95
Partial file hits: 0.08
Avg latency: 13ms
```

Hybrid mode after reindex:

```text
Mode: hybrid
Questions: 13
Symbol Hit@1: 0.38
Symbol Hit@5: 0.54
Symbol MRR: 0.46
File Hit@1: 0.77
File Hit@5: 0.85
File MRR: 0.81
Partial file hits: 0.31
Avg latency: 13ms
```

Graphify preservation check:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
Avg latency: 56ms
```

The extractor fix moved `cli-entrypoint` from a partial file hit to an exact symbol hit in both symbol and hybrid mode. It also improved HTTPX exact-symbol recall without changing ranking rules.

## Dotted API And Method Owner Ranking

Run date: 2026-06-12

Two remaining HTTPX misses had different causes:

- `top-level-request-api`: `request` was not in the top-25 symbol candidates, so this needed candidate expansion for exact dotted API references such as `httpx.request`.
- `response-json`: `Response.json` was present, but broader content helpers tied or outranked it. This needed a method owner/name signal when both the class-like owner and method name appear in the question.

Symbol mode after ranking update:

```text
Mode: symbol
Questions: 13
Symbol Hit@1: 0.69
Symbol Hit@5: 1.00
Symbol MRR: 0.83
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 12ms
```

Hybrid mode after ranking update:

```text
Mode: hybrid
Questions: 13
Symbol Hit@1: 0.46
Symbol Hit@5: 0.62
Symbol MRR: 0.54
File Hit@1: 0.85
File Hit@5: 0.92
File MRR: 0.88
Partial file hits: 0.31
Avg latency: 12ms
```

Graphify preservation check:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
Avg latency: 55ms
```

Graphify symbol mode stayed at Symbol Hit@1 `0.90` and Symbol Hit@5 `1.00`; plain FTS stayed at Symbol Hit@5 `0.40`.

## Soft Lexical Hybrid Ranking

Run date: 2026-06-12

The prior hybrid strategy preserved the first five FTS candidates as a hard gate. That helped Graphify, but it blocked stronger later symbol candidates on HTTPX. The new strategy gives FTS top-five function/method hits a lexical-priority boost, while letting all candidates compete by adjusted score. Modules and classes do not receive that boost.

Hybrid mode after soft lexical ranking:

```text
Mode: hybrid
Questions: 13
Symbol Hit@1: 0.77
Symbol Hit@5: 1.00
Symbol MRR: 0.84
File Hit@1: 0.92
File Hit@5: 1.00
File MRR: 0.94
Partial file hits: 0.00
Avg latency: 15ms
```

Graphify preservation check:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
Avg latency: 52ms
```

This recovers HTTPX top-five symbol recall without giving up the Graphify hybrid result. Hybrid now beats symbol mode on HTTPX Symbol Hit@1, `0.77` vs `0.69`, while matching Symbol Hit@5 `1.00`.

## Per-Question Detail

Latest symbol mode detail:

```text
cli-entrypoint          symbolRank=1     fileRank=1     top=main                       file=httpx/_main.py
top-level-request-api   symbolRank=1     fileRank=1     top=request                    file=httpx/_api.py
sync-client-send        symbolRank=1     fileRank=1     top=Client.send                 file=httpx/_client.py
async-client-send       symbolRank=1     fileRank=1     top=AsyncClient.send           file=httpx/_client.py
redirect-handling       symbolRank=1     fileRank=1     top=BaseClient._build_redirect_request file=httpx/_client.py
basic-auth              symbolRank=1     fileRank=1     top=BasicAuth                   file=httpx/_auth.py
timeout-config          symbolRank=2     fileRank=1     top=httpx/_config.py            file=httpx/_config.py
proxy-routing           symbolRank=1     fileRank=1     top=get_environment_proxies     file=httpx/_utils.py
asgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/asgi.py   file=httpx/_transports/asgi.py
wsgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/wsgi.py   file=httpx/_transports/wsgi.py
response-json           symbolRank=1     fileRank=1     top=Response.json              file=httpx/_models.py
response-status-errors  symbolRank=1     fileRank=1     top=Response.raise_for_status   file=httpx/_models.py
multipart-encoding      symbolRank=3     fileRank=1     top=encode_urlencoded_data      file=httpx/_content.py
```

Latest hybrid mode detail:

```text
cli-entrypoint          symbolRank=1     fileRank=1     top=main                       file=httpx/_main.py
top-level-request-api   symbolRank=1     fileRank=1     top=request                    file=httpx/_api.py
sync-client-send        symbolRank=1     fileRank=1     top=Client.send                 file=httpx/_client.py
async-client-send       symbolRank=1     fileRank=1     top=AsyncClient.send           file=httpx/_client.py
redirect-handling       symbolRank=1     fileRank=1     top=BaseClient._build_redirect_request file=httpx/_client.py
basic-auth              symbolRank=1     fileRank=1     top=BasicAuth                   file=httpx/_auth.py
timeout-config          symbolRank=5     fileRank=4     top=request                    file=httpx/_api.py
proxy-routing           symbolRank=1     fileRank=1     top=get_environment_proxies     file=httpx/_utils.py
asgi-transport          symbolRank=1     fileRank=1     top=ASGITransport.handle_async_request file=httpx/_transports/asgi.py
wsgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/wsgi.py   file=httpx/_transports/wsgi.py
response-json           symbolRank=1     fileRank=1     top=Response.json              file=httpx/_models.py
response-status-errors  symbolRank=1     fileRank=1     top=Response.raise_for_status   file=httpx/_models.py
multipart-encoding      symbolRank=5     fileRank=1     top=encode_request             file=httpx/_content.py
```

## Initial Findings

- The second corpus immediately caught overconfidence from Graphify. A saturated Graphify score did not mean the hybrid ranking strategy was generally best.
- Symbol mode is the best current HTTPX mode for exact symbols, while hybrid is competitive for file-level retrieval.
- Several misses are exact-symbol ordering problems rather than file-retrieval failures.
- `cli-entrypoint` now hits `main` after decorated functions are extracted.
- `top-level-request-api` now hits `request` after exact dotted API references are added as intent candidates.
- `response-json` now hits `Response.json` in symbol mode after adding a method owner/name signal.
- Soft lexical hybrid ranking recovers HTTPX Symbol Hit@5 `1.00` while keeping Graphify hybrid saturated.

## Next HTTPX Work

- Investigate remaining hybrid top-one misses, especially `timeout-config`, `wsgi-transport`, and `multipart-encoding`.
- Keep HTTPX results separate from Graphify results so cross-corpus changes stay visible.
- Add a third corpus or larger HTTPX question set before adding more hand-built intent rules.
