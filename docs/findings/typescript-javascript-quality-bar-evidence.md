# TypeScript/JavaScript Quality Bar Evidence

Date: 2026-06-23

## Scope

This pass updates the TypeScript/JavaScript evidence for the current first-class language quality bar.

Existing real-repo navigation coverage spans:

- `unit-node-sdk`
- `react`
- `next.js`
- `axios`
- `vite`
- `typescript`
- `redux-toolkit`
- `tanstack-query`

The material gap was that none of these fixtures had an `agentToolUse` expectation, and there was no TS/JS live-agent or subagent-style trial note.

## Fixture Update

`benchmarks/navigation/unit-node-sdk-payment-list-filters.json` now includes an `agentToolUse` expectation on the existing bugfix workflow:

- Expected tool behavior: `agent-index-first`
- First useful command budget: command 1
- Completion command budget: command 1
- First useful context budget: 100 tokens
- Completion context budget: 200 tokens

This case is a realistic TypeScript SDK bugfix task. It uses one `source-tests` step to find the payment resource implementation, list parameter type surface, and matching payment tests.

`tests/core/navigation-suite.test.ts` now also asserts that the checked-in TypeScript/JavaScript navigation slice includes at least one `agentToolUse` case.

## Commands And Results

Setup and build:

```bash
npm install
npm run build
```

Result:

- `npm install`: added 102 packages; npm reported 1 low severity vulnerability.
- `npm run build`: passed.

Dogfood index for this repository:

```bash
node dist/cli.js index . --index-path /tmp/agent-index-self-tsjs-evidence.sqlite
```

Result:

- Indexed 172 files, 2,260 symbols, 2,260 chunks, and 15,647 edges.

Focused regression test:

```bash
npm test -- tests/core/navigation-suite.test.ts
```

Result:

- Passed: 11 tests.

Focused Unit Node SDK navigation slice:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-tsjs-indexes \
  --artifacts-dir /tmp/agent-index-tsjs-artifacts \
  --repo unit-node-sdk \
  --reindex \
  --repos
```

Result:

- Cases: 1
- Agent-index completion: 1.00
- Broad `rg` completion: 1.00
- Optimized `rg` completion: 0.00
- Agent tool-use cases: 1
- Agent tool-use satisfied rate: 1.00
- Agent-index context: 70 tokens
- Broad `rg` context: 40,621 tokens
- Optimized `rg` context: 2,173 tokens

Full TypeScript/JavaScript navigation slice:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-tsjs-indexes \
  --artifacts-dir /tmp/agent-index-tsjs-artifacts-all \
  --repo unit-node-sdk \
  --repo react \
  --repo next.js \
  --repo axios \
  --repo vite \
  --repo typescript \
  --repo redux-toolkit \
  --repo tanstack-query \
  --reindex \
  --repos
```

Result:

- Repos: 8
- Cases: 10
- Agent-index completion: 1.00
- Broad `rg` completion: 0.90
- Optimized `rg` completion: 0.50
- Agent tool-use cases: 1
- Agent tool-use satisfied rate: 1.00
- Agent-index average context: 211 tokens
- Broad `rg` average context: 711,609 tokens
- Optimized `rg` average context: 1,690 tokens
- Agent-index wins vs broad `rg`: 10/10
- Agent-index wins vs optimized `rg`: 10/10

## Agent Tool-Use Detail

For `unit-node-sdk-payment-list-array-filters`, the authored agent-index workflow ran:

```text
agent-index source-tests payment list array filters status type direction query params --test-fanout-limit 2
```

It completed in one command and 70 context tokens, finding:

- `resources/payments.ts`
- `tests/payments.spec.ts`
- `PaymentListParams`
- `Payments.list`

The `agentToolUse` expectation passed with first useful result and task completion both on command 1.

## Live Subagent-Style Trial

A worker subagent ran an isolated JavaScript bugfix trial under `/tmp/agent-index-tsjs-live-trial`.

Task:

- Fix array-valued payment filters so `status` and `type` serialize as repeated query parameters instead of comma-joined values.

Setup:

- Fixture index: `/tmp/agent-index-tsjs-live-trial/index.sqlite`
- Verification command: `npm test` in `/tmp/agent-index-tsjs-live-trial`
- Initial failure: array filters serialized as `pending%2Ccompleted` instead of repeated `filter[status]` parameters.

Observed agent behavior:

- First navigation tool: agent-index.
- First navigation command:

```bash
node /Users/juan/.codex/worktrees/847b/agent-index/dist/cli.js query \
  --target /tmp/agent-index-tsjs-live-trial \
  --index /tmp/agent-index-tsjs-live-trial/index.sqlite \
  --mode hybrid \
  --term payment \
  --term filter \
  --term serialize \
  --term status \
  --term type \
  --role source
```

- First useful hit: `serializePaymentFilters` in `/tmp/agent-index-tsjs-live-trial/src/paymentFilters.js`.
- Files inspected: `/tmp/agent-index-tsjs-live-trial/src/paymentFilters.js`, `/tmp/agent-index-tsjs-live-trial/tests/paymentFilters.test.js`, `/tmp/agent-index-tsjs-live-trial/package.json`.
- Files edited: `/tmp/agent-index-tsjs-live-trial/src/paymentFilters.js`.
- Broad `rg` fallback: none.
- Outcome: changed array handling from comma-joined `params.set(...)` to repeated `params.append(...)`.

Independent verification after the subagent completed:

```bash
npm test
```

Result:

- Passed in `/tmp/agent-index-tsjs-live-trial`.

This is a small fixture rather than a mature production repository. Its value is narrower than the real-repo navigation suite, but it directly checks whether an agent with agent-index available chooses it before broad search and can complete a TS/JS bugfix loop.

## Where `rg` Was Still Needed

During this update, `rg` was used for exact repository discovery before dependencies and `dist/cli.js` were present in the worktree. After `npm install` and `npm run build`, the repository was indexed with agent-index and subsequent codebase navigation used agent-index queries plus targeted file reads.

The live subagent-style TS/JS bugfix trial did not need broad `rg`; agent-index found the serializer directly.

## Remaining Gaps

Only one checked-in TS/JS case currently has an `agentToolUse` expectation. The broader TS/JS fixture set still provides real-repo navigation coverage across eight repositories, but future hardening could add `agentToolUse` to another source/test bugfix case such as `redux-toolkit-create-slice-selector-bugfix` or `tanstack-query-infinite-query-feature-tracing`.
