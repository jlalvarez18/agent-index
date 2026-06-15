# NetworkX Weighted Mixing Agent Dogfood Trial

Date: 2026-06-15

## Goal

Run a controlled agent comparison on a less literal NetworkX task in a module
area that had not been used for prior dogfood trials.

Question:

```text
Can agent-index help an agent navigate to a weighted graph metric bug when the
report describes behavior without naming the exact implementation symbol?
```

Task prompt:

```text
A weighted group-mixing score is too large when edge costs are nonuniform.
When a weight attribute is supplied, both the cross-group edge cost and the
total graph size should use that weight. Unweighted behavior should stay the
same.
```

## Setup

Original repo:

```text
/Users/juan/Repos/networkx
```

The original checkout was not modified. Two fresh temp copies were created:

```text
/tmp/networkx-mixing-agent-index-trial
/tmp/networkx-mixing-rg-trial
```

Copy times:

```text
agent-index copy: 0.713s
rg copy: 0.757s
```

Agent-index setup:

```bash
npm run build
node dist/cli.js index /tmp/networkx-mixing-agent-index-trial \
  --index-path /tmp/networkx-mixing-agent-index.sqlite
```

Index result:

```text
Indexed 690 files, 8348 symbols, 8348 chunks, 42387 edges at /tmp/networkx-mixing-agent-index.sqlite (mode: all-files)
```

Index time:

```text
3.457s total
```

Indexing was measured as setup cost, not agent implementation time.

## Agent A: agent-index First

Worker:

```text
Mencius
```

Scope:

```text
/tmp/networkx-mixing-agent-index-trial
```

Commands:

```bash
/Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/networkx-mixing-agent-index-trial \
  --index /tmp/networkx-mixing-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/networkx-mixing-agent-index-trace.jsonl \
  --trace-task networkx-weighted-mixing \
  --term weighted \
  --term mixing \
  --term group \
  --term ratio \
  --term edge \
  --term total \
  --term cost \
  --kind function \
  --role source \
  --path algorithms \
  --limit 10
```

```bash
/Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/networkx-mixing-agent-index-trial \
  --index /tmp/networkx-mixing-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/networkx-mixing-agent-index-trace.jsonl \
  --trace-task networkx-weighted-mixing \
  --term weighted \
  --term mixing \
  --term graph \
  --term cost \
  --kind function \
  --kind method \
  --role test \
  --path tests \
  --path algorithms \
  --limit 10
```

Refinement query:

```bash
/Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/networkx-mixing-agent-index-trial \
  --index /tmp/networkx-mixing-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/networkx-mixing-agent-index-trace.jsonl \
  --trace-task networkx-weighted-mixing \
  --term mixing_expansion \
  --term cuts \
  --term test \
  --kind function \
  --kind method \
  --role test \
  --path algorithms \
  --limit 10
```

Results:

- First useful implementation hit: rank 7,
  `networkx/algorithms/cuts.py::mixing_expansion`.
- First required test query result quality: bad result. It found assortativity
  weighted-mixing tests, not the cut metric tests needed for this bug.
- First useful test hit after refinement: rank 1,
  `networkx/algorithms/tests/test_cuts.py::TestMixingExpansion.test_graph`.
- Agent-index query count: 3.
- `rg` fallback count: 0.
- Invalid command count: 0.
- Reported wall time: about 85s, with the caveat that timing started after the
  worker read the skill and began navigation.

Trace report after annotation:

```text
Trace events: 3
Query events: 3
Avg query latency: 237ms
First useful hit rank: 7
rg fallbacks: 0
Bad results: 1
Unreviewed queries: 0
Code changes: 0
Verifications: 0
Elapsed wall time: 114.3s
```

## Agent B: rg First

Worker:

```text
Ampere
```

Scope:

```text
/tmp/networkx-mixing-rg-trial
```

Search commands:

```bash
rg -n "mixing" networkx
rg -n "mixing" tests
rg -n "attribute_mixing|numeric_mixing|degree_mixing|mixing_dict" networkx tests
rg -n "mixing_expansion|cut_size|number_of_edges\(|size\(" networkx/algorithms/cuts.py networkx/algorithms/tests/test_cuts.py
rg -n "G\.size\(weight=|\.size\(weight=" networkx/algorithms networkx/classes
```

Results:

- First useful implementation location:
  `networkx/algorithms/cuts.py::mixing_expansion`, found from
  `rg -n "mixing" networkx`.
- First useful test location:
  `networkx/algorithms/tests/test_cuts.py::TestMixingExpansion.test_graph`,
  found from the same search.
- Search command count: 5.
- Agent-index usage: 0.
- Invalid command count: 2, both from assuming a nonexistent top-level `tests`
  directory in the NetworkX checkout.
- Reported wall time: about 72s.

## Code Changes

Both workers made the same core implementation change:

```diff
 num_cut_edges = cut_size(G, S, T=T, weight=weight)
-num_total_edges = G.number_of_edges()
+num_total_edges = G.size(weight=weight)
 return num_cut_edges / (2 * num_total_edges)
```

The agent-index worker also updated the docstring sentence from "number of
edges" to "total edge weight". The rg worker left the docstring unchanged.

Both workers added a focused weighted regression in
`networkx/algorithms/tests/test_cuts.py::TestMixingExpansion`.

## Independent Verification

Agent-index copy:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -m pytest \
  networkx/algorithms/tests/test_cuts.py -q
```

Result:

```text
18 passed in 0.11s
```

Direct behavior check:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -c "import networkx as nx; G = nx.Graph(); G.add_edge('a', 'b', weight=10); G.add_edge('b', 'c', weight=1); assert nx.mixing_expansion(G, {'a'}, {'b', 'c'}, weight='weight') == 10 / (2 * G.size(weight='weight')); assert nx.mixing_expansion(G, {'a'}, {'b', 'c'}) == 1 / (2 * G.number_of_edges())"
```

Result:

```text
passed with no output
```

rg copy:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -m pytest \
  networkx/algorithms/tests/test_cuts.py -q
```

Result:

```text
18 passed in 0.10s
```

Direct behavior check:

```bash
/tmp/networkx-agent-index-pytest-venv/bin/python -c "import networkx as nx; G = nx.Graph(); G.add_edge('a', 'b', weight=10); G.add_edge('b', 'c', weight=1); assert nx.mixing_expansion(G, {'a'}, {'b', 'c'}, weight='weight') == 10 / (2 * G.size(weight='weight')); assert nx.mixing_expansion(G, {'a'}, {'b', 'c'}) == 1 / (2 * G.number_of_edges())"
```

Result:

```text
passed with no output
```

Both temp diffs passed `git diff --check`. Pytest emitted the existing mixed
NetworkX configuration warning in both copies.

## Assessment

This is useful evidence, but it is not a clean win for `agent-index`.

What worked for `agent-index`:

- It found the correct implementation without falling back to `rg`.
- It eventually found the correct test location.
- It produced traceable evidence of query latency, useful rank, and bad-result
  count.
- It avoided the `rg` worker's invalid top-level `tests` directory searches.

What did not work cleanly:

- The first useful implementation hit was rank 7, not rank 1.
- The required test query went to the wrong "mixing" domain:
  assortativity tests instead of cut/expansion tests.
- The worker needed a more explicit refinement query with
  `mixing_expansion` after inspecting the implementation result.
- The reported wall time was slower than the rg worker: about 85s versus 72s.

What worked for `rg`:

- A broad `mixing` text search found the right implementation and tests quickly.
- Follow-up searches helped confirm the weighted-denominator convention.

Conclusion:

```text
For this behavior-shaped weighted-metric task, agent-index was sufficient but
not clearly faster. The trace revealed a concrete retrieval weakness: overloaded
domain words such as "mixing" can route test discovery to the wrong subdomain
unless the agent refines with a discovered symbol or module hint.
```

Next implication:

```text
The next product improvement should not be another ranking tweak by default.
It should improve the dogfood workflow: capture bad-result annotations and
agent refinements well enough to compare navigation paths across several tasks.
```
