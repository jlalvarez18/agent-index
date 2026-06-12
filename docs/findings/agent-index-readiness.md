# Agent Index Readiness Backlog

This backlog tracks whether the prototype is close to real local use, not just whether one benchmark number improved.

Last audit: 2026-06-12

## Current Evidence

- `npm test`: 34 tests passed across 7 files.
- `npm run build`: passes and emits `dist/cli.js`.
- Built CLI help: `node dist/cli.js --help` exits successfully.
- `git diff --check`: passes.
- Hybrid Graphify benchmark: Symbol Hit@1 `1.00`, Symbol Hit@5 `1.00`, File Hit@5 `1.00`, avg `54ms`.
- Hybrid HTTPX benchmark: Symbol Hit@1 `0.77`, Symbol Hit@5 `1.00`, File Hit@5 `1.00`, avg `13ms`.
- Hybrid Click benchmark: Symbol Hit@1 `0.79`, Symbol Hit@5 `1.00`, File Hit@5 `1.00`, avg `18ms`.

## Resolved In Latest Audit

| Area | Issue | Resolution |
| --- | --- | --- |
| CLI/user experience | `--help` printed usage but exited through `commander.helpDisplayed`, making npm report failure. | `runCli` now captures Commander output and treats successful help display as a normal return. |
| Packaging/release hygiene | `package.json` pointed `bin.agent-index` at `dist/cli.js`, but the build emitted `dist/src/cli.js`. | `tsconfig.json` now builds from `src` to `dist`, so the published bin path matches the emitted CLI. |
| Packaging/release hygiene | Build output could retain stale files from the old layout. | `prebuild` runs a dependency-free `clean` script before TypeScript emits artifacts. |
| Documentation/publishing | There was no README entrypoint for local users. | Added `README.md` with install, build, index, query, benchmark, limits, and findings links. |

## Open Backlog

| Priority | Area | Gap | Why It Matters | Suggested Next Move |
| --- | --- | --- | --- | --- |
| High | CLI/user experience | `query` does not expose `--mode`, while `benchmark` does. | Users can benchmark hybrid/fts/symbol but cannot easily inspect the same mode interactively. | Add `--mode <fts|symbol|hybrid>` to `query`, defaulting to current behavior. |
| High | Packaging/release hygiene | Package metadata is thin: no `license`, `repository`, `files`, or explicit `engines`. | A prototype can be local-only, but publishable package shape needs clear metadata and package contents. | Add conservative package metadata and a package-content check such as `npm pack --dry-run`. |
| Medium | CLI/user experience | `index` reports counts but not whether support code was included or skipped. | Users may forget whether `.codeindex` was built source-only, which changes benchmark conclusions. | Include indexing mode in the `index` success line. |
| Medium | Indexing robustness | CLI does not expose `--index-path` even though core indexing supports it. | External or read-only corpora may need indexes outside the target tree. | Add optional `--index-path` to `index`, `query`, and `benchmark` if the core query path supports it cleanly. |
| Medium | Retrieval quality | Exact top-one ordering remains imperfect on HTTPX and Click. | The prototype finds the right file/neighborhood, but a coding agent benefits from the exact method being first. | Design a broader exact-method ordering pass before adding more narrow intent rules. |
| Medium | Benchmark/test coverage | Benchmarks cover three good Python repos, but all golden sets are still small. | Small benchmarks are easy to overfit, even with source audits. | Add one larger framework or application corpus before claiming generality. |
| Low | Documentation/publishing | Publishing outline has enough raw material but is not a polished article. | The process is publishable, but the narrative still needs editing. | Convert the outline into a draft after the package/readme surface stabilizes. |

## Dogfood Readiness Assessment

The prototype is close to local dogfood use for Python repositories. The main remaining readiness gaps are not basic correctness; they are CLI consistency, package metadata, and clearer user-facing affordances.

The current system is strongest when the agent needs a ranked starting point with file, symbol, line range, and nearby context. It is weaker when a dense API has many plausible methods in the same class or module.
