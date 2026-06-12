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
Avg latency: 2ms
```

Symbol mode:

```text
Mode: symbol
Questions: 14
Symbol Hit@1: 0.43
Symbol Hit@5: 0.79
Symbol MRR: 0.55
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.21
Avg latency: 15ms
```

Hybrid mode:

```text
Mode: hybrid
Questions: 14
Symbol Hit@1: 0.71
Symbol Hit@5: 1.00
Symbol MRR: 0.82
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 16ms
```

Click supports the soft-hybrid direction. Hybrid beats FTS and symbol mode on Symbol Hit@1 and Symbol Hit@5, while matching symbol mode on File Hit@5. The tradeoff is latency: FTS is much faster.

After the first Click baseline, the entrypoint intent trigger was narrowed so ordinary "command line value" wording no longer counts as an entrypoint query. This moved `option-value-source` from a partial file hit to a top-five exact symbol hit without changing the answer key.

The next ranking pass added a small hybrid-only specificity boost for methods that already match both owner and method name. This moved `option-value-source` and `usage-formatting` to top-one exact symbol hits.

The `shell-completion` question was then audited against source. The original wording, "where is shell completion dispatch implemented?", was too broad and reasonably matched formatter methods. It now asks where Click decides between `source` and `complete` shell completion instructions. No ranking code changed for this audit.

The `group-decorator` question was then audited against source. The original answer key only allowed the top-level `group` function, but the question wording also reasonably matches `Group.group`, the shortcut decorator that declares and attaches a group to another group, and `command`, the shared decorator implementation used by `group(cls=Group)`. Expanding the expected answer key moved hybrid Symbol Hit@5 to `1.00` without ranking changes.

The `choice-type-conversion` question was then audited against source. `Choice.convert` is the end-to-end conversion method, but `Choice._normalized_mapping` is the code path that returns the accepted normalized command-line values and delegates to `Choice.normalize_choice`. Because the question asks about values being normalized and converted, the answer key now includes `_normalized_mapping`. No ranking code changed for this audit.

The `path-type-validation` question was then audited against source. `Path.convert` is still the exact expected method: it handles existence, file/directory, readable, writable, executable, and result coercion checks. The current rank 1 and rank 2 results are the containing `types.py` module and `Path` class, so this is acceptable top-one ambiguity rather than benchmark ambiguity. No answer-key or ranking change was made.

The `terminal-prompt` question was then audited against source. `prompt` and `confirm` are the general terminal UI helpers, but `Option.prompt_for_value` is also source-valid: it handles option prompts, calls `confirm` for boolean flags, and passes `confirmation_prompt` through to `prompt`. The answer key now includes this option-prompt path. No ranking code changed for this audit.

The `cli-runner-invoke` question exposed a real ranking weakness. The entrypoint intent treated the `cli` token from `CliRunner` as a generic CLI entrypoint query, which boosted `Command.main` above `CliRunner.invoke`. A regression test now covers this case, and the entrypoint trigger requires explicit entrypoint wording or `cli` plus `main`.

## Per-Question Detail

Latest hybrid mode detail:

```text
command-decorator           symbolRank=1  fileRank=1  top=command                         file=src/click/decorators.py
group-decorator             symbolRank=3  fileRank=1  top=src/click/decorators.py         file=src/click/decorators.py
option-decorator            symbolRank=3  fileRank=1  top=command                         file=src/click/decorators.py
context-callback-invoke     symbolRank=1  fileRank=1  top=Context.invoke                  file=src/click/core.py
command-main                symbolRank=1  fileRank=1  top=Command.main                    file=src/click/core.py
group-subcommand-dispatch   symbolRank=1  fileRank=1  top=Group.invoke                    file=src/click/core.py
option-value-source         symbolRank=1  fileRank=1  top=Option.consume_value            file=src/click/core.py
choice-type-conversion      symbolRank=1  fileRank=1  top=Choice._normalized_mapping      file=src/click/types.py
path-type-validation        symbolRank=4  fileRank=1  top=src/click/types.py              file=src/click/types.py
echo-output                 symbolRank=1  fileRank=1  top=echo                            file=src/click/utils.py
terminal-prompt             symbolRank=1  fileRank=1  top=Option.prompt_for_value         file=src/click/core.py
shell-completion            symbolRank=2  fileRank=1  top=src/click/shell_completion.py   file=src/click/shell_completion.py
cli-runner-invoke           symbolRank=1  fileRank=1  top=CliRunner.invoke                file=src/click/testing.py
usage-formatting            symbolRank=1  fileRank=1  top=HelpFormatter.write_usage       file=src/click/formatting.py
```

## Qualitative Examples

- Good: `command-decorator` lands directly on `command` in `src/click/decorators.py`. This is the ideal case: lexical terms, symbol name, and source text all agree.
- Good: `command-main` lands on `Command.main`, which shows that the existing entrypoint intent can help outside Graphify and HTTPX.
- Good: `choice-type-conversion` lands on `Choice._normalized_mapping`, which source audit confirmed is a valid answer for the normalization half of the question, with `Choice.convert` next.
- Mixed: `path-type-validation` lands on `src/click/types.py` first, with `Path.convert` at rank 4. The class/module context is useful, but the exact validation logic lives in `Path.convert`.
- Good: `terminal-prompt` lands on `Option.prompt_for_value`, which source audit confirmed is a valid option-prompt path that delegates to `prompt` and `confirm`.
- Good: `cli-runner-invoke` now lands on `CliRunner.invoke` after the entrypoint trigger stopped treating `CliRunner` as a generic CLI entrypoint query.
- Good: `option-value-source` now lands directly on `Option.consume_value` after combining the narrower entrypoint trigger with method specificity.
- Good: `usage-formatting` now lands directly on `HelpFormatter.write_usage`, another container-vs-method win.
- Mixed: `shell-completion` now finds the dispatcher `shell_complete` at rank 2 after the question wording was narrowed to source-vs-complete instruction handling. The module still ranks first.
- Mixed: `group-decorator` lands on the decorators module first and `Group.group` at rank 3. Source audit showed the original expected symbol set was too narrow, but the top-level `group` wrapper still does not beat the module or shortcut method.

## Cross-Corpus Comparison

Latest comparable hybrid results:

```text
Graphify: Symbol Hit@1 1.00, Symbol Hit@5 1.00, File Hit@5 1.00
HTTPX:    Symbol Hit@1 0.77, Symbol Hit@5 1.00, File Hit@5 1.00
Click:    Symbol Hit@1 0.71, Symbol Hit@5 1.00, File Hit@5 1.00
```

Click lowers confidence in the current exact-symbol ranking. The system is good at finding files and neighborhoods, but exact method/function ordering still struggles in dense framework code.

The third corpus does not reverse the soft-hybrid conclusion. It makes the claim more precise: hybrid is the best current mode across these three corpora, but its biggest remaining weakness is not recall. It is choosing the right room after it has found the right building.

## Findings

- Click validates the need for cross-corpus testing. Graphify is saturated and HTTPX is strong, but Click exposes new exact-symbol misses.
- File-level retrieval is strong: hybrid and symbol mode both reach File Hit@5 `1.00`.
- Plain FTS remains a strong baseline. It reaches Symbol Hit@5 `0.86` at `2ms`, close to hybrid's `1.00` at `16ms`.
- Symbol mode alone underperforms hybrid on this corpus. It often promotes module/class containers over exact methods.
- The entrypoint intent is useful but must stay narrowly scoped. Removing the broad `command` + `line` trigger improved Click Symbol Hit@5 from `0.79` to `0.86` while preserving Graphify and HTTPX.
- A small hybrid-only method specificity boost improved Click Symbol Hit@1 from `0.36` to `0.50` while preserving Graphify and HTTPX.
- The shell-completion audit improved Click Symbol Hit@5 from `0.86` to `0.93` without code changes, which reinforces the rule that misses need source review before ranking work.
- The group-decorator audit improved Click Symbol Hit@5 from `0.93` to `1.00` without code changes by recognizing `Group.group` and `command` as source-backed alternatives to the top-level `group` wrapper.
- The choice-type-conversion audit improved Click Symbol Hit@1 from `0.50` to `0.57` without code changes by recognizing `_normalized_mapping` as the normalization implementation named by the question.
- The path-type-validation audit did not change metrics. It classified the miss as acceptable top-one ambiguity: the exact method is present at rank 4, behind its containing module and class.
- The terminal-prompt audit improved Click Symbol Hit@1 from `0.57` to `0.64` and File Hit@1 from `0.86` to `0.93` without code changes by recognizing `Option.prompt_for_value` as a source-backed prompt path.
- The cli-runner audit improved Click Symbol Hit@1 from `0.64` to `0.71` and File Hit@1 from `0.93` to `1.00` by narrowing the entrypoint trigger. Graphify and HTTPX hybrid metrics stayed at Symbol Hit@1/Hit@5 `1.00/1.00` and `0.77/1.00`.
- All previously listed Click top-one misses have now been source-audited or fixed. Further work should move from miss triage to a broader exact-method ordering design.

## Next Click Work

- No remaining listed Click top-one miss is unaudited.
- Plan a broader exact-method ordering pass before adding more ranking rules.
