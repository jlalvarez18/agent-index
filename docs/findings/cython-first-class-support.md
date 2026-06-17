# Cython First-Class Support Notes

Date: 2026-06-17

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

Measured result after integrating the C/C++ fixes:

| Suite entry | Files | Symbols | agent-index completion | broad rg completion | optimized rg completion | agent tokens | broad rg tokens | optimized rg tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `scikit-learn-cython-dbscan` | 1,170 | 15,137 | 1.00 | 1.00 | 0.00 | 214 | 2,261,917 | 1,003 |

agent-index won against both broad and optimized `rg`, saving 2,261,703 tokens versus broad `rg` and 789 tokens versus optimized `rg`.

## Verification

Passing:

```bash
npx vitest run tests/core/cython-extractor.test.ts
```

Latest result: 2 tests passed on 2026-06-17, including scikit-learn-style `ctypedef` alias coverage.

Full integrated verification:

- `npm test`: 26 test files passed, 399 tests passed.
- `npm run build`: TypeScript build completed successfully.
- `git diff --check`: no whitespace errors.
