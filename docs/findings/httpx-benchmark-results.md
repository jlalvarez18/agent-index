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
Indexed 23 files, 466 symbols, 466 chunks, 1675 edges at /Users/juan/Repos/httpx/.codeindex/index.sqlite
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

## Per-Question Detail

Symbol mode detail:

```text
cli-entrypoint          symbolRank=null  fileRank=1     top=httpx/_main.py              file=httpx/_main.py
top-level-request-api   symbolRank=null  fileRank=1     top=httpx/_api.py               file=httpx/_api.py
sync-client-send        symbolRank=1     fileRank=1     top=Client.send                 file=httpx/_client.py
async-client-send       symbolRank=2     fileRank=1     top=AsyncClient                 file=httpx/_client.py
redirect-handling       symbolRank=1     fileRank=1     top=BaseClient._build_redirect_request file=httpx/_client.py
basic-auth              symbolRank=1     fileRank=1     top=BasicAuth                   file=httpx/_auth.py
timeout-config          symbolRank=2     fileRank=1     top=httpx/_config.py            file=httpx/_config.py
proxy-routing           symbolRank=1     fileRank=1     top=get_environment_proxies     file=httpx/_utils.py
asgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/asgi.py   file=httpx/_transports/asgi.py
wsgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/wsgi.py   file=httpx/_transports/wsgi.py
response-json           symbolRank=4     fileRank=3     top=httpx/_content.py           file=httpx/_content.py
response-status-errors  symbolRank=1     fileRank=1     top=Response.raise_for_status   file=httpx/_models.py
multipart-encoding      symbolRank=2     fileRank=1     top=encode_urlencoded_data      file=httpx/_content.py
```

Hybrid mode detail:

```text
cli-entrypoint          symbolRank=null  fileRank=1     top=httpx/_main.py              file=httpx/_main.py
top-level-request-api   symbolRank=null  fileRank=null  top=httpx/__init__.py            file=httpx/__init__.py
sync-client-send        symbolRank=null  fileRank=1     top=AsyncClient                 file=httpx/_client.py
async-client-send       symbolRank=null  fileRank=1     top=AsyncClient                 file=httpx/_client.py
redirect-handling       symbolRank=null  fileRank=1     top=BaseClient.build_request    file=httpx/_client.py
basic-auth              symbolRank=1     fileRank=1     top=BasicAuth                   file=httpx/_auth.py
timeout-config          symbolRank=null  fileRank=1     top=httpx/_config.py            file=httpx/_config.py
proxy-routing           symbolRank=1     fileRank=1     top=get_environment_proxies     file=httpx/_utils.py
asgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/asgi.py   file=httpx/_transports/asgi.py
wsgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/wsgi.py   file=httpx/_transports/wsgi.py
response-json           symbolRank=null  fileRank=null  top=httpx/_content.py           file=httpx/_content.py
response-status-errors  symbolRank=1     fileRank=1     top=Response.raise_for_status   file=httpx/_models.py
multipart-encoding      symbolRank=1     fileRank=1     top=MultipartStream             file=httpx/_multipart.py
```

## Initial Findings

- The second corpus immediately caught overconfidence from Graphify. A saturated Graphify score did not mean the hybrid ranking strategy was generally best.
- Symbol mode is the best current HTTPX mode for exact symbols, while hybrid is competitive for file-level retrieval.
- Several misses are exact-symbol ordering problems rather than file-retrieval failures.
- `cli-entrypoint` lands in `httpx/_main.py` in hybrid but misses the `main` function, which means file-level intent works but intra-file symbol ordering still needs work.
- `top-level-request-api` is now clearer, and symbol mode finds the right file, but both symbol and hybrid still miss the `request` function itself.
- `response-json` shows a real limitation: the query lands near content encoding instead of `Response.json`, while `response-status-errors` cleanly hits `Response.raise_for_status`.

## Next HTTPX Work

- Improve intra-file symbol ordering so module/class containers do not hide exact functions such as `main`, `request`, and `Response.json`.
- Keep HTTPX results separate from Graphify results so cross-corpus changes stay visible.
- Compare symbol mode and hybrid mode per question before changing hybrid candidate protection.
