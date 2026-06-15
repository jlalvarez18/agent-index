---
name: using-agent-index
description: Use when navigating a local codebase to find files, symbols, functions, classes, imports, callers, callees, implementation locations, or related tests with agent-index
---

# Using Agent Index

## Overview

`agent-index` is a local code-navigation tool for agents. Use it before broad
text search when you need likely files, symbols, functions, classes, callers,
callees, imports, or related tests.

Core principle: ask for structured code clues, not natural-language answers.

## Workflow

1. Confirm syntax with `agent-index query --help` when unsure.
2. Use `agent-index index <target> --index-path <path>` if no warm index exists.
3. Use all-files indexes when looking for tests; use source-only indexes or
   `--role source` when looking for implementation/edit locations.
4. Prefer shorthand query flags:

```bash
agent-index query --target <repo> --index <index.sqlite> \
  --mode hybrid --term cache --term semantic --kind function --path cache --role source
```

5. You can also refine a short positional phrase with structured flags:

```bash
agent-index query "semantic cache" --target <repo> --index <index.sqlite> \
  --mode hybrid --path cache --kind function
```

6. Open the returned files/symbol ranges to inspect code.
7. Fall back to `rg` when you need exact strings, code snippets, or when
   `agent-index` does not surface relevant files after a few focused queries.

## Query Shaping

- Put owner/API names in `--term`: function names, class names, method names,
  config keys, exception names, protocol terms.
- Put directories or modules in `--path`: `tests`, `auth`, `client`, `models`.
- Put exact file categories in `--role`: `source`, `test`, `docs`, `example`,
  `fixture`, `tool`, or `benchmark`. `--path tests` is only a hint;
  `--role test` is the filter.
- Use `--kind function`, `--kind method`, `--kind class`, or `--kind module`
  when you know the shape of the answer.
- Use `--expand callers`, `--expand callees`, `--expand imports`, or
  `--expand parents` for nearby context.
- Use repeated flags or comma-separated values; both are valid.

## Positional Phrases

Short positional phrases can be refined with structured flags. The positional
words become query terms:

```bash
agent-index query "color output" --target <repo> --index <idx> \
  --mode hybrid --path tests --role test --kind function
```

For scripted or benchmark-style calls, prefer explicit `--term` flags because
they make the agent's intent easier to audit.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Searching for tests with a source-only index | Rebuild/use an all-files index |
| Starting with `rg` for navigation | Try `agent-index query` first |
| Using `{"query":"..."}` JSON | Use shorthand flags or `{"terms":[...]}` |
| Using `--index` before the subcommand | Use `agent-index query ... --index <path>` |
| Guessing `--repo` or `--db` | These work on `query`, but prefer `--target` and `--index` in examples |
| No useful test results | Use an all-files index and add `--role test` |
| Too many support files | Add `--role source` for implementation search |
| Combining `--role` with `--exclude-support-code` | Use one category filter; prefer `--role` |

## Reporting

When dogfooding, record:

- commands run
- first useful implementation hit
- first useful test hit
- confusing or invalid commands
- `rg` fallbacks and why they were needed
