# Agent-Index Skill Baseline

Date: 2026-06-14

## Goal

Run a baseline pressure test before creating a dedicated `using-agent-index`
skill. The question was whether the improved `agent-index query` shorthand is
enough for another agent to find implementation and test locations in a real
Python repo without special training.

Target repo:

```text
/Users/juan/Repos/click
```

CLI:

```text
/Users/juan/Repos/agent-index/dist/cli.js
```

## Baseline 1: Flawed Setup

Index command:

```bash
node dist/cli.js index /Users/juan/Repos/click --source-only --index-path /tmp/click-agent-index-skill-baseline.sqlite
```

Result:

```text
Indexed 17 files, 608 symbols, 608 chunks, 2380 edges at /tmp/click-agent-index-skill-baseline.sqlite (mode: source-only)
```

The agent found the implementation entry point:

- `src/click/globals.py::resolve_color_default`

But it could not find concrete test-suite functions and fell back to `rg`. That
result is not a fair test of test discovery because the index intentionally
excluded tests.

Lesson:

- A source-only index is good for edit-location search.
- It is the wrong setup when asking an agent to find tests.
- Future dogfood prompts should state whether the index is source-only or
  all-files.

## Baseline 2: Corrected All-Files Index

Index command:

```bash
node dist/cli.js index /Users/juan/Repos/click --index-path /tmp/click-agent-index-skill-baseline-allfiles.sqlite
```

Result:

```text
Indexed 64 files, 1305 symbols, 1305 chunks, 5835 edges at /tmp/click-agent-index-skill-baseline-allfiles.sqlite (mode: all-files)
```

The agent used `agent-index query --help`, then used the CLI before any
`rg`/`grep` fallback. It reported that `agent-index` alone was enough for the
navigation task.

First useful implementation hit:

- `src/click/globals.py::resolve_color_default`

Nearby useful implementation symbols:

- `src/click/utils.py::echo`
- `src/click/termui.py::get_pager_file`
- `src/click/termui.py::progressbar`
- `src/click/termui.py::_interpret_color`
- `src/click/termui.py::style`
- `src/click/termui.py::secho`
- `src/click/core.py::Context.__init__`
- `src/click/_termui_impl.py::MaybeStripAnsi`

First useful test hits:

- `tests/test_utils.py::test_echo_color_flag`
- `tests/test_testing.py::test_with_color`

Other useful test hits:

- `tests/test_globals.py::test_no_color_disables_default_color`
- `tests/test_globals.py::test_no_color_empty_value_does_not_disable_color`
- `tests/test_globals.py::test_explicit_color_overrides_no_color`
- `tests/test_globals.py::test_context_color_overrides_no_color`
- `tests/test_testing.py::test_with_color_errors`
- `tests/test_testing.py::test_with_color_but_pause_not_blocking`
- `tests/test_compat.py::test_should_strip_ansi`

Approximate elapsed time:

```text
about 5 minutes wall-clock; individual CLI queries were effectively instant
```

Fallback:

```text
No rg/grep fallback was used in the corrected all-files run.
```

## Confusing CLI Behavior

The agent hit a real ergonomics issue:

```text
--mode symbol with a positional query failed with:
Missing --term for shorthand query mode
```

It also found this confusing:

```text
A positional hybrid query worked initially, but adding structured flags such as
--exclude-support-code or --path pushed the command into shorthand mode and
required --term.
```

This means the shorthand improvement helped, but mixed positional plus
structured flags needed consistent CLI behavior.

## Assessment

This supports creating a `using-agent-index` skill, but it also shows the CLI is
closer to usable than before.

What worked:

- Agents can discover the shorthand flags through `query --help`.
- `--index` is natural and worked.
- All-files indexing lets `--path tests` surface concrete test functions.
- The agent did not need `rg` in the corrected run.

What still needs attention:

- The skill should teach when to use source-only versus all-files indexes.
- The skill should teach that short positional phrases can now be refined with
  structured flags, while explicit `--term` flags remain better for benchmark
  and audit trails.
- The CLI now treats positional query words as terms when structured flags are
  present.

Next implication:

- Create the skill from this baseline, then rerun a similar pressure test on a
  different repo or task to verify the skill changes agent behavior.

## After-Test: Skill Supplied on HTTPX

Skill file:

```text
skills/using-agent-index/SKILL.md
```

The first version was intentionally small, about 412 words. It focused on the
baseline failures:

- source-only versus all-files indexes
- using structured flags with either explicit `--term` values or short
  positional phrases
- starting with `agent-index` for navigation
- falling back to `rg` only for exact strings, snippets, or exhausted queries

Target repo:

```text
/Users/juan/Repos/httpx
```

Index command:

```bash
node dist/cli.js index /Users/juan/Repos/httpx --index-path /tmp/httpx-agent-index-skill-after.sqlite
```

Result:

```text
Indexed 60 files, 1204 symbols, 1204 chunks, 4637 edges at /tmp/httpx-agent-index-skill-after.sqlite (mode: all-files)
```

Pressure task:

```text
Find where HTTPX handles redirects and records response history, nearby
implementation symbols, and likely tests related to redirects and response
history.
```

The subagent was explicitly supplied the skill file and told to use
`agent-index` before `rg` or `grep`.

First useful implementation hit:

- `httpx/_client.py::Client._send_handling_redirects`

Useful nearby implementation symbols:

- `httpx/_client.py::AsyncClient._send_handling_redirects`
- `httpx/_client.py::BaseClient._build_redirect_request`
- `_redirect_method`
- `_redirect_url`
- `_redirect_headers`
- `_redirect_stream`
- `httpx/_models.py::Response.__init__`
- `httpx/_models.py::Response.has_redirect_location`
- `httpx/_models.py::Response.is_redirect`
- `TooManyRedirects`

First useful test hit:

- `tests/client/test_redirects.py::test_redirect_301`

More specific history-related hits:

- `tests/client/test_redirects.py::test_multiple_redirects`
- `tests/client/test_auth.py::test_async_auth_history`
- `tests/client/test_auth.py::test_sync_auth_history`

Result:

```text
No invalid agent-index commands.
No rg/grep fallback against /Users/juan/Repos/httpx.
Approximate elapsed time: about 65 seconds between recorded timestamps.
```

Remaining deployment gap:

- The skill was supplied directly to the subagent, not discovered globally.
- The subagent used one `rg --files` search only to locate the local skill file
  because `using-agent-index` is not yet installed under the global
  `/Users/juan/.agents/skills` path.

Assessment:

- The skill appears useful enough to keep.
- The next step is either installing it globally for Codex discovery or keeping
  it repo-local until the CLI ambiguity around positional queries plus
  structured flags is fixed.
