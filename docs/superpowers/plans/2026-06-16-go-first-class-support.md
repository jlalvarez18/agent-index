# Go First-Class Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class Go indexing and navigation support while preserving the Python and TypeScript/JavaScript stabilization baselines.

**Architecture:** Follow the existing extractor/scanner/indexer/navigation-suite shape. Add a Go extractor that captures packages, imports, types, interfaces, methods, functions, calls, and Go tests/subtests; then add real-repository navigation fixtures that compare agent-index against broad and optimized `rg` workflows with fairness guards.

**Tech Stack:** TypeScript, Vitest, SQLite/FTS5, local navigation fixtures under `benchmarks/navigation`, optional real Go repositories under `/Users/juan/Repos`.

---

### Task 1: Add Go Scanner, Schema, Extractor, and Indexer Wiring

**Files:**
- Modify: `src/core/schema.ts`
- Modify: `src/core/scanner.ts`
- Modify: `src/core/indexer.ts`
- Create: `src/core/extractors/go.ts`
- Create: `tests/core/go-extractor.test.ts`
- Modify: `tests/core/scanner.test.ts`

- [x] **Step 1: Write failing extractor tests**

Create `tests/core/go-extractor.test.ts` with cases for package/import edges, interfaces/types, free functions, receiver methods, constructor-style calls, error wrapping, table tests, and subtests.

- [x] **Step 2: Run the failing extractor tests**

Run: `npm test -- tests/core/go-extractor.test.ts`

Expected: FAIL because `src/core/extractors/go.ts` does not exist.

- [x] **Step 3: Write failing scanner/indexer tests**

Update `tests/core/scanner.test.ts` to include `.go` and `_test.go` files and assert language `go` plus test role for `_test.go`.

- [x] **Step 4: Run the failing scanner tests**

Run: `npm test -- tests/core/scanner.test.ts`

Expected: FAIL because `.go` is not scanned and `go` is not a `Language`.

- [x] **Step 5: Implement minimal Go support**

Add `go` to the language union, scan `.go` files, classify `_test.go` as tests, route Go files through `extractGo`, and implement the Go extractor with line-based block parsing matching the existing TypeScript/Rust extractor style.

- [x] **Step 6: Verify green**

Run: `npm test -- tests/core/go-extractor.test.ts tests/core/scanner.test.ts tests/core/indexer.test.ts`

Expected: PASS.

### Task 2: Improve Go Test Linking and Ranking

**Files:**
- Modify: `src/core/related-tests.ts`
- Modify: `src/core/query.ts`
- Modify: `tests/core/related-tests.test.ts`
- Modify: `tests/core/query.test.ts`

- [x] **Step 1: Write failing related-test tests**

Add Go fixtures showing `handler.go` maps to `handler_test.go`, `TestHandler`, table-driven cases, and `t.Run` subtests.

- [x] **Step 2: Run related-test tests**

Run: `npm test -- tests/core/related-tests.test.ts`

Expected: FAIL until Go calls/imports/test symbol names are indexed and scored.

- [x] **Step 3: Implement minimal Go scoring/ranking improvements**

Boost tests when imports mention the package path, test file stem matches source stem, test symbols wrap source names with `Test`, and subtest/table text includes task terms.

- [x] **Step 4: Verify query and related-test tests**

Run: `npm test -- tests/core/related-tests.test.ts tests/core/query.test.ts`

Expected: PASS.

### Task 3: Add Real-World Go Navigation Benchmarks

**Files:**
- Create: `benchmarks/navigation/cobra-cli-command-tracing.json`
- Create: `benchmarks/navigation/viper-config-build-tooling.json`
- Create: `benchmarks/navigation/prometheus-error-flow.json`
- Create: `benchmarks/navigation/kubernetes-interface-implementation.json`
- Create: `benchmarks/navigation/go-ethereum-package-boundary.json`
- Create: `benchmarks/navigation/testify-table-subtest-navigation.json`
- Create: `benchmarks/navigation/go-exact-string-audit.json`
- Modify: `benchmarks/navigation/suite.json`
- Modify: `tests/core/navigation-suite.test.ts`

- [x] **Step 1: Add benchmark manifest coverage test**

Update the navigation-suite test to require Go entries covering bug fixes, interface tracing, source-to-test discovery, table/subtest navigation, CLI tracing, config/build tooling, package/module boundaries, error-flow tracing, and exact-string audits.

- [x] **Step 2: Run the failing manifest test**

Run: `npm test -- tests/core/navigation-suite.test.ts`

Expected: FAIL because Go benchmark entries are missing.

- [x] **Step 3: Add Go navigation fixtures**

Add realistic case JSON files with `agentIndexSteps`, `rgQueries`, and `rgOptimizedPlan` steps. Exact-string audit cases should allow `rg` to be strong; behavior-only cases must avoid leaking exact target symbols and expected file paths.

- [x] **Step 4: Verify manifest and fairness guards**

Run: `npm test -- tests/core/navigation-suite.test.ts tests/core/navigation-eval.test.ts`

Expected: PASS.

### Task 4: Run Regression and Navigation Gates

**Files:**
- Modify: `docs/findings/navigation-eval-results.md`

- [x] **Step 1: Run full unit/build regression**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all pass, including Python and TypeScript/JavaScript extractor/navigation tests.

- [x] **Step 2: Run Go navigation suite when repos are available**

Run:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json --repos --repo-root /Users/juan/Repos --index-root /private/tmp/agent-index-nav-suite-go --runs 3 --artifacts-dir /private/tmp/agent-index-nav-artifacts-go
```

Expected: agent-index completes Go cases with materially lower context usage than broad `rg`; exact-string audit outcomes are documented honestly if `rg` ties or wins.

- [x] **Step 3: Document results**

Update `docs/findings/navigation-eval-results.md` with Go case coverage, completion rates, context usage, `rg` comparison, and remaining risks.
