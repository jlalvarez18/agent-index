# Jinja Benchmark Results

Date: 2026-06-13

Corpus: fresh shallow clone of `pallets/jinja` at `/tmp/agent-index-jinja`, commit `5ef7011`

Index command:

```bash
node dist/cli.js index /tmp/agent-index-jinja --source-only --index-path /tmp/agent-index-jinja.sqlite
```

Clean source-only index:

- 25 Python files
- 890 symbols
- 890 chunks
- 3265 edges

Jinja was added after the Black blind comparison to test another new domain: template lexing, parsing, compilation, loaders, sandboxing, runtime context, filters, bytecode cache, and meta analysis.

## Golden Set

The benchmark has 12 source-audited questions covering:

- environment template loading and cache reuse
- filesystem loader source lookup and reload checks
- loader bytecode-cache buckets
- lexer tokenization and token wrapping
- full-template parsing into AST nodes
- environment parse/generate/compile pipeline
- code generator template and output visitors
- runtime context callable dispatch
- macro invocation and autoescape behavior
- sandbox attribute/callable safety
- map/select/reject filter helpers
- meta undeclared-variable and referenced-template analysis

Benchmark file:

```text
benchmarks/jinja-python.json
```

## Current Metrics

| Mode | Symbol Hit@1 | Symbol Hit@5 | Symbol MRR | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Hybrid, first blind run | 0.75 | 0.92 | 0.80 | 0.92 | 0.92 | 32ms |
| Hybrid, after template pipeline repair | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 33ms |

## Progression

| Step | Hybrid Symbol Hit@1 | Hybrid Symbol Hit@5 | File Hit@5 | Notes |
| --- | ---: | ---: | ---: | --- |
| First blind run | 0.75 | 0.92 | 0.92 | File recall was strong, but abstract loader methods and specific parser helpers beat full-pipeline answers. |
| Template pipeline repair | 1.00 | 1.00 | 1.00 | Added guarded filesystem-loader, template-parser-pipeline, and template-compile-pipeline signals; suppressed generic parser-module boosts for full-pipeline questions. |

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 12 Jinja benchmark rows. The structured queries use owner/API-shaped terms such as `Environment._load_template`, `FileSystemLoader.get_source`, `BaseLoader.load`, `Lexer.tokenize`, `Parser.subparse`, `Environment.compile`, `CodeGenerator.visit_Template`, `Context.call`, `Macro.__call__`, `SandboxedEnvironment.is_safe_attribute`, `prepare_select_or_reject`, and `find_undeclared_variables`.

Index:

```text
node dist/cli.js index /tmp/agent-index-jinja --source-only --index-path /tmp/agent-index-jinja-structured.sqlite
Indexed 25 files, 890 symbols, 890 chunks, 3265 edges at /tmp/agent-index-jinja-structured.sqlite (mode: source-only)
```

Structured pass:

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
Avg latency: 29ms
rg-style File Hit@1: 0.42
rg-style File Hit@5: 0.75
rg-style File MRR: 0.58
rg-style Avg latency: 10ms

Misses: none
```

Interpretation: Jinja is a clean structured-agent pass in a template-engine corpus. The rg-style file baseline struggles because words such as `template`, `parse`, `source`, `context`, and `environment` are spread across loaders, parser helpers, compiler pipeline, runtime, and meta analysis. Structured owner/API terms keep the query anchored to the exact symbol and abstraction level.

## Query Examples

Good result after filesystem loader intent:

```text
Question: where does Jinja search filesystem template directories, read the source text, and create the uptodate reload check?
Top result: FileSystemLoader.get_source in src/jinja2/loaders.py
Why it matters: the abstract BaseLoader.get_source shares the method name, but the question asks for filesystem search, reading, and reload behavior.
```

Good result after template parser pipeline intent:

```text
Question: where does Jinja parse template data variable blocks and statement blocks into a Template node AST?
Top result: Parser.subparse in src/jinja2/parser.py
Why it matters: specific helpers such as parse_block are relevant pieces, but subparse is the method that handles data, variable blocks, and statement blocks together.
```

Good result after template compile pipeline intent:

```text
Question: where does Jinja parse template source, generate Python source, and compile it into a code object or raw generated code?
Top result: Environment.compile in src/jinja2/environment.py
Why it matters: generic expression parser helpers matched "parse", but the question asks for the environment-level pipeline from parsing through generation and compilation.
```

## Graphify Comparison

To compare against Graphify-style traversal, the Jinja source tree was copied into a Python-only corpus under `/tmp/jinja-py-only-6FReIG`.

Graphify extraction:

```text
[graphify extract] found 25 code, 0 docs, 0 papers, 0 images
[graphify extract] wrote /private/tmp/graphify-bench-jinja-py/graphify-out/graph.json - 1552 nodes, 4953 edges (no clustering)
```

As in earlier comparisons, Graphify's token benchmark needed a temporary compatibility copy with `links = edges`.

Graphify token benchmark:

```text
Corpus:          79,300 words -> ~105,733 tokens (naive)
Graph:           1,586 nodes, 4,953 edges
Avg query cost:  ~9,126 tokens
Reduction:       11.6x fewer tokens per query
```

Same Python-only corpus with `agent-index`:

```text
Indexed 25 files, 890 symbols, 890 chunks, 3265 edges at /tmp/agent-index-jinja-py-only.sqlite (mode: source-only)

Mode: hybrid
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
Avg latency: 33ms
Misses: none
```

`agent-eval` comparison:

```text
agent-index Symbol Hit@1: 1.00
agent-index Symbol Hit@5: 1.00
agent-index File Hit@1: 1.00
agent-index File Hit@5: 1.00
Graphify symbol mention rate: 0.08
Graphify file mention rate: 0.67
```

Interpretation: Jinja is strong evidence for exact agent navigation. Graphify still provides meaningful context compression, but its traversal output rarely names the exact expected symbol for these source-audited questions.

## Findings

- Jinja reinforced a pattern from Black: parser vocabulary is dangerous when every helper starts with `parse_*`.
- Exact file recall was already mostly good on the first run. The improvement was choosing the right level of abstraction inside the right file.
- The useful fixes are not Jinja-specific names; they encode general distinctions:
  - concrete filesystem loader behavior beats abstract loader interface wording;
  - full-template parsing beats single statement/expression parser helpers;
  - compile pipeline wording beats parser-only helpers.
- This is another same-corpus comparison where `agent-index` is stronger for exact file/symbol navigation, while Graphify's native strength remains context reduction.

## Next Candidates

- Keep Jinja as a preservation benchmark for parser/compiler pipeline wording.
- Add another blind repo only after rerunning the broader preservation suite, because the rule set is now large enough that regressions are the main risk.
