# Agent Eval Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small comparison harness that scores `agent-index` ranked retrieval beside Graphify-style context-query output on the same benchmark JSON and target corpus.

**Architecture:** Add a focused `src/core/agent-eval.ts` module that reuses `runBenchmark()` for `agent-index` and scores Graphify query text from a JSON file supplied by the caller. The CLI gets a thin `agent-eval` command that prints a side-by-side report and optional JSON. Graphify execution itself stays outside the core so this package does not depend on Python, uv, or Graphify internals.

**Tech Stack:** TypeScript, Node.js, Commander, Vitest, existing benchmark JSON schema.

---

## File Structure

- Create `src/core/agent-eval.ts`: load benchmark questions, run `agent-index`, score Graphify text outputs by expected file/symbol mentions, compute side-by-side summary.
- Modify `src/core/schema.ts`: add comparison result types.
- Modify `src/cli.ts`: add `agent-eval <benchmark-json>` command with `--target`, `--index-path`, `--mode`, `--graphify-results`, `--json`, and `--misses`.
- Test `tests/core/agent-eval.test.ts`: core scoring for Graphify mention rates and winner labels.
- Modify `tests/core/cli.test.ts`: CLI smoke coverage for text and JSON comparison output.
- Modify `docs/findings/graphify-benchmark-results.md` or `docs/findings/agent-index-process.md`: document how the harness should be used.

## Task 1: Core Comparison Types

**Files:**
- Modify: `src/core/schema.ts`
- Test: `tests/core/agent-eval.test.ts`

- [ ] **Step 1: Write the failing type-oriented test**

Create `tests/core/agent-eval.test.ts` with a fixture that imports `scoreGraphifyMentions` from `src/core/agent-eval.ts` and expects symbol/file mention scoring.

```ts
import { describe, expect, test } from "vitest";
import { scoreGraphifyMentions } from "../../src/core/agent-eval.js";

describe("agent eval Graphify mention scoring", () => {
  test("scores expected file and symbol mentions in Graphify query text", () => {
    const result = scoreGraphifyMentions(
      {
        id: "semantic-cache",
        question: "where is semantic cache handled?",
        expected: {
          files: ["pkg/cache.py"],
          symbols: ["load_value"]
        }
      },
      "NODE load_value() [src=pkg/cache.py loc=L1]"
    );

    expect(result).toMatchObject({
      id: "semantic-cache",
      symbolMention: true,
      fileMention: true
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/agent-eval.test.ts`

Expected: FAIL because `src/core/agent-eval.ts` does not exist.

- [ ] **Step 3: Add schema types and minimal scoring implementation**

Add types to `src/core/schema.ts`:

```ts
export interface GraphifyQueryTextResult {
  id: string;
  text: string;
}

export interface GraphifyMentionCaseResult {
  id: string;
  question: string;
  expectedSymbols: string[];
  expectedFiles: string[];
  symbolMention: boolean;
  fileMention: boolean;
}

export interface AgentEvalCaseResult {
  id: string;
  question: string;
  agentIndexSymbolRank: number | null;
  agentIndexFileRank: number | null;
  graphifySymbolMention: boolean | null;
  graphifyFileMention: boolean | null;
  winner: "agent-index" | "graphify" | "tie" | "inconclusive";
}

export interface AgentEvalResult {
  questions: number;
  mode: QueryMode;
  agentIndex: BenchmarkResult;
  graphify?: {
    symbolMentionRate: number;
    fileMentionRate: number;
    cases: GraphifyMentionCaseResult[];
  };
  cases: AgentEvalCaseResult[];
}
```

Create `src/core/agent-eval.ts`:

```ts
import type { BenchmarkQuestion, GraphifyMentionCaseResult } from "./schema.js";

export function scoreGraphifyMentions(
  question: BenchmarkQuestion,
  text: string | undefined
): GraphifyMentionCaseResult {
  const normalized = (text ?? "").toLowerCase();
  return {
    id: question.id,
    question: question.question,
    expectedSymbols: question.expected.symbols,
    expectedFiles: question.expected.files,
    symbolMention: question.expected.symbols.some((symbol) => mentionsSymbol(normalized, symbol)),
    fileMention: question.expected.files.some((file) => normalized.includes(file.toLowerCase()))
  };
}

function mentionsSymbol(text: string, symbol: string): boolean {
  const normalized = symbol.toLowerCase();
  return text.includes(normalized) || text.includes(`${normalized}()`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/agent-eval.test.ts`

Expected: PASS.

## Task 2: Agent Eval Runner

**Files:**
- Modify: `src/core/agent-eval.ts`
- Test: `tests/core/agent-eval.test.ts`

- [ ] **Step 1: Add failing test for side-by-side evaluation**

Extend `tests/core/agent-eval.test.ts` with a fixture project, an index build, a benchmark file, and Graphify text results.

```ts
test("runs agent-index benchmark and compares Graphify mention results", async () => {
  const { root, benchmarkPath, graphifyResultsPath } = await fixtureProject();

  const result = await runAgentEval(benchmarkPath, {
    target: root,
    graphifyResultsPath
  });

  expect(result.questions).toBe(2);
  expect(result.agentIndex.symbolHitAt1).toBe(0.5);
  expect(result.graphify?.symbolMentionRate).toBe(0.5);
  expect(result.graphify?.fileMentionRate).toBe(1);
  expect(result.cases[0]).toMatchObject({
    id: "semantic-cache",
    agentIndexSymbolRank: 1,
    graphifySymbolMention: true,
    winner: "tie"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/agent-eval.test.ts`

Expected: FAIL because `runAgentEval()` is not implemented.

- [ ] **Step 3: Implement runner**

In `src/core/agent-eval.ts`, load the benchmark JSON, call `runBenchmark()`, optionally load Graphify result text JSON, score mention rates, and choose a conservative winner:

- `tie` when both tools find the expected symbol.
- `agent-index` when `agent-index` has symbol Hit@1 and Graphify does not mention an expected symbol.
- `graphify` when `agent-index` misses symbol top five and Graphify mentions an expected symbol.
- `inconclusive` otherwise.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/agent-eval.test.ts`

Expected: PASS.

## Task 3: CLI Command

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/core/cli.test.ts`

- [ ] **Step 1: Add failing CLI smoke test**

Add a test that calls:

```ts
await runCli([
  "agent-eval",
  benchmarkPath,
  "--target",
  root,
  "--graphify-results",
  graphifyResultsPath
], { write: (line) => output.push(line) });
```

Expected text includes:

```text
Mode: symbol
Questions: 2
agent-index Symbol Hit@1: 0.50
Graphify symbol mention rate: 0.50
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/cli.test.ts`

Expected: FAIL because `agent-eval` is not a command.

- [ ] **Step 3: Add CLI command and formatter**

Import `runAgentEval`, add `agent-eval` command, and implement `formatAgentEval(result, includeMisses)` in `src/cli.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/cli.test.ts`

Expected: PASS.

## Task 4: Documentation And Verification

**Files:**
- Modify: `docs/findings/graphify-benchmark-results.md`
- Modify: `docs/findings/agent-index-process.md`

- [ ] **Step 1: Document Graphify results JSON format**

Add an example:

```json
[
  {
    "id": "semantic-cache",
    "text": "NODE load_value() [src=pkg/cache.py loc=L1]"
  }
]
```

- [ ] **Step 2: Document comparison command**

Add:

```bash
npm run agent-index -- agent-eval ./benchmarks/graphify-python.json \
  --target /tmp/graphify-source-only-2 \
  --index-path /tmp/agent-index-graphify-source-only.sqlite \
  --mode hybrid \
  --graphify-results /tmp/graphify-query-results.json
```

- [ ] **Step 3: Run focused tests**

Run: `npx vitest run tests/core/agent-eval.test.ts tests/core/cli.test.ts`

Expected: PASS.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all commands pass.

## Self-Review

- Spec coverage: The plan covers side-by-side comparison, Graphify mention scoring, CLI output, JSON output, and docs.
- Placeholder scan: No `TBD` or deferred implementation language remains.
- Type consistency: `graphifyResultsPath`, `GraphifyQueryTextResult`, and `AgentEvalResult` names are consistent across tasks.
