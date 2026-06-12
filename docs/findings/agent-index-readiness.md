# Agent Index Readiness Backlog

This backlog tracks whether the prototype is close to real local use, not just whether one benchmark number improved.

Last audit: 2026-06-12

## Current Evidence

- `npm test`: 43 tests passed across 7 files.
- `npm run build`: passes and emits `dist/cli.js`.
- Built CLI help: `node dist/cli.js --help` exits successfully.
- `git diff --check`: passes.
- `npm pack --dry-run`: passes and includes README, benchmark JSON, docs, built `dist` files, and package metadata.
- Hybrid Graphify benchmark: Symbol Hit@1 `1.00`, Symbol Hit@5 `1.00`, File Hit@5 `1.00`, avg `55ms`.
- Hybrid HTTPX benchmark: Symbol Hit@1 `1.00`, Symbol Hit@5 `1.00`, File Hit@5 `1.00`, avg `14ms`.
- Hybrid Click benchmark: Symbol Hit@1 `1.00`, Symbol Hit@5 `1.00`, File Hit@5 `1.00`, avg `20ms`.

## Resolved In Latest Audit

| Area | Issue | Resolution |
| --- | --- | --- |
| CLI/user experience | `--help` printed usage but exited through `commander.helpDisplayed`, making npm report failure. | `runCli` now captures Commander output and treats successful help display as a normal return. |
| Packaging/release hygiene | `package.json` pointed `bin.agent-index` at `dist/cli.js`, but the build emitted `dist/src/cli.js`. | `tsconfig.json` now builds from `src` to `dist`, so the published bin path matches the emitted CLI. |
| Packaging/release hygiene | Build output could retain stale files from the old layout. | `prebuild` runs a dependency-free `clean` script before TypeScript emits artifacts. |
| Documentation/publishing | There was no README entrypoint for local users. | Added `README.md` with install, build, index, query, benchmark, limits, and findings links. |
| CLI/user experience | `query` did not expose `--mode`, while `benchmark` did. | `query` now accepts `--mode <fts\|symbol\|hybrid>` and passes it to the core query API. |
| Packaging/release hygiene | Package contents and runtime metadata were implicit. | Added `files`, `engines.node`, and conservative `UNLICENSED` metadata; verified package contents with `npm pack --dry-run`. The package includes docs so README links resolve. |
| CLI/user experience | `index` reported counts but not whether support code was included or skipped. | The success line now includes `(mode: source-only)` or `(mode: all-files)`. |
| Indexing robustness | CLI did not expose `--index-path` even though core APIs supported it. | `index`, `query`, and `benchmark` now accept `--index-path <path>`. |
| Retrieval quality | Hybrid ranking still let broad modules or generic methods outrank concrete code objects in dense APIs. | Added a module-context penalty, method owner/source signal, dunder-method lexical exclusion, and method-specific lexical gating. HTTPX Hit@1 moved `0.77 -> 0.85`; Click Hit@1 moved `0.79 -> 0.86`; Hit@5 stayed `1.00`. |
| Retrieval quality | Remaining misses shared coding-query phrasing patterns: decorator targets, multi-token symbols, and configuration representation classes. | Added guarded signals for those patterns. The current Graphify, HTTPX, and Click hybrid benchmarks are now saturated at Symbol Hit@1/Hit@5 `1.00/1.00`. |

## Open Backlog

| Priority | Area | Gap | Why It Matters | Suggested Next Move |
| --- | --- | --- | --- | --- |
| High | Packaging/release hygiene | Public `license` and `repository` metadata still need owner decisions. | `UNLICENSED` is honest for local dogfood, but public publishing should not guess legal terms or remote URLs. | Choose a license and add repository metadata once the project has an intended public home. |
| Medium | Benchmark/test coverage | Benchmarks cover three good Python repos, but all golden sets are still small. | Small benchmarks are easy to overfit, even with source audits. | Add one larger framework or application corpus before claiming generality. |
| Low | Documentation/publishing | Publishing outline has enough raw material but is not a polished article. | The process is publishable, but the narrative still needs editing. | Convert the outline into a draft after the package/readme surface stabilizes. |

## Dogfood Readiness Assessment

The prototype is close to local dogfood use for Python repositories. The main remaining readiness gaps are not basic correctness; they are public-publishing decisions and broader validation beyond the now-saturated small benchmarks.

The current system is strongest when the agent needs a ranked starting point with file, symbol, line range, and nearby context. Dense APIs with many plausible nearby methods remain the area to keep testing on larger benchmarks.
