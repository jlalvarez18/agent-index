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
