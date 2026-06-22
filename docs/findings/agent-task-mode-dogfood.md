# Agent Task Mode Dogfood

Date: 2026-06-21

Task: design and implement agent-facing task presets for `bugfix`, `feature`,
`explain`, `find-tests`, and `source-to-tests`.

## Agent-Index Commands Used

Built a self index:

```bash
npm run agent-index -- index /Users/juan/.codex/worktrees/a45e/agent-index --index-path /tmp/agent-index-self.sqlite
```

First implementation navigation:

```bash
npm run agent-index -- query --target /Users/juan/.codex/worktrees/a45e/agent-index --index-path /tmp/agent-index-self.sqlite --mode hybrid --term cli --term command --term format --kind function --kind method --role source
```

First useful implementation hit: `src/cli.ts` / `runCli`, which showed where
commands, options, and compact formatters are wired.

Related primitive navigation:

```bash
npm run agent-index -- query --target /Users/juan/.codex/worktrees/a45e/agent-index --index-path /tmp/agent-index-self.sqlite --mode hybrid --term related --term tests --term source --kind function --role source --expand callers
npm run agent-index -- query --target /Users/juan/.codex/worktrees/a45e/agent-index --index-path /tmp/agent-index-self.sqlite --mode hybrid --term file --term clusters --kind function --role source --expand callers
```

First useful primitive hits:

- `src/core/related-tests.ts` / `findRelatedTests`, `findRelatedTestsBatch`
- `src/core/file-clusters.ts` / `findFileClusters`
- `src/core/source-tests.ts` / `findSourceTests`

First useful test hit came from opening the existing focused tests after the
primitive hits: `tests/core/cli.test.ts`, `tests/core/file-clusters.test.ts`,
`tests/core/source-tests.test.ts`, and `tests/core/related-tests.test.ts`.

## What Task Mode Changed

The new `task` command reduces manual-query friction for the common agent path.
Instead of hand-authoring three separate commands for a bugfix workflow, an
agent can now run:

```bash
node dist/cli.js task bugfix "semantic cache load regression" --target /path/to/repo --format compact
```

The CLI fixture in `tests/core/cli.test.ts` demonstrates the reduced workflow:
one task command returns the source map, implementation context, and related
test file for a tiny source/test project. `--format json` exposes the generated
`plan.steps`, so future benchmark artifacts can compare task-mode behavior to
hand-authored structured workflows.

## Fallbacks

Used exact file reads and `rg`-style targeted checks for doc placement and
existing test context after agent-index identified the relevant files. Broad
repository search was not needed for implementation navigation.

## Default-Decision Gap Follow-Up

After the first task-mode implementation, real-repo smoke tests exposed a blind
bugfix gap: `task bugfix "NO_COLOR should disable color by default"` on Click
found adjacent ANSI/color helpers before the likely edit point,
`src/click/globals.py:54 resolve_color_default`.

The follow-up added a guarded default-decision resolver signal. On the same
Click checkout (`8a1b1a3`), the updated command now returns:

```text
Step 1 source-map file-clusters
  1 src/click/globals.py ... function resolve_color_default:54

Step 2 implementation-context query
  1 src/click/globals.py:54-67 function resolve_color_default
    why: ... default decision resolver intent ...
```

Preservation smoke checks stayed healthy:

- FastAPI response serialization still returns `fastapi/routing.py` and
  `serialize_response`.
- Rich `print_json` feature navigation still returns `rich/__init__.py`,
  `rich/console.py`, and tests such as `tests/test_rich_print.py`.
