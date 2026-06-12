# Agent Index Process Notes

## Purpose

This prototype tests a narrow claim: a local symbol-first index can give coding agents better starting points than plain text search alone.

The working analogy is a library catalog. Text search finds pages with matching words; the symbol index adds the catalog cards that say which function, class, and nearby references those pages belong to.

## Decisions

- Use TypeScript/Node for the v1 prototype because it keeps CLI, tests, and package setup simple.
- Use SQLite plus FTS5 as the live query store because it is one local file and does not require a server.
- Keep Tree-sitter behind a language extractor interface so Python is the first language, not the permanent architecture.
- Store unresolved call/import targets by name. This is less precise than a full call graph, but it is honest and good enough for retrieval expansion.
- Default the index to `<target>/.codeindex/index.sqlite`, matching the design spec.
- Rebuild the index fully in v1. Incremental indexing is deliberately out of scope.

## Findings So Far

- Tree-sitter extraction gives useful structure quickly: modules, classes, methods, functions, and line ranges are enough to produce cited results.
- SQLite FTS needs normalized identifier text. Without it, natural-language queries like "semantic cache loaded" can miss identifiers such as `semantic_cache` and `load_value`.
- Exact-match boosts must be careful. A single generic symbol like `Cache` should not beat a more specific function just because the question contains "cache."
- One-hop graph expansion is useful as supporting context, but it should not flood the result. In v1 it is a flashlight around the match, not the whole map.
- Tree-sitter's Node binding can reject large Python source strings with `Invalid argument`. Feeding the parser through its callback API avoids that native string-argument failure.
- Running against Graphify showed a major benchmark hygiene issue: indexing `tests/` and `tools/` lets helper code outrank product code for broad natural-language questions.
- Source-only indexing improved Graphify Hit@5 from 0.20 to 0.30 and average latency from 65ms to 48ms by reducing the corpus from 142 Python files to 51.
- Auditing the golden truth set against real Graphify v8 symbols improved source-only Hit@5 from 0.30 to 0.50. Several initial benchmark expectations were plausible guesses but not real v8 symbol names.
- Splitting benchmark metrics showed the sharper truth: source-only file Hit@5 is 0.50, but exact symbol Hit@5 is only 0.20. The index finds neighborhoods better than exact functions right now.
- The plain FTS baseline beat current symbol ranking on Symbol Hit@5, 0.40 vs 0.20. Symbol boosts improved Symbol Hit@1 and File MRR slightly, but they also pushed valid FTS candidates down.
- Hybrid ranking fixed that specific regression by protecting the FTS top five before reranking. It kept Symbol Hit@5 at 0.40 while improving Symbol Hit@1 from FTS 0.00 to Hybrid 0.10.
- Adding JSON benchmark details made the remaining misses concrete: broad questions often land in topical support modules, while some right-file hits still miss the exact expected function.
- Source-only hygiene v2 removed fixture/sample corpora from the benchmark index, reducing Graphify from 51 indexed Python files to 37. Metrics stayed flat, but noisy `worked/` results disappeared from the miss table.
- Query-intent candidate expansion changed the best hybrid result from Symbol Hit@1 0.10 / Symbol Hit@5 0.40 to Symbol Hit@1 0.50 / Symbol Hit@5 0.70. The win came from adding likely candidates for high-signal terms such as `entrypoint`, `export json`, `report`, `community detection`, and `mcp server` before reranking.
- The query-intent layer is deliberately labeled as a hand-built retrieval prior. It is useful evidence that agents need query understanding, but it is not yet evidence that a fixed rule list generalizes across repositories.
- General action aliases for `extraction`, `built`, and query `seeds` improved hybrid to Symbol Hit@1 0.70 / Symbol Hit@5 1.00. This suggests a small vocabulary of coding verbs can recover implementation candidates that plain FTS misses or under-ranks.
- The remaining Graphify misses are no longer file-retrieval misses. They are exact-symbol ordering misses inside the right file or immediate neighborhood.
- Core-symbol ordering improved hybrid to Symbol Hit@1 0.90 / Symbol Hit@5 1.00 by preferring file-stem function matches and demoting explanatory helper names. A first version was too broad and boosted classes, so the rule is now limited to function-like symbols.
- The only remaining Graphify miss is `incremental-cache`, where orchestration code in `watch.py` outranks the expected manifest/cache symbols.
- Inspecting the incremental-cache miss confirmed the golden label: `watch()` orchestrates file events, while `detect_incremental()` decides what changed by comparing the manifest. Adding a narrow incremental change-detection intent rule saturated the current Graphify benchmark at Symbol Hit@1 1.00 / Symbol Hit@5 1.00.
- The current Graphify set is no longer useful for additional ranking optimization by itself. The next evidence should come from another repository or a larger golden set.
- HTTPX is now the second corpus. Its first baseline reverses the Graphify conclusion: symbol mode beats hybrid on exact symbol retrieval, with Symbol Hit@5 0.83 vs hybrid 0.42. This is useful evidence that the hybrid strategy is corpus-sensitive.
- Auditing the HTTPX truth set preserved that conclusion. The cleaned 13-question set gives symbol mode Symbol Hit@5 0.85 and File Hit@5 1.00, while hybrid gives Symbol Hit@5 0.46 and File Hit@5 0.85. The remaining symbol-mode misses are mostly module/class containers outranking exact functions, such as `main`, `request`, and `Response.json`.
- Inspecting the HTTPX index showed `main` was absent from `httpx/_main.py`, not merely under-ranked. Tree-sitter wraps decorated functions and methods in `decorated_definition`; adding extraction for that wrapper increased HTTPX source-only coverage from 466 to 544 symbols and moved symbol-mode Hit@5 from 0.85 to 0.92.
- Adding exact dotted API reference candidates and method owner/name ranking moved HTTPX symbol mode to Symbol Hit@1 0.69 / Hit@5 1.00 while preserving Graphify hybrid at 1.00. The remaining cross-corpus question is hybrid strategy, not symbol-mode recall.
- Replacing hard hybrid FTS protection with a soft lexical boost for FTS top-five functions/methods moved HTTPX hybrid to Symbol Hit@1 0.77 / Hit@5 1.00 while preserving Graphify hybrid at 1.00. This suggests FTS should stay influential, but not act as a hard gate.
- Click is now the third corpus. Its source-only index at `8a1b1a3` has 18 files, 609 symbols, and 2379 edges. The audited 14-question benchmark gives hybrid Symbol Hit@1 0.36 / Hit@5 0.79 and File Hit@5 1.00.
- Click makes the current claim more precise: hybrid is the strongest current mode across the three corpora, but the remaining problem is often choosing the exact method after the right file or class neighborhood is already found.
- Click also exposed an over-broad intent rule. The entrypoint prior helps `Command.main`, but terms like "command line values" can wrongly pull `Command.main` above option parsing methods.
- Narrowing the entrypoint trigger to explicit `entry point`, `entrypoint`, and later `cli` plus `main` terms moved Click hybrid Symbol Hit@5 from 0.79 to 0.86, then fixed the `CliRunner` top-one miss, while preserving Graphify and HTTPX. This is a useful example of pruning an intent rule instead of adding another special case.
- Adding a small hybrid-only method specificity boost for results that already have `method owner/name match` moved Click hybrid Symbol Hit@1 from 0.36 to 0.50 while preserving Graphify and HTTPX. This improved exact-method ordering without adding another query-intent rule.
- Auditing the Click `shell-completion` question showed a benchmark wording problem, not a ranking problem. Rewording it around source-vs-complete instruction handling moved Click hybrid Symbol Hit@5 from 0.86 to 0.93 without code changes.
- Auditing the Click `group-decorator` question showed answer-key ambiguity. The top-level `group` wrapper delegates through `command(cls=Group)`, while `Group.group` is also a source-valid group decorator path that registers the result. Expanding the expected symbols moved Click hybrid Symbol Hit@5 from 0.93 to 1.00 without ranking changes.
- Auditing the Click `choice-type-conversion` question showed another answer-key ambiguity. `Choice.convert` performs end-to-end conversion, but `_normalized_mapping` directly implements the accepted normalized values named by the question. Expanding the expected symbols moved Click hybrid Symbol Hit@1 from 0.50 to 0.57 without ranking changes.
- Auditing the Click `path-type-validation` question confirmed the expected method: `Path.convert` performs the existence and permission checks. The current module/class results ahead of it are useful navigation context, so this was recorded as acceptable top-one ambiguity rather than a benchmark or ranking change.
- Auditing the Click `terminal-prompt` question showed answer-key ambiguity across public helper and option-specific prompt paths. `Option.prompt_for_value` calls `confirm` for boolean flags and passes `confirmation_prompt` to `prompt`, so adding it moved Click hybrid Symbol Hit@1 from 0.57 to 0.64 without ranking changes.
- Auditing the Click `cli-runner-invoke` question found a real ranking weakness: `CliRunner` supplied a `cli` token that over-triggered the entrypoint prior and boosted `Command.main`. Requiring `cli` to appear with `main` fixed the miss and moved Click hybrid Symbol Hit@1 from 0.64 to 0.71 while preserving Graphify and HTTPX.
- A stem-equivalent core-symbol rule moved `shell-completion` to top-one by treating `shell_completion.py` and `shell_complete` as the same core implementation. The first broad version over-boosted helpers like `DigestAuth.auth_flow`; narrowing the rule to equal-length file/symbol token sets preserved Graphify and HTTPX while moving Click hybrid Symbol Hit@1 from 0.71 to 0.79.
- When invoking the CLI through npm, pass arguments after `--`; otherwise npm may consume options such as `--target`.
- In the current sandbox, running `tsx` through the CLI may fail with `listen EPERM` on a temp IPC pipe. The same command works when run outside the sandbox.
- A readiness audit found two package-surface bugs after the ranking work: help output printed but exited as a Commander exception, and the package bin pointed at `dist/cli.js` while the build emitted `dist/src/cli.js`. Both are now covered by regression tests because they affect whether a local user can actually run the tool.
- The build now cleans `dist/` before compiling. Without that, the old layout left stale `dist/src` and `dist/tests` files behind even after the bin path was fixed.
- A first README now documents install/build, indexing, querying, benchmarking, current metrics, and limits. That gives the prototype a usable front door instead of relying on conversation history.
- The interactive `query` command now supports the same `fts`, `symbol`, and `hybrid` modes as `benchmark`, defaulting to the previous symbol behavior. This makes qualitative inspection line up with measured benchmark modes.
- The npm package now has an explicit file allowlist and Node engine. `npm pack --dry-run` includes README, benchmark JSON, docs, built `dist` files, and package metadata. The license remains `UNLICENSED` because choosing a public license is an owner/legal decision, not an implementation detail.
- The `index` command now reports whether it ran in `source-only` or `all-files` mode. This matters because source filtering changed benchmark conclusions earlier, so the mode should be visible in future process notes.
- `--index-path` is now exposed consistently on `index`, `query`, and `benchmark`. This makes the existing core support usable from the CLI, especially for external corpora where writing under the target tree is not ideal.
- A broader exact-object ranking pass improved HTTPX and Click top-one without sacrificing top-five recall. The first version regressed HTTPX `multipart-encoding` by boosting `MultipartStream.__init__`; narrowing owner/source matching and excluding dunder methods from broad lexical boosts recovered Symbol Hit@5.
- A final guarded coding-domain pass saturated the current three-corpus hybrid benchmarks by adding decorator-target phrasing, multi-token symbol coverage, and representation-class signals. This should be framed as benchmark exhaustion, not proof of general search quality.

## Rejected Ideas

- Embeddings: useful later, but they would make the first experiment harder to interpret.
- MCP server: useful product surface, but not needed to prove retrieval shape.
- Background watcher: useful ergonomics, but full rebuild is simpler for a benchmark prototype.
- Multi-language extraction: important eventually, but Python-only keeps the first benchmark contained.

## Open Questions

- How much does symbol-first ranking improve Hit@5 over plain FTS on the same corpus?
- Which edge types matter most for agent navigation: contains, imports, calls, or callers?
- Does normalized lexical search cover enough natural-language phrasing before embeddings are added?
- How large can the SQLite-only approach get before query latency or index time becomes a problem?
- Should the default scanner include tests, or should benchmark/query modes support source-only filtering?
- Which top-one ranking signals can improve remaining HTTPX hybrid misses without turning the benchmark into a rule-list for specific questions?
- Can query-intent terms like "entrypoint", "export", and "report" be mapped to likely file/symbol patterns without overfitting to Graphify?
- Should the intent layer be rule-based, learned from repo structure, or supplied by the calling agent as explicit search hints?
- Can container-vs-method ordering improve Click top-one precision without regressing Graphify or HTTPX?
- Should intent rules be split into trigger detection and scoring explanations so broad phrases are easier to audit?
- What broader exact-method ordering design would improve the remaining Click non-top-one rows, such as `Path.convert`, without over-boosting unrelated methods in compact modules?
- What package metadata and `npm pack` checks are enough before calling the prototype publishable, even if it stays pre-1.0?
- Which larger fourth corpus or expanded golden set can test whether the coding-domain signals generalize beyond the now-saturated small benchmarks?
