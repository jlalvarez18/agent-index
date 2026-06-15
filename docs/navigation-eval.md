# Navigation Eval

`nav-eval` is the repeatable road course for coding-agent navigation. The regular benchmark asks, "Did one query rank the golden symbol?" Navigation eval asks, "How much did an agent have to read before it found useful code?"

That distinction matters. `rg` is excellent at exact string lookup. `agent-index` should win when a task starts as intent, requires source/test navigation, and the agent needs a compact map instead of pages of matching lines.

## Run

```bash
npm run agent-index -- index /path/to/repo
npm run agent-index -- nav-eval ./navigation-eval.json \
  --target /path/to/repo \
  --mode hybrid \
  --cases
```

Use `--json` for machine-readable results.

## Multi-Repo Suite

Use `nav-suite` to run multiple repository fixtures and get weighted aggregate metrics:

```json
[
  {
    "name": "networkx",
    "evalPath": "benchmarks/navigation/networkx-path-and-cuts.json",
    "target": "/path/to/networkx",
    "indexPath": "/tmp/agent-index-networkx-nav.sqlite",
    "mode": "hybrid"
  },
  {
    "name": "pydantic",
    "evalPath": "benchmarks/navigation/pydantic-computed-fields.json",
    "target": "/path/to/pydantic",
    "indexPath": "/tmp/agent-index-pydantic-nav.sqlite",
    "mode": "hybrid"
  }
]
```

Then run:

```bash
npm run agent-index -- nav-suite ./benchmarks/navigation/suite.json \
  --repo-root /path/to/local/repos \
  --index-root /tmp/agent-index-nav-suite \
  --artifacts-dir /tmp/agent-index-nav-artifacts \
  --repos \
  --reindex
```

Use `--reindex` when you want one command to rebuild every suite index before measuring navigation. Omit it when comparing against already-built indexes.
Use `--repo-root` with portable suite manifests whose `target` values are repo directory names. Use `--index-root` to write generated SQLite indexes outside the evaluated repositories.
Use `--artifacts-dir` to persist `summary.json` and one JSON file per repository under `repos/`, which makes CI comparisons and regression diffs easier than scraping terminal output.

Compare two saved suite runs with `nav-compare`:

```bash
npm run agent-index -- nav-compare /path/to/baseline-artifacts /tmp/agent-index-nav-artifacts \
  --max-agent-token-increase-percent 5 \
  --max-agent-latency-increase-percent 25
```

The comparison fails when agent-index completion or win counts drop, or when average agent-index context tokens rise beyond the configured absolute or percentage allowance. Latency checks are opt-in because runtime noise depends on the machine; use `--max-agent-latency-increase-ms` or `--max-agent-latency-increase-percent` when comparing artifacts from a stable environment.

Relative `evalPath`, `target`, and `indexPath` values resolve relative to the manifest file.

## Input Shape

```json
[
  {
    "id": "click-no-color",
    "task": "Add NO_COLOR handling without overriding explicit color=True.",
    "kind": "bugfix",
    "agentIndexSteps": [
      {
        "type": "file-clusters",
        "query": {
          "terms": ["resolve_color_default", "NO_COLOR", "color", "env"],
          "symbolKinds": ["function"],
          "roles": ["source"],
          "pathHints": ["globals", "color"]
        },
        "limit": 5
      },
      {
        "type": "related-tests",
        "sourceFromStep": 1,
        "symbol": "resolve_color_default",
        "limit": 5
      },
      {
        "type": "query",
        "query": {
          "terms": ["NO_COLOR", "resolve_color_default", "color"],
          "symbolKinds": ["function"],
          "roles": ["test"],
          "pathHints": ["tests"],
          "expand": []
        }
      }
    ],
    "rgQueries": [
      ["NO_COLOR", "resolve_color_default", "color=True", "strip_ansi"],
      ["resolve_color_default", "test_with_color", "CliRunner"]
    ],
    "rgOptimizedSteps": [
      {
        "type": "files",
        "terms": ["NO_COLOR", "resolve_color_default"],
        "paths": ["src"],
        "globs": ["*.py"],
        "limit": 20
      },
      {
        "type": "snippets",
        "terms": ["NO_COLOR", "resolve_color_default"],
        "fromStep": 1,
        "before": 2,
        "after": 2,
        "limit": 5
      }
    ],
    "expected": {
      "files": ["src/click/globals.py", "tests/test_globals.py"],
      "symbols": ["resolve_color_default"],
      "requiredFiles": ["src/click/globals.py"],
      "requiredSymbols": ["resolve_color_default"]
    }
  }
]
```

## Metrics

- `foundUseful`: whether a workflow reached an expected file or symbol.
- `taskComplete`: whether the workflow surfaced the required files and symbols for the task.
- `firstUsefulCommand`: which command first produced a useful hit.
- `firstUsefulRank`: where the useful hit appeared in that command's output.
- `missingFiles` / `missingSymbols`: what the workflow still lacks for task-completion coverage.
- `contextTokens`: deterministic `ceil(chars / 4)` estimate of what the agent had to read.
- `winner`: favors the workflow that finds useful code with fewer context tokens without taking more commands to get there.

Use `expected.files` and `expected.symbols` for acceptable useful hits. Use `expected.requiredFiles` and `expected.requiredSymbols` for the files/symbols required to call the navigation task complete. If required fields are omitted, completion uses all expected files and symbols.

Older fixtures may still use `agentIndexQueries`; the runner treats each query as a `query` step. New fixtures should prefer `agentIndexSteps` so they can measure realistic map -> source -> tests workflows.
For `related-tests`, either pass `sourceFile` explicitly or use `sourceFromStep` with a 1-based prior step number. `sourceFromStep` derives the source file from the actual prior output, which is better for blind map -> test workflows.
Use `rgOptimizedSteps` to model a stronger rg workflow explicitly. A `files` step runs filename narrowing like `rg --files-with-matches`; a `snippets` step reads bounded context from explicit files or from a prior file-list step. Keep these steps authored in the fixture rather than inferred from expected files.

## Source To Test Follow-Up

Use `file-clusters` when the agent needs a cheap file map before choosing exact symbols:

```bash
npm run agent-index -- file-clusters "computed fields serialization" \
  --target /path/to/repo \
  --term exclude_computed_fields \
  --role source \
  --path pydantic
```

This is useful for broad bug-fix or feature prompts where `rg` may return thousands of lines. The output is file-level: top file, role, matched chunks, compact token estimate, representative symbols, and short reasons.

After a navigation eval or ordinary query finds a source file, use `related-tests` to avoid a broad second `rg` search:

```bash
npm run agent-index -- related-tests \
  --target /path/to/repo \
  --source networkx/algorithms/cuts.py \
  --symbol mixing_expansion \
  --term weighted \
  --term cut_size
```

The current scorer ranks test files by source path tokens, source file stem, source symbol mentions, import edges, call-name edges, and optional task terms. It is still heuristic, but it can now find tests whose filenames do not mirror the source filename when they import or call the source module/symbol. Use task terms for behavior-specific follow-ups when many tests share the same imports.

Navigation eval reports both broad matched-line rg output and the explicit optimized rg workflow when `rgOptimizedSteps` are present. The optimized baseline is closer to how agents conserve context with rg: first find candidate files, then read selected snippets.

## Starter Real-World Cases

The next multi-repo suite should start with these dogfood-backed cases:

- HTTPX redirect history: `httpx/_client.py`, `tests/client/test_redirects.py`; see `docs/findings/httpx-redirect-history-dogfood.md`.
- NetworkX path weight defaults: `networkx/classes/function.py`, `networkx/classes/tests/test_function.py`; see `docs/findings/networkx-path-cost-agent-dogfood.md`.
- NetworkX weighted mixing expansion: `networkx/algorithms/cuts.py`, `networkx/algorithms/tests/test_cuts.py`; see `docs/findings/networkx-weighted-mixing-agent-dogfood.md`.
- Click `NO_COLOR`: `src/click/globals.py`, color callers, and tests; see `docs/findings/click-no-color-dogfood.md`.
- Rich `print_json(file=...)`: `rich/__init__.py`, `rich/console.py`, JSON tests; see `docs/findings/rich-print-json-file-dogfood.md`.
- Pydantic computed fields: `pydantic/main.py`, `pydantic/fields.py`, `pydantic-core/src/serializers/computed_fields.rs`, computed-field tests; see `docs/findings/pydantic-computed-fields-agent-dogfood.md`.

Each case should represent a real bug fix, feature, or test-discovery task. Avoid cases that are only "find this symbol"; those mostly test whether the agent already knows what to type into `rg`.
