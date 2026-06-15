# Agent Query Cookbook

This guide is for LLM agents using `agent-index` as a structured code-search tool.

The core split is simple: the LLM does the reasoning, then `agent-index` does fast indexed retrieval over files, symbols, line ranges, and graph neighbors. Think of it like using a library catalog instead of reading every shelf label. The agent chooses the catalog terms; `agent-index` returns the most likely code objects.

## Query Shape

Use shorthand structured flags for the primary agent path:

```bash
node dist/cli.js query \
  --target /path/to/python/repo \
  --mode hybrid \
  --term webhook \
  --term signature \
  --term verify \
  --kind function \
  --kind method \
  --path webhook \
  --path auth \
  --path security \
  --expand callers \
  --expand callees \
  --expand parents \
  --role source
```

Repeated flags and comma-separated values are equivalent, so `--term webhook --term signature` can also be written as `--term webhook,signature`.

Short positional phrases can also be refined with structured flags. The phrase
is split into terms, and the structured flags narrow the search:

```bash
node dist/cli.js query "webhook signature" \
  --target /path/to/python/repo \
  --mode hybrid \
  --path webhook \
  --kind function
```

For benchmark files and repeatable audits, prefer explicit `--term` flags so
the intended query shape is visible.

The full JSON form remains available for benchmark files, scripted callers, and advanced usage:

```bash
node dist/cli.js query \
  --target /path/to/python/repo \
  --mode hybrid \
  --agent-query '{"terms":["webhook","signature","verify"],"symbolKinds":["function","method"],"pathHints":["webhook","auth","security"],"roles":["source"],"expand":["callers","callees","parents"],"limit":10}'
```

Supported JSON fields and their shorthand flags:

| Field | Shorthand | Use it for | Notes |
| --- | --- | --- |
| `terms` | `--term` | Symbols, API names, behavior words, constants, and implementation nouns. | Required. Prefer terms likely to appear in code. |
| `symbolKinds` | `--kind` | Narrowing to `function`, `method`, `class`, or `module`. | Use this when the task clearly asks for one kind of object. |
| `pathHints` | `--path` | Directory, module, or filename clues. | Put location clues here instead of mixing them into broad terms. |
| `roles` | `--role` | Exact file-category filtering: `source`, `test`, `docs`, `example`, `fixture`, `tool`, `benchmark`. | Use `--role source` for implementation and `--role test` for test discovery. |
| `excludeSupportCode` | `--exclude-support-code` | Legacy shortcut for source-only results when no role is provided. | Do not combine with `--role`. |
| `expand` | `--expand` | Nearby context such as `callers`, `callees`, `imports`, `parents`, and `children`. | Use neighbors for orientation, not as a replacement for primary terms. |
| `limit` | `--limit` | Result count. | Keep results compact for agent context. |

## Basic Loop

1. Translate the user's request into code-shaped search clues.
2. Put exact API or owner names in `terms` when you can infer them.
3. Put directory and module guesses in `pathHints`.
4. Set `symbolKinds` when the target kind is obvious.
5. Query in `hybrid` mode.
6. Inspect the top results and neighbors.
7. If the top result is nearby but not the edit location, rerun with more discriminating terms.

Use `--debug` when the ranking is surprising:

```bash
node dist/cli.js query \
  --target /path/to/python/repo \
  --mode hybrid \
  --debug \
  --term login,SESSION_KEY,BACKEND_SESSION_KEY \
  --kind function \
  --path contrib,auth \
  --expand callees,parents \
  --role source
```

## Common Mistakes

- Use `agent-index query ...`; query flags at the root command will fail with a suggestion.
- On `query`, `--index /tmp/index.sqlite` and `--index-path /tmp/index.sqlite` are equivalent.
- On `query`, `--repo /path/to/repo` is accepted as an alias for `--target`, and `--db /tmp/index.sqlite` is accepted as an alias for `--index-path`. Prefer the canonical flags in examples.
- JSON mode requires `{"terms":["semantic","cache"]}`. Do not pass `{"query":"semantic cache"}`.
- Do not mix `--agent-query` with shorthand flags such as `--term` or `--kind`.
- Use `--role source` when looking for edit locations in source.
- Use `--role test` when intentionally looking for tests. `--path tests` helps ranking but does not filter by itself.
- Do not combine `--role` with `--exclude-support-code`.

## Choosing Terms

Good `terms` are implementation clues. They can be exact symbols, constants, internal helper names, public API names, or distinctive behavior words.

Prefer:

```json
{
  "terms": ["QuerySet.update_or_create", "update_or_create", "select_for_update", "create_defaults", "defaults", "atomic"]
}
```

Over:

```json
{
  "terms": ["where", "does", "Django", "update", "or", "create", "a", "row"]
}
```

The first query gives the index code addresses and rare words. The second query is mostly prose, which is what `rg` already struggles with.

## Owner Names Are High Signal

When you know the owner, use a dotted term:

```json
{
  "terms": ["Model.save", "save", "force_insert", "force_update", "update_fields"],
  "symbolKinds": ["method"],
  "pathHints": ["db", "models", "base"]
}
```

Dotted owner terms help keep overloaded names anchored. `save`, `execute`, `parse`, `get`, `run`, and `start` appear everywhere in large repos; `Model.save` or `Connection.execute` is much closer to an address.

## Path Hints Are Not Terms

Use `pathHints` for likely files or modules:

```json
{
  "terms": ["render_to_string", "context", "request", "get_template", "select_template"],
  "symbolKinds": ["function"],
  "pathHints": ["template", "loader"]
}
```

Do not pad `terms` with generic directory words unless they are also meaningful in code. The index already uses `pathHints` for path matching, and separating them makes the query easier to debug.

Path hints are not filters. If you need a file category, use `roles`:

```json
{
  "terms": ["print_json", "JSON", "file"],
  "symbolKinds": ["function"],
  "pathHints": ["tests"],
  "roles": ["test"]
}
```

That query returns test files only. The same query with `pathHints: ["tests"]` but no role can still return source files if they score better.

## Helper Names Can Hurt

Only put an exact helper name in `terms` when the helper is a valid target. If the helper is just nearby context, let graph expansion surface it.

Bad for a public login-flow query:

```json
{
  "terms": ["login", "cycle_key", "session_auth_hash", "backend"]
}
```

This can over-rank a helper such as `update_session_auth_hash`.

Better:

```json
{
  "terms": ["login", "user_logged_in", "rotate_token", "_set_auth_user", "SESSION_KEY", "BACKEND_SESSION_KEY", "HASH_SESSION_KEY", "_get_backend_from_user"],
  "symbolKinds": ["function"],
  "pathHints": ["contrib", "auth", "__init__"],
  "roles": ["source"],
  "expand": ["callees", "parents"]
}
```

The better query names the public flow and its distinctive side effects. Helper symbols can still show up as neighbors.

## Pick Symbol Kinds Aggressively

If the target is an edit location inside behavior, narrow to functions and methods:

```json
{
  "terms": ["FrameProtocol._serialize_frame", "serialize", "opcode", "payload", "mask"],
  "symbolKinds": ["method"],
  "pathHints": ["frame_protocol"],
  "roles": ["source"]
}
```

Use `class` when the class container itself is the answer, such as a data structure, framework object, or public extension point.

## Expansion Guidance

Use `expand` to ask for useful context around likely edit locations:

| Expansion | Use when |
| --- | --- |
| `parents` | You need the class or module containing a method/function. |
| `children` | A class or module is likely, but the exact method may be below it. |
| `callees` | The top result should show helpers it calls. |
| `callers` | You found a helper and need entrypoints that use it. |
| `imports` | The task involves dependency wiring or module boundaries. |

The common default is:

```json
{
  "expand": ["callees", "parents"]
}
```

Switch to `callers` when the first result is a helper and you need the public entrypoint.

## Query Patterns

### Public API Entry Point

Use exact public names, side effects, and module hints:

```json
{
  "terms": ["request", "Client.request", "method", "url", "headers", "cookies", "timeout"],
  "symbolKinds": ["function", "method"],
  "pathHints": ["api", "client"],
  "roles": ["source"],
  "expand": ["callees", "parents"]
}
```

### Orchestration Method

Avoid over-weighting inner helpers:

```json
{
  "terms": ["BaseHandler.load_middleware", "load_middleware", "request", "view", "template_response", "exception", "hooks"],
  "symbolKinds": ["method"],
  "pathHints": ["core", "handlers", "base"],
  "roles": ["source"],
  "expand": ["callees", "parents"]
}
```

### Parser Or Compiler Pipeline

Name the full pipeline and suppress local-helper ambiguity with owner/path hints:

```json
{
  "terms": ["Parser.parse", "parse", "tokens", "block", "tags", "nodelist", "template"],
  "symbolKinds": ["method"],
  "pathHints": ["template", "base"],
  "roles": ["source"],
  "expand": ["children", "callees", "parents"]
}
```

### Protocol Or State Machine

Use exact owner/API names and state/event nouns:

```json
{
  "terms": ["ConnectionState.process_event", "process_event", "state", "event", "transition", "CLIENT", "SERVER"],
  "symbolKinds": ["method"],
  "pathHints": ["state"],
  "roles": ["source"],
  "expand": ["callees", "parents"]
}
```

### Unknown Repo First Pass

When you do not know exact symbols yet, start broad but code-shaped:

```json
{
  "terms": ["webhook", "signature", "verify", "secret", "payload", "timestamp", "hmac"],
  "symbolKinds": ["function", "method", "class"],
  "pathHints": ["webhook", "auth", "security", "signature"],
  "roles": ["source"],
  "expand": ["callers", "callees", "parents"],
  "limit": 10
}
```

If top results are too broad, rerun with exact names from the first result's file, class, or neighbors.

## Anti-Patterns

Avoid these:

- Passing the whole user request as `terms`.
- Including every plausible helper name as a primary term.
- Using broad verbs alone: `get`, `set`, `run`, `build`, `parse`, `execute`.
- Repeating path words in `terms` when they belong in `pathHints`.
- Omitting `symbolKinds` when you know the task is about a function or method.
- Treating a green top file as proof that the top symbol is the edit location.

## Benchmarking Agent Queries

Benchmarks should compare structured `agent-index` results against an rg-style baseline over the same terms:

```bash
node dist/cli.js benchmark benchmarks/django-adversarial-python.json \
  --target /path/to/django \
  --index-path /tmp/agent-index-django-adversarial-structured.sqlite \
  --mode hybrid \
  --query-style agent \
  --include-rg-baseline \
  --misses
```

For every miss:

1. Inspect the source.
2. Decide whether the expected answer is wrong, the query is poorly shaped, or ranking/indexing has a general defect.
3. Change benchmark queries when the agent terms were the problem.
4. Change production ranking/indexing only when the miss shows a reusable agent-navigation issue.
5. Document the miss and fix in `docs/findings/`.

## Current Caveat

The current evidence says structured agent queries beat the measured rg-style file baseline on the curated corpus suite, while also returning exact symbols. It does not prove general search superiority. The benchmark sets are source-audited but hand-built, and several improvements came from learning how to shape better agent queries. Treat this cookbook as a living contract between the LLM planner and the index.
