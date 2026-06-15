# Rich Filesize Precision Dogfood Trial

Date: 2026-06-14

## Goal

Use the new dogfood tracing workflow on a real Python codebase task: make
`rich.filesize.decimal(..., precision=None)` behave consistently with its
`Optional[int]` annotation instead of raising a format-specifier error.

Target repo copy:

```text
/tmp/rich-traced-dogfood-HAGJTc/rich
```

Index:

```text
/tmp/rich-traced-dogfood.sqlite
```

Trace:

```text
/tmp/rich-filesize-precision-trace.jsonl
```

The original `/Users/juan/Repos/rich` checkout was not modified.

## Agent-Index Navigation

Implementation query:

```bash
node dist/cli.js query \
  --target /tmp/rich-traced-dogfood-HAGJTc/rich \
  --index /tmp/rich-traced-dogfood.sqlite \
  --mode hybrid \
  --trace /tmp/rich-filesize-precision-trace.jsonl \
  --trace-task rich-filesize-precision-none \
  --term filesize \
  --term decimal \
  --term precision \
  --term None \
  --kind function \
  --path filesize \
  --exclude-support-code \
  --limit 8
```

First useful implementation hit:

- `rich/filesize.py::decimal` at rank 1

Nearby useful hit:

- `rich/filesize.py::_to_str` at rank 2

Test query:

```bash
node dist/cli.js query \
  --target /tmp/rich-traced-dogfood-HAGJTc/rich \
  --index /tmp/rich-traced-dogfood.sqlite \
  --mode hybrid \
  --trace /tmp/rich-filesize-precision-trace.jsonl \
  --trace-task rich-filesize-precision-none \
  --term filesize \
  --term decimal \
  --term precision \
  --path tests \
  --kind function \
  --limit 8
```

First useful test hit:

- `tests/test_filesize.py::test_traditional` at rank 1

Related caller/test context:

- `tests/test_progress.py::test_download_progress_uses_decimal_units` at rank 3

Fallback `rg` searches:

- None.

## Code Change

Temporary Rich files changed:

- `rich/filesize.py`
- `tests/test_filesize.py`

Behavior added:

- `filesize.decimal(1000, precision=None)` returns `"1 kB"`.
- `filesize.decimal(1111, precision=None)` returns `"1.111 kB"`.
- Existing fixed-precision behavior is unchanged.

Implementation note:

- `_to_str` now formats with `g` only when `precision is None`; otherwise it uses
  the existing fixed-point precision formatting.

## Verification

Initial runner issue:

```bash
python3 -m pytest tests/test_filesize.py -q
```

Result:

```text
No module named pytest
```

Red check:

```bash
UV_CACHE_DIR=/tmp/agent-index-uv-cache \
  uv run --no-project --with pytest python -m pytest tests/test_filesize.py -q
```

Result:

```text
1 failed, 2 passed
ValueError: Format specifier missing precision
```

Green focused check:

```bash
UV_CACHE_DIR=/tmp/agent-index-uv-cache \
  uv run --no-project --with pytest python -m pytest tests/test_filesize.py -q
```

Result:

```text
3 passed
```

Related caller check:

```bash
UV_CACHE_DIR=/tmp/agent-index-uv-cache \
  uv run --no-project --with pytest python -m pytest \
  tests/test_filesize.py \
  tests/test_progress.py::test_download_progress_uses_decimal_units \
  -q
```

Result:

```text
4 passed
```

## Trace Report

```bash
node dist/cli.js trace-report /tmp/rich-filesize-precision-trace.jsonl
```

Result:

```text
Trace events: 5
Query events: 2
Avg query latency: 20ms
First useful hit rank: 1
rg fallbacks: 0
Bad results: 0
Unreviewed queries: 0
Code changes: 1
Verifications: 2
Elapsed wall time: 138.0s
```

## Assessment

This supports the dogfood claim for a small helper-level change.

What worked:

- The implementation query found the exact public helper and nearby private
  formatter in one command.
- The test query found the right test file and also surfaced the related
  progress test.
- No `rg` fallback was needed for code navigation.
- The trace report made the trial easy to summarize without rereading the full
  command history.

What to watch:

- The first test command failed because system Python had no pytest installed.
  This is setup friction in the target repo, not an `agent-index` navigation
  issue.
- The task was intentionally small. The next traced trial should involve a
  multi-file behavior change where implementation and tests are less obviously
  named.
