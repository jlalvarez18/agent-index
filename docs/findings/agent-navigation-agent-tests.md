# Agent Navigation Agent Tests

Date: 2026-06-15

## Goal

Record the latest two-agent navigation rerun before dispatching a fresh dogfood
trial. This document captures the state after the CLI ergonomics fixes:

- `dist/cli.js` is executable after build.
- `agent-index query` accepts `--repo` as an alias for `--target`.
- `agent-index query` accepts `--db` as an alias for `--index-path`.

The purpose is to preserve the progression evidence: earlier agents found useful
results but lost time to command-shape friction; this rerun checks whether that
friction was removed.

## Setup

Agent-index build:

```bash
npm run build
```

Warm Click all-files index:

```bash
./dist/cli.js index /Users/juan/Repos/click \
  --index-path /tmp/click-agent-index-agent-test.sqlite
```

Result:

```text
Indexed 64 files, 1305 symbols, 1305 chunks, 5835 edges at /tmp/click-agent-index-agent-test.sqlite (mode: all-files)
```

Warm HTTPX all-files index:

```bash
./dist/cli.js index /Users/juan/Repos/httpx \
  --index-path /tmp/httpx-agent-index-agent-test.sqlite
```

Result:

```text
Indexed 60 files, 1206 symbols, 1206 chunks, 4641 edges at /tmp/httpx-agent-index-agent-test.sqlite (mode: all-files)
```

Indexing time is not counted as agent implementation time for these reruns.

## Click Rerun

Task:

```text
Find the Click implementation and tests for NO_COLOR / color default behavior.
Use agent-index first and report whether rg was needed.
```

Result:

- First useful implementation hit: `src/click/globals.py::resolve_color_default`
  at rank 1.
- First useful test hit:
  `tests/test_globals.py::test_no_color_disables_default_color` at rank 1.
- Approximate elapsed agent time: less than 1 second after dispatch completion.
- Invalid commands: 0.
- `rg` fallback searches: 0.

Notes:

- The agent used the directly executable CLI:
  `/Users/juan/Repos/agent-index/dist/cli.js query ...`.
- This rerun did not repeat the earlier executable-bit problem.
- Role metadata made the test query exact: `--role test` returned test files
  instead of merely boosting paths containing `tests`.

## HTTPX Rerun

Task:

```text
Find where HTTPX handles redirects and preserves response history, plus likely
tests for manual next_request redirect history.
Use agent-index first and report whether rg was needed.
```

Result:

- First useful implementation hit:
  `httpx/_client.py::Client._send_handling_redirects` at rank 1.
- First useful test hit:
  `tests/client/test_redirects.py::test_next_request_preserves_redirect_history`
  at rank 1.
- Approximate elapsed agent time: 15 seconds.
- Invalid commands: 0.
- `rg` fallback searches: 0.

Notes:

- The agent used the alias shape that had previously caused friction:
  `--repo` and `--db`.
- The aliases worked, so the agent did not need to recover from a failed command.

## Assessment

This supports the narrow claim that the latest CLI ergonomics changes improved
agent usability:

- agents can use direct `dist/cli.js` execution after build;
- guessed `--repo` / `--db` flags no longer derail the query;
- `--role source` and `--role test` make implementation and test discovery more
  explicit than path hints alone;
- both reruns found implementation and test targets without `rg`.

This is not yet fresh-task evidence. Click and HTTPX had already been explored
in earlier dogfood work. The next step is therefore a fresh controlled trial on
NetworkX, with documentation completed before dispatching the new agents.
