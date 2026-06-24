# Cython First-Class Support Notes

Date: 2026-06-17
Updated: 2026-06-23

## Scope

This pass upgrades Cython from basic template-file indexing toward first-class mixed-language navigation:

- Scanner coverage for `.pyx`, `.pxd`, `.pxi`, `.pyx.tp`, `.pxd.tp`, `.pxi.tp`, `.pyx.in`, `.pxd.in`, and `.pxi.in`.
- Cython test-file role detection for names such as `test_fast.pyx` and `_fast_test.pyx`.
- Extractor coverage for `def`, `cdef`, `cpdef`, templated function/class names, `cdef class` extension types, `ctypedef`, `cpdef enum`, `cdef struct`, top-level Cython constants, imports, cimports, base-class hierarchy, ownership edges, and call-name edges.
- `ctypedef` extraction now handles fused types, scalar aliases such as `ctypedef double float64_t`, array aliases, quoted C aliases, and function-pointer aliases.
- Cython-aware ranking signals for backend/performance-shaped navigation tasks in `query` and `file-clusters`.
- Cython source-to-test navigation support by normalizing compound suffixes such as `.pyx.tp` and `.pxd.in` to Python-style module names.

## Benchmarks

Added `benchmarks/navigation/scikit-learn-dbscan-cython-inner-loop.json` and registered it as `scikit-learn-cython-dbscan` in the navigation suite. It complements the existing scikit-learn radius-neighbors Cython template case with a DBSCAN workflow that starts at the Python estimator, enters the `_dbscan_inner.pyx` backend, and returns to Python tests.

Intended local command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-indexes \
  --artifacts-dir /tmp/agent-index-artifacts-cython \
  --repo scikit-learn-cython-dbscan \
  --reindex \
  --repos
```

Measured result after adding `agentToolUse` expectations on 2026-06-23:

| Suite entry | Files | Symbols | Edges | agent-index completion | broad rg completion | optimized rg completion | agent tokens | broad rg tokens | optimized rg tokens | agentToolUse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `scikit-learn-cython-dbscan` | 1,217 | 15,175 | 89,758 | 1.00 | 1.00 | 0.00 | 213 | 2,261,917 | 1,004 | 1.00 |

agent-index won against both broad and optimized `rg`, saving 2,261,704 tokens versus broad `rg` and 791 tokens versus optimized `rg`.

The authored workflow now includes:

```json
"agentToolUse": {
  "expected": "agent-index-first",
  "maxFirstUsefulCommand": 1,
  "maxCompletionContextTokens": 300
}
```

The 2026-06-23 run satisfied that expectation:

- first useful command: 1
- completion command: 2
- first useful context: 187 tokens
- completion context: 213 tokens
- first useful hit: `sklearn/cluster/_dbscan_inner.pyx` / `dbscan_inner`
- related test hit: `sklearn/cluster/tests/test_dbscan.py`

One repeated pre-edit run found that optimized `rg` could complete this case with 1,087 completion-context tokens when file-order and snippet-derived terms happened to keep `test_dbscan.py` in the optimized path. The post-edit validation run above is the recorded fixture result, but the limitation is useful: this case should be read as "agent-index gives a smaller, stable mixed Python-to-Cython map" rather than "optimized `rg` can never complete the task."

## Live-Agent Cython Trial

A worker subagent performed a small Cython bugfix trial in `/tmp/agent-index-cython-live-trial`.

Task:

- Fix a DBSCAN-like inner-loop bug where a border sample reached from a core sample stayed labeled as noise.

Setup:

- Mixed fixture files: Python estimator sidecar, Cython `.pyx` inner loop, and Python unittest coverage.
- Prebuilt index: `/tmp/agent-index-cython-live-trial/index.sqlite`
- agent-index CLI: `/Users/juan/.codex/worktrees/ec49/agent-index/dist/cli.js`
- Initial verification failure: labels were `[0, -1, -1]` instead of `[0, 0, -1]`.

Observed agent behavior:

- First navigation tool: agent-index.
- First useful hit: `expand_core_labels` in `sklearn/cluster/_dbscan_inner.pyx`.
- Files inspected: `sklearn/cluster/_dbscan_inner.pyx`, `sklearn/cluster/tests/test_dbscan_live.py`, and `sklearn/cluster/_dbscan.py`.
- Files edited: `sklearn/cluster/_dbscan_inner.pyx`.
- Tests run: `python3 -m unittest discover -s sklearn/cluster/tests`.
- Broad `rg` fallback: none.

The subagent used agent-index before broad search, then fixed the Cython-style loop by assigning the cluster label to every newly reached neighbor while only pushing core neighbors for further expansion. Independent verification after the subagent completed:

```text
.
----------------------------------------------------------------------
Ran 1 test in 0.000s

OK
```

This is a live coding signal for Cython-specific navigation, but it is intentionally small. It proves that an agent can choose agent-index first and complete a mixed Python/Cython bugfix loop in a controlled fixture; it does not replace the real scikit-learn navigation benchmark above.

## Mixed-Language Limitations

- Cython extraction remains line-based. It handles scikit-learn-style `.pyx`, `.pxd`, `.pxi`, and template suffixes well enough for the current benchmark, but it is not a full Cython parser.
- Qualified names for Cython members are compact local names such as `RadiusNeighbors.compute` or `dbscan_inner`, not fully resolved Python package paths.
- Cross-language navigation relies on file/module paths, import/cimport edges, call-name edges, and related-test heuristics. It can surface the Python estimator, Cython backend, and Python tests, but it does not prove semantic type resolution across Python and Cython.
- Optimized `rg` remains competitive on latency and can sometimes complete this DBSCAN case with bounded snippets; agent-index's advantage is the smaller symbol-aware context and direct related-test follow-up.

## Verification

Passing:

```bash
npx vitest run tests/core/cython-extractor.test.ts
```

Latest focused extractor result: 2 tests passed on 2026-06-23, including scikit-learn-style `ctypedef` alias coverage.

Full integrated verification:

- `npm test`: 26 test files passed, 399 tests passed.
- `npm run build`: TypeScript build completed successfully.
- `git diff --check`: no whitespace errors.

2026-06-23 focused validation:

```bash
npm install
npm run build
npx vitest run tests/core/cython-extractor.test.ts tests/core/related-tests.test.ts
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-indexes-cython-tooluse \
  --artifacts-dir /tmp/agent-index-artifacts-cython-tooluse-after \
  --repo scikit-learn-cython-dbscan \
  --reindex \
  --repos \
  --json
node -e "JSON.parse(require('node:fs').readFileSync('benchmarks/navigation/scikit-learn-dbscan-cython-inner-loop.json','utf8'))"
git diff --check
python3 -m unittest discover -s sklearn/cluster/tests
```

The `python3 -m unittest` command was run from `/tmp/agent-index-cython-live-trial` for the live-agent fixture.
