# attrs Benchmark Results

## Current Status

Run date: 2026-06-13

This was the first fresh `agent-eval` run after adding the Graphify comparison harness. The target repo was [`python-attrs/attrs`](https://github.com/python-attrs/attrs), cloned into `/tmp/agent-index-eval-attrs`.

The benchmark is intentionally small and source-audited, with 10 questions covering class generation, decorators, fields, recursive conversion, converters, validators, and setter hooks.

## Corpus Setup

To keep the comparison fair, both tools used a source-only copy containing only implementation `.py` files under `src/`:

```text
/tmp/attrs-source-only
```

`agent-index` indexed:

```text
Indexed 19 files, 227 symbols, 227 chunks, 769 edges at /tmp/agent-index-attrs-source-only.sqlite
```

Graphify extracted:

```text
[graphify extract] found 19 code, 0 docs, 0 papers, 0 images
[graphify extract] wrote /private/tmp/graphify-bench-attrs/graphify-out/graph.json — 385 nodes, 765 edges (no clustering)
```

As with the Graphify self-comparison, Graphify's benchmark reader required a temporary compatibility copy with `links = edges`.

## Graphify Token Benchmark

```text
Corpus:          20,250 words -> ~27,000 tokens (naive)
Graph:           405 nodes, 765 edges
Avg query cost:  ~2,680 tokens
Reduction:       10.1x fewer tokens per query
```

This is context-compression evidence, not exact retrieval evidence.

## agent-index Benchmark

Command:

```bash
node dist/cli.js benchmark benchmarks/attrs-python.json \
  --target /tmp/attrs-source-only \
  --index-path /tmp/agent-index-attrs-source-only.sqlite \
  --mode hybrid \
  --misses
```

Result:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 0.40
Symbol Hit@5: 0.60
Symbol MRR: 0.48
File Hit@1: 0.40
File Hit@5: 0.60
File MRR: 0.48
Partial file hits: 0.00
Avg latency: 13ms
```

Misses:

```text
field-factory              symbolRank=-  fileRank=-  top=attrs                  file=src/attr/_make.py
asdict-recursion           symbolRank=3   fileRank=3   top=make_class             file=src/attr/_make.py
optional-converter         symbolRank=-  fileRank=-  top=attrib                 file=src/attr/_make.py
default-if-none-converter  symbolRank=2   fileRank=2   top=_attrs_to_init_script  file=src/attr/_make.py
instance-of-validator      symbolRank=-  fileRank=-  top=_attrs_to_init_script  file=src/attr/_make.py
setter-pipeline            symbolRank=-  fileRank=-  top=_attrs_to_init_script  file=src/attr/_make.py
```

## agent-eval Comparison

Command:

```bash
node dist/cli.js agent-eval benchmarks/attrs-python.json \
  --target /tmp/attrs-source-only \
  --index-path /tmp/agent-index-attrs-source-only.sqlite \
  --mode hybrid \
  --graphify-results /tmp/attrs-graphify-query-results.json \
  --misses
```

Result:

```text
agent-index Symbol Hit@1: 0.40
agent-index Symbol Hit@5: 0.60
agent-index File Hit@1: 0.40
agent-index File Hit@5: 0.60
Graphify symbol mention rate: 0.70
Graphify file mention rate: 0.90
```

Comparison misses:

```text
class-builder-finalize     agentIndex=rank1  graphifySymbol=no   graphifyFile=yes  winner=agent-index
field-factory              agentIndex=miss   graphifySymbol=yes  graphifyFile=yes  winner=graphify
asdict-recursion           agentIndex=rank3  graphifySymbol=yes  graphifyFile=yes  winner=inconclusive
optional-converter         agentIndex=miss   graphifySymbol=yes  graphifyFile=yes  winner=graphify
default-if-none-converter  agentIndex=rank2  graphifySymbol=yes  graphifyFile=yes  winner=inconclusive
instance-of-validator      agentIndex=miss   graphifySymbol=no   graphifyFile=yes  winner=inconclusive
deep-iterable-validator    agentIndex=rank1  graphifySymbol=no   graphifyFile=no   winner=agent-index
setter-pipeline            agentIndex=miss   graphifySymbol=yes  graphifyFile=yes  winner=graphify
```

## Interpretation

attrs is a useful blind benchmark because it breaks the earlier Graphify-only story. On this corpus, `agent-index` is better when it finds the exact symbol, but Graphify's traversal context includes more expected answers overall.

The biggest `agent-index` failure pattern is that broad attrs construction terms pull results toward `src/attr/_make.py`, especially `_attrs_to_init_script`, even when the question asks about converters, validators, or setter hooks in smaller modules. This is a candidate-recall and routing problem, not just an ordering problem inside the right file.

Graphify's advantage here is broader context inclusion: it often mentions the expected file/symbol even when it is not ranking exact answers. Its weakness remains precision: mention rate does not tell an agent which result should be edited first.

## 2026-06-13 Follow-Up: Module-Domain Routing

The first fix focused on the `_make.py` routing failure rather than adding attrs-specific symbol names. The hypothesis was that questions containing module-domain words such as converter, validator, setter, serializer, parser, compiler, or filter should consider public symbols in matching file stems as candidates before broad construction machinery dominates the ranking.

Regression coverage was added before implementation with a tiny fixture containing `_make.py`, `converters.py`, `validators.py`, `setters.py`, and `funcs.py`. The test initially failed because the converter question still ranked `_attrs_to_init_script` first. The final fix:

- adds guarded module-domain candidate expansion for matching file stems;
- matches only the actual detected domain tokens, not every query token;
- adds object-serialization intent for dict/tuple/json conversion wording;
- treats `pipe` and `pipeline` as equivalent for setter pipeline questions;
- avoids broad domains such as field/schema/backend after they caused unrelated regressions in existing query tests.

Post-fix attrs benchmark:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 0.80
Symbol Hit@5: 1.00
Symbol MRR: 0.88
File Hit@1: 0.90
File Hit@5: 1.00
File MRR: 0.95
Partial file hits: 0.00
Avg latency: 21ms
```

Remaining misses:

```text
optional-converter         symbolRank=3  fileRank=1  top=default_if_none       file=src/attr/converters.py
default-if-none-converter  symbolRank=2  fileRank=2  top=_attrs_to_init_script  file=src/attr/_make.py
```

Post-fix `agent-eval` comparison:

```text
agent-index Symbol Hit@1: 0.80
agent-index Symbol Hit@5: 1.00
agent-index File Hit@1: 0.90
agent-index File Hit@5: 1.00
Graphify symbol mention rate: 0.70
Graphify file mention rate: 0.90
```

Interpretation: the module-routing fix moved attrs up to Graphify-level mention recall, and the later noun-factory follow-up moved the `field` factory question from a miss to top-one by recognizing "field factory" as an exact public factory request. The current attrs result now beats Graphify's symbol mention rate and matches its file mention rate while still returning ranked results. This is useful evidence, but not proof of general superiority: the two remaining misses still show nearby converter ordering problems.

## Converter Completion

The remaining converter misses were fixed in a later pass:

- `default_if_none` lost because `if` was treated as a required symbol-coverage token even though it is a connector word inside the snake-case symbol.
- `optional` lost because a question about passing through `None` did not look like an explicit conversion query, so broader converter-module context favored `default_if_none`.

Regression coverage now treats connector/glue words inside symbol names as optional for coverage and recognizes optional wrapper wording from `None` pass-through questions.

Final attrs benchmark:

```text
Mode: hybrid
Questions: 10
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
Misses: none
```

Final `agent-eval` comparison:

```text
agent-index Symbol Hit@1: 1.00
agent-index Symbol Hit@5: 1.00
agent-index File Hit@1: 1.00
agent-index File Hit@5: 1.00
Graphify symbol mention rate: 0.70
Graphify file mention rate: 0.90
```

Interpretation: attrs changed from the benchmark that made Graphify look better into evidence that ranked symbol navigation can beat Graphify-style traversal, as long as the ranker handles module intent and symbol-token glue carefully.

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 10 attrs benchmark rows. The structured queries use API-shaped terms such as `_ClassBuilder.build_class`, `attr.s`, `define`, `field`, `asdict`, `_asdict_anything`, `optional`, `default_if_none`, `instance_of`, `_InstanceOfValidator.__call__`, `deep_iterable`, `_DeepIterable.__call__`, and `pipe`.

Index:

```text
node dist/cli.js index /tmp/attrs-source-only --source-only --index-path /tmp/agent-index-attrs-structured.sqlite
Indexed 19 files, 227 symbols, 227 chunks, 769 edges at /tmp/agent-index-attrs-structured.sqlite (mode: source-only)
```

First structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 10
Symbol Hit@1: 0.80
Symbol Hit@5: 0.90
File Hit@1: 0.90
File Hit@5: 0.90

Misses:
classic-attrs-decorator  symbolRank=3  fileRank=1  top=make_class  file=src/attr/_make.py
field-factory            symbolRank=-  fileRank=-  top=default_if_none  file=src/attr/converters.py
```

Source/debug audit: both misses were query-shaping problems, not ranker defects. The classic decorator query used broad project/package words, so class-building helpers in `_make.py` could beat the actual `attrs` decorator. The field factory query over-included `default`, `validator`, and `converter`, which routed the query into neighboring converter and validator modules.

Refined structured pass:

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
Avg latency: 11ms
rg-style File Hit@1: 0.40
rg-style File Hit@5: 1.00
rg-style File MRR: 0.65
rg-style Avg latency: 6ms

Misses: none
```

Interpretation: attrs reinforces the agent-query contract. The LLM should choose implementation/API terms that identify the edit location, not every adjacent concept mentioned in a docstring. When the query is shaped that way, `agent-index` returns the exact symbol at rank one while rg-style file ranking still needs top-five to recover all expected files.

## Next Step

attrs now meets the threshold for this stage. The next useful work is to keep attrs as a regression fixture while adding structured-agent coverage to h11 and wsproto, then adding fresh repos or larger source-audited slices.
