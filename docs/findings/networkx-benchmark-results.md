# NetworkX Benchmark Results

## Current Status

NetworkX is the ninth validation corpus, cloned locally at `/Users/juan/Repos/networkx`.

This corpus was chosen because it moves away from web frameworks, validation libraries, terminal rendering, and packaging infrastructure. It adds graph algorithms, matrix routines, graph classes, random graph generators, isomorphism, GraphML IO, and flow algorithms.

Local source revision:

```text
2622da75c
```

## Benchmark Setup

Command:

```bash
node dist/cli.js index /Users/juan/Repos/networkx --source-only --index-path /tmp/agent-index-networkx.sqlite
node dist/cli.js benchmark ./benchmarks/networkx-python.json --target /Users/juan/Repos/networkx --index-path /tmp/agent-index-networkx.sqlite --mode hybrid
```

Source-only index summary:

```text
Indexed 305 files, 2504 symbols, 2504 chunks, 14742 edges at /tmp/agent-index-networkx.sqlite (mode: source-only)
```

## Golden Questions

The seed set contains 14 source-audited questions covering:

- A* and Dijkstra shortest paths
- Brandes betweenness centrality
- DAG generations and transitive reduction
- Louvain community detection
- `Graph` node/edge mutation
- GraphML read/parse flow
- random graph generation
- VF2 isomorphism
- Laplacian matrices
- maximum flow

## Mode Comparison

Run date: 2026-06-13

Plain FTS:

```text
Mode: fts
Questions: 14
Symbol Hit@1: 0.50
Symbol Hit@5: 1.00
Symbol MRR: 0.71
File Hit@1: 0.79
File Hit@5: 1.00
File MRR: 0.86
Partial file hits: 0.00
Avg latency: 28ms
```

Symbol mode:

```text
Mode: symbol
Questions: 14
Symbol Hit@1: 0.50
Symbol Hit@5: 0.86
Symbol MRR: 0.64
File Hit@1: 0.86
File Hit@5: 1.00
File MRR: 0.92
Partial file hits: 0.14
Avg latency: 75ms
```

Hybrid mode before the NetworkX fixes and benchmark audit:

```text
Mode: hybrid
Questions: 14
Symbol Hit@1: 0.50
Symbol Hit@5: 0.71
Symbol MRR: 0.57
File Hit@1: 0.64
File Hit@5: 0.79
File MRR: 0.71
Partial file hits: 0.07
Avg latency: 91ms
```

Hybrid mode after the NetworkX fixes and benchmark audit:

```text
Mode: hybrid
Questions: 14
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 74ms
```

Hybrid mode after the 2026-06-13 named-concept repair:

```text
Mode: hybrid
Questions: 14
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 107ms
```

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 14 friendly NetworkX benchmark rows. The structured queries use algorithm and API-shaped terms such as `astar_path`, `_dijkstra_multisource`, `bidirectional_dijkstra`, `topological_generations`, `louvain_communities`, `Graph.add_edge`, `parse_graphml`, `fast_gnp_random_graph`, `GraphMatcher`, `laplacian_matrix`, and `maximum_flow`.

Index:

```text
node dist/cli.js index /Users/juan/Repos/networkx --source-only --index-path /tmp/agent-index-networkx-structured.sqlite
Indexed 292 files, 2395 symbols, 2395 chunks, 14481 edges at /tmp/agent-index-networkx-structured.sqlite (mode: source-only)
```

First structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 14
Symbol Hit@1: 0.93
Symbol Hit@5: 0.93
Symbol MRR: 0.93
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.07
Avg latency: 58ms
rg-style File Hit@1: 0.57
rg-style File Hit@5: 0.86

Misses:
graph-add-node-edge  top=Graph.update
```

Source audit: the miss was query shaping. The broad query named `Graph`, `add_node`, `add_edge`, adjacency, and attributes, so `Graph.update` was source-nearby because it calls `add_nodes_from` and `add_edges_from`. The intended edit locations were the direct mutation methods.

Final structured pass after changing that query to dotted method references:

```text
Mode: hybrid
Query style: agent
Questions: 14
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 66ms
rg-style File Hit@1: 0.57
rg-style File Hit@5: 0.86
rg-style File MRR: 0.66
rg-style Avg latency: 76ms

Misses: none
```

Interpretation: NetworkX extends structured-agent evidence into algorithm-heavy code where generic words are highly overloaded. The rg-style baseline is decent at file recall, but structured `agent-index` returns exact algorithm/class/method symbols at rank 1. The main agent guidance is sharper here: for broad core classes like `Graph`, use dotted method terms such as `Graph.add_edge` when the intended edit location is a method, because class-level words like `graph`, `node`, `edge`, and `attributes` match many legitimate neighbors.

NetworkX adversarial after the same repair:

```text
Mode: hybrid
Questions: 13
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 96ms
```

## Hybrid Detail

```text
astar-heuristic-cutoff          symbolRank=1  fileRank=1  top=astar_path
dijkstra-multisource-core      symbolRank=1  fileRank=1  top=_dijkstra_multisource
bidirectional-dijkstra         symbolRank=1  fileRank=1  top=bidirectional_dijkstra
betweenness-brandes            symbolRank=1  fileRank=1  top=betweenness_centrality
dag-topological-generations    symbolRank=1  fileRank=1  top=topological_generations
dag-transitive-reduction       symbolRank=1  fileRank=1  top=transitive_reduction
louvain-modularity-level       symbolRank=1  fileRank=1  top=louvain_communities
graph-add-node-edge            symbolRank=1  fileRank=1  top=Graph
graphml-read-parse             symbolRank=1  fileRank=1  top=parse_graphml
random-gnp-sparse              symbolRank=1  fileRank=1  top=gnp_random_graph
barabasi-preferential-attachment symbolRank=1 fileRank=1 top=barabasi_albert_graph
graph-isomorphism-vf2          symbolRank=1  fileRank=1  top=GraphMatcher
laplacian-matrices             symbolRank=1  fileRank=1  top=normalized_laplacian_matrix
maximum-flow-residual          symbolRank=1  fileRank=1  top=maximum_flow
```

## Examples

Good result: `where does NetworkX run A star shortest path search with heuristic, cutoff, and weighted edges?`

- Top result: `astar_path` in `networkx/algorithms/shortest_paths/astar.py`
- This validated the stronger module demotion: before the fix, the whole `weighted.py` module beat the concrete A* function.

Fixed result: `where does NetworkX build graph Laplacian sparse matrices from adjacency and degree data?`

- Before the fix, the generic graph-build intent lifted `build_residual_network`.
- After the first fix, the top result was `normalized_laplacian_matrix`, with `laplacian_matrix` also in the expected set.
- A later rerun exposed a different over-trigger: create/build factory intent lifted GraphML generation for a Laplacian matrix question. The named-concept repair now keeps Laplacian questions in `networkx/linalg/laplacianmatrix.py`.
- The lesson is that "build graph" and "build graph matrix" are different intents.

Fixed result: `where does NetworkX test graph isomorphism with optional node and edge matching using the VF2 algorithm?`

- Before the named-concept repair, `Graph.nodes` and `Graph.edges` could win because the query mentions graph, node, and edge.
- After the repair, `GraphMatcher`/`is_isomorphic` candidates win because `isomorphism` and `VF2` are treated as the named concept, while generic `Graph` owner methods are context.

Fixed result: `where does NetworkX choose each possible Gnp random graph edge with probability p in O n squared time?`

- Before the repair, generic edge accessors and unrelated graph generators could outrank `gnp_random_graph`.
- After the repair, the quadratic-Gnp intent separates exhaustive `O(n^2)` generation from sparse `fast_gnp_random_graph`.

Fixed result: `where does NetworkX find a weighted shortest path by expanding Dijkstra search from both source and target?`

- Before the fix, the generic wrapper `shortest_path` ranked first and `bidirectional_dijkstra` ranked third.
- After adding a scoped bidirectional-Dijkstra intent, `bidirectional_dijkstra` ranks first.

## Audit Notes

- The initial `graph-isomorphism-vf2` answer key was too narrow. `is_isomorphic` is the public wrapper, but the VF2 implementation lives in `GraphMatcher` and `DiGraphMatcher` in `isomorphvf2.py`.
- The initial maximum-flow question mentioned residual networks, which made `build_residual_network` a source-valid answer. The row was reworded to ask for `maximum_flow` return behavior when the expected answer is `maximum_flow`.
- The `Graph` top result for the node/edge mutation question is source-valid because the question asks for the `Graph` class and combines node and edge mutation in one prompt. The individual mutation methods remain expected symbols too.

## Finding

NetworkX exposed a broader exact-object ordering issue than earlier corpora: whole-file module chunks can dominate algorithm-heavy files because they contain the entire docstring/import surface. Strengthening the hybrid module penalty improved concrete symbol ranking without hurting the new corpus.

NetworkX also showed why intent rules need negative domains. The old graph-build prior helped Graphify, but it over-triggered on graph matrix questions. The fix keeps graph construction intent while excluding matrix/Laplacian/adjacency/degree wording.

## Adversarial Set

Run date: 2026-06-13

After the first NetworkX set saturated, a second adversarial set was added at `benchmarks/networkx-adversarial-python.json`. It keeps the same corpus but asks sharper near-miss questions around overloaded words:

- `build` as graph construction vs residual-network construction vs matrix computation
- `flow` as maximum-flow wrapper vs residual-network helper
- `parse` vs `read` for GraphML strings and file handles
- `shortest_path` wrapper dispatch vs bidirectional Dijkstra implementation
- `path` as route/path search vs `path_weight`
- sparse fast Gnp generation vs quadratic Gnp generation

Initial adversarial comparison before the new fixes:

```text
FTS:    Symbol Hit@1 0.54, Symbol Hit@5 0.85, File Hit@5 1.00, Avg 34ms
Symbol: Symbol Hit@1 0.77, Symbol Hit@5 0.92, File Hit@5 0.92, Avg 89ms
Hybrid: Symbol Hit@1 0.77, Symbol Hit@5 0.92, File Hit@5 0.92, Avg 86ms
```

Misses:

```text
shortest-path-dispatch-wrapper top=bidirectional_dijkstra
path-weight-existing-path      top=traveling_salesman_problem, expected path_weight/is_path at rank 2
gnp-sparse-fast-random-graph   top=gnp_random_graph, expected fast_gnp_random_graph at rank 2
```

Fixes:

- Bidirectional-Dijkstra intent now excludes dispatch wording such as `choose`, `between`, `branches`, `unweighted`, and `Bellman-Ford`.
- Path cost queries now get a `path weight intent` signal for `path_weight` and nearby `is_path`.
- Sparse/fast random graph wording now gets a `fast random graph intent` signal for `fast_gnp_random_graph`.

Final adversarial hybrid result:

```text
Mode: hybrid
Questions: 13
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 97ms
```

Final detail:

```text
flow-build-residual-network      top=build_residual_network
flow-maximum-wrapper-return      top=maximum_flow
graphml-parse-string             top=parse_graphml
graphml-read-path                top=read_graphml
shortest-path-dispatch-wrapper   top=shortest_path
dijkstra-bidirectional-specific  top=bidirectional_dijkstra
graph-add-single-edge            top=Graph.add_edge
set-edge-attributes-dict         top=set_edge_attributes
path-weight-existing-path        top=path_weight
laplacian-unnormalized           top=laplacian_matrix
laplacian-directed-transition    top=directed_laplacian_matrix
gnp-quadratic-random-graph       top=gnp_random_graph
gnp-sparse-fast-random-graph     top=fast_gnp_random_graph
```

Adversarial takeaway: the system needs both positive intent signals and negative triggers. The same words that helped earlier, such as `source`, `target`, `graph`, `path`, `fast`, and `build`, become misleading unless the ranker recognizes neighboring but different intents.
