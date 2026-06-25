# Publishing Outline

## Working Title

Building a Symbol-First Code Index for Coding Agents

## Thesis

Agents do not only need more text search. They need search results tied to code structure: symbols, line ranges, and nearby relationships.

## Outline

1. Problem: plain text search often finds words, not the right code object.
2. Baseline inspiration: Graphify shows the value of code graphs but carries more workflow than a small retrieval experiment needs.
3. Prototype: TypeScript CLI, Tree-sitter Python extraction, SQLite/FTS5, symbol-first ranking.
4. Key lesson: normalize identifiers so natural-language questions can find `snake_case` and dotted paths.
5. Benchmark: 10 Graphify questions, Hit@1, Hit@5, MRR, partial file hits, latency.
6. Results: first Graphify all-files run reached blended Hit@5 0.20; source-only filtering improved blended Hit@5 to 0.30; truth-set auditing improved blended Hit@5 to 0.50; split scoring revealed exact Symbol Hit@5 was only 0.20 while File Hit@5 was 0.50; conservative hybrid plus query-intent candidate expansion later reached Symbol Hit@1 0.50 and Symbol Hit@5 0.70; generic action aliases reached Symbol Hit@1 0.70 and Symbol Hit@5 1.00; core-symbol ordering reached Symbol Hit@1 0.90; incremental change-detection intent saturated the current Graphify set at Symbol Hit@1 1.00.
7. What worked: cited symbol results, simple local setup, one-hop graph context.
8. What did not: unresolved call names, lexical-only phrasing limits, no incremental updates.
9. Next steps: compare against plain FTS, add embeddings, add MCP, add incremental indexing.
10. Cross-corpus check: HTTPX breaks the Graphify-perfect story, then soft hybrid recovers HTTPX without giving up Graphify.
11. Third-corpus check: Click validates hybrid as the best current mode, while exposing exact-method ordering and over-broad intent triggers.
12. Product-readiness check: once retrieval looked useful, the next blocker was ordinary usability: help exit codes, package bin layout, clean build output, and a README.
13. Fourth-corpus check: Rich mostly generalizes the hybrid gains, exposes a useful public-API-vs-parser ambiguity around markup, then validates a scoped parser/property ranking fix.
14. Fifth-corpus check: pytest breaks the "everything is green" story in a useful way, showing strong file retrieval but remaining exact-symbol ranking gaps in hook-heavy framework internals.
15. Sixth-corpus check: FastAPI breaks the saturated story again. File retrieval stays strong, while exact-symbol ranking improves through framework-container, handler, callable-method, route-registration, response-serialization, and dependency-builder fixes.
16. Seventh-corpus check: Pydantic adds validation, serialization, schema generation, decorator factories, and model-construction pressure. It breaks saturation with two exact-object ordering misses, then validates narrow model-dump and model-completion intent rules.
17. Eighth-corpus check: Poetry adds packaging and CLI infrastructure pressure. It exposes one benchmark-label issue and three real adjacent-helper ordering misses around solving, installer option application, and plugin activation.
18. Ninth-corpus check: NetworkX adds graph algorithms, matrix routines, graph classes, GraphML, isomorphism, and flow. It exposes whole-file module dominance and overloaded graph-build wording, then validates stronger module demotion and scoped bidirectional-Dijkstra intent.
19. Adversarial check: a second NetworkX set uses near-miss wording to stress overloaded intent words. It catches dispatch-vs-bidirectional, path-cost-vs-path-search, and fast-vs-quadratic random graph failures after the friendly benchmark was already green.
20. Tenth-corpus check: SQLAlchemy adds ORM, SQL construction, execution, async wrappers, compilation, events, and pooling. It exposes execute-vs-execution-options, sync-vs-async wrappers, factory constructors, and duplicate overload results.
21. SQLAlchemy adversarial check: sharper wording around bind parameters, literal execution, URL parsing, exact scalar results, engine disposal, and event registry internals catches false-positive intent triggers after the friendly SQLAlchemy set is green.
22. Eleventh-corpus check: Scikit-learn adds scientific/data tooling pressure. It exposes crowded FTS candidates, estimator class containers, owner-method candidate gaps, noun-vs-action exact matching, cross-validation score, nearest-neighbor, input-array validation, and forest fitting behavior.
23. Task-queue check: Celery adds worker, broker, beat, canvas, and backend pressure. It exposes a top-level `t/` source-only filtering gap and exact-object misses around lifecycle methods and schedule subtypes.
24. Celery adversarial check: sharper task-queue questions expose helper-vs-implementation ranking issues around tracer helpers, report wording, backend state, event-handler prefixes, strategy refresh, scheduled-entry logging, and group freeze metadata.
25. Readiness rerun: stale docs again hide reality. FastAPI and NetworkX reopen under fresh source-only checks, then saturate after guarded docs-route/encoder, named-concept, and graph-algorithm repairs.
26. Fresh blind repo check: Black adds formatter, parser, notebook, and daemon vocabulary. It catches parser-domain overreach and stdin/stdout ranking weakness, then saturates after guarded config/header/stdio fixes.
27. Black same-corpus comparison: Graphify reduces context by `29.9x`, but its query traversal mentions expected symbols/files at `0.58`/`0.83`; `agent-index` reaches ranked Symbol/File Hit@1/Hit@5 `1.00/1.00`.
28. Jinja blind repo check: a template engine stresses loader/source, parser/compiler, runtime, sandbox, filter, and meta-analysis vocabulary. It catches level-of-abstraction failures, then saturates after guarded template pipeline fixes.
29. Jinja same-corpus comparison: Graphify reduces context by `11.6x`, but its query traversal mentions expected symbols/files at `0.08`/`0.67`; `agent-index` reaches ranked Symbol/File Hit@1/Hit@5 `1.00/1.00`.
30. attrs recovery check: the first Graphify comparison that made `agent-index` look worse becomes the main proof discipline story. Module-domain routing moved attrs to `0.80/1.00`; glue-word symbol coverage and optional-wrapper intent later moved it to ranked Symbol/File Hit@1/Hit@5 `1.00/1.00`, beating Graphify mention rates of `0.70`/`0.90`.
31. h11 completion check: a keep-alive top-two miss shows that file-level success is not enough for agents that want the exact function. A narrow exact-function specificity boost moves h11 to Symbol/File Hit@1/Hit@5 `1.00/1.00`.
32. wsproto blind repo check: WebSocket protocol code stresses handshakes, extension negotiation, and frame-to-event conversion. Initial hybrid gets Symbol Hit@1 `0.58`, Hit@5 `1.00`; guarded owner-action, handshake, extension, and event-conversion rules move it to Symbol/File Hit@1/Hit@5 `1.00/1.00`.
33. wsproto same-corpus comparison: Graphify reduces context by `3.9x`, but its query traversal mentions expected symbols/files at `0.00`/`0.75`; `agent-index` reaches ranked Symbol/File Hit@1/Hit@5 `1.00/1.00`.
34. urllib3 structured-agent and Graphify comparison: HTTP transport code validates the agent-query cookbook around pools, retries, proxies, SSL, URLs, multipart forms, and streaming. The same-corpus Graphify comparison shows `7.0x` token reduction, Graphify symbol/file mentions at `0.17`/`0.67`, and structured `agent-index` ranked Symbol/File Hit@1/Hit@5 `1.00/1.00`.
35. Language-support readiness check: newer findings extend the quality bar beyond Python, including Dart's move from fixture-backed Flutter coverage to a public `json_serializable.dart` real-repository benchmark. The article should avoid stale "fixture-only" wording when summarizing language coverage.

## Current Baseline Comparison

- Symbol mode: Symbol Hit@1 0.10, Symbol Hit@5 0.20, File Hit@5 0.50, Avg 47ms.
- Plain FTS mode: Symbol Hit@1 0.00, Symbol Hit@5 0.40, File Hit@5 0.50, Avg 6ms.
- Hybrid mode: Symbol Hit@1 0.10, Symbol Hit@5 0.40, File Hit@5 0.50, Avg 43ms.
- Hybrid plus query-intent expansion: Symbol Hit@1 0.50, Symbol Hit@5 0.70, File Hit@5 0.70, Avg 56ms.
- Hybrid plus action aliases: Symbol Hit@1 0.70, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 60ms.
- Hybrid plus core-symbol ordering: Symbol Hit@1 0.90, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 61ms.
- Hybrid plus incremental change-detection intent: Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 53ms.
- HTTPX symbol mode baseline: Symbol Hit@1 0.42, Symbol Hit@5 0.83, File Hit@5 0.92, Avg 15ms.
- HTTPX hybrid mode baseline: Symbol Hit@1 0.25, Symbol Hit@5 0.42, File Hit@5 0.83, Avg 11ms.
- HTTPX audited symbol mode: Symbol Hit@1 0.38, Symbol Hit@5 0.85, File Hit@5 1.00, Avg 11ms.
- HTTPX audited hybrid mode: Symbol Hit@1 0.31, Symbol Hit@5 0.46, File Hit@5 0.85, Avg 13ms.
- HTTPX after decorated-definition extraction: symbol mode Symbol Hit@1 0.46, Symbol Hit@5 0.92, File Hit@5 1.00, Avg 13ms; hybrid mode Symbol Hit@1 0.38, Symbol Hit@5 0.54, File Hit@5 0.85, Avg 13ms.
- HTTPX after dotted API and method owner/name ranking: symbol mode Symbol Hit@1 0.69, Symbol Hit@5 1.00, File Hit@1 1.00, Avg 12ms; hybrid mode Symbol Hit@1 0.46, Symbol Hit@5 0.62, File Hit@5 0.92, Avg 12ms.
- HTTPX after soft lexical hybrid ranking: hybrid mode Symbol Hit@1 0.77, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 15ms; Graphify hybrid stayed Symbol Hit@1 1.00.
- HTTPX after exact-object ordering: hybrid mode Symbol Hit@1 0.85, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 13ms.
- HTTPX after guarded coding-domain signals: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 14ms.
- Click after scoped entrypoint intent, hybrid method specificity, answer-key audits, the CliRunner entrypoint fix, stem-equivalent core-symbol ranking, exact-object ordering, and decorator-target signals: FTS Symbol Hit@1 0.43, Symbol Hit@5 0.86, File Hit@5 0.93, Avg 3ms; symbol mode Symbol Hit@1 0.43, Symbol Hit@5 0.86, File Hit@5 1.00, Avg 16ms; hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 20ms.
- Rich source-only check before the markup fix: FTS Symbol Hit@1 0.50, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 6ms; symbol mode Symbol Hit@1 0.92, Symbol Hit@5 0.92, File Hit@5 1.00, Avg 28ms; hybrid mode Symbol Hit@1 0.92, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 27ms.
- Rich after the markup parser/property fix: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 26ms; Graphify, HTTPX, and Click stayed at Symbol Hit@1/Hit@5 1.00.
- Pytest first clean source-only check after excluding `testing/`: FTS Symbol Hit@1 0.13, Symbol Hit@5 0.75, File Hit@5 0.94, Avg 8ms; symbol mode Symbol Hit@1 0.25, Symbol Hit@5 0.75, File Hit@5 0.94, Avg 43ms; hybrid mode Symbol Hit@1 0.38, Symbol Hit@5 0.94, File Hit@5 1.00, Avg 43ms.
- Pytest after narrowing the build intent and source-backed answer-key audit: FTS Symbol Hit@1 0.13, Symbol Hit@5 0.75, File Hit@5 0.94, Avg 8ms; symbol mode Symbol Hit@1 0.31, Symbol Hit@5 0.88, File Hit@5 0.94, Avg 42ms; hybrid mode Symbol Hit@1 0.63, Symbol Hit@5 0.94, File Hit@5 1.00, Avg 42ms.
- Pytest after hook-spec demotion and lifecycle-action candidates: hybrid mode Symbol Hit@1 0.81, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 41ms.
- Pytest after action/domain, flag-behavior, and exact-file-context fixes: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 59ms.
- FastAPI clean source-only baseline: FTS Symbol Hit@1 0.25, Symbol Hit@5 0.75, File Hit@5 1.00, Avg 5ms; symbol mode Symbol Hit@1 0.08, Symbol Hit@5 0.50, File Hit@5 0.92, Avg 31ms; hybrid mode Symbol Hit@1 0.25, Symbol Hit@5 0.58, File Hit@5 0.92, Avg 32ms.
- FastAPI after framework-container, HTTP verb, dependency-graph, and constructor-container fixes: hybrid mode Symbol Hit@1 0.50, Symbol Hit@5 0.75, File Hit@5 1.00, Avg 34ms.
- FastAPI after exception-handler and callable-auth intent fixes: hybrid mode Symbol Hit@1 0.75, Symbol Hit@5 0.92, File Hit@1 1.00, File Hit@5 1.00, Avg 32ms.
- FastAPI after route-registration intent: hybrid mode Symbol Hit@1 0.83, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 33ms.
- FastAPI after response-serialization and dependency-builder refinements: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 36ms.
- FastAPI after docs-route setup, add-route action, and JSON-compatible encoder repair: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 47ms.
- Pydantic initial source-only check: FTS Symbol Hit@1 0.43, Symbol Hit@5 0.86, File Hit@5 0.86, Avg 18ms; symbol mode before final fixes Symbol Hit@1 0.71, Symbol Hit@5 0.86, File Hit@5 0.93; hybrid mode Symbol Hit@1 0.86, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 57ms.
- Pydantic after model-dump and model-completion intents: symbol mode Symbol Hit@1 0.86, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 54ms; hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 65ms.
- Poetry initial source-only check: FTS Symbol Hit@1 0.25, Symbol Hit@5 0.83, File Hit@5 0.92, Avg 7ms; symbol mode after fixes Symbol Hit@1 0.58, Symbol Hit@5 0.92, File Hit@5 1.00, Avg 44ms; initial hybrid before the installer benchmark correction and ranking fixes Symbol Hit@1 0.67, Symbol Hit@5 0.92, File Hit@5 0.92, Avg 39ms.
- Poetry after source audit plus solver, installer-option, plugin-activation, and stronger entrypoint scoring: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 53ms.
- NetworkX initial source-only check: FTS Symbol Hit@1 0.50, Symbol Hit@5 0.86, File Hit@5 0.93, Avg 37ms; symbol mode Symbol Hit@1 0.36, Symbol Hit@5 0.57, File Hit@5 0.79, Avg 90ms; hybrid mode Symbol Hit@1 0.50, Symbol Hit@5 0.71, File Hit@5 0.79, Avg 91ms.
- NetworkX after benchmark audit, stronger module demotion, graph-matrix intent scoping, exact class-name scoring, and bidirectional-Dijkstra intent: FTS Symbol Hit@1 0.50, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 28ms; symbol mode Symbol Hit@1 0.50, Symbol Hit@5 0.86, File Hit@5 1.00, Avg 75ms; hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 74ms.
- NetworkX adversarial initial check: FTS Symbol Hit@1 0.54, Symbol Hit@5 0.85, File Hit@5 1.00, Avg 34ms; symbol mode Symbol Hit@1 0.77, Symbol Hit@5 0.92, File Hit@5 0.92, Avg 89ms; hybrid mode Symbol Hit@1 0.77, Symbol Hit@5 0.92, File Hit@5 0.92, Avg 86ms.
- NetworkX adversarial after dispatch, path-weight, and fast-random-graph fixes: FTS Symbol Hit@1 0.54, Symbol Hit@5 0.85, File Hit@5 1.00, Avg 37ms; symbol mode Symbol Hit@1 0.92, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 96ms; hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 97ms.
- NetworkX after named-concept/factory/Graph-owner repair plus multisource-Dijkstra, VF2/isomorphism, and quadratic-Gnp intents: friendly hybrid Symbol/File Hit@1/Hit@5 1.00/1.00, Avg 107ms; adversarial hybrid Symbol/File Hit@1/Hit@5 1.00/1.00, Avg 96ms.
- SQLAlchemy initial source-only check: FTS Symbol Hit@1 0.13, Symbol Hit@5 0.75, File Hit@5 0.94, Avg 45ms; symbol mode Symbol Hit@1 0.38, Symbol Hit@5 0.75, File Hit@5 1.00, Avg 153ms; hybrid mode Symbol Hit@1 0.63, Symbol Hit@5 0.88, File Hit@5 0.94, Avg 153ms.
- SQLAlchemy after source audit, execution/factory intent fixes, and overload dedupe: FTS Symbol Hit@1 0.13, Symbol Hit@5 0.81, File Hit@5 0.94, Avg 46ms; symbol mode Symbol Hit@1 0.69, Symbol Hit@5 0.88, File Hit@5 1.00, Avg 222ms; hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 247ms.
- SQLAlchemy adversarial initial check: FTS Symbol Hit@1 0.38, Symbol Hit@5 0.85, File Hit@5 1.00, Avg 67ms; symbol mode Symbol Hit@1 0.23, Symbol Hit@5 0.62, File Hit@5 0.85, Avg 207ms; hybrid mode Symbol Hit@1 0.54, Symbol Hit@5 0.85, File Hit@5 0.85, Avg 206ms.
- SQLAlchemy adversarial after bind-parameter, URL-parse, exact-scalar, engine-disposal, and event-key-listener fixes: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 247ms.
- Scikit-learn initial source-only check: FTS Symbol Hit@1 0.13, Symbol Hit@5 0.25, File Hit@5 0.88, Avg 44ms; symbol mode Symbol Hit@1 0.25, Symbol Hit@5 0.56, File Hit@5 1.00, Avg 130ms; hybrid mode Symbol Hit@1 0.44, Symbol Hit@5 0.63, File Hit@5 0.94, Avg 125ms.
- Scikit-learn after owner-method, exact-symbol, and scientific/ML intent fixes: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 220ms.
- Scikit-learn adversarial initial check: hybrid mode Symbol Hit@1 0.62, Symbol Hit@5 0.92, File Hit@5 0.92, Avg 157ms.
- Scikit-learn adversarial after final-estimator prediction, grid-search, nearest-neighbor graph, paired-validation, and estimator-data-validation fixes: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 201ms.
- Django initial check: FTS Symbol Hit@1 0.38, Symbol Hit@5 0.88, File Hit@5 0.94, Avg 37ms; symbol mode Symbol Hit@1 0.50, Symbol Hit@5 0.94, File Hit@5 0.94, Avg 235ms; hybrid mode Symbol Hit@1 0.50, Symbol Hit@5 0.94, File Hit@5 0.94, Avg 235ms.
- Django after source-audit wording fixes: hybrid mode Symbol Hit@1 0.75, Symbol Hit@5 0.94, File Hit@5 0.94, Avg 229ms.
- Django after URL resolver, template parser, JSON response, and CSRF process-view fixes: FTS Symbol Hit@1 0.31, Symbol Hit@5 0.94, File Hit@5 0.94, Avg 40ms; symbol mode Symbol Hit@1 0.94, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 238ms; hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 250ms.
- Django adversarial initial check: FTS Symbol Hit@1 0.56, Symbol Hit@5 0.88, File Hit@5 1.00, Avg 43ms; symbol mode Symbol Hit@1 0.88, Symbol Hit@5 0.94, File Hit@5 0.94, Avg 254ms; hybrid mode Symbol Hit@1 0.94, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 251ms.
- Django adversarial after URL reverse fix: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 246ms.
- Django adversarial structured-agent check: first structured hybrid Symbol Hit@1/Hit@5 0.94/1.00; refining the login query away from adjacent auth-hash helper terms moved Symbol/File Hit@1/Hit@5 to 1.00/1.00, Avg 289ms; rg-style baseline over the same terms reached File Hit@1 0.38, File Hit@5 0.69, File MRR 0.49.
- Agent query cookbook: `docs/agent-query-cookbook.md` turns the structured-agent lessons into a reusable contract for LLMs: choose code-shaped terms, separate path hints, narrow symbol kinds, avoid adjacent-helper over-weighting, and debug misses before changing ranking.
- Celery initial clean source-only check: FTS Symbol Hit@1 0.38, Symbol Hit@5 0.81, File Hit@5 0.94, Avg 16ms; symbol mode Symbol Hit@1 0.69, Symbol Hit@5 0.81, File Hit@5 0.94, Avg 51ms; hybrid mode Symbol Hit@1 0.88, Symbol Hit@5 1.00, File Hit@5 1.00, Avg 52ms.
- Celery after top-level `t/` scanner filtering, early single-method specificity, and schedule-subtype due intent: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 46ms.
- Celery structured-agent check: structured hybrid Symbol/File Hit@1/Hit@5 1.00/1.00, Avg 46ms; rg-style baseline over the same terms reached File Hit@1 0.31, File Hit@5 0.88, File MRR 0.56.
- Celery adversarial initial pass in this iteration: hybrid mode Symbol Hit@1 0.63, Symbol Hit@5 0.94, File Hit@1 0.75, File Hit@5 0.94, Avg 62ms.
- Celery adversarial after report-scope, backend-state, event-prefix, strategy-refresh, eager-task, scheduler-entry, and group-freeze metadata fixes: hybrid mode Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@1 1.00, File Hit@5 1.00, Avg 67ms.
- Celery adversarial structured-agent check: structured hybrid Symbol/File Hit@1/Hit@5 1.00/1.00, Avg 65ms; rg-style baseline over the same terms reached File Hit@1 0.44, File Hit@5 0.88, File MRR 0.63. This is the first clean post-cookbook adversarial pass.
- Black blind benchmark: initial hybrid Symbol Hit@1 `0.67`, Symbol Hit@5 `0.75`, File Hit@5 `0.75`; FTS Symbol Hit@1/Hit@5 `0.25/0.83`; symbol mode `0.75/1.00`; after config/header/stdio repair, hybrid Symbol/File Hit@1/Hit@5 `1.00/1.00`, Avg about `40ms`.
- Black structured-agent check: first structured hybrid Symbol Hit@1/Hit@5 0.92/1.00; removing adjacent verifier-helper terms moved Symbol/File Hit@1/Hit@5 to 1.00/1.00, Avg 31ms; rg-style baseline over the same terms reached File Hit@1 0.50, File Hit@5 0.92, File MRR 0.69.
- Black same-corpus Graphify comparison: Graphify token reduction `29.9x`; Graphify symbol/file mention rates `0.58`/`0.83`; agent-index Symbol/File Hit@1/Hit@5 `1.00/1.00`.
- Jinja blind benchmark: initial hybrid Symbol Hit@1 `0.75`, Symbol Hit@5 `0.92`, File Hit@5 `0.92`; after template pipeline repair, hybrid Symbol/File Hit@1/Hit@5 `1.00/1.00`, Avg `33ms`.
- Jinja structured-agent check: structured hybrid Symbol/File Hit@1/Hit@5 `1.00/1.00`, Avg `29ms`; rg-style baseline File Hit@1 `0.42`, File Hit@5 `0.75`, File MRR `0.58`.
- Jinja same-corpus Graphify comparison: Graphify token reduction `11.6x`; Graphify symbol/file mention rates `0.08`/`0.67`; agent-index Symbol/File Hit@1/Hit@5 `1.00/1.00`.
- attrs completion: after module-domain routing, connector/glue token coverage, and optional-wrapper intent, hybrid Symbol/File Hit@1/Hit@5 reaches `1.00/1.00`; Graphify same-corpus mention rates remain symbol `0.70`, file `0.90`.
- attrs structured-agent check: first structured hybrid Symbol Hit@1/Hit@5 `0.80/0.90`; source-shaped query refinement moved Symbol/File Hit@1/Hit@5 to `1.00/1.00`, Avg `11ms`; rg-style baseline File Hit@1 `0.40`, File Hit@5 `1.00`, File MRR `0.65`.
- h11 completion: after exact-function specificity for the keep-alive miss, hybrid Symbol/File Hit@1/Hit@5 reaches `1.00/1.00`.
- h11 structured-agent check: structured hybrid Symbol/File Hit@1/Hit@5 `1.00/1.00`, Avg `8ms`; rg-style baseline File Hit@1 `0.58`, File Hit@5 `1.00`, File MRR `0.77`.
- wsproto blind benchmark: initial hybrid Symbol Hit@1 `0.58`, Symbol Hit@5 `1.00`, File Hit@1 `0.75`, File Hit@5 `1.00`; after direct owner-action, handshake, extension-negotiation, and frame-event conversion fixes, hybrid Symbol/File Hit@1/Hit@5 reaches `1.00/1.00`, Avg `12ms`.
- wsproto structured-agent check: first structured hybrid Symbol Hit@1/Hit@5 `0.92/1.00`; removing `FrameProtocol.received_frames` from primary terms moved Symbol/File Hit@1/Hit@5 to `1.00/1.00`, Avg `11ms`; rg-style baseline File Hit@1 `0.67`, File Hit@5 `1.00`, File MRR `0.83`.
- wsproto same-corpus Graphify comparison: Graphify token reduction `3.9x`; Graphify symbol/file mention rates `0.00`/`0.75`; agent-index Symbol/File Hit@1/Hit@5 `1.00/1.00`.
- Trio structured-agent check: first structured hybrid Symbol Hit@1/Hit@5 `0.78/0.94`; query audit fixed helper-overweighting for `sleep` and `serve_listeners`, source audit added `open_memory_channel.__new__` as a valid implementation target, and a test-first dunder ranking fix made `CancelScope.__enter__` beat sibling owner methods. Final structured hybrid Symbol/File Hit@1/Hit@5 reached `1.00/1.00`, Avg `18ms`; rg-style baseline File Hit@1 `0.67`, File Hit@5 `1.00`, File MRR `0.83`.
- Post-Trio preservation repair: the dunder fix initially regressed Django friendly because `__init__` in `pathHints` for `django/core/management/__init__.py` created constructor intent. Filtering dunder-looking path hints out of query text restored Django friendly to Symbol/File Hit@1/Hit@5 `1.00/1.00` and preserved Django adversarial, Graphify, Black, Pytest, FastAPI, attrs, h11, wsproto, and Trio.
- Current expanded-matrix caveat after Trio structured-agent coverage: Graphify, HTTPX, Click, Rich, Pytest, FastAPI, Pydantic, Poetry, NetworkX, SQLAlchemy, Scikit-learn, Django, Celery, Black, Jinja, attrs, h11, wsproto, and Trio are green in this worktree, including NetworkX, SQLAlchemy, Scikit-learn, Django, and Celery adversarial sets. The structured-agent matrix now includes Django adversarial, Celery adversarial, and Trio as harder checks beyond friendly web/tooling corpora. The next readiness frontier is larger source-audited slices or another fresh repo after broad preservation reruns.
- Early conclusion: structure is useful as a conservative reranker, and query understanding is needed when the right symbol is not present in the FTS candidate set.
- Detailed benchmark JSON saturates the current Graphify set, while HTTPX and Click show cross-corpus behavior is not solved by one benchmark.
- Source-only hygiene v2 removed fixture/sample corpora; remaining misses are now cleaner evidence for ranking/query-intent work.
- The write-up should be explicit that the latest jump comes from a small hand-built intent layer, not from a general semantic model.
- The write-up should frame the 1.00 score as "benchmark exhausted" rather than proof of general retrieval quality.
- The scikit-learn adversarial section should highlight accumulation risk: positive intent rules need negative guards as the rule set grows, or graph/nearest-neighbor/validation words leak into adjacent APIs.
- The Django section should highlight source-audit discipline: wording around `resolve`, `changelist`, and `argv` changed the apparent misses before any ranker code changed.
- The Django section should also include the constructor/orchestration lesson: `__init__` and process methods are often the correct answer even when helper methods contain more lexical detail.
- The Django adversarial section should include the overloaded-language lesson: `reverse` plus `query` can describe URL construction or queryset ordering.
- The CLI/readiness section should mention that `benchmark --json --debug` was added after query debug, because batch miss triage needs candidate-source and score-component evidence without one-off reruns.
- The Celery section should include the source-only lesson: some projects use top-level `t/` for tests, and source-only filtering needs to be broad enough for real repo conventions without skipping arbitrary nested names.
- The Celery section should include the exact-object lesson: a broad class can be valuable context, but an early FTS single-token lifecycle method like `start` may be the exact implementation answer.
- The Celery section should include the subtype lesson: `schedule.is_due` and `crontab.is_due` are neighboring implementations, but a question naming `crontab` should prefer the subtype.
- The HTTPX section should note that answer-key audits changed the question count from 12 to 13 but did not reverse the cross-corpus conclusion.
- The HTTPX section should include the `main` lesson: before tuning ranking, confirm the target symbols exist in the index.
- The HTTPX section should include the hybrid lesson: hard FTS protection over-constrained results, while soft lexical boosting preserved Graphify and recovered HTTPX.
- The Click section should include the file-vs-symbol lesson: File Hit@5 is strong, but dense framework code still needs better exact-method ordering.
- The Click section should include the intent-scope lesson: "command line" should not automatically imply command entrypoint; narrowing that trigger improved Click without hurting Graphify or HTTPX.
- The Click section should include the method-specificity lesson: a small owner/name method boost improved top-one exact symbols without changing recall.
- The Click section should include the truth-set lesson: the shell-completion miss was mostly vague wording, not a ranking failure.
- The Click section should include the shortcut-API lesson: `group-decorator` looked like a miss until source audit showed `Group.group` and shared `command(cls=Group)` were valid answers for the original wording.
- The Click section should include the multi-step-method lesson: `choice-type-conversion` involved normalization and conversion, so `_normalized_mapping` was a valid answer instead of a ranking miss.
- The Click section should include the top-one ambiguity lesson: `path-type-validation` had the exact method at rank 4 behind its module/class, which is useful but still shows room for exact-method ordering.
- The Click section should also show that exact-object ordering later moved `Path.convert` to rank 1 without losing top-five recall.
- The Click section should include the layered API lesson: `terminal-prompt` spans public terminal helpers and option prompting, so the benchmark should allow both layers when the question is broad.
- The Click section should include the over-trigger lesson: `cli` alone was too broad for entrypoint intent because `CliRunner` is a test helper, not a request for the CLI main function.
- The Click section should include the stem-equivalence lesson: `shell_completion.py` and `shell_complete` should match as core-symbol equivalents, but only under a narrow rule that does not boost every method in a short-stem file like `_auth.py`.
- The Click/HTTPX section should include the exact-object ordering lesson: module demotion and owner/source method signals improved top-one, but the first broad version over-boosted `MultipartStream.__init__`, proving constructor and partial-owner safeguards matter.
- The Rich section should show that new-corpus validation improved the story: hybrid retained FTS top-five recall and improved top-one precision, but did not saturate immediately.
- The Rich section should include the markup lesson: `Text.markup` is a legitimate public convenience API, while `_parse` is the expected parser implementation. The fix should be framed as a general parser/property ranking guard, not a Rich-specific hack.
- The final write-up should call the current benchmark set small and exhausted: all four hybrid benchmarks are saturated, so the next evidence must come from a larger corpus or a harder golden set.
- The pytest section should revise that conclusion: all five current benchmarks are exhausted. The honest current claim is "dogfood-ready enough to use on Python repos, but benchmark evidence now needs a new frontier."
- The pytest section should include the source-only hygiene lesson: `testing/` can be a test suite directory just like `tests/`, and benchmark corpus filtering needs to handle both.
- The pytest section should include the build-intent lesson: generic coding verbs help until they over-trigger on ordinary prose; scoped intent rules need negative examples.
- The pytest section should include the hook-spec lesson: symbol names alone are not enough when hook specifications and implementations share vocabulary.
- The pytest section should include the multi-action query lesson: lifecycle questions name several verbs, so the ranker may need to lift multiple exact methods over a container or hook wrapper.
- The pytest section should include the answer-key lesson: `MultiCapture.resume_capturing` and the `monkeypatch` fixture were source-valid answers once the question wording was audited.
- The pytest section should include the final-top-one lesson: remaining wins came from guarded general signals, not hardcoded pytest symbols.
- The FastAPI section should include the source-only hygiene lesson: docs/tutorial source snippets (`docs_src/`) and maintenance `scripts/` can pollute a benchmark as badly as tests.
- The FastAPI section should include the framework-container lesson: a named class like `FastAPI` can be query context rather than the answer.
- The FastAPI section should include the dependency-graph lesson: generic action rules need domain scoping, because "build graph" and "build dependency graph" are not the same retrieval intent.
- The FastAPI section should include the constructor lesson: large `__init__` methods often behave like class summaries and should not receive broad behavior boosts.
- The FastAPI section should include the handler/callable lesson: small exception handlers and security `__call__` methods needed explicit candidate expansion, and callable auth needed scheme-specific negative examples.
- The FastAPI section should include the route-registration lesson: direct registration symbols like `add_api_route` need to beat adjacent router composition and decorator helpers.
- The FastAPI section should include the final top-one lesson: once file recall is solved, the remaining work is often choosing between an orchestration function, a low-level helper, and the exact implementation step.
- The Pydantic section should include the option-word lesson: a phrase like "computed fields" can pull an adjacent decorator above the broader serialization API.
- The Pydantic section should include the orchestration lesson: "finish building a model class" should point at `complete_model_class`, not a lower-level schema helper.
- The Poetry section should include the benchmark-label lesson: `Application.configure_installer_for_command` constructs and attaches an installer, while `InstallCommand.handle` applies the command-line installer options named by the question.
- The Poetry section should include the solver lesson: provider helper methods can contain many relevant words, but the orchestration answer is `Solver.solve`.
- The Poetry section should include the plugin lesson: loading plugins and activating plugins are neighboring but different intents.
- The NetworkX section should include the module-container lesson: whole-file module chunks can dominate algorithm-heavy files unless hybrid ranking strongly prefers concrete symbols.
- The NetworkX section should include the overloaded-word lesson: "build graph" helped Graphify but over-triggered on graph matrix questions.
- The NetworkX section should include the benchmark-label lesson: `GraphMatcher` is a valid VF2 implementation answer, and residual-network wording points naturally at `build_residual_network`.
- The NetworkX section should include the exact-class lesson: a query naming the `Graph` class should prefer `Graph` over substring matches such as `MultiGraph`.
- The adversarial section should include the negative-trigger lesson: dispatch wording must suppress bidirectional-only intent, and sparse/fast wording must suppress the generic random graph implementation.
- The SQLAlchemy section should include the overload-output lesson: even correct top-one ranking is awkward if overloads fill the result list with duplicate qualified symbols.
- The SQLAlchemy section should include the sync/async wrapper lesson: intent rules need to distinguish plain `Session.execute` from `AsyncSession.execute`.
- The SQLAlchemy section should include the public-factory lesson: "relationship constructor" should point at the public `relationship()` helper, while explicit dunder wording should still be able to find `RelationshipProperty.__init__`.
- The SQLAlchemy adversarial section should include the tokenization lesson: `literal_execute` created an `execute` token, but the intended domain was bind parameters.
- The Scikit-learn section should include the source-only hygiene lesson: `benchmarks/` and `asv_benchmarks/` are support code for benchmark-style retrieval.
- The Scikit-learn section should include the owner-method lesson: when the question names an owner like `BaseEstimator`, candidate expansion should surface matching methods even when FTS is crowded.
- The Scikit-learn section should include the exact-token lesson: broad fuzzy matching can confuse nouns and actions, such as "transformer" versus `transform`.
- The Scikit-learn section should include the scientific/ML intent lesson: cross-validation scoring, nearest-neighbor lookup, input-array validation, and forest fitting are distinct enough to need guarded signals.
- The final readiness caveat should now say the current corpus suite is strong but not proof of general superiority: many friendly/adversarial sets are green, same-corpus Graphify comparisons help but measure a different target than token reduction, and the next evidence should come from a fresh blind repo or larger source-audited slices.
- The Black section should include the parser-overreach lesson: `parse` is a dangerous general trigger because config parsing and HTTP header parsing are not grammar parser questions.
- The Black section should include the stdin/stdout lesson: explicit IO endpoints should beat unrelated helpers that happen to share lifecycle verbs like read/write.
- The Jinja section should include the level-of-abstraction lesson: exact navigation must distinguish whole template pipelines from local helpers with the same verbs.
- The Jinja section should include the loader lesson: an abstract interface method and concrete implementation method can share a name, but source/reload/filesystem wording should prefer the concrete loader.
- The urllib3 section should include the cookbook-validation lesson: helpers such as `connection_from_host`, `is_exhausted`, and `read_chunked` are useful graph neighbors, but putting them in primary `terms` can hide the orchestration method the agent wants to edit.
- The urllib3 Graphify section should include the harness lesson: comparing against Graphify must run `agent-index` in structured-agent mode, because question-text mode measures the old interface rather than the product contract.
- The urllib3 Graphify section should include the metric-boundary lesson: Graphify's `7.0x` token reduction is real and valuable, but it is not the same as returning the exact symbol/file/function an agent should inspect first.
- The readiness section should include the packaging lesson: a tool can have strong benchmark numbers and still fail local use if help exits nonzero or the built bin path is wrong.
- The readiness section should distinguish implementation-ready package hygiene from owner decisions: `files`, `engines`, and `npm pack --dry-run` can be done now; license, repository URL, npm access, and any `private: true` policy should be chosen deliberately.

## Evidence To Include Later

- One screenshot or terminal block for `agent-index query`.
- Benchmark summary table.
- README quick-start excerpt.
- Readiness backlog table from `docs/findings/agent-index-readiness.md`.
- Three qualitative query examples from `docs/findings/graphify-benchmark-results.md`.
- Experiment progression table from `docs/findings/experiment-log.md`.
- HTTPX baseline notes from `docs/findings/httpx-benchmark-results.md`.
- Click baseline notes from `docs/findings/click-benchmark-results.md`.
- Rich validation notes from `docs/findings/rich-benchmark-results.md`.
- Pytest validation notes from `docs/findings/pytest-benchmark-results.md`.
- FastAPI validation notes from `docs/findings/fastapi-benchmark-results.md`.
- Pydantic validation notes from `docs/findings/pydantic-benchmark-results.md`.
- Poetry validation notes from `docs/findings/poetry-benchmark-results.md`.
- NetworkX validation notes from `docs/findings/networkx-benchmark-results.md`.
- SQLAlchemy validation notes from `docs/findings/sqlalchemy-benchmark-results.md`.
- Celery validation notes from `docs/findings/celery-benchmark-results.md`.
- Black validation notes from `docs/findings/black-benchmark-results.md`.
- Jinja validation notes from `docs/findings/jinja-benchmark-results.md`.
- attrs recovery notes from `docs/findings/attrs-benchmark-results.md`.
- h11 protocol notes from `docs/findings/h11-benchmark-results.md`.
- wsproto validation notes from `docs/findings/wsproto-benchmark-results.md`.
- urllib3 transport notes from `docs/findings/urllib3-benchmark-results.md`.
- A short comparison table: plain FTS vs symbol-first FTS plus graph expansion.
- One caveat box: "structured queries beat the rg-style baseline on the measured corpora, but Click, Pytest, Poetry, NetworkX, Trio, wsproto, and urllib3 show agents need guidance to choose discriminating edit-location terms instead of broad or adjacent-helper terms; SQLAlchemy shows dotted owner/API terms work well in dense public APIs; Rich shows answer keys need source audit before ranker changes."
