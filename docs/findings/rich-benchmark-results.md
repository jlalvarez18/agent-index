# Rich Benchmark Results

## Current Status

Rich is the fourth validation corpus, cloned locally at `/Users/juan/Repos/rich`.

This corpus was chosen because it is a medium-sized, source-heavy Python library with a different shape from the earlier corpora: terminal rendering, layout, markup parsing, progress display, logging, tracebacks, and syntax highlighting.

## Benchmark Setup

Commands:

```bash
node dist/cli.js index /Users/juan/Repos/rich --source-only
node dist/cli.js benchmark ./benchmarks/rich-python.json --target /Users/juan/Repos/rich --mode hybrid
```

Source-only index summary:

```text
Indexed 105 files, 1174 symbols, 1174 chunks, 4179 edges at /Users/juan/Repos/rich/.codeindex/index.sqlite (mode: source-only)
```

The all-files index was also tested first:

```text
Indexed 213 files, 2076 symbols, 2076 chunks, 8319 edges at /Users/juan/Repos/rich/.codeindex/index.sqlite (mode: all-files)
```

The all-files run produced Symbol Hit@1 `0.92`, Symbol Hit@5 `0.92`, and avg latency `35ms`. Source-only mode gave cleaner retrieval and recovered Symbol Hit@5 to `1.00`.

## Golden Questions

The seed set contains 12 questions covering console rendering, markup parsing, text wrapping, table layout, progress tasks, file progress helpers, logging, tracebacks, syntax highlighting, and live rendering.

## Mode Comparison

Run date: 2026-06-12

Plain FTS:

```text
Mode: fts
Questions: 12
Symbol Hit@1: 0.50
Symbol Hit@5: 1.00
Symbol MRR: 0.67
File Hit@1: 0.83
File Hit@5: 1.00
File MRR: 0.90
Partial file hits: 0.00
Avg latency: 6ms
```

Symbol mode:

```text
Mode: symbol
Questions: 12
Symbol Hit@1: 0.92
Symbol Hit@5: 0.92
Symbol MRR: 0.92
File Hit@1: 0.92
File Hit@5: 1.00
File MRR: 0.96
Partial file hits: 0.08
Avg latency: 28ms
```

Hybrid mode before the markup parser fix:

```text
Mode: hybrid
Questions: 12
Symbol Hit@1: 0.92
Symbol Hit@5: 1.00
Symbol MRR: 0.94
File Hit@1: 0.92
File Hit@5: 1.00
File MRR: 0.96
Partial file hits: 0.00
Avg latency: 26ms
```

Hybrid mode after the markup parser fix:

```text
Mode: hybrid
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 26ms
```

Hybrid is the best current mode on Rich. It keeps the full top-five symbol recall of FTS while improving top-one symbol precision from `0.50` to `1.00`.

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 12 Rich benchmark rows. These structured queries model what an LLM agent should pass after translating the task into code-search terms, symbol kinds, path hints, source-only filtering, and graph expansion preferences.

Index:

```text
node dist/cli.js index /Users/juan/Repos/rich --source-only --index-path /tmp/agent-index-rich-structured.sqlite
Indexed 101 files, 1118 symbols, 1118 chunks, 4035 edges at /tmp/agent-index-rich-structured.sqlite (mode: source-only)
```

First structured run:

```text
Mode: hybrid
Query style: agent
Questions: 12
Symbol Hit@1: 0.92
Symbol Hit@5: 1.00
Symbol MRR: 0.96
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 15ms
rg-style File Hit@1: 0.58
rg-style File Hit@5: 0.92
rg-style File MRR: 0.75
rg-style Avg latency: 23ms

Misses:
progress-track-files  symbolRank=2  fileRank=1  top=Progress.open  file=rich/progress.py
```

Source audit showed this was an answer-key gap, not a ranking bug. `Progress.open` opens the file, creates or updates the progress task, wraps the handle in `_Reader`, and returns the progress-aware reader. It is a source-valid answer for "wrap files with progress", alongside the module-level `open`, `wrap_file`, and `Progress.wrap_file`.

After adding `Progress.open` to the expected symbols:

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
Avg latency: 15ms
rg-style File Hit@1: 0.58
rg-style File Hit@5: 0.92
rg-style File MRR: 0.75
rg-style Avg latency: 22ms

Misses: none
```

Interpretation: Rich extends the structured-agent evidence beyond Graphify, HTTPX, and Click. The result also reinforces the lab-notebook rule: top-one surprises need source audit before ranker changes. In this case the right fix was to broaden the source-backed answer key, not add another scoring rule.

## Hybrid Detail

```text
console-print-renderables     symbolRank=1  fileRank=1  top=Console._collect_renderables   file=rich/console.py
console-render-markup-string  symbolRank=1  fileRank=1  top=Console.render_str            file=rich/console.py
markup-parse-tags             symbolRank=1  fileRank=1  top=_parse                        file=rich/markup.py
text-wrap-divide              symbolRank=1  fileRank=1  top=Text.wrap                     file=rich/text.py
table-add-columns-rows        symbolRank=1  fileRank=1  top=Table.add_row                 file=rich/table.py
table-column-widths           symbolRank=1  fileRank=1  top=Table._calculate_column_widths file=rich/table.py
progress-task-lifecycle       symbolRank=1  fileRank=1  top=Progress.update               file=rich/progress.py
progress-track-files          symbolRank=1  fileRank=1  top=Progress.wrap_file            file=rich/progress.py
logging-handler-render        symbolRank=1  fileRank=1  top=RichHandler.emit              file=rich/logging.py
traceback-extract-render      symbolRank=1  fileRank=1  top=Traceback._render_stack       file=rich/traceback.py
syntax-highlight-code         symbolRank=1  fileRank=1  top=Syntax.guess_lexer            file=rich/syntax.py
live-render-refresh           symbolRank=1  fileRank=1  top=Live.process_renderables      file=rich/live.py
```

## Examples

Good result: `where does Table calculate and collapse column widths?`

- Top result: `Table._calculate_column_widths` in `rich/table.py`
- Expected symbols included `Table._calculate_column_widths`, `Table._collapse_widths`, and `Table._measure_column`.
- This is a clean symbol-first win because the query describes implementation behavior rather than naming the exact method.

Good result: `where does Live update refresh and process live renderables?`

- Top result: `Live.process_renderables` in `rich/live.py`
- Expected symbols included `Live.update`, `Live.refresh`, `Live.process_renderables`, `Live.start`, and `Live.stop`.
- Nearby graph context also surfaced calls from `Console.print` and `Console.log`, which is useful navigation context.

Fixed result: `where is Rich markup parsed into tags and converted to text?`

- Before the audit fix, the top result was `Text.markup` and `_parse` ranked 3.
- After the fix, the top result is `_parse` in `rich/markup.py`.
- This confirms the benchmark wanted the lower-level parser, not the inverse/convenience APIs that serialize markup strings.

## Finding

Rich supports the broader claim better than the saturated earlier corpora: hybrid ranking improves top-one precision over FTS while preserving top-five recall. The markup miss was useful because it exposed a general ambiguity between public convenience APIs and lower-level implementation functions.

## Markup Miss Audit

Audit date: 2026-06-12

Question:

```text
where is Rich markup parsed into tags and converted to text?
```

Observed top results:

```text
rank 1  Text.markup   rich/text.py
rank 2  Tag.markup    rich/markup.py
rank 3  _parse        rich/markup.py
```

Source check:

- `Text.markup` in `rich/text.py` is a property that serializes a `Text` object and its spans back into console markup.
- `Tag.markup` in `rich/markup.py` is a property that serializes one parsed tag back into bracket markup.
- `_parse` in `rich/markup.py` is the function that scans markup text and yields text/tag tuples.
- `render` in `rich/markup.py` is the end-to-end function that calls `_parse`, builds spans, and returns a `Text` instance.

Conclusion: the answer key is directionally correct. The query asks for parsing markup into tags/text, so `_parse` and `render` are the implementation path. `Text.markup` and `Tag.markup` are mostly inverse/convenience APIs.

Root causes found:

- The generic owner/name method boost overvalues `Text.markup` because the query contains both `markup` and `text`, even though `text` is the output concept here, not an explicit request for the `Text` class.
- The core-symbol rule overvalues `Tag.markup` because `markup.py` and a method named `markup` have matching stem tokens. That rule was useful for top-level functions such as `shell_completion.py` / `shell_complete`, but it is too broad for class properties.
- A second probe, `where does rich.markup parse markup tags into a Text instance?`, exposed another issue: the dotted-reference rule treats `rich.markup` like an API member called `markup`, even though in this context it is a module path.
- The tiny stemmer turns `parsed` into `pars`, so it does not help `_parse` as much as a real parser/action signal would.

Recommended next fix:

Add regression tests for this audit case, then narrow ranking in three small ways:

- Limit the core-symbol file-stem boost to top-level functions, or at least exclude property methods.
- Treat two-segment lowercase dotted references such as `rich.markup` as likely module references unless the query explicitly asks for a function, method, class, or definition.
- Add a small parser/action signal so queries with `parse`, `parsed`, or `parser` can prefer function symbols such as `_parse` over properties named after the subject noun.

## Markup Fix

Implementation date: 2026-06-12

Regression tests added:

- Lowercase dotted module paths such as `pkg.markup` should not be treated as API-member references unless the query explicitly asks for a function, method, class, or definition.
- Parser questions should prefer `_parse` over inverse `markup` properties when the query asks where markup is parsed into tags/text.

Ranking changes:

- The core-symbol file-stem boost is now limited to top-level functions. This preserves `shell_completion.py` / `shell_complete` while avoiding class property boosts such as `Tag.markup`.
- Owner/name and owner/source method boosts no longer apply to `@property` methods unless the query names the exact qualified property, such as `Text.markup`.
- Lowercase dotted references are treated as likely module paths unless the surrounding query explicitly asks for an API object.
- A guarded parser-action signal boosts function symbols for parser questions involving markup/tags.

Result:

```text
Graphify hybrid: Symbol Hit@1 1.00, Symbol Hit@5 1.00, avg 53ms
HTTPX hybrid:    Symbol Hit@1 1.00, Symbol Hit@5 1.00, avg 13ms
Click hybrid:    Symbol Hit@1 1.00, Symbol Hit@5 1.00, avg 18ms
Rich hybrid:     Symbol Hit@1 1.00, Symbol Hit@5 1.00, avg 26ms
```
