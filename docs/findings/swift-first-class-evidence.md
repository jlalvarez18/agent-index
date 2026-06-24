# Swift First-Class Evidence

Date: 2026-06-24

## Scope

Swift already has broad real-repository navigation fixtures registered in
`benchmarks/navigation/suite.json`:

- `swift-argument-parser`
- `swift-collections`
- `swift-nio`
- `swift-composable-architecture`
- `alamofire`
- `swift-package-manager`
- `swift`

The fixture set covers config/build navigation, source-to-test discovery,
component navigation, maintenance/module-boundary navigation, bugfix flow, and
an exact-string audit. This update adds the missing first-class evidence for an
authored agent-index tool-use expectation and a live-agent Swift coding trial.

## Authored Agent Tool-Use Expectation

`benchmarks/navigation/alamofire-bugfix-result-error-flow.json` now includes an
`agentToolUse` expectation:

- Expected use: `agent-index-first`
- First useful command budget: command 1
- Completion command budget: command 2
- Completion context budget: 500 tokens

This is attached to the realistic Alamofire bugfix task:

> Find Alamofire request serialization and validation paths for a bug where
> AFError should preserve the underlying Result failure.

The workflow starts with `file-clusters` over source/test Swift files, then uses
`related-tests` from the first source result. That keeps the expectation tied to
a realistic map-then-test agent workflow instead of a single exact-symbol lookup.

## Validation Commands

Focused fixture validation:

```bash
./node_modules/.bin/vitest run tests/core/navigation-suite.test.ts -t "navigation manifest includes broad Swift benchmark coverage"
```

Result:

```text
Test Files  1 passed (1)
Tests  1 passed | 10 skipped (11)
```

Swift fixture fairness validation:

```bash
./node_modules/.bin/vitest run tests/core/navigation-suite.test.ts -t "Swift navigation benchmark cases pass fairness validation"
```

Result:

```text
Test Files  1 passed (1)
Tests  1 passed | 10 skipped (11)
```

Swift extractor regression coverage:

```bash
./node_modules/.bin/vitest run tests/core/swift-extractor.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  7 passed (7)
```

Attempted real Alamofire slice:

```bash
./node_modules/.bin/tsx src/cli.ts nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-swift-repos \
  --index-root /tmp/agent-index-swift-indexes-current \
  --artifacts-dir /tmp/agent-index-swift-artifacts-alamofire-current \
  --repo alamofire \
  --reindex \
  --repos
```

Result:

```text
related-tests step needs sourceFile or a previous step with at least one output file
```

Follow-up inspection showed the local `/tmp/agent-index-swift-repos/Alamofire`
copy currently indexes as `0 files, 0 symbols, 0 chunks, 0 edges`; its source
directories are present but empty. This was not counted as a benchmark result.
The fixture-level fairness and manifest coverage tests still validate the
checked-in Swift benchmark definitions.

## Live-Agent Swift Trial

A worker subagent performed a small Swift bugfix trial in an isolated SwiftPM
fixture at `/tmp/agent-index-swift-live-trial`.

Task:

- Fix `CheckoutRedirect.sanitizedReturnPath` so local absolute paths such as
  `/orders/123` are allowed, while external absolute URLs such as
  `https://evil.example/phish` and protocol-relative URLs such as
  `//evil.example/phish` fall back to `/checkout`.

Setup:

- Prebuilt index: `/tmp/agent-index-swift-live-trial/index.sqlite`
- Verification command: `swift test`
- Initial failure: 2 XCTest failures, for external and protocol-relative return
  URLs returning the unsafe input instead of `/checkout`.

Initial verification:

```text
Executed 3 tests, with 2 failures (0 unexpected)
```

Observed agent behavior:

- First navigation/search tool: agent-index.
- First command:

```bash
tsx src/cli.ts query \
  --target /tmp/agent-index-swift-live-trial \
  --index-path /tmp/agent-index-swift-live-trial/index.sqlite \
  --mode hybrid \
  --term CheckoutRedirect \
  --term sanitizedReturnPath \
  --role source
```

- First useful hit: `CheckoutRedirect.sanitizedReturnPath` in
  `Sources/CheckoutCore/CheckoutRedirect.swift`.
- Files inspected:
  - `Sources/CheckoutCore/CheckoutRedirect.swift`
  - `Tests/CheckoutCoreTests/CheckoutRedirectTests.swift`
- Files edited:
  - `Sources/CheckoutCore/CheckoutRedirect.swift`
- Broad `rg` fallback: none.

Independent verification after the worker completed:

```bash
swift test
```

Result:

```text
Executed 3 tests, with 0 failures (0 unexpected)
```

The same agent-index query also ranked
`CheckoutRedirect.sanitizedReturnPath` first and surfaced the three
`CheckoutRedirectTests` methods as graph neighbors through call-name evidence.

## Remaining Gaps

- The live-agent trial is a controlled SwiftPM fixture, not a mature Swift
  repository. It proves that a live worker chose agent-index first for a Swift
  bugfix, but it does not replace a mature-repo trial on Alamofire, SwiftNIO, or
  SwiftPM.
- The local Swift benchmark repos under `/tmp/agent-index-swift-repos` need to
  be refreshed before recording a full Swift nav-suite artifact with the new
  `agentToolUse` metric.
- Re-run the full seven-repo Swift slice once populated repos are available, and
  record per-case completion/context metrics alongside the existing broad
  coverage evidence.
