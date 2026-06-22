# Autonomous Run Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file-based telemetry provenance to autonomous benchmark review artifacts so summaries separate measured values from estimates.

**Architecture:** Keep existing top-level review metrics as backwards-compatible legacy fields. Add `telemetry` with metadata, artifact paths, timestamps, metric provenance, setup metrics, and test command observations; summary aggregation derives confidence buckets from telemetry when present and treats legacy-only numeric fields as estimated.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest, Commander CLI.

---

### Task 1: Telemetry Validation And Summary Tests

**Files:**
- Modify: `tests/core/autonomous-comparison.test.ts`

- [ ] **Step 1: Write failing validation tests**

Add tests that construct a review with `telemetry.schemaVersion = 1`, measured `wallTimeSeconds`, estimated token metrics with `method`, generated artifact paths, timestamps, index setup values, and test command results. Assert `loadAutonomousReviews()` accepts it. Add a second test with invalid telemetry source/missing estimate method and assert validation rejects it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: FAIL because `telemetry` is not part of the schema yet.

- [ ] **Step 3: Write failing summary tests**

Add a summary test with one measured telemetry review and one legacy-only review. Assert measured and estimated metric confidence counts are separated, and measured median fields use only measured telemetry values.

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: FAIL because `summarizeAutonomousReviews()` does not emit confidence or separated medians yet.

### Task 2: Telemetry Schema And Core Implementation

**Files:**
- Modify: `src/core/schema.ts`
- Modify: `src/core/autonomous-comparison.ts`

- [ ] **Step 1: Add TypeScript interfaces**

Add `AutonomousTelemetry`, `AutonomousTelemetryMetric`, `AutonomousTelemetryMetricSource`, timestamp/artifact/setup/test-command interfaces, and summary metric confidence interfaces.

- [ ] **Step 2: Implement validation**

Validate `telemetry.schemaVersion`, metadata, artifacts, ISO-ish timestamp strings, metric source values, numeric metric values, required estimate methods for estimated metrics, setup metrics, and test command outcomes.

- [ ] **Step 3: Capture automatic prepare/load telemetry**

Have `prepareAutonomousRunPacket()` include metadata, generated artifact paths, and prepare/template timestamps in the review template. Have `loadAutonomousReviews()` annotate loaded review objects with review path, file modified time, and validation timestamps.

- [ ] **Step 4: Implement confidence aggregation**

Keep existing median fields unchanged. Add summary confidence counts and measured/estimated median groups for the main autonomous-run metrics.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/core/autonomous-comparison.test.ts`

Expected: PASS.

### Task 3: CLI Output And Docs

**Files:**
- Modify: `tests/core/cli.test.ts`
- Modify: `src/cli.ts`
- Modify: `docs/autonomous-comparison.md`

- [ ] **Step 1: Add failing CLI test**

Extend autonomous summary CLI coverage to include telemetry confidence text such as `measured=... estimated=... missing=...`.

- [ ] **Step 2: Run CLI test to verify it fails**

Run: `npx vitest run tests/core/cli.test.ts -t autonomous-summary`

Expected: FAIL until formatter includes telemetry confidence.

- [ ] **Step 3: Update formatter**

Print concise confidence summaries per condition while preserving existing summary columns.

- [ ] **Step 4: Update docs**

Document the telemetry protocol, measured-vs-estimated semantics, legacy compatibility, and review-template behavior.

- [ ] **Step 5: Verify all criteria**

Run: `npm test` and `npm run build`.

Expected: both PASS.
