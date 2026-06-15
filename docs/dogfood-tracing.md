# Dogfood Tracing

Dogfood traces record how an agent actually navigated a repo during a feature or
bug fix. Benchmarks answer known-answer retrieval questions. Traces answer the
workflow question: did `agent-index` help the agent find useful files and
symbols before falling back to `rg`?

## Query Tracing

Add `--trace <path>` to any `agent-index query` command:

```bash
node dist/cli.js query "redirect history" \
  --target /Users/juan/Repos/httpx \
  --index /tmp/httpx-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/httpx-trace.jsonl \
  --trace-task httpx-redirect-history \
  --limit 5
```

The command still writes the normal query JSON to stdout. The trace file receives
one JSONL event with:

- timestamp
- task id
- target and index path
- query mode
- original text and/or structured `agentQuery`
- normalized query text
- query latency
- support-code filtering state
- top five matches
- default `outcome: "unreviewed"`

## Manual Events

Add manual JSONL events when the agent falls back to exact text search, changes
code, verifies behavior, or records the final lesson from a dogfood test:

```jsonl
{"type":"rg-fallback","timestamp":"2026-06-14T10:00:08.000Z","taskId":"httpx-redirect-history","command":"rg -n \"extensions\\[|extensions =|\\.extensions\" /Users/juan/Repos/httpx/httpx /Users/juan/Repos/httpx/tests","reason":"Exact Request.extensions usage audit"}
{"type":"code-change","timestamp":"2026-06-14T10:05:00.000Z","taskId":"httpx-redirect-history","files":["httpx/_client.py","tests/client/test_redirects.py"],"summary":"Preserve redirect history when manually sending response.next_request"}
{"type":"verification","timestamp":"2026-06-14T10:12:00.000Z","taskId":"httpx-redirect-history","command":"uv run python -m pytest tests/client/test_redirects.py -q","result":"passed"}
{"type":"lesson","timestamp":"2026-06-14T10:14:00.000Z","taskId":"httpx-redirect-history","lesson":"Agent-index found redirect implementation and test files, but exact Request.extensions auditing still belonged to rg.","nextStep":"Keep using warm traced dogfood trials before making ranking changes.","evidence":"One rg fallback checked exact extension-key usage."}
```

For lesson events, prefer the CLI helper instead of hand-editing JSONL:

```bash
node dist/cli.js trace-note /tmp/httpx-trace.jsonl \
  --task httpx-redirect-history \
  --lesson "Agent-index found redirect implementation and tests; rg was still useful for exact Request.extensions usage." \
  --next-step "Run another warm traced dogfood trial before changing retrieval." \
  --evidence "Implementation and test queries were useful; one exact-string fallback remained."
```

## Annotation

After a dogfood run, edit the generated query events:

```json
{"type":"agent-index-query","outcome":"useful","usefulRank":1}
```

Use these outcomes:

- `useful`: the query produced a hit the agent used.
- `bad-result`: the query was confusing or pointed at the wrong area.
- `unreviewed`: the query has not been judged yet.

`usefulRank` is the rank of the first result the agent used. If the result was
useful only as general context, record the nearest honest rank or leave it out.

## Report

Summarize a trace with:

```bash
node dist/cli.js trace-report /tmp/httpx-trace.jsonl
```

The report includes:

- total events
- query event count
- average query latency
- first useful hit rank when annotated
- `rg` fallback count
- bad-result count
- unreviewed query count
- code-change and verification counts
- lesson count
- elapsed wall time from first to last timestamp
- compact query path with outcome, useful rank, query text, and top result
- bad-result top matches
- lessons learned and recommended next steps

Every dogfood test should end with this shape:

1. What we tested.
2. Result.
3. Lessons learned.
4. Recommended next step.

`trace-report` provides the evidence for the middle two points. The final report
or findings doc should still add a short human summary so readers do not need to
replay the whole trace.

## Reading Results

A good dogfood trace is not one with zero `rg` usage. `rg` is still the right
tool for exact strings, snippets, and field-name audits. A good trace shows that
`agent-index` found the navigation targets first: implementation symbols,
nearby tests, line ranges, and graph neighbors.
