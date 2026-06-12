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

The initial golden set contains 12 questions covering CLI entrypoint, top-level request API, sync and async clients, redirects, basic auth, timeout config, proxy routing, ASGI/WSGI transports, response helpers, and multipart encoding.

## Baseline Results

Run date: 2026-06-11

Plain FTS:

```text
Mode: fts
Questions: 12
Symbol Hit@1: 0.33
Symbol Hit@5: 0.42
Symbol MRR: 0.38
File Hit@1: 0.58
File Hit@5: 0.83
File MRR: 0.67
Partial file hits: 0.42
Avg latency: 3ms
```

Symbol mode:

```text
Mode: symbol
Questions: 12
Symbol Hit@1: 0.42
Symbol Hit@5: 0.83
Symbol MRR: 0.63
File Hit@1: 0.83
File Hit@5: 0.92
File MRR: 0.88
Partial file hits: 0.08
Avg latency: 15ms
```

Hybrid mode:

```text
Mode: hybrid
Questions: 12
Symbol Hit@1: 0.25
Symbol Hit@5: 0.42
Symbol MRR: 0.33
File Hit@1: 0.83
File Hit@5: 0.83
File MRR: 0.83
Partial file hits: 0.42
Avg latency: 11ms
```

The first HTTPX result is useful because it does not simply repeat Graphify. On this corpus, symbol mode is currently stronger than hybrid for exact symbols: Symbol Hit@5 is `0.83` for symbol mode but only `0.42` for hybrid. That suggests the conservative hybrid candidate protection that helped Graphify can hold back symbol matches on a library-shaped corpus.

## Per-Question Detail

Symbol mode detail:

```text
cli-entrypoint          symbolRank=null  fileRank=2     top=httpx/_client.py            file=httpx/_client.py
top-level-request-api   symbolRank=null  fileRank=null  top=httpx/_client.py            file=httpx/_client.py
sync-client-send        symbolRank=1     fileRank=1     top=Client.send                 file=httpx/_client.py
async-client-send       symbolRank=2     fileRank=1     top=AsyncClient                 file=httpx/_client.py
redirect-handling       symbolRank=1     fileRank=1     top=BaseClient._build_redirect_request file=httpx/_client.py
basic-auth              symbolRank=1     fileRank=1     top=BasicAuth                   file=httpx/_auth.py
timeout-config          symbolRank=2     fileRank=1     top=httpx/_config.py            file=httpx/_config.py
proxy-routing           symbolRank=1     fileRank=1     top=get_environment_proxies     file=httpx/_utils.py
asgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/asgi.py   file=httpx/_transports/asgi.py
wsgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/wsgi.py   file=httpx/_transports/wsgi.py
response-json-status    symbolRank=1     fileRank=1     top=Response.raise_for_status   file=httpx/_models.py
multipart-encoding      symbolRank=2     fileRank=1     top=encode_urlencoded_data      file=httpx/_content.py
```

Hybrid mode detail:

```text
cli-entrypoint          symbolRank=null  fileRank=1     top=httpx/_main.py              file=httpx/_main.py
top-level-request-api   symbolRank=null  fileRank=null  top=BaseTransport.handle_request file=httpx/_transports/base.py
sync-client-send        symbolRank=null  fileRank=1     top=AsyncClient                 file=httpx/_client.py
async-client-send       symbolRank=null  fileRank=1     top=AsyncClient                 file=httpx/_client.py
redirect-handling       symbolRank=null  fileRank=1     top=BaseClient.build_request    file=httpx/_client.py
basic-auth              symbolRank=1     fileRank=1     top=BasicAuth                   file=httpx/_auth.py
timeout-config          symbolRank=null  fileRank=1     top=httpx/_config.py            file=httpx/_config.py
proxy-routing           symbolRank=1     fileRank=1     top=get_environment_proxies     file=httpx/_utils.py
asgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/asgi.py   file=httpx/_transports/asgi.py
wsgi-transport          symbolRank=2     fileRank=1     top=httpx/_transports/wsgi.py   file=httpx/_transports/wsgi.py
response-json-status    symbolRank=null  fileRank=null  top=httpx/_auth.py              file=httpx/_auth.py
multipart-encoding      symbolRank=1     fileRank=1     top=MultipartStream             file=httpx/_multipart.py
```

## Initial Findings

- The second corpus immediately caught overconfidence from Graphify. A saturated Graphify score did not mean the hybrid ranking strategy was generally best.
- Symbol mode is the best current HTTPX mode for exact symbols, while hybrid is competitive for file-level retrieval.
- Several misses are exact-symbol ordering problems rather than file-retrieval failures.
- `cli-entrypoint` lands in `httpx/_main.py` in hybrid but misses the `main` function, which means file-level intent works but intra-file symbol ordering still needs work.
- `top-level-request-api` may need a truth-set review: the user-facing top-level function is `httpx/_api.py::request`, but the query wording also strongly matches lower-level transport request handling.
- `response-json-status` is a hard query because it asks for two behaviors in one question: `Response.json` and `Response.raise_for_status`.

## Next HTTPX Work

- Audit the 12 golden labels after reading the relevant source, especially `top-level-request-api` and `response-json-status`.
- Keep HTTPX results separate from Graphify results so cross-corpus changes stay visible.
- Do not tune ranking until the HTTPX truth set is audited.
- After audit, compare symbol mode and hybrid mode per question to decide whether hybrid should protect FTS candidates differently.
