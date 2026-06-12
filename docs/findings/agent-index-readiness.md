# Agent Index Readiness Backlog

This backlog tracks whether the prototype is close to real local use, not just whether one benchmark number improved.

Last audit: 2026-06-12

## Current Evidence

- `npm test`: 34 tests passed across 7 files.
- `npm run build`: passes and emits `dist/cli.js`.
- Built CLI help: `node dist/cli.js --help` exits successfully.
- `git diff --check`: passes.
- `npm pack --dry-run`: passes and includes README, benchmark JSON, built `dist` files, and package metadata.
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
| CLI/user experience | `query` did not expose `--mode`, while `benchmark` did. | `query` now accepts `--mode <fts\|symbol\|hybrid>` and passes it to the core query API. |
| Packaging/release hygiene | Package contents and runtime metadata were implicit. | Added `files`, `engines.node`, and conservative `UNLICENSED` metadata; verified package contents with `npm pack --dry-run`. |

## Open Backlog

| Priority | Area | Gap | Why It Matters | Suggested Next Move |
| --- | --- | --- | --- | --- |
| High | Packaging/release hygiene | Public `license` and `repository` metadata still need owner decisions. | `UNLICENSED` is honest for local dogfood, but public publishing should not guess legal terms or remote URLs. | Choose a license and add repository metadata once the project has an intended public home. |
| Medium | CLI/user experience | `index` reports counts but not whether support code was included or skipped. | Users may forget whether `.codeindex` was built source-only, which changes benchmark conclusions. | Include indexing mode in the `index` success line. |
| Medium | Indexing robustness | CLI does not expose `--index-path` even though core indexing supports it. | External or read-only corpora may need indexes outside the target tree. | Add optional `--index-path` to `index`, `query`, and `benchmark` if the core query path supports it cleanly. |
| Medium | Retrieval quality | Exact top-one ordering remains imperfect on HTTPX and Click. | The prototype finds the right file/neighborhood, but a coding agent benefits from the exact method being first. | Design a broader exact-method ordering pass before adding more narrow intent rules. |
| Medium | Benchmark/test coverage | Benchmarks cover three good Python repos, but all golden sets are still small. | Small benchmarks are easy to overfit, even with source audits. | Add one larger framework or application corpus before claiming generality. |
| Low | Documentation/publishing | Publishing outline has enough raw material but is not a polished article. | The process is publishable, but the narrative still needs editing. | Convert the outline into a draft after the package/readme surface stabilizes. |

## Dogfood Readiness Assessment

The prototype is close to local dogfood use for Python repositories. The main remaining readiness gaps are not basic correctness; they are public-publishing decisions, clearer index reporting, and broader validation.

The current system is strongest when the agent needs a ranked starting point with file, symbol, line range, and nearby context. It is weaker when a dense API has many plausible methods in the same class or module.
