# Rust Benchmark Results

## 2026-06-17 First-Class Rust Support Preparation

Rust support was upgraded from minimal mixed-repo extraction toward first-class navigation coverage.

Implemented coverage:

- Rust scanner role detection for `tests/`, `src/tests.rs`, `*_test.rs`, `*_tests.rs`, `examples/`, and `benches/`.
- Rust extractor coverage for logical module paths, `mod` declarations, structs, enums, traits, unions, type aliases, macros, impl methods, trait impls, `use` imports, call-name edges, inline module tests, and conformance edges.
- Cargo ownership symbols from `Cargo.toml`: package, dependency, dev/build dependency, feature, bin, test, bench, and example targets.
- Source-to-test navigation variants for Rust source modules such as `src/runtime/mod.rs` matching integration-test imports like `crate_name::runtime::Runtime`.
- Navigation fixtures registered in `benchmarks/navigation/suite.json`:
  - `tokio-rust`: `tokio-runtime-builder-rust.json`
  - `serde-rust`: `serde-serializer-trait-rust.json`
  - `ripgrep-rust`: `ripgrep-searcher-rust.json`

Focused verification:

```bash
npm test -- tests/core/rust-extractor.test.ts tests/core/toml-extractor.test.ts tests/core/indexer.test.ts tests/core/query.test.ts tests/core/related-tests.test.ts tests/core/scanner.test.ts -t "extracts modules|extracts structs|Cargo|indexes Rust|links Rust|structured hybrid queries prefer Rust|can find Rust core|classifies file roles"
```

Result:

- 6 test files passed.
- 9 Rust/Cargo-focused tests passed.

Full verification:

```bash
npm test
npm run build
```

Result:

- `npm test`: 26 test files passed, 399 tests passed.
- `npm run build`: TypeScript build completed successfully.

Benchmark command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-rust-indexes \
  --artifacts-dir /tmp/agent-index-rust-artifacts \
  --repo tokio-rust \
  --repo serde-rust \
  --repo ripgrep-rust \
  --reindex \
  --repos
```

Benchmark results:

| Suite entry | Files | Symbols | agent-index completion | broad rg completion | optimized rg completion | agent tokens | broad rg tokens | optimized rg tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `tokio-rust` | 803 | 11,104 | 1.00 | 0.00 | 0.00 | 345 | 115,107 | 2,425 |
| `serde-rust` | 215 | 3,470 | 1.00 | 0.00 | 0.00 | 275 | 167,444 | 723 |
| `ripgrep-rust` | 114 | 3,552 | 1.00 | 0.00 | 0.00 | 340 | 26,161 | 510 |

Aggregate result:

- agent-index completion: 1.00
- broad `rg` completion: 0.00
- optimized `rg` completion: 0.00
- agent-index average context: 320 tokens
- broad `rg` average context: 102,904 tokens
- optimized `rg` average context: 1,219 tokens
- wins: agent-index 3, broad `rg` 0, optimized `rg` 0

Benchmark corrections made for current upstream layouts:

- Serde serializer traits now live under `serde_core/src/ser/mod.rs`.
- ripgrep searcher orchestration now lives under `crates/searcher/src/searcher/mod.rs`.

## 2026-06-24 Tool-Use Evidence Update

The Rust track now includes an authored bugfix/source-to-test workflow with an explicit `agentToolUse` expectation. The Tokio runtime-builder case was changed from maintenance navigation to a bugfix-style task:

> Bugfix: preserve explicit blocking-pool limits while reviewing Tokio multi-thread worker scheduler options. Use code navigation before editing.

Why Tokio was the right candidate:

- The task has a realistic edit surface in `tokio/src/runtime/builder.rs`.
- It requires both implementation symbols and regression/panic-test context.
- The `source-tests` workflow can complete the task in one agent-index command without being handed exact files by the fixture.

Authored expectation:

```json
"agentToolUse": {
  "expected": "agent-index-first",
  "maxFirstUsefulCommand": 1,
  "maxCompletionCommand": 1,
  "maxFirstUsefulContextTokens": 500,
  "maxCompletionContextTokens": 500
}
```

Focused Tokio validation:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-rust-indexes-tooluse \
  --artifacts-dir /tmp/agent-index-rust-artifacts-tooluse \
  --repo tokio-rust \
  --reindex \
  --repos
```

Result:

- indexed 814 files, 11,115 symbols
- agent-index completion: 1.00
- broad `rg` completion: 0.00
- optimized `rg` completion: 0.00
- agent-index tool-use satisfied rate: 1.00
- first useful command: 1
- completion command: 1
- completion context: 157 tokens
- required files found: `tokio/src/runtime/builder.rs`, `tokio/tests/rt_threaded.rs`, `tokio/tests/rt_panic.rs`
- required symbols found: `runtime.builder.Builder.max_blocking_threads`, `tokio.tests.rt_threaded.max_blocking_threads`

Updated Rust slice:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-rust-indexes \
  --artifacts-dir /tmp/agent-index-rust-artifacts \
  --repo tokio-rust \
  --repo serde-rust \
  --repo ripgrep-rust \
  --reindex \
  --repos
```

| Suite entry | Files | Symbols | agent-index completion | broad rg completion | optimized rg completion | agent tokens | broad rg tokens | optimized rg tokens | agentToolUse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `tokio-rust` | 814 | 11,115 | 1.00 | 0.00 | 0.00 | 157 | 154,435 | 1,809 | 1.00 |
| `serde-rust` | 217 | 3,472 | 1.00 | 0.00 | 0.00 | 275 | 167,444 | 723 | n/a |
| `ripgrep-rust` | 120 | 3,560 | 1.00 | 0.00 | 0.00 | 339 | 26,161 | 510 | n/a |

Aggregate result:

- agent-index completion: 1.00
- broad `rg` completion: 0.00
- optimized `rg` completion: 0.00
- agent-index tool-use cases: 1
- agent-index tool-use satisfied rate: 1.00
- agent-index average context: 257 tokens
- broad `rg` average context: 116,013 tokens
- optimized `rg` average context: 1,014 tokens
- wins: agent-index 3, broad `rg` 0, optimized `rg` 0

### Live Subagent Trial

A fresh subagent ran this prompt against `/Users/juan/Repos/tokio` without a prewritten query plan:

> Bugfix investigation: Tokio runtime Builder configuration should preserve explicit blocking-pool settings while reviewing worker-thread scheduler options. Find the implementation file/symbols and the most relevant tests you would inspect before editing. agent-index is available if you choose to use it; rg and normal file reads are also available. Start from the bugfix prompt, not from a prewritten query plan.

Observed behavior:

- First command overall: `pwd`, to confirm the worktree.
- First target-navigation command: `node /Users/juan/Repos/agent-index/dist/cli.js index /Users/juan/Repos/tokio --index-path /tmp/tokio-agent-index.sqlite`.
- The agent chose agent-index before broad `rg`.
- First useful hit: `tokio/src/runtime/builder.rs`, symbol `Builder::max_blocking_threads`.
- Most relevant implementation symbol: `Builder::build_threaded_runtime`, which creates the blocking pool with `self.max_blocking_threads + worker_threads`; current-thread construction uses `self.max_blocking_threads` directly.
- Files inspected: `tokio/src/runtime/builder.rs`, `tokio/src/runtime/blocking/mod.rs`, `tokio/src/runtime/blocking/pool.rs`, `tokio/tests/rt_threaded.rs`, `tokio/tests/rt_panic.rs`, `tokio/src/runtime/tests/loom_blocking.rs`, `tokio/tests/rt_unstable_metrics.rs`, and `tokio/src/runtime/metrics/runtime.rs`.
- Targeted `rg` fallback happened after agent-index to enumerate exact `max_blocking_threads`, `worker_threads`, `thread_cap`, `spawn_blocking`, and `block_in_place` occurrences.
- One CLI-shape correction was needed: `related-tests --format compact` is invalid; the agent reran with `--format text`.

Tests the subagent would run before editing:

```bash
cargo test -p tokio --test rt_threaded max_blocking_threads --features full
cargo test -p tokio --test rt_panic builder_max_blocking_threads_panic_caller --features full
RUSTFLAGS="--cfg tokio_unstable" cargo test -p tokio --test rt_unstable_metrics --features full num_blocking_threads blocking_queue_depth
```

Outcome:

- Implementation location found with high confidence.
- Existing tests cover setters, panics, blocking behavior, and metrics.
- The trial did not find a direct regression test proving `new_multi_thread().worker_threads(2).max_blocking_threads(1)` preserves the explicit blocking-thread cap independently of scheduler worker count; that is the likely test gap for a real edit.
