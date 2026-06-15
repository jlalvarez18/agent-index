# NetworkX Reciprocity Agent Dogfood Trial

Date: 2026-06-15

## Goal

Compare an `agent-index`-first agent against an `rg`-first agent on the same
fresh NetworkX bug fix.

Question:

```text
Does agent-index help an agent find implementation and test locations faster or
with fewer wasted searches than a normal text-search workflow?
```

Task:

```text
Fix nx.reciprocity(DG, isolated_node) so it returns None, matching the docstring
and iterable-node behavior, while overall_reciprocity(empty_graph) still raises.
```

## Setup

The latest Click/HTTPX agent rerun was documented first in
`docs/findings/agent-navigation-agent-tests.md`. Only after that documentation
was written were the fresh NetworkX agents dispatched.

Original repo:

```text
/Users/juan/Repos/networkx
```

The original checkout was not modified. Two isolated temp copies were created:

```text
/tmp/networkx-agent-index-trial
/tmp/networkx-rg-trial
```

Copy times:

```text
agent-index copy: 0.798s
rg copy: 0.777s
```

Agent-index setup:

```bash
npm run build
node dist/cli.js index /tmp/networkx-agent-index-trial \
  --index-path /tmp/networkx-agent-index-trial.sqlite
```

Index result:

```text
Indexed 690 files, 8348 symbols, 8348 chunks, 42387 edges at /tmp/networkx-agent-index-trial.sqlite (mode: all-files)
```

Index time:

```text
3.630s total
```

Indexing time is setup cost and was not counted as agent implementation time.

## Agent A: agent-index First

Worker:

```text
Noether
```

Scope:

```text
/tmp/networkx-agent-index-trial
```

Commands:

```bash
/Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/networkx-agent-index-trial \
  --index /tmp/networkx-agent-index-trial.sqlite \
  --mode hybrid \
  --trace /tmp/networkx-reciprocity-agent-index.jsonl \
  --trace-task networkx-reciprocity-isolated-node \
  --term reciprocity \
  --term isolated \
  --term node \
  --term NetworkXError \
  --kind function \
  --role source \
  --path algorithms \
  --limit 8
```

```bash
/Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/networkx-agent-index-trial \
  --index /tmp/networkx-agent-index-trial.sqlite \
  --mode hybrid \
  --trace /tmp/networkx-reciprocity-agent-index.jsonl \
  --trace-task networkx-reciprocity-isolated-node \
  --term reciprocity \
  --term isolated \
  --term NetworkXError \
  --kind function \
  --kind method \
  --role test \
  --path tests \
  --path reciprocity \
  --limit 10
```

Results:

- First useful implementation hit: rank 1,
  `networkx/algorithms/reciprocity.py::reciprocity`.
- First useful test hit: rank 1,
  `networkx/algorithms/tests/test_reciprocity.py::TestReciprocity.test_reciprocity_graph_isolated_nodes`.
- Agent-index query count: 2.
- `rg` fallback count: 0.
- Invalid command count: 0.
- Agent wall time reported by worker: about 162s.

Trace report after annotation:

```text
Trace events: 2
Query events: 2
Avg query latency: 381ms
First useful hit rank: 1
rg fallbacks: 0
Bad results: 0
Unreviewed queries: 0
Code changes: 0
Verifications: 0
Elapsed wall time: 5.2s
```

Environment friction:

- `python` was not on `PATH`.
- System `python3` was too old for this NetworkX checkout.
- `pytest` was not installed initially.
- `uv` panicked in this environment.
- A temporary Python 3.13 venv under `/tmp` was used for verification.

## Agent B: rg First

Worker:

```text
Harvey
```

Scope:

```text
/tmp/networkx-rg-trial
```

Search command:

```bash
rg -n "def reciprocity|def overall_reciprocity|reciprocity\(" \
  networkx/algorithms/reciprocity.py \
  networkx/algorithms/tests/test_reciprocity.py
```

Results:

- First useful implementation location:
  `networkx/algorithms/reciprocity.py::reciprocity`.
- First useful test location:
  `networkx/algorithms/tests/test_reciprocity.py::TestReciprocity.test_reciprocity_graph_isolated_nodes`.
- Search command count: 1.
- Invalid command count: 0.
- Agent-index usage: 0.
- Agent wall time reported by worker: about 132s.

Environment friction:

- The plan's literal `python ...` commands failed because `python` was not on
  `PATH`.
- The worker verified with `uv run --no-project --with pytest --python
  /opt/homebrew/bin/python3.13 ...` and direct `python3.13`.

## Code Changes

Both agents made the same narrow change in their isolated copies.

Implementation:

```diff
 if nodes in G:
-    reciprocity = next(_reciprocity_iter(G, nodes))[1]
-    if reciprocity is None:
-        raise NetworkXError("Not defined for isolated nodes.")
-    else:
-        return reciprocity
+    return next(_reciprocity_iter(G, nodes))[1]
```

Test:

```diff
 def test_reciprocity_graph_isolated_nodes(self):
-    with pytest.raises(nx.NetworkXError):
-        DG = nx.DiGraph([(1, 2)])
-        DG.add_node(4)
-        nx.reciprocity(DG, 4)
+    DG = nx.DiGraph([(1, 2)])
+    DG.add_node(4)
+    assert nx.reciprocity(DG, 4) is None
```

## Independent Verification

Agent-index copy:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -m pytest \
  networkx/algorithms/tests/test_reciprocity.py -q
```

Result:

```text
5 passed in 0.10s
```

Direct behavior check:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -c "import networkx as nx; DG = nx.DiGraph([(1, 2)]); DG.add_node(4); assert nx.reciprocity(DG, 4) is None"
```

Result:

```text
passed with no output
```

rg copy:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -m pytest \
  networkx/algorithms/tests/test_reciprocity.py -q
```

Result:

```text
5 passed in 0.10s
```

Direct behavior check:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -c "import networkx as nx; DG = nx.DiGraph([(1, 2)]); DG.add_node(4); assert nx.reciprocity(DG, 4) is None"
```

Result:

```text
passed with no output
```

Both pytest runs emitted an existing mixed NetworkX configuration warning from
`networkx/conftest.py`. The focused tests still passed.

## Assessment

This trial supports the navigation quality of `agent-index`, but it does not
show a clear speed win over `rg`.

What `agent-index` showed:

- It found the right implementation symbol at rank 1.
- It found the right test method at rank 1.
- It required no fallback search and no command recovery.
- The trace gives structured evidence of query latency and result quality.

What `rg` showed:

- This bug was easy for plain text search because the user-facing symbol,
  implementation function, and test names all contained `reciprocity`.
- One targeted `rg` command found both implementation and test locations.
- The rg-first worker reported a shorter wall time, though both workers spent
  meaningful time on Python environment friction rather than navigation.

Conclusion:

```text
For tiny obvious-symbol bugs, rg remains a strong baseline and may be faster.
agent-index matched the useful result quality with better structured traceability,
but this task was too easy to prove superiority.
```

Next implication:

```text
The next controlled trial should use a less literal task where the bug report
does not name the implementation symbol, or a task that requires choosing among
multiple plausible files and test areas.
```
