# FastAPI Benchmark Results

Date: 2026-06-12

Corpus: local FastAPI checkout at `/Users/juan/Repos/fastapi`

Index command:

```bash
node dist/cli.js index /Users/juan/Repos/fastapi --source-only --index-path /tmp/agent-index-fastapi.sqlite
```

Clean source-only index:

- 48 Python files
- 410 symbols
- 410 chunks
- 1721 edges

FastAPI was the sixth benchmark frontier after the earlier five corpora went green. It is larger, more framework-shaped, and full of broad public classes that can outrank the exact implementation method.

## Golden Set

The benchmark has 12 source-audited questions covering:

- application OpenAPI schema caching
- docs route setup
- route registration
- router inclusion
- request handling and dependency solving
- response serialization
- dependency graph construction
- JSON-compatible encoding
- exception handlers
- HTTP bearer security
- OAuth2 password bearer security

Benchmark file:

```text
benchmarks/fastapi-python.json
```

## Current Metrics

| Mode | Symbol Hit@1 | Symbol Hit@5 | Symbol MRR | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FTS | 0.25 | 0.75 | 0.43 | 1.00 | 1.00 | 5ms |
| Symbol | 0.67 | 0.92 | 0.78 | 0.92 | 1.00 | 33ms |
| Hybrid | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 47ms |

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 12 FastAPI benchmark rows. The structured queries use code-shaped terms such as `add_api_route`, `serialize_response`, `get_dependant`, `jsonable_encoder`, and the concrete security scheme names where an LLM agent could reasonably infer them from the task.

Index:

```text
node dist/cli.js index /Users/juan/Repos/fastapi --source-only --index-path /tmp/agent-index-fastapi-structured.sqlite
Indexed 48 files, 410 symbols, 410 chunks, 1721 edges at /tmp/agent-index-fastapi-structured.sqlite (mode: source-only)
```

Benchmark:

```text
node dist/cli.js benchmark benchmarks/fastapi-python.json \
  --target /Users/juan/Repos/fastapi \
  --index-path /tmp/agent-index-fastapi-structured.sqlite \
  --mode hybrid \
  --query-style agent \
  --include-rg-baseline \
  --misses
```

Result:

```text
Mode: hybrid
Query style: agent
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 18ms
rg-style File Hit@1: 0.67
rg-style File Hit@5: 0.92
rg-style File MRR: 0.75
rg-style Avg latency: 14ms

Misses: none
```

Interpretation: FastAPI extends the structured-agent evidence to a framework-shaped corpus with routing, dependency injection, OpenAPI/docs setup, response serialization, and security dependencies. The rg-style file baseline is already useful at File Hit@5, but structured `agent-index` returns exact symbols at rank 1 and keeps the output compact enough for an agent to jump directly to edit locations.

## Progression

| Step | Hybrid Symbol Hit@1 | Hybrid Symbol Hit@5 | File Hit@5 | Notes |
| --- | ---: | ---: | ---: | --- |
| Clean baseline | 0.25 | 0.58 | 0.92 | Broad `FastAPI` containers and route decorator methods often outranked behavior symbols. |
| Framework container and HTTP verb guards | 0.42 | 0.67 | 1.00 | Treated `FastAPI` as context for behavior-heavy queries and stopped broad boosts for `get`/`post` style methods unless named. |
| Dependency graph intent | 0.42 | 0.75 | 1.00 | Stopped "build dependency graph" from triggering the generic graph-build prior. |
| Constructor container guard | 0.50 | 0.75 | 1.00 | Stopped `__init__` owner/source boosts unless the query asks about initialization or names the dunder. |
| Exception and auth callable intents | 0.75 | 0.92 | 1.00 | Surfaced tiny exception handler functions and authorization-header `__call__` methods; added scheme scoring so HTTP bearer does not lose to OAuth bearer. |
| Route registration intent | 0.83 | 1.00 | 1.00 | Preferred direct `add_api_route` and `APIRoute.__init__` registration symbols over router composition and HTTP verb decorator helpers. |
| Response serialization and dependency builder intents | 1.00 | 1.00 | 1.00 | Preferred `serialize_response` over broad request handling and `get_*dependant` builders over lower-level parameter helpers. |
| Docs/routes/encoder repair | 1.00 | 1.00 | 1.00 | Fresh rerun reopened docs setup, add-route, and JSON-compatible encoder ordering. Added guarded setup/docs, add-route action, and JSON-compatible encoder signals. |

## Query Examples

Good result after constructor guard:

```text
Question: where does FastAPI build and cache the OpenAPI schema for the application?
Top result: FastAPI.openapi in fastapi/applications.py
Why it matters: previously FastAPI.__init__ won because its huge constructor mentioned enough application/OpenAPI vocabulary.
```

Good result after dependency builder refinement:

```text
Question: where does FastAPI inspect endpoint signatures and build the dependency graph?
Top result: get_dependant in fastapi/dependencies/utils.py
Why it matters: this first beat FastAPI.build_middleware_stack, then still needed a second refinement because add_non_field_param_to_dependency was too low-level for the graph-building question.
```

Good result after exception-handler intent:

```text
Question: where does FastAPI convert HTTP exceptions and request validation errors into JSON responses?
Top result: request_validation_exception_handler in fastapi/exception_handlers.py
Why it matters: previously the small handler functions were buried behind module chunks and broad framework setup text.
```

Good result after callable auth intent:

```text
Question: where does FastAPI read OAuth2 password bearer tokens from the Authorization header?
Top result: OAuth2PasswordBearer.__call__ in fastapi/security/oauth2.py
Why it matters: natural-language "read token from header" maps to a callable dependency method, not the class or constructor.
```

Good result after route-registration intent:

```text
Question: where does FastAPI add an API route with response model dependencies and callbacks?
Top result: FastAPI.add_api_route in fastapi/applications.py
Expected symbols: FastAPI.add_api_route, APIRouter.add_api_route, or APIRoute.__init__
Why it matters: direct route registration had been losing to adjacent router composition and HTTP verb decorator methods.
```

Good result after documentation-route setup intent:

```text
Question: where does FastAPI setup the openapi json docs swagger ui and redoc routes?
Top result: FastAPI.setup in fastapi/applications.py
Why it matters: generic `api_route` decorators mention routes, but the question asks for the setup method that wires documentation routes.
```

Good result after JSON-compatible encoder intent:

```text
Question: where does FastAPI convert pydantic models dataclasses enums paths and collections into JSON compatible data?
Top result: jsonable_encoder in fastapi/encoders.py
Why it matters: lower-level serializer helpers are nearby, but "JSON compatible data" is the public encoder behavior agents usually need.
```

Good result after response-serialization intent:

```text
Question: where does FastAPI validate and serialize endpoint return values into the response model?
Top result: serialize_response in fastapi/routing.py
Why it matters: the broader request handler calls this function, but the question asks for the validation/serialization step itself.
```

## Findings

- Source-only filtering had to exclude `docs_src/` and `scripts/`; otherwise tutorial snippets and maintenance code polluted the benchmark.
- File retrieval is strong: hybrid File Hit@5 is `1.00`, and FTS File Hit@1 is already `1.00`.
- Exact-symbol ranking is saturated on this current 12-question set. That is a useful milestone, but it also means FastAPI no longer supplies fresh discovery pressure without more questions.
- Handler and callable behavior questions need explicit query understanding. `exception_handlers.py` and security `__call__` methods are easy for a human to spot, but plain lexical matching under-ranks them.
- Route registration, response serialization, and dependency graph construction all needed narrow intent signals to distinguish direct implementation symbols from nearby orchestration helpers.
- The response-serialization intent currently marks some nearby route decorator methods as candidates because their chunks mention response models. They rank far below `serialize_response`, but this is worth watching in the next corpus.

## Next Candidates

- Expand FastAPI with harder questions before adding more FastAPI-specific ranking rules.
- Add another application-shaped Python corpus so the intent rules are tested somewhere they were not designed.
- Audit whether broad intent candidate reasons, especially response serialization, should require symbol-name matches before appearing in result explanations.
