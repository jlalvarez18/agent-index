# NetworkX Path-Cost Agent Dogfood Trial

Date: 2026-06-15

## Goal

Run a second controlled NetworkX dogfood trial after the reciprocity task proved
too literal for a strong comparison.

Question:

```text
When the bug report does not name the implementation symbol directly, does
agent-index help an agent reach the right implementation and tests faster than
an rg-first workflow?
```

Task:

```text
Calculating the total cost of a valid path should handle an edge that lacks the
requested weight attribute like other weighted NetworkX APIs do: treat the
missing edge weight as 1 instead of crashing. Invalid paths should still raise
NetworkXNoPath.
```

The prompt did not name `path_weight`, but it did include code-shaped concepts:
path, cost, edge, weight, missing attribute, and unweighted edges.

## Setup

Original repo:

```text
/Users/juan/Repos/networkx
```

The original checkout was not modified. Two fresh temp copies were created:

```text
/tmp/networkx-path-cost-agent-index-trial
/tmp/networkx-path-cost-rg-trial
```

Copy times:

```text
agent-index copy: 0.679s
rg copy: 0.735s
```

Agent-index setup:

```bash
npm run build
node dist/cli.js index /tmp/networkx-path-cost-agent-index-trial \
  --index-path /tmp/networkx-path-cost-agent-index.sqlite
```

Index result:

```text
Indexed 690 files, 8348 symbols, 8348 chunks, 42387 edges at /tmp/networkx-path-cost-agent-index.sqlite (mode: all-files)
```

Index time:

```text
3.410s total
```

Indexing time was treated as setup cost, not agent implementation time.

Both agents were given the same Python 3.13 verification command to avoid
repeating the earlier `python`-not-on-`PATH` setup problem.

## Agent A: agent-index First

Worker:

```text
Franklin
```

Scope:

```text
/tmp/networkx-path-cost-agent-index-trial
```

Commands:

```bash
/Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/networkx-path-cost-agent-index-trial \
  --index /tmp/networkx-path-cost-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/networkx-path-cost-agent-index-trace.jsonl \
  --trace-task networkx-path-cost-missing-weight \
  --term path \
  --term cost \
  --term edge \
  --term weight \
  --term missing \
  --term attribute \
  --term unweighted \
  --kind function \
  --role source \
  --path classes \
  --path algorithms \
  --limit 10
```

```bash
/Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/networkx-path-cost-agent-index-trial \
  --index /tmp/networkx-path-cost-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/networkx-path-cost-agent-index-trace.jsonl \
  --trace-task networkx-path-cost-missing-weight \
  --term path \
  --term cost \
  --term weight \
  --term missing \
  --term attribute \
  --kind function \
  --kind method \
  --role test \
  --path tests \
  --path classes \
  --limit 10
```

Results:

- First useful implementation hit: rank 1,
  `networkx/classes/function.py::path_weight`.
- First useful test hit: rank 1,
  `networkx/classes/tests/test_function.py::test_pathweight`.
- Agent-index query count: 2.
- `rg` fallback count: 0.
- Invalid command count: 0.
- Agent wall time reported by worker: about 63s.

Trace report after annotation:

```text
Trace events: 2
Query events: 2
Avg query latency: 137ms
First useful hit rank: 1
rg fallbacks: 0
Bad results: 0
Unreviewed queries: 0
Code changes: 0
Verifications: 0
Elapsed wall time: 5.8s
```

## Agent B: rg First

Worker:

```text
Euclid
```

Scope:

```text
/tmp/networkx-path-cost-rg-trial
```

Search commands:

```bash
rg -n "def path_weight|path_weight" networkx/classes
rg -n "path_weight" networkx/classes/tests/test_function.py
rg -n "def _weight_function|attr\\.get\\(weight, 1\\)|get\\(weight, 1\\)" networkx
```

Results:

- First useful implementation location:
  `networkx/classes/function.py::path_weight`.
- First useful test location:
  `networkx/classes/tests/test_function.py::test_pathweight`.
- Search command count: 3.
- Agent-index usage: 0.
- Invalid command count: 0.
- Agent wall time reported by worker: about 91s.

The rg worker also ran an intentional red check before the fix, which failed
with `KeyError: 'weight'`.

## Code Changes

Both agents made the same implementation change.

```diff
 if multigraph:
-    cost += min(v[weight] for v in G._adj[node][nbr].values())
+    cost += min(v.get(weight, 1) for v in G._adj[node][nbr].values())
 else:
-    cost += G._adj[node][nbr][weight]
+    cost += G._adj[node][nbr].get(weight, 1)
```

The test changes differed:

- The agent-index worker extended existing `test_pathweight`, so the file still
  had 81 tests.
- The rg worker added a new focused
  `test_path_weight_missing_weight_defaults_to_one`, so the file had 82 tests.

Both test shapes covered `Graph`, `DiGraph`, `MultiGraph`, and `MultiDiGraph`.

## Independent Verification

Agent-index copy:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -m pytest \
  networkx/classes/tests/test_function.py -q
```

Result:

```text
81 passed in 0.08s
```

Direct behavior check:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -c "import networkx as nx; G = nx.Graph(); G.add_edge('a', 'b', weight=3); G.add_edge('b', 'c'); assert nx.path_weight(G, ['a', 'b', 'c'], 'weight') == 4"
```

Result:

```text
passed with no output
```

rg copy:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -m pytest \
  networkx/classes/tests/test_function.py -q
```

Result:

```text
82 passed in 0.08s
```

Direct behavior check:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -c "import networkx as nx; G = nx.Graph(); G.add_edge('a', 'b', weight=3); G.add_edge('b', 'c'); assert nx.path_weight(G, ['a', 'b', 'c'], 'weight') == 4"
```

Result:

```text
passed with no output
```

Both pytest runs emitted the existing mixed NetworkX configuration warning from
`networkx/conftest.py`. The focused class helper tests still passed.

## Assessment

This trial is a stronger positive signal for `agent-index` than the reciprocity
trial:

- The task did not name `path_weight` directly.
- `agent-index` returned the implementation symbol at rank 1 from code-shaped
  terms.
- `agent-index` returned the existing test function at rank 1.
- The agent-index worker used fewer navigation commands and reported lower wall
  time: about 63s vs about 91s.
- The trace gives compact, auditable evidence of query latency and hit rank.

This still does not make `rg` look bad. The rg worker inferred the likely
identifier from the bug wording and found the right files quickly. That is
exactly how LLM agents often use `rg`: guess likely code tokens, search, inspect,
and refine.

Conclusion:

```text
For a less literal but still code-shaped task, agent-index gave cleaner and
faster navigation than rg-first search in this run. The advantage came from
ranked symbol/test retrieval and traceability, not from replacing exact text
search entirely.
```

Next implication:

```text
Run another controlled trial where the report describes behavior without obvious
identifier tokens, or use an unfamiliar repo/module so the rg worker cannot
infer the symbol name as easily from API vocabulary.
```
