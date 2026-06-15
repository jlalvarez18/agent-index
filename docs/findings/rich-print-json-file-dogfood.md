# Rich print_json File Dogfood Trial

Date: 2026-06-14

## Goal

Run a second traced dogfood trial on a less obvious Rich change than the
filesize helper: make top-level `rich.print_json(..., file=...)` mirror
top-level `rich.print(..., file=...)` by writing JSON output to an explicit
stream.

Target repo copy:

```text
/tmp/rich-json-dogfood-YEseWU/rich
```

Index:

```text
/tmp/rich-json-dogfood.sqlite
```

Trace:

```text
/tmp/rich-json-dogfood-trace.jsonl
```

The original `/Users/juan/Repos/rich` checkout was not modified.

## Agent-Index Navigation

Implementation query:

```bash
node dist/cli.js query \
  --target /tmp/rich-json-dogfood-YEseWU/rich \
  --index /tmp/rich-json-dogfood.sqlite \
  --mode hybrid \
  --trace /tmp/rich-json-dogfood-trace.jsonl \
  --trace-task rich-json-sort-keys \
  --term print_json \
  --term JSON \
  --term sort_keys \
  --term json \
  --kind function \
  --kind method \
  --path console \
  --path json \
  --exclude-support-code \
  --expand callees \
  --limit 10
```

Useful implementation hits:

- `rich/console.py::Console.print_json` at rank 1
- `rich/__init__.py::print_json` at rank 3
- `rich/json.py::JSON.from_data` at rank 4

Test query:

```bash
node dist/cli.js query \
  --target /tmp/rich-json-dogfood-YEseWU/rich \
  --index /tmp/rich-json-dogfood.sqlite \
  --mode hybrid \
  --trace /tmp/rich-json-dogfood-trace.jsonl \
  --trace-task rich-json-sort-keys \
  --term print_json \
  --term JSON \
  --term data \
  --term default \
  --term sort_keys \
  --path tests \
  --kind function \
  --limit 10
```

Useful test hits:

- `tests/test_json.py::test_print_json_data_with_default` at rank 2
- `tests/test_console.py::test_print_json_data` at rank 3
- `tests/test_console.py::test_print_json_with_default_ensure_ascii` at rank 4
- `tests/test_rich_print.py::test_rich_print_json_round_trip` at rank 5

Fallback `rg` searches:

- None.

## Code Change

Temporary Rich files changed:

- `rich/__init__.py`
- `tests/test_rich_print.py`

Behavior added:

- `rich.print_json(data=..., file=output)` writes to the provided file-like
  object.
- Existing global-console behavior is preserved when `file` is omitted.
- Existing `sort_keys` behavior still flows through to `Console.print_json`.

Implementation note:

- The top-level wrapper now imports `Console`, builds `Console(file=file)` when
  a stream is supplied, and delegates to `write_console.print_json(...)`.

## Verification

Red check:

```bash
UV_CACHE_DIR=/tmp/agent-index-uv-cache \
  uv run --no-project --with pytest python -m pytest \
  tests/test_rich_print.py::test_rich_print_json_file \
  -q
```

Result:

```text
1 failed
TypeError: print_json() got an unexpected keyword argument 'file'
```

Green focused check:

```bash
UV_CACHE_DIR=/tmp/agent-index-uv-cache \
  uv run --no-project --with pytest python -m pytest \
  tests/test_rich_print.py::test_rich_print_json_file \
  -q
```

Result:

```text
1 passed
```

Neighboring JSON/print check:

```bash
UV_CACHE_DIR=/tmp/agent-index-uv-cache \
  uv run --no-project --with pytest python -m pytest \
  tests/test_rich_print.py \
  tests/test_console.py::test_print_json \
  tests/test_console.py::test_print_json_data \
  tests/test_console.py::test_print_json_ensure_ascii \
  tests/test_console.py::test_print_json_indent_none \
  -q
```

Result:

```text
12 passed
```

## Trace Report

```bash
node dist/cli.js trace-report /tmp/rich-json-dogfood-trace.jsonl
```

Result:

```text
Trace events: 5
Query events: 2
Avg query latency: 47ms
First useful hit rank: 1
rg fallbacks: 0
Bad results: 0
Unreviewed queries: 0
Code changes: 1
Verifications: 2
Elapsed wall time: 193.1s
```

## Assessment

This supports the dogfood claim, with a more interesting caveat than the
filesize trial.

What worked:

- `agent-index` found the JSON printing implementation surface without `rg`.
- The implementation query exposed the important delegation chain:
  `rich.__init__.print_json`, `Console.print_json`, and `JSON.from_data`.
- The test query found the right test family and the eventual test file in the
  top five.
- The trace made it easy to distinguish implementation navigation from test
  discovery quality.

What to watch:

- The test query's rank 1 result was the source wrapper, not a test, even with
  `--path tests`. The exact new-test location was rank 5. This is not a failure
  for the task, but it suggests test-discovery queries may need either stronger
  path weighting or better skill guidance such as adding `--term test` for test
  searches.
- `uv` still required an unsandboxed run because sandboxed `uv run` panicked in
  macOS dynamic-store setup. That is target-test-runner friction, not
  `agent-index` navigation friction.
