# Django Benchmark Results

## Setup

- Corpus: local checkout at `/Users/juan/Repos/django`
- Commit checked during this pass: `f1440a7`
- Indexed mode: `--source-only`
- Index path used for this pass: `/tmp/agent-index-django.sqlite`
- Clean source-only index: 899 Python files, 11553 symbols, 40926 edges.
- Benchmark file: `benchmarks/django-python.json`
- Questions: 16 source-audited questions covering request handling, URL resolving, ORM/querysets, model validation, forms, template parsing, admin querysets, management commands, JSON responses, and CSRF middleware.

## Baselines

Initial Django benchmark before source-audit wording fixes:

| Mode | Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| FTS | 0.38 | 0.88 | 0.75 | 0.94 | 37ms |
| Symbol | 0.50 | 0.94 | 0.88 | 0.94 | 235ms |
| Hybrid | 0.50 | 0.94 | 0.88 | 0.94 | 235ms |

After source-audit wording fixes but before new ranking fixes, hybrid reached:

| Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| ---: | ---: | ---: | ---: | ---: |
| 0.75 | 0.94 | 0.88 | 0.94 | 229ms |

Final comparison after the Django ranking fixes:

| Mode | Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| FTS | 0.31 | 0.94 | 0.75 | 0.94 | 40ms |
| Symbol | 0.94 | 1.00 | 1.00 | 1.00 | 238ms |
| Hybrid | 1.00 | 1.00 | 1.00 | 1.00 | 250ms |

## Source-Audit Corrections

The first benchmark pass found some answer-key and wording issues:

- `BaseHandler.get_response` was expected, but the question said "resolve a request", which naturally over-weighted `BaseHandler.resolve_request`. The question now asks for getting an `HttpResponse` through the middleware chain.
- `Variable._resolve_lookup` is a source-valid implementation for resolving context dictionary, attribute, and list-index lookups. It was added alongside `Variable.resolve`.
- `ModelAdmin.get_queryset` was expected, but the question mentioned the changelist, which naturally pulled in `ModelAdmin.get_changelist`. The question now focuses on getting the queryset using ordering and the model manager.
- `BaseCommand.run_from_argv` was expected, but the question did not name `argv`, so concrete command `run()` methods competed too strongly. The question now names `run_from_argv` and argv parsing.

These were benchmark-quality fixes, not ranker changes.

## Ranking Fixes

Four remaining misses were real ranking gaps:

- `URLResolver.resolve` lost to the `url_patterns` property because the query contained both `URLResolver` and "URL patterns".
- `Parser.parse` was absent from the top five because the parser-action signal only boosted functions, so helper functions such as `parse_bits` won.
- `JsonResponse.__init__` lost to `FileResponse.set_headers` because dunder methods are normally guarded and the adjacent helper shared content-type words.
- `CsrfViewMiddleware.process_view` lost to `_check_token` because token-checking wording overpowered the orchestration method.

The fixes were implemented test-first:

- URL resolver questions now boost `URLResolver.resolve` and demote property-only URL pattern matches.
- Template parser questions now allow parser owner methods, not just top-level parse functions.
- JSON response serialization questions can boost the `JsonResponse.__init__` constructor while demoting file-response header helpers.
- CSRF process-view questions now prefer the middleware orchestration method over token/check helper methods.

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 16 friendly Django benchmark rows. The structured queries use owner/API-shaped terms such as `BaseHandler.load_middleware`, `URLResolver.resolve`, `QuerySet.filter`, `Model.save`, `Model.full_clean`, `BaseForm.full_clean`, `Parser.parse`, `ManagementUtility.execute`, `JsonResponse.__init__`, and `CsrfViewMiddleware.process_view`.

Index:

```text
node dist/cli.js index /Users/juan/Repos/django --source-only --index-path /tmp/agent-index-django-structured.sqlite
Indexed 899 files, 11553 symbols, 11553 chunks, 40926 edges at /tmp/agent-index-django-structured.sqlite (mode: source-only)
```

First structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 0.88
Symbol Hit@5: 0.88
Symbol MRR: 0.88
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.13
Avg latency: 217ms
rg-style File Hit@1: 0.44
rg-style File Hit@5: 0.81
rg-style File MRR: 0.59
rg-style Avg latency: 224ms

Misses:
model-save  top=Model.save_base
model-full-clean  top=Model.validate_constraints
```

Source/debug audit: both misses were right-file/right-neighborhood failures. `Model.save_base` is the lower-level implementation called by public `Model.save`, and `Model.validate_constraints` is one helper called by `Model.full_clean`. The broader issue was not Django-specific: a dotted agent term such as `Model.save` was being treated too much like "any method named `save`", and generic direct-owner action boosts could overpower an explicit dotted owner target.

The fix was test-first: add regressions for explicit public methods versus longer helpers and explicit orchestration methods versus named component helpers, then make dotted API references respect owner names when the reference names an owner like `Model`.

Final structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 224ms
rg-style File Hit@1: 0.44
rg-style File Hit@5: 0.81
rg-style File MRR: 0.59
rg-style Avg latency: 219ms

Misses: none
```

Preservation rerun after the Trio dunder-method fix:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 221ms
rg-style File Hit@1: 0.44
rg-style File Hit@5: 0.81
rg-style File MRR: 0.59
rg-style Avg latency: 199ms

Misses: none
```

This rerun first exposed a regression before the path-hint fix: `management-utility-execute` ranked `ManagementUtility.__init__` above `ManagementUtility.execute` because `__init__` appeared in `pathHints` for `django/core/management/__init__.py`. The fix keeps dunder-looking path hints out of symbol-intent query text, so explicit dunder terms such as `JsonResponse.__init__` or `CancelScope.__enter__` still work while package-file hints do not behave like constructor requests.

Interpretation: Django adds a large framework corpus to the structured-agent evidence. The rg-style baseline can often find the correct area, but it misses top-one file ranking on more than half the rows and cannot return exact symbols. The main agent-query lesson is that dotted owner targets are high-signal: `Model.save` should be treated as an exact address, while `save_base`, `validate_constraints`, and other helper vocabulary are nearby rooms.

## Concrete Examples

Fixed result:

```text
where does Django template Parser parse tokens until block tags and build nodelists?
```

- Before the fix: `parse_bits` in `django/template/library.py`.
- After the fix: `Parser.parse` in `django/template/base.py`.

Fixed result:

```text
where does Django JsonResponse serialize data to JSON and set the application/json content type?
```

- Before the fix: `FileResponse.set_headers`.
- After the fix: `JsonResponse.__init__`.

Fixed result:

```text
where does Django CsrfViewMiddleware process a view by checking CSRF cookies tokens origins and trusted origins?
```

- Before the fix: `CsrfViewMiddleware._check_token`.
- After the fix: `CsrfViewMiddleware.process_view`.

## Takeaways

- Django is the largest benchmark corpus so far by symbol count, and it quickly exposed constructor, property, parser-method, and orchestration-vs-helper ranking issues.
- Source-auditing wording matters. Small phrases such as "resolve a request" or "changelist" can point at valid adjacent APIs.
- The current rule set continues to improve exact top-one ranking, but the benchmark saturated after a small number of guarded intents. The next pressure should come from adversarial Django questions or another domain, not from treating this green set as broad proof.

## Adversarial Follow-Up

After the friendly set saturated, a 16-question adversarial set was added at `benchmarks/django-adversarial-python.json`. It asks sharper near-miss questions around URL reversing, resolver internals, regex-vs-route matching, queryset creation/update/prefetch helpers, form/model-form cleaning, template loader selection/rendering, authentication middleware, login session persistence, cache get-or-set behavior, timestamp signing, atomic transactions, and migration planning.

Initial adversarial comparison:

| Mode | Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| FTS | 0.56 | 0.88 | 0.94 | 1.00 | 43ms |
| Symbol | 0.88 | 0.94 | 0.94 | 0.94 | 254ms |
| Hybrid | 0.94 | 1.00 | 0.94 | 1.00 | 251ms |

The only real hybrid miss was the public URL reversing question:

```text
where does Django reverse a view name into a URL using urlconf args kwargs current_app and query or fragment values?
```

Before the fix, the broad `QuerySet` class ranked first because the query included common words such as `reverse`, `query`, and values. The expected `reverse` function in `django/urls/base.py` ranked second.

The fix added a test-first URL reverse intent that prefers top-level URL reverse functions and demotes query-set containers for URL-building wording.

Final adversarial comparison:

| Mode | Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| FTS | 0.56 | 0.88 | 0.94 | 1.00 | 39ms |
| Symbol | 0.94 | 1.00 | 1.00 | 1.00 | 249ms |
| Hybrid | 1.00 | 1.00 | 1.00 | 1.00 | 246ms |

The adversarial result is useful because it shows hybrid still helps on harder wording, but the same caveat remains: this is a hand-built, source-audited golden set. It proves the dogfood loop is working; it does not prove the rules are complete.

## Structured Agent Query vs rg-Style Baseline (Adversarial)

Run date: 2026-06-13

This pass added `agentQuery` fields to all 16 adversarial Django rows. The structured queries use explicit code-shaped terms and constraints for URL reversing, resolver internals, queryset creation/update/prefetch methods, form cleaning, template loading, authentication/session persistence, cache defaulting, signing age checks, transactions, and migration planning.

Index:

```text
node dist/cli.js index /Users/juan/Repos/django --source-only --index-path /tmp/agent-index-django-adversarial-structured.sqlite
Indexed 899 files, 11553 symbols, 11553 chunks, 40926 edges at /tmp/agent-index-django-adversarial-structured.sqlite (mode: source-only)
```

First structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 0.94
Symbol Hit@5: 1.00
Symbol MRR: 0.97
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 274ms
rg-style File Hit@1: 0.38
rg-style File Hit@5: 0.69
rg-style File MRR: 0.49
rg-style Avg latency: 308ms

Misses:
auth-login-session-cycle-key  symbolRank=2  fileRank=1  top=update_session_auth_hash  file=django/contrib/auth/__init__.py
```

Source/debug audit: `login` is the public entrypoint that persists `SESSION_KEY`, `BACKEND_SESSION_KEY`, and `HASH_SESSION_KEY`, rotates the token, sets `request.user`, and sends `user_logged_in`. `update_session_auth_hash` is a related helper that cycles the session key and updates only the auth hash. The initial structured query included adjacent helper-ish terms such as `session_auth_hash` and `cycle_key`, which made the helper rank above the intended public login flow.

Final structured pass after query refinement:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 289ms
rg-style File Hit@1: 0.38
rg-style File Hit@5: 0.69
rg-style File MRR: 0.49
rg-style Avg latency: 255ms

Misses: none
```

Interpretation: the adversarial structured run reinforces the current agent-contract lesson. Exact symbol navigation wins when the LLM supplies discriminating implementation terms, but helper terms should be included only when the helper is the intended edit location. In this case `user_logged_in`, `rotate_token`, `_set_auth_user`, and `_get_backend_from_user` point at `login`; `session_auth_hash` and `cycle_key` are better treated as surrounding context.
