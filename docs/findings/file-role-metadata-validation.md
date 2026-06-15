# File Role Metadata Validation

Date: 2026-06-14

## Goal

Validate the new file role metadata end to end after rebuilding warm indexes. The important product question was whether agents can now ask for exact file categories with `--role`, especially tests, instead of relying on `--path tests` as an imprecise ranking hint.

## Baseline Verification

Commands run from `/Users/juan/Repos/agent-index`:

```bash
npm test
npm run build
git diff --check
node dist/cli.js query --help
```

Results:

- `npm test`: 211 tests passed across 8 test files.
- `npm run build`: TypeScript build passed.
- `git diff --check`: no whitespace errors.
- `query --help`: includes `--role <role>` with `source`, `test`, `docs`, `example`, `fixture`, `tool`, and `benchmark`.

## Warm Rich Reindex

The warm Rich dogfood checkout was reindexed so the SQLite schema and rows include `files.role`:

```bash
node dist/cli.js index /tmp/rich-json-dogfood-YEseWU/rich \
  --index-path /tmp/rich-json-dogfood.sqlite
```

Result:

```text
Indexed 213 files, 2077 symbols, 2077 chunks, 8326 edges at /tmp/rich-json-dogfood.sqlite (mode: all-files)
```

Schema and role distribution:

```text
0|id|INTEGER|0||1
1|path|TEXT|1||0
2|hash|TEXT|1||0
3|language|TEXT|1||0
4|role|TEXT|1||0
benchmark|3
docs|1
example|36
source|101
test|67
tool|5
```

This confirms the warm index was not using the old schema.

## Rich Query Checks

Test-only query:

```bash
node dist/cli.js query \
  --target /tmp/rich-json-dogfood-YEseWU/rich \
  --index /tmp/rich-json-dogfood.sqlite \
  --mode hybrid \
  --term print_json \
  --term JSON \
  --role test \
  --kind function \
  --limit 5
```

Top files:

```text
tests/test_json.py
tests/test_rich_print.py
tests/test_rich_print.py
tests/test_console.py
tests/test_rich_print.py
```

All returned files were under `tests/`.

Source-only role query:

```bash
node dist/cli.js query \
  --target /tmp/rich-json-dogfood-YEseWU/rich \
  --index /tmp/rich-json-dogfood.sqlite \
  --mode hybrid \
  --term print_json \
  --term JSON \
  --role source \
  --kind function \
  --limit 5
```

Top file:

```text
rich/__init__.py
```

No returned files were under `tests/`.

Path-hint contrast:

```bash
node dist/cli.js query \
  --target /tmp/rich-json-dogfood-YEseWU/rich \
  --index /tmp/rich-json-dogfood.sqlite \
  --mode hybrid \
  --term print_json \
  --term JSON \
  --path tests \
  --kind function \
  --limit 5
```

Top files:

```text
rich/__init__.py
tests/test_json.py
tests/test_rich_print.py
tests/test_rich_print.py
tests/test_console.py
```

This is the desired distinction: `--path tests` nudges ranking but does not filter; `--role test` filters.

## Error Handling

Invalid role:

```bash
node dist/cli.js query \
  --target /tmp/rich-json-dogfood-YEseWU/rich \
  --index /tmp/rich-json-dogfood.sqlite \
  --term print_json \
  --role vendor
```

Result:

```text
Invalid --role value: vendor. Expected one of: source, test, docs, example, fixture, tool, benchmark.
```

Conflicting role filters:

```bash
node dist/cli.js query \
  --target /tmp/rich-json-dogfood-YEseWU/rich \
  --index /tmp/rich-json-dogfood.sqlite \
  --term print_json \
  --role test \
  --exclude-support-code
```

Result:

```text
Use either --role or --exclude-support-code, not both.
```

## Graphify Source-Only Compatibility

Graphify was reindexed with source-only mode:

```bash
node dist/cli.js index /Users/juan/Repos/graphify \
  --source-only \
  --index-path /tmp/agent-index-graphify-source-only-role.sqlite
```

Result:

```text
Indexed 37 files, 804 symbols, 804 chunks, 6467 edges at /tmp/agent-index-graphify-source-only-role.sqlite (mode: source-only)
```

Role distribution:

```text
source|37
```

Benchmark command:

```bash
node dist/cli.js benchmark benchmarks/graphify-python.json \
  --target /Users/juan/Repos/graphify \
  --index-path /tmp/agent-index-graphify-source-only-role.sqlite \
  --mode hybrid \
  --query-style agent \
  --include-rg-baseline \
  --misses
```

Result:

```text
Mode: hybrid
Query style: agent
Questions: 10
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 33ms
rg-style File Hit@1: 0.20
rg-style File Hit@5: 0.80
rg-style File MRR: 0.44
rg-style Avg latency: 20ms

Misses: none
```

The schema change did not regress the existing source-only Graphify benchmark.

## Click All-Files Test Discovery

Click was reindexed in all-files mode:

```bash
node dist/cli.js index /Users/juan/Repos/click \
  --index-path /tmp/click-agent-index-role.sqlite
```

Result:

```text
Indexed 64 files, 1305 symbols, 1305 chunks, 5835 edges at /tmp/click-agent-index-role.sqlite (mode: all-files)
```

Role distribution:

```text
docs|1
example|14
source|17
test|32
```

Test-discovery query:

```bash
node dist/cli.js query \
  --target /Users/juan/Repos/click \
  --index /tmp/click-agent-index-role.sqlite \
  --mode hybrid \
  --term color \
  --term runner \
  --term strip \
  --role test \
  --kind function \
  --limit 10
```

Top files:

```text
tests/test_compat.py
tests/test_termui.py
tests/test_testing.py
tests/test_testing.py
tests/test_testing.py
tests/test_termui.py
tests/test_termui.py
tests/test_termui.py
tests/test_chain.py
tests/test_stream_lifecycle.py
```

All returned files were tests. This directly addresses the earlier Click dogfood friction where test discovery depended on index mode and path hints.

## Trace Check

Traced role query:

```bash
node dist/cli.js query \
  --target /tmp/rich-json-dogfood-YEseWU/rich \
  --index /tmp/rich-json-dogfood.sqlite \
  --mode hybrid \
  --term print_json \
  --role test \
  --kind function \
  --trace /tmp/rich-role-trace-20260614233614.jsonl \
  --trace-task rich-role-filter \
  --limit 3
```

Trace report:

```text
Trace events: 1
Query events: 1
Avg query latency: 47ms
First useful hit rank: -
rg fallbacks: 0
Bad results: 0
Unreviewed queries: 1
Code changes: 0
Verifications: 0
Elapsed wall time: -
```

The JSONL event included:

```json
{
  "type": "agent-index-query",
  "taskId": "rich-role-filter",
  "roles": ["test"],
  "topFiles": [
    "tests/test_json.py",
    "tests/test_rich_print.py",
    "tests/test_rich_print.py"
  ]
}
```

Role filters are therefore visible in dogfood traces through `query.agentQuery.roles`.

## Conclusion

File role metadata is working across scanner, SQLite storage, CLI shorthand, structured query filtering, benchmark compatibility, and trace capture. The strongest evidence is the Rich contrast: `--path tests` can still return `rich/__init__.py`, while `--role test` returns only test files. Existing warm indexes must be rebuilt after this schema change; stale indexes from before `files.role` will not be valid for role-aware queries.
