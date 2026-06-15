# Click Benchmark Results

## Current Status

Click was cloned as the third benchmark corpus at `/Users/juan/Repos/click`.

Repository: `https://github.com/pallets/click`

Checked revision: `8a1b1a3`

## Why Click

Click is a good validation corpus because it is a mature Python library with a compact but dense API surface: decorators, command dispatch, option parsing, parameter conversion, shell completion, terminal UI helpers, and test utilities.

It is different from Graphify and HTTPX. Graphify is a small application-style codebase, HTTPX is a client library with transports and models, and Click is a CLI framework where many questions naturally point at classes with many closely related methods. This makes it useful for testing exact-symbol ordering.

## Benchmark Setup

Index command:

```bash
npm run agent-index -- index /Users/juan/Repos/click --source-only
```

Index summary:

```text
Indexed 18 files, 609 symbols, 609 chunks, 2379 edges at /Users/juan/Repos/click/.codeindex/index.sqlite
```

Benchmark command:

```bash
npm run agent-index -- benchmark ./benchmarks/click-python.json --target /Users/juan/Repos/click --mode <fts|symbol|hybrid>
```

The audited golden set contains 14 questions covering command/group decorators, option decorators, callback invocation, command entrypoint handling, group subcommand dispatch, option value sources, choice/path type conversion, output echoing, prompts, shell completion, `CliRunner`, and usage formatting.

## Truth-Set Audit

Run date: 2026-06-12

Before writing the benchmark, source symbols were inspected directly with `rg` and the SQLite index. The answer key uses `qualified_name` values returned by the query layer, such as `Command.main`, `Group.invoke`, `Option.consume_value`, and `CliRunner.invoke`.

No ranking code changed during this audit.

One process note: running the CLI inside the sandbox failed because `tsx` could not create its IPC pipe under the temp directory. The benchmark commands were rerun outside the sandbox with the same arguments.

## Results

Plain FTS:

```text
Mode: fts
Questions: 14
Symbol Hit@1: 0.43
Symbol Hit@5: 0.86
Symbol MRR: 0.60
File Hit@1: 0.93
File Hit@5: 0.93
File MRR: 0.93
Partial file hits: 0.07
Avg latency: 3ms
```

Symbol mode:

```text
Mode: symbol
Questions: 14
Symbol Hit@1: 0.43
Symbol Hit@5: 0.86
Symbol MRR: 0.58
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.14
Avg latency: 16ms
```

Hybrid mode:

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
Avg latency: 20ms
```

Click supports the soft-hybrid direction. Hybrid beats FTS and symbol mode on Symbol Hit@1 and Symbol Hit@5, while matching symbol mode on File Hit@5. The tradeoff is latency: FTS is much faster.

## Structured Agent Query Pass

Run date: 2026-06-13

This pass evaluates the product-facing path: an LLM agent supplies structured `agentQuery` terms, symbol kinds, path hints, support-code filtering, and graph expansion preferences. The descriptive `question` remains in the benchmark for continuity, but `--query-style agent` does not ask `agent-index` to interpret natural language.

Index command:

```bash
node dist/cli.js index /Users/juan/Repos/click --source-only --index-path /tmp/agent-index-click-structured-current.sqlite
```

Index summary:

```text
Indexed 17 files, 608 symbols, 608 chunks, 2377 edges at /tmp/agent-index-click-structured-current.sqlite (mode: source-only)
```

First structured run:

```text
Mode: hybrid
Query style: agent
Questions: 14
Symbol Hit@1: 0.71
Symbol Hit@5: 0.93
Symbol MRR: 0.82
File Hit@1: 0.93
File Hit@5: 1.00
File MRR: 0.96
Partial file hits: 0.07
Avg latency: 10ms
rg-style File Hit@1: 0.57
rg-style File Hit@5: 1.00
rg-style File MRR: 0.77
rg-style Avg latency: 7ms
```

The misses were useful because they were not ranking bugs in a well-formed query. They were query-shaping issues:

```text
group-decorator         top=Group.command             expected=Group.group/group/command
option-decorator        top=command                   expected=option/_param_memo
path-type-validation    top=Parameter.type_cast_value expected=Path.convert
usage-formatting        top=Command.format_help       expected=HelpFormatter.write_usage/Command.format_usage
```

After source inspection, the structured queries were refined to carry more discriminating implementation terms:

- `group-decorator`: removed broad `command`, leaving `group`, `decorator`, `function`.
- `option-decorator`: replaced broad `command` with `param`, matching how decorators store option parameters.
- `path-type-validation`: used `convert`, `readable`, and `writable` instead of generic `validate` and `parameter`.
- `usage-formatting`: used `write`, `format`, and `line` instead of broad `help` and `output`.

Final structured run:

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
Avg latency: 14ms
rg-style File Hit@1: 0.64
rg-style File Hit@5: 1.00
rg-style File MRR: 0.79
rg-style Avg latency: 10ms

Misses: none
```

Finding: this did not justify another hidden ranking heuristic. It showed that the agent-facing query contract needs good examples and documentation. Like using `rg`, an LLM gets better results when it chooses discriminating code terms instead of forwarding every word from the user request.

After the first Click baseline, the entrypoint intent trigger was narrowed so ordinary "command line value" wording no longer counts as an entrypoint query. This moved `option-value-source` from a partial file hit to a top-five exact symbol hit without changing the answer key.

The next ranking pass added a small hybrid-only specificity boost for methods that already match both owner and method name. This moved `option-value-source` and `usage-formatting` to top-one exact symbol hits.

The `shell-completion` question was then audited against source. The original wording, "where is shell completion dispatch implemented?", was too broad and reasonably matched formatter methods. It now asks where Click decides between `source` and `complete` shell completion instructions. No ranking code changed for this audit.

The `group-decorator` question was then audited against source. The original answer key only allowed the top-level `group` function, but the question wording also reasonably matches `Group.group`, the shortcut decorator that declares and attaches a group to another group, and `command`, the shared decorator implementation used by `group(cls=Group)`. Expanding the expected answer key moved hybrid Symbol Hit@5 to `1.00` without ranking changes.

The `choice-type-conversion` question was then audited against source. `Choice.convert` is the end-to-end conversion method, but `Choice._normalized_mapping` is the code path that returns the accepted normalized command-line values and delegates to `Choice.normalize_choice`. Because the question asks about values being normalized and converted, the answer key now includes `_normalized_mapping`. No ranking code changed for this audit.

The `path-type-validation` question was then audited against source. `Path.convert` is still the exact expected method: it handles existence, file/directory, readable, writable, executable, and result coercion checks. The current rank 1 and rank 2 results are the containing `types.py` module and `Path` class, so this is acceptable top-one ambiguity rather than benchmark ambiguity. No answer-key or ranking change was made.

The `terminal-prompt` question was then audited against source. `prompt` and `confirm` are the general terminal UI helpers, but `Option.prompt_for_value` is also source-valid: it handles option prompts, calls `confirm` for boolean flags, and passes `confirmation_prompt` through to `prompt`. The answer key now includes this option-prompt path. No ranking code changed for this audit.

The `cli-runner-invoke` question exposed a real ranking weakness. The entrypoint intent treated the `cli` token from `CliRunner` as a generic CLI entrypoint query, which boosted `Command.main` above `CliRunner.invoke`. A regression test now covers this case, and the entrypoint trigger requires explicit entrypoint wording or `cli` plus `main`.

The `shell-completion` row then exposed a broader core-symbol ordering issue. `shell_completion.py` and `shell_complete` describe the same core implementation, but the earlier file-stem boost only handled exact token equality. A regression test now covers stem-equivalent file and function names, and the core-symbol boost is limited to equal-length file/symbol token sets to avoid over-boosting helpers such as `auth_flow` in `_auth.py`.

The exact-object ordering pass then added a small module-context penalty, a method owner/source signal, and narrower method lexical boosting. This moved `path-type-validation` from rank 4 to top-one by preferring `Path.convert` over module/class context, while preserving Symbol Hit@5.

The guarded coding-domain pass added decorator-target phrasing. A first version over-boosted `Command.get_help_option` because it contained the word `option`; the final rule requires the callable's own symbol name to match the decorator target. This saturated the current Click set.

## Per-Question Detail

Latest hybrid mode detail:

```text
command-decorator           symbolRank=1  fileRank=1  top=command                         file=src/click/decorators.py
group-decorator             symbolRank=1  fileRank=1  top=Group.group                     file=src/click/core.py
option-decorator            symbolRank=1  fileRank=1  top=option                          file=src/click/decorators.py
context-callback-invoke     symbolRank=1  fileRank=1  top=Context.invoke                  file=src/click/core.py
command-main                symbolRank=1  fileRank=1  top=Command.main                    file=src/click/core.py
group-subcommand-dispatch   symbolRank=1  fileRank=1  top=Group.invoke                    file=src/click/core.py
option-value-source         symbolRank=1  fileRank=1  top=Option.consume_value            file=src/click/core.py
choice-type-conversion      symbolRank=1  fileRank=1  top=Choice._normalized_mapping      file=src/click/types.py
path-type-validation        symbolRank=1  fileRank=1  top=Path.convert                    file=src/click/types.py
echo-output                 symbolRank=1  fileRank=1  top=echo                            file=src/click/utils.py
terminal-prompt             symbolRank=1  fileRank=1  top=Option.prompt_for_value         file=src/click/core.py
shell-completion            symbolRank=1  fileRank=1  top=shell_complete                 file=src/click/shell_completion.py
cli-runner-invoke           symbolRank=1  fileRank=1  top=CliRunner.invoke                file=src/click/testing.py
usage-formatting            symbolRank=1  fileRank=1  top=HelpFormatter.write_usage       file=src/click/formatting.py
```

## Qualitative Examples

- Good: `command-decorator` lands directly on `command` in `src/click/decorators.py`. This is the ideal case: lexical terms, symbol name, and source text all agree.
- Good: `command-main` lands on `Command.main`, which shows that the existing entrypoint intent can help outside Graphify and HTTPX.
- Good: `choice-type-conversion` lands on `Choice._normalized_mapping`, which source audit confirmed is a valid answer for the normalization half of the question, with `Choice.convert` next.
- Good: `path-type-validation` now lands on `Path.convert` after the exact-object ordering pass learned to prefer owner-matched implementation methods over module/class context.
- Good: `terminal-prompt` lands on `Option.prompt_for_value`, which source audit confirmed is a valid option-prompt path that delegates to `prompt` and `confirm`.
- Good: `cli-runner-invoke` now lands on `CliRunner.invoke` after the entrypoint trigger stopped treating `CliRunner` as a generic CLI entrypoint query.
- Good: `option-value-source` now lands directly on `Option.consume_value` after combining the narrower entrypoint trigger with method specificity.
- Good: `usage-formatting` now lands directly on `HelpFormatter.write_usage`, another container-vs-method win.
- Good: `shell-completion` now lands on `shell_complete` after the core-symbol rule learned that `shell_completion.py` and `shell_complete` are stem-equivalent.
- Good: `group-decorator` now lands on `Group.group` after the guarded decorator-target signal.
- Good: `option-decorator` now lands on `option`; the rule is guarded so helper methods like `Command.get_help_option` do not win just because they contain the target word.

## Cross-Corpus Comparison

Latest comparable hybrid results:

```text
Graphify: Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00
HTTPX:    Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00
Click:    Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00
```

Click lowered confidence in the earlier exact-symbol ranking. The current set is now saturated, so it no longer provides fresh ranking pressure.

The third corpus does not reverse the soft-hybrid conclusion. It makes the claim more precise: hybrid is the best current mode across these three corpora, but the benchmark is now exhausted and needs expansion.

## Findings

- Click validates the need for cross-corpus testing. Graphify is saturated and HTTPX is strong, but Click exposes new exact-symbol misses.
- File-level retrieval is strong: hybrid and symbol mode both reach File Hit@5 `1.00`.
- Plain FTS remains a strong baseline. It reaches Symbol Hit@5 `0.86` at `3ms`, close to hybrid's `1.00` at `19ms`.
- Symbol mode alone underperforms hybrid on this corpus. It often promotes module/class containers over exact methods.
- The entrypoint intent is useful but must stay narrowly scoped. Removing the broad `command` + `line` trigger improved Click Symbol Hit@5 from `0.79` to `0.86` while preserving Graphify and HTTPX.
- A small hybrid-only method specificity boost improved Click Symbol Hit@1 from `0.36` to `0.50` while preserving Graphify and HTTPX.
- The shell-completion audit improved Click Symbol Hit@5 from `0.86` to `0.93` without code changes, which reinforces the rule that misses need source review before ranking work.
- The group-decorator audit improved Click Symbol Hit@5 from `0.93` to `1.00` without code changes by recognizing `Group.group` and `command` as source-backed alternatives to the top-level `group` wrapper.
- The choice-type-conversion audit improved Click Symbol Hit@1 from `0.50` to `0.57` without code changes by recognizing `_normalized_mapping` as the normalization implementation named by the question.
- The path-type-validation audit did not change metrics. It classified the miss as acceptable top-one ambiguity: the exact method was present at rank 4, behind its containing module and class.
- The terminal-prompt audit improved Click Symbol Hit@1 from `0.57` to `0.64` and File Hit@1 from `0.86` to `0.93` without code changes by recognizing `Option.prompt_for_value` as a source-backed prompt path.
- The cli-runner audit improved Click Symbol Hit@1 from `0.64` to `0.71` and File Hit@1 from `0.93` to `1.00` by narrowing the entrypoint trigger. Graphify and HTTPX hybrid metrics stayed at Symbol Hit@1/Hit@5 `1.00/1.00` and `0.77/1.00`.
- The stem-equivalent core-symbol rule improved Click Symbol Hit@1 from `0.71` to `0.79` by moving `shell_complete` over the `shell_completion.py` module. Graphify and HTTPX hybrid metrics stayed at Symbol Hit@1/Hit@5 `1.00/1.00` and `0.77/1.00`.
- The exact-object ordering pass improved Click Symbol Hit@1 from `0.79` to `0.86` by moving `Path.convert` over module/class context. Graphify stayed saturated and HTTPX improved to Symbol Hit@1/Hit@5 `0.85/1.00`.
- The guarded decorator-target signal improved Click Symbol Hit@1 from `0.86` to `1.00`, while Graphify and HTTPX stayed saturated.
- All previously listed Click top-one misses have now been source-audited or fixed.

## Next Click Work

- The current Click set is saturated. Further Click work should expand the question set before adding more ranking rules.
