# Hard Ranking Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve agent-index ranking on hard navigation tasks where user-facing behavior terms do not exactly match implementation symbols.

**Architecture:** Add a narrowly-scoped file-cluster ranking signal that rewards implementation files whose path names the domain while matched symbols/chunks name the behavior. Use tests and real navigation cases to keep this from becoming a broad one-off boost.

**Tech Stack:** TypeScript, Node.js, SQLite/FTS5, Vitest, existing navigation-suite benchmark runner.

---

### Task 1: Pin The Ranking Failure

**Files:**
- Modify: `tests/core/file-clusters.test.ts`

- [ ] **Step 1: Add a failing file-cluster test**

Add a Vitest case that creates these files:

```text
pkg/core/serializers/type_serializers/function.rs
pkg/core/serializers/computed_fields.rs
pkg/main.py
```

The query should be:

```ts
{
  terms: ["serializer", "computed", "fields", "exclude"],
  symbolKinds: ["method", "function"],
  roles: ["source"]
}
```

Expected first cluster:

```ts
expect(result.clusters[0]).toMatchObject({
  file: "pkg/core/serializers/computed_fields.rs"
});
expect(result.clusters[0].why).toContain("implementation path coverage match");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/core/file-clusters.test.ts -t "boosts implementation paths"
```

Expected: FAIL because `function.rs` or `main.py` ranks above `computed_fields.rs`.

### Task 2: Implement Path-Coverage Ranking

**Files:**
- Modify: `src/core/file-clusters.ts`

- [ ] **Step 1: Add path token helpers**

Add helpers near `fileNameTermBoost`:

```ts
function implementationPathCoverageBoost(cluster: MutableCluster, queryTerms: string[]): number {
  if (cluster.role !== "source" || queryTerms.length < 3) {
    return 0;
  }

  const pathTokens = normalize(cluster.file).split(/\s+/u).filter((token) => token.length >= 3);
  const basenameTokens = normalize(path.posix.basename(cluster.file).replace(/\.[^.]+$/u, ""))
    .split(/\s+/u)
    .filter((token) => token.length >= 3);
  const matchedPathTerms = queryTerms.filter((term) => pathTokens.some((pathToken) => clusterTokenMatches(pathToken, term)));
  const matchedBasenameTerms = queryTerms.filter((term) => basenameTokens.some((pathToken) => clusterTokenMatches(pathToken, term)));
  const behaviorTerms = queryTerms.filter((term) =>
    cluster.symbols.some((symbol) => clusterTokenMatches(normalize(symbol.name), term)) ||
    clusterTokenMatches(normalize(cluster.evidence ?? ""), term)
  );

  if (matchedPathTerms.length < 3 || matchedBasenameTerms.length < 2 || behaviorTerms.length === 0) {
    return 0;
  }

  return Math.min(42 + matchedBasenameTerms.length * 8 + behaviorTerms.length * 6, 72);
}

function clusterTokenMatches(text: string, term: string): boolean {
  return text.split(/\s+/u).some((token) => token === term || token.includes(term) || term.includes(token) || stemToken(token) === stemToken(term));
}
```

- [ ] **Step 2: Wire the boost into cluster scoring**

In `clusterRows`, compute the boost beside `fileNameBoost`, add reason `"implementation path coverage match"`, and include it in the final score sum.

- [ ] **Step 3: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/core/file-clusters.test.ts -t "boosts implementation paths"
npm test -- tests/core/file-clusters.test.ts
```

Expected: PASS.

### Task 3: Add Hard Real-World Benchmark Cases

**Files:**
- Modify: `benchmarks/navigation/pydantic-computed-fields.json`
- Modify: `benchmarks/navigation/react-use-sync-external-store.json`
- Modify: `benchmarks/navigation/nextjs-router-component-navigation.json`

- [ ] **Step 1: Add a bugfix hard-ranking case**

Add a Pydantic behavior-only bugfix case for excluding computed fields during serialization. The agent step should use `file-clusters` with terms `["serializer", "computed", "fields", "exclude"]`, no exact Rust type or method name, and expected required symbol `ComputedFields.serialize`.

- [ ] **Step 2: Add a source-to-test navigation hard case**

Add a React source-to-test case for the shim behavior where terms emphasize user-facing `subscribe`, `snapshot`, `hydration`, and `fallback` wording while expected files remain the shim client and shared test file.

- [ ] **Step 3: Add a code-explanation hard case**

Add a Next.js App Router explanation case where the task asks how component-facing redirect APIs create navigation errors without forcing exact internal helper names in the first step.

- [ ] **Step 4: Validate benchmark fairness**

Run:

```bash
npm test -- tests/core/navigation-eval.test.ts
```

Expected: PASS without behavior-only leakage errors.

### Task 4: Capture Metrics And Findings

**Files:**
- Create: `docs/findings/hard-ranking-improvements.md`

- [ ] **Step 1: Build the CLI**

Run:

```bash
npm run build
```

- [ ] **Step 2: Run focused after benchmarks**

Run:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-hard-after-indexes \
  --artifacts-dir /tmp/agent-index-hard-after \
  --reindex \
  --repo pydantic \
  --repo react \
  --repo next.js \
  --repo redux-toolkit \
  --repo tanstack-query \
  --repo axios \
  --repo pytest \
  --json
```

- [ ] **Step 3: Run verification**

Run:

```bash
npm test
npm run build
```

- [ ] **Step 4: Document concrete before/after numbers**

Record pass/completion rates, first useful command, context tokens, total context tokens, latency, command count, files read/opened, and wins/losses/ties versus broad and optimized rg. State whether gains are measurable, task-specific, neutral, or a regression.
