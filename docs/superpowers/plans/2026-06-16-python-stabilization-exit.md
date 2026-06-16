# Python Stabilization Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Python/mixed-Python support exit bar before starting any TypeScript milestone.

**Architecture:** Keep the benchmark centered on realistic agent navigation tasks and preserve the existing `nav-suite`/`nav-eval` contract. Improve only the Python stabilization surface: benchmark fairness, current outlier handling, docs, and suite gates.

**Tech Stack:** TypeScript, Vitest, SQLite/FTS5, local real-repo benchmark fixtures under `benchmarks/navigation`.

---

### Task 1: Commit Current Verified Benchmark Slice

**Files:**
- Modify: `benchmarks/navigation/unit-node-sdk-payment-list-filters.json`
- Modify: `src/core/file-clusters.ts`
- Modify: `tests/core/file-clusters.test.ts`
- Modify: `docs/findings/navigation-eval-results.md`

- [ ] **Step 1: Verify the current focused tests**

Run:

```bash
npm test -- tests/core/file-clusters.test.ts tests/core/navigation-eval.test.ts tests/core/navigation-suite.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Verify the full current navigation suite**

Run:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json --repos --repo-root /Users/juan/Repos --index-root /private/tmp/agent-index-nav-suite-set-candidates-local-v1 --runs 3 --artifacts-dir /private/tmp/agent-index-nav-artifacts-python-stabilization-current
```

Expected: `agent-index completion rate: 1.00`, `agent-index wins vs optimized rg: 27`.

- [ ] **Step 3: Commit**

Run:

```bash
git add benchmarks/navigation/unit-node-sdk-payment-list-filters.json src/core/file-clusters.ts tests/core/file-clusters.test.ts docs/findings/navigation-eval-results.md docs/superpowers/plans/2026-06-16-python-stabilization-exit.md
git commit --no-gpg-sign -m "Stabilize current navigation benchmark evidence"
```

Expected: a commit containing the current benchmark workflow, planner, docs, and plan changes.

### Task 2: Add Exact-String Audit Benchmark

**Files:**
- Modify: `benchmarks/navigation/pytest-behavior-navigation.json`
- Modify: `tests/core/navigation-eval.test.ts` if a fairness guard is needed
- Modify: `docs/findings/navigation-eval-results.md`

- [ ] **Step 1: Add a pytest exact-string audit case**

Add a case that asks an agent to audit `-k` keyword selection behavior using the public `-k` flag and keyword terms. This case should be fair to `rg`: broad `rg` receives the exact public flag term, optimized `rg` uses a v2 plan, and completion requires multiple relevant source/test files rather than one hidden symbol.

- [ ] **Step 2: Run pytest navigation eval**

Run:

```bash
node dist/cli.js nav-eval benchmarks/navigation/pytest-behavior-navigation.json --target /Users/juan/Repos/pytest --index-path /private/tmp/agent-index-nav-suite-set-candidates-local-v1/pytest.sqlite --mode hybrid --cases
```

Expected: agent-index completion remains `1.00`; `rg` may tie or win on this exact-string case, and that outcome is acceptable if documented honestly.

- [ ] **Step 3: Update docs with the exact-string audit result**

Record whether agent-index wins, ties, or loses that specific case and explain why this strengthens benchmark credibility.

### Task 3: Handle Celery Outlier

**Files:**
- Modify: `benchmarks/navigation/celery-canvas-chain-group.json`
- Modify: `docs/findings/navigation-eval-results.md`

- [ ] **Step 1: Inspect current Celery step output**

Run:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json --repos --repo-root /Users/juan/Repos --index-root /private/tmp/agent-index-nav-suite-set-candidates-local-v1 --repo celery --runs 3 --artifacts-dir /private/tmp/agent-index-nav-artifacts-celery-stabilization
```

Expected: capture current Celery tokens and latency.

- [ ] **Step 2: Try the smallest safe workflow reduction**

If the saved steps show a later command is redundant after completion, reduce the Celery `agentIndexSteps` breadth or remove the redundant command. Preserve required source/test completion for `celery/canvas.py`, `t/integration/test_canvas.py`, `_prepare_chain_from_options`, and `test_chain_inside_group_receives_arguments`.

- [ ] **Step 3: Document if not reduced**

If reducing the workflow loses completion or weakens fairness, keep the existing fixture and document Celery as the remaining Python stabilization outlier.

### Task 4: Final Python Exit Verification

**Files:**
- Modify: `docs/findings/navigation-eval-results.md`

- [ ] **Step 1: Run full test/build gates**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run full navigation suite**

Run:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json --repos --repo-root /Users/juan/Repos --index-root /private/tmp/agent-index-nav-suite-set-candidates-local-v1 --runs 3 --artifacts-dir /private/tmp/agent-index-nav-artifacts-python-stabilization-final
```

Expected: agent-index retains `1.00` completion and materially lower context than broad and optimized `rg`.

- [ ] **Step 3: Commit final stabilization**

Run:

```bash
git add benchmarks/navigation docs/findings/navigation-eval-results.md tests src
git commit --no-gpg-sign -m "Finish Python navigation stabilization exit bar"
```

Expected: a commit with the exact-string audit, Celery outcome, and final documentation.
