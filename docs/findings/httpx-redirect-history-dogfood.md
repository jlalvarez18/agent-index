# HTTPX Redirect History Dogfood Trial

Date: 2026-06-14

## Goal

Use the improved `agent-index query` CLI and the `using-agent-index` skill on a
real Python code change in HTTPX. The trial tested whether an agent could find
implementation and tests, make a small redirect/history change, verify it, and
record where `agent-index` helped.

Target repo:

```text
/Users/juan/Repos/httpx
```

Index:

```text
/tmp/httpx-agent-index-skill-after.sqlite
```

The target repo's existing `.codeindex/` directory was not used.

## Agent-Index Navigation

Implementation query:

```bash
node dist/cli.js query "redirect history" \
  --target /Users/juan/Repos/httpx \
  --index /tmp/httpx-agent-index-skill-after.sqlite \
  --mode hybrid \
  --exclude-support-code \
  --expand callees \
  --expand parents \
  --limit 8
```

First useful implementation hit:

- `httpx/_client.py::Client._send_handling_redirects`

Other useful implementation hits:

- `httpx/_client.py::AsyncClient._send_handling_redirects`
- `httpx/_client.py::BaseClient._build_redirect_request`
- `httpx/_models.py::Response.is_redirect`
- `httpx/_models.py::Response.__init__`
- `httpx/_client.py::Client._send_handling_auth`
- `httpx/_client.py::AsyncClient._send_handling_auth`

Test query:

```bash
node dist/cli.js query "redirect history" \
  --target /Users/juan/Repos/httpx \
  --index /tmp/httpx-agent-index-skill-after.sqlite \
  --mode hybrid \
  --path tests \
  --kind function \
  --limit 12
```

First useful test hit:

- `tests/client/test_redirects.py::test_redirect_301`

More targeted query:

```bash
node dist/cli.js query "next_request redirect history" \
  --target /Users/juan/Repos/httpx \
  --index /tmp/httpx-agent-index-skill-after.sqlite \
  --mode hybrid \
  --path tests \
  --kind function \
  --limit 12
```

Most useful test hits:

- `tests/client/test_redirects.py::test_next_request`
- `tests/client/test_redirects.py::test_async_next_request`

Fallback `rg` search:

```bash
rg -n "extensions\[|extensions =|\.extensions" /Users/juan/Repos/httpx/httpx /Users/juan/Repos/httpx/tests
```

Reason:

- `agent-index` found the right redirect methods and tests.
- `rg` was useful for exact field usage of `Request.extensions`, which is a
  precise string-level audit rather than a navigation question.

## Trace Shape

The same trial should now be captured with `--trace`:

```bash
node dist/cli.js query "redirect history" \
  --target /Users/juan/Repos/httpx \
  --index /tmp/httpx-agent-index-skill-after.sqlite \
  --mode hybrid \
  --exclude-support-code \
  --expand callees \
  --expand parents \
  --limit 8 \
  --trace /tmp/httpx-redirect-history-trace.jsonl \
  --trace-task httpx-redirect-history
```

The generated query event would be annotated after review:

```json
{"type":"agent-index-query","taskId":"httpx-redirect-history","outcome":"useful","usefulRank":1}
```

The exact extension audit remains a manual fallback event:

```json
{"type":"rg-fallback","taskId":"httpx-redirect-history","command":"rg -n \"extensions\\[|extensions =|\\.extensions\" /Users/juan/Repos/httpx/httpx /Users/juan/Repos/httpx/tests","reason":"Exact Request.extensions usage audit"}
```

This distinction matters: benchmarks measure known-answer retrieval, while trace
events measure whether the agent's actual navigation path started in the right
place and where exact text search was still appropriate.

## Code Change

HTTPX files changed:

- `httpx/_client.py`
- `tests/client/test_redirects.py`

Behavior added:

- When a caller receives a redirect response with `follow_redirects=False` and
  manually sends `response.next_request`, the next response now preserves the
  prior redirect response in `response.history`.
- The behavior is covered for both `Client` and `AsyncClient`.

Implementation notes:

- `BaseClient._build_redirect_request` copies request extensions instead of
  passing the same mapping through.
- `Client.send` and `AsyncClient.send` seed their internal redirect history from
  an internal `redirect_history` request extension when present.
- `_send_handling_redirects` stores the current redirect history on
  `response.next_request` only when returning a manual next request.

## Verification

Red checks:

```bash
uv run python -m pytest tests/client/test_redirects.py::test_next_request_preserves_redirect_history -q
uv run python -m pytest tests/client/test_redirects.py::test_async_next_request_preserves_redirect_history -q
```

Observed failures:

```text
assert len(response.history) == 1
E assert 0 == 1
```

Green checks:

```bash
uv run python -m pytest \
  tests/client/test_redirects.py::test_next_request_preserves_redirect_history \
  tests/client/test_redirects.py::test_async_next_request_preserves_redirect_history \
  -q
```

Result:

```text
3 passed
```

Broader redirect verification:

```bash
uv run python -m pytest tests/client/test_redirects.py -q
```

Result:

```text
34 passed
```

Auth-history neighbor verification:

```bash
uv run python -m pytest \
  tests/client/test_auth.py::test_sync_auth_history \
  tests/client/test_auth.py::test_async_auth_history \
  -q
```

Result:

```text
3 passed
```

Final combined HTTPX verification:

```bash
uv run python -m pytest \
  tests/client/test_redirects.py \
  tests/client/test_auth.py::test_sync_auth_history \
  tests/client/test_auth.py::test_async_auth_history \
  -q
```

Result:

```text
37 passed
```

Touched-file lint:

```bash
uv run ruff check httpx/_client.py tests/client/test_redirects.py
```

Result:

```text
All checks passed!
```

## Assessment

This supports the dogfood claim.

What worked:

- The first implementation query found the exact redirect loop method.
- The tests query found the correct test file and existing `next_request`
  coverage.
- The new positional-plus-structured flag behavior was useful in real use.
- Only one `rg` fallback was needed, and it was for exact extension-field usage.

What to watch:

- The current implementation stores redirect history in a request extension on
  `response.next_request`; this is compact, but it does make an internal marker
  visible on the returned request object until the request is sent.
- If that exposure is considered unacceptable, a follow-up could use a private
  request attribute instead, but that would be a larger design choice.
