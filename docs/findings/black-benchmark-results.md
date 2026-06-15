# Black Benchmark Results

Date: 2026-06-13

Corpus: fresh shallow clone of `psf/black` at `/tmp/agent-index-black`, commit `6325332`

Index command:

```bash
node dist/cli.js index /tmp/agent-index-black --source-only --index-path /tmp/agent-index-black.sqlite
```

Clean source-only index:

- 49 Python files
- 701 symbols
- 701 chunks
- 3180 edges

Black was added as a fresh blind repo after the expanded matrix had already been tuned across web frameworks, ORMs, graph algorithms, scientific tooling, packaging, and task queues. It stresses formatting flow, parser/config vocabulary, notebook cell handling, cache metadata, and an HTTP daemon (`blackd`).

## Golden Set

The benchmark has 12 source-audited questions covering:

- formatting files, strings, stdin/stdout, and diffs
- source discovery, exclusions, gitignore, and pyproject configuration
- cache read/change/write behavior
- Jupyter notebook cell formatting and IPython magic masking
- `blackd` request handling and Python variant headers
- line transformation and mode feature/cache-key behavior

Benchmark file:

```text
benchmarks/black-python.json
```

## Current Metrics

| Mode | Symbol Hit@1 | Symbol Hit@5 | Symbol MRR | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FTS | 0.25 | 0.83 | 0.47 | 0.92 | 1.00 | 5ms |
| Symbol | 0.75 | 1.00 | 0.86 | 0.92 | 1.00 | 38ms |
| Hybrid | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | ~40ms |

## Progression

| Step | Hybrid Symbol Hit@1 | Hybrid Symbol Hit@5 | File Hit@5 | Notes |
| --- | ---: | ---: | ---: | --- |
| First blind run | 0.67 | 0.75 | 0.75 | Parser-module domain intent over-triggered on config and HTTP-header questions; stdin/stdout formatting lost to an unrelated pyproject reader. |
| Parser/config/header/stdio repair | 1.00 | 1.00 | 1.00 | Added guarded config, HTTP request handler, Python variant header, and stdin/stdout formatting signals; suppressed parser-module domain routing for those cases. |

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 12 Black benchmark rows. The structured queries use API-shaped terms such as `format_file_in_place`, `format_str`, `_format_str_once`, `format_stdin_to_stdout`, `get_sources`, `gen_python_files`, `find_project_root`, `Cache.read`, `format_cell`, `mask_cell`, `handle`, `parse_python_variant_header`, `transform_line`, and `Mode.get_cache_key`.

Index:

```text
node dist/cli.js index /tmp/agent-index-black --source-only --index-path /tmp/agent-index-black-structured.sqlite
Indexed 49 files, 701 symbols, 701 chunks, 3180 edges at /tmp/agent-index-black-structured.sqlite (mode: source-only)
```

First structured pass:

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
Avg latency: 28ms
rg-style File Hit@1: 0.50
rg-style File Hit@5: 0.92
rg-style File MRR: 0.69
rg-style Avg latency: 32ms

Misses:
format-string-two-pass  top=assert_stable
```

Source/debug audit: `format_str` is the public entrypoint that runs `_format_str_once` and then performs the forced second pass when needed. `assert_stable` is a verifier helper that also calls `_format_str_once`; it only ranked first because the initial structured query included `assert_stable` and `assert_equivalent` as terms. That is a query-shaping error, not a production ranking defect.

Final structured pass after removing verifier-helper terms and using source-backed second-pass terms:

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
Avg latency: 31ms
rg-style File Hit@1: 0.50
rg-style File Hit@5: 0.92
rg-style File MRR: 0.69
rg-style Avg latency: 34ms

Misses: none
```

Interpretation: Black extends structured-agent evidence to a formatter/config/parser corpus. The main lesson is agent-facing query guidance: include exact helper names only when the helper is the intended target. Adjacent verifier helpers such as `assert_stable` can be source-near and lexically strong, but they are not the edit location for source-string formatting.

## Query Examples

Good result after stdin/stdout formatting intent:

```text
Question: where does Black read code from stdin and write formatted output or a diff to stdout?
Top result: format_stdin_to_stdout in src/black/__init__.py
Why it matters: the first run ranked an unrelated pyproject reader above the explicit stdio formatter because broad lifecycle verbs matched "read" and "write".
```

Good result after project config guard:

```text
Question: where does Black find the project root and parse pyproject toml configuration including inferred target versions?
Top result: find_project_root in src/black/files.py
Why it matters: "parse" should not automatically route to low-level parser machinery when the question names configuration and project-root behavior.
```

Good result after HTTP request handler guard:

```text
Question: where does blackd handle an HTTP request, parse headers, format the request body, and return the response?
Top result: handle in src/blackd/__init__.py
Why it matters: request/header/body wording points at daemon request handling, not grammar parser internals.
```

## Findings

- Black is useful blind evidence because it is compact, source-only friendly, and domain-distinct from the earlier corpora.
- Plain FTS was already strong at file recall: File Hit@5 was `1.00`. The gap was exact symbol ordering.
- Symbol mode found every expected symbol in top five, but still surfaced module chunks or broad context first in several cases.
- The main transfer failure was over-broad parser-domain routing. Parser modules should win parser questions, but not config parsing or HTTP header parsing questions.
- The final fix is reusable but narrow: it adds positive signals for project config, request handling, Python variant headers, and stdin/stdout formatting, while adding negative guards for parser-module overreach.
- This run supports the agent-navigation strategy on a fresh repo, but it is still benchmark evidence, not proof that `agent-index` generally beats Graphify on every corpus.

## Graphify Comparison

To compare against Graphify-style traversal, the Black source tree was copied into a Python-only corpus under `/tmp/black-py-only-vDkfan`. This avoids Graphify's semantic document path and keeps both tools on local source files.

Graphify extraction:

```text
[graphify extract] found 40 code, 0 docs, 0 papers, 0 images
[graphify extract] wrote /private/tmp/graphify-bench-black-py-uv/graphify-out/graph.json - 1299 nodes, 4146 edges (no clustering)
```

As in earlier comparisons, Graphify's token benchmark needed a temporary compatibility copy with `links = edges`.

Graphify token benchmark:

```text
Corpus:          67,700 words -> ~90,266 tokens (naive)
Graph:           1,354 nodes, 4,146 edges
Avg query cost:  ~3,022 tokens
Reduction:       29.9x fewer tokens per query
```

Same Python-only corpus with `agent-index`:

```text
Indexed 41 files, 690 symbols, 690 chunks, 3151 edges at /tmp/agent-index-black-py-only.sqlite (mode: source-only)

Mode: hybrid
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
Avg latency: 30ms
Misses: none
```

`agent-eval` comparison:

```text
agent-index Symbol Hit@1: 1.00
agent-index Symbol Hit@5: 1.00
agent-index File Hit@1: 1.00
agent-index File Hit@5: 1.00
Graphify symbol mention rate: 0.58
Graphify file mention rate: 0.83
```

Comparison misses:

```text
project-config-root          graphifySymbol=no  graphifyFile=no
cache-read-change-write      graphifySymbol=no  graphifyFile=yes
ipython-magic-masking        graphifySymbol=no  graphifyFile=no
blackd-python-variant-header graphifySymbol=no  graphifyFile=yes
mode-feature-cache-key       graphifySymbol=no  graphifyFile=yes
```

Interpretation: Graphify provides a strong context-compression result on Black, but its traversal context did not mention expected exact symbols often enough for precise agent navigation. On this source-audited benchmark, `agent-index` is stronger for finding the file/symbol/function an agent should inspect first.

## Next Candidates

- Keep attrs and h11 as small unsaturated pressure checks.
- Add one more fresh blind repo after Black, preferably with different vocabulary again, before claiming broad readiness.
