# Pydantic Benchmark Results

Date: 2026-06-13

Corpus: local Pydantic checkout at `/Users/juan/Repos/pydantic`

Revision:

```text
2700a3594
```

Index command:

```bash
node dist/cli.js index /Users/juan/Repos/pydantic --source-only --index-path /tmp/agent-index-pydantic.sqlite
```

Clean source-only index from the latest verification:

- 112 Python files
- 2335 symbols
- 2335 chunks
- 8866 edges

Pydantic is the seventh corpus. It is useful because it is not a web router, CLI framework, renderer, or test runner. It stresses model validation, serialization, schema generation, decorator factories, and internal class construction.

## Golden Set

The benchmark has 14 source-audited questions covering:

- `BaseModel` validation, dumping, JSON schema, and rebuild APIs
- dynamic `create_model`
- `TypeAdapter` validation and JSON dumping
- field and model validator decorators
- computed field decorators
- model field collection and class completion internals
- `validate_call`
- alias path lookup

Benchmark file:

```text
benchmarks/pydantic-python.json
```

## Current Metrics

| Mode | Symbol Hit@1 | Symbol Hit@5 | Symbol MRR | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FTS | 0.43 | 0.86 | 0.60 | 0.64 | 0.86 | 23ms |
| Symbol | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 101ms |
| Hybrid | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 99ms |

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 14 Pydantic benchmark rows. The structured queries use code-shaped terms such as `BaseModel`, `model_validate`, `model_dump`, `TypeAdapter`, `field_validator`, `complete_model_class`, and `AliasPath.search_dict_for_path`, plus path and symbol-kind constraints an LLM agent could reasonably infer before calling the tool.

Index:

```text
node dist/cli.js index /Users/juan/Repos/pydantic --source-only --index-path /tmp/agent-index-pydantic-structured.sqlite
Indexed 112 files, 2335 symbols, 2335 chunks, 8866 edges at /tmp/agent-index-pydantic-structured.sqlite (mode: source-only)
```

Benchmark:

```text
node dist/cli.js benchmark benchmarks/pydantic-python.json \
  --target /Users/juan/Repos/pydantic \
  --index-path /tmp/agent-index-pydantic-structured.sqlite \
  --mode hybrid \
  --query-style agent \
  --include-rg-baseline \
  --misses
```

Result:

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
Avg latency: 69ms
rg-style File Hit@1: 0.14
rg-style File Hit@5: 0.79
rg-style File MRR: 0.37
rg-style Avg latency: 37ms

Misses: none
```

Interpretation: Pydantic is the strongest structured-agent gap so far. The rg-style baseline often finds related validation, schema, or decorator files somewhere in the top five, but top-one file ranking is poor because terms like `validate`, `schema`, `model`, and `field` are spread across the library. Structured `agent-index` keeps the owner/API terms tied to symbols and returns exact edit locations at rank 1.

## Progression

| Step | Hybrid Symbol Hit@1 | Hybrid Symbol Hit@5 | File Hit@5 | Notes |
| --- | ---: | ---: | ---: | --- |
| Initial Pydantic benchmark | 0.86 | 1.00 | 1.00 | Top-five recall was already strong, but `computed_field` beat `BaseModel.model_dump`, and schema-generation helpers beat `complete_model_class`. |
| Model dump and completion intents | 1.00 | 1.00 | 1.00 | Added narrow intent rules for model-dump serialization and model-class completion orchestration. Prior six corpora stayed saturated. |
| Current-state rerun after broader benchmark work | 0.50 | 0.64 | 0.71 | The current all-files index showed a worse live state than the older source-only snapshot: validator/helper modules beat public Pydantic APIs such as `BaseModel.model_validate`, `TypeAdapter.validate_python`, `create_model`, and schema lifecycle APIs. |
| Public API owner, factory, JSON-schema, and lifecycle fixes | 1.00 | 1.00 | 1.00 | Added test-first owner API routing for exact owner mentions, dynamic model factory routing, public model JSON-schema routing, and model lifecycle routing. Tightened owner matching so action words like "generate schema" do not masquerade as an explicit `GenerateSchema` owner mention. |

## Query Examples

Good result after model-dump intent:

```text
Question: where does Pydantic serialize a model to a Python dict with include exclude aliases unset defaults none computed fields and round trip options?
Top result: BaseModel.model_dump in pydantic/main.py
Why it matters: computed_field is related to one option, but model_dump is the serialization entrypoint for the whole question.
```

Good result after model-completion intent:

```text
Question: where does Pydantic finish building a model class by generating core schema validators serializers and computed fields?
Top result: complete_model_class in pydantic/_internal/_model_construction.py
Why it matters: GenerateSchema helpers build pieces of the schema, but complete_model_class orchestrates finishing the model class.
```

Good result after public owner API routing:

```text
Question: where does Pydantic TypeAdapter validate a Python object with strict extra from_attributes partial validation by_alias and by_name options?
Top result: TypeAdapter.validate_python in pydantic/type_adapter.py
Why it matters: validate-call helpers and validator decorators share vocabulary, but the question names the public owner API.
```

Good result after owner-mention tightening:

```text
Question: where does Pydantic generate JSON schema for a model with by_alias ref_template union_format schema generator and mode?
Top result: BaseModel.model_json_schema in pydantic/main.py
Why it matters: "generate schema" is ordinary action wording, not an explicit reference to the internal GenerateSchema class.
```

Good initial result:

```text
Question: where does Pydantic validate_call wrap a function to validate arguments and optionally validate the return value?
Top result: validate_call in pydantic/validate_call_decorator.py
Why it matters: this validates the ranker on a decorator factory that creates a wrapper object rather than a simple model method.
```

## Findings

- Pydantic broke the six-corpus saturation in a useful way. The initial hybrid score was Symbol Hit@1 `0.86`, not `1.00`.
- The misses were exact-object ordering misses, not file recall misses. The expected symbols were already in the top five.
- Public API questions can contain option words that point at adjacent helpers. `computed fields` pulled `computed_field` above `BaseModel.model_dump` until the ranker learned the broader model-dump intent.
- Internal orchestration questions need a signal for "finish/build class" separate from "generate schema." Otherwise lower-level schema builder methods look more lexically relevant.
- A later current-state rerun exposed a stronger version of the same problem: broad `validator`, `serializer`, and schema-helper modules can dominate public API owner questions unless exact owner mentions and public API lifecycle questions get their own signals.
- The owner API fix initially overreached by treating generic action words as class owners. The regression test now requires exact owner phrasing before applying `named owner API intent`.
- The new intent rules are still hand-built. They improve dogfood behavior, but they should be treated as evidence that query understanding matters, not as proof that the current rule list is complete.

## Next Candidates

- Add another corpus or expand Pydantic with harder questions before adding more Pydantic-specific ranking rules.
- Audit whether model-related intent rules over-trigger on repos where "model" means database model, ML model, or UI model.
- Keep preserving all earlier corpora after every new intent rule.
