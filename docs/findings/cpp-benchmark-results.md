# C++ Benchmark Results

Date: 2026-06-24

## Scope

This run validates the first C++ navigation slice against the local
`firebase-ios-sdk` checkout. The case focuses on Firestore's C++ core:
`RemoteStore::Listen`, watch-stream startup, and watch request sending.

The fixture now frames the task as a bugfix-style pre-edit navigation workflow:

> RemoteStore watch listens should start the watch stream and send watch
> requests for target data. Trace the implementation before editing.

The repository was already present at `/Users/juan/Repos/firebase-ios-sdk`.

## Commands

Fresh reindex and baseline metrics:

```bash
npm run nav:suite -- --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-cpp-indexes \
  --artifacts-dir /tmp/agent-index-cpp-artifacts \
  --repo firebase-firestore-cpp \
  --reindex \
  --repos
```

Fixture re-run after adding `agentToolUse` expectations:

```bash
npm run nav:suite -- --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-cpp-indexes \
  --artifacts-dir /tmp/agent-index-cpp-artifacts \
  --repo firebase-firestore-cpp \
  --repos
```

## Indexed Corpus

| Suite entry | Files | Symbols | Edges |
| --- | ---: | ---: | ---: |
| `firebase-firestore-cpp` | 2,316 | 42,048 | 180,778 |

## Result

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Average commands | 2.00 | 2.00 | 2.00 |
| Average context tokens | 544 | 92,482 | 1,523 |
| Average first-useful context tokens | 222 | 90,945 | 135 |
| Average completion context tokens | 222 | 0 | 0 |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Average savings were 91,938 tokens versus broad `rg` and 979 tokens versus
optimized `rg`.

## Agent Tool-Use Measurement

The real Firebase C++ case now includes an `agentToolUse` expectation:

```json
{
  "expected": "agent-index-first",
  "maxFirstUsefulCommand": 1,
  "maxCompletionCommand": 1,
  "maxFirstUsefulContextTokens": 300,
  "maxCompletionContextTokens": 300
}
```

The authored workflow satisfied that contract.

| Metric | Result |
| --- | ---: |
| Tool-use cases | 1 |
| Tool-use satisfied rate | 1.00 |
| First useful command | 1 |
| Completion command | 1 |
| Average first-useful context tokens | 222 |
| Average completion context tokens | 222 |

The first `agent-index query` step completed the task by surfacing both
`remote_store.cc` and `remote_store.h`, plus the required symbols:

- `firebase::firestore::remote::RemoteStore.Listen`
- `firebase::firestore::remote::RemoteStore.SendWatchRequest`
- `firebase::firestore::remote::RemoteStore.ShouldStartWatchStream`

## Source-To-Test Investigation

The local Firebase checkout does not contain a direct
`remote_store_test.cc` or one-to-one RemoteStore gtest file. I checked this two
ways.

First, `related-tests` from the source file:

```bash
node dist/cli.js related-tests \
  --target /Users/juan/Repos/firebase-ios-sdk \
  --index-path /tmp/agent-index-cpp-indexes/firebase-firestore-cpp.sqlite \
  --source Firestore/core/src/remote/remote_store.cc \
  --symbol firebase::firestore::remote::RemoteStore.Listen \
  --term watch \
  --term listen \
  --term target \
  --limit 8 \
  --format compact-json
```

The top results were adjacent coverage such as:

- `Firestore/core/test/unit/remote/remote_event_test.cc`
- `Firestore/core/test/unit/remote/serializer_test.cc`
- `Firestore/core/test/unit/remote/fake_target_metadata_provider.cc`
- `Firestore/core/test/unit/core/query_listener_test.cc`

Second, a role-filtered test query:

```bash
node dist/cli.js query \
  --target /Users/juan/Repos/firebase-ios-sdk \
  --index-path /tmp/agent-index-cpp-indexes/firebase-firestore-cpp.sqlite \
  --mode hybrid \
  --term RemoteStore \
  --term Listen \
  --term watch \
  --term target \
  --kind class \
  --kind method \
  --role test \
  --path Firestore/core/test/unit/remote \
  --limit 10 \
  --format compact
```

This returned listen/watch protocol tests in `serializer_test.cc`,
`watch_change_test.cc`, and `remote_event_test.cc`. These are useful adjacent
tests for the watch protocol, but they do not directly exercise
`RemoteStore::Listen` or `RemoteStore::SendWatchRequest`. For that reason the
benchmark remains a source-navigation case instead of adding a required
`related-tests` completion step that would overclaim the repository's test
shape.

An exact filename fallback confirmed the same layout:

```bash
rg --files /Users/juan/Repos/firebase-ios-sdk/Firestore/core/test | rg 'remote_store|watch|listen|remote'
```

## Live Subagent Navigation Trial

A fresh explorer subagent ran a read-only C++ navigation trial against the real
Firebase checkout.

Task:

- Find where Firestore `RemoteStore` starts a watch listen and sends watch
  requests for target data.

Setup:

- Repository: `/Users/juan/Repos/firebase-ios-sdk`
- Prebuilt index: `/tmp/agent-index-cpp-indexes/firebase-firestore-cpp.sqlite`
- CLI: `/Users/juan/.codex/worktrees/a41f/agent-index/dist/cli.js`

Observed agent behavior:

- First navigation tool: agent-index.
- First useful hit: `RemoteStore::Listen` in
  `Firestore/core/src/remote/remote_store.cc`.
- Confirmed send path: `RemoteStore::SendWatchRequest` calls
  `watch_stream_->WatchQuery(target_data)`.
- Confirmed request construction: `WatchStream::WatchQuery` in
  `Firestore/core/src/remote/watch_stream.cc` encodes and writes the watch
  request.
- Files inspected:
  - `Firestore/core/src/remote/remote_store.cc`
  - `Firestore/core/src/remote/watch_stream.cc`
- Files edited: none; this was a read-only navigation trial.
- Tests run: none; validation was focused source inspection of the
  agent-index hits.
- Broad `rg` fallback: none.
- Command-shape mistakes: none.

Subagent commands:

```bash
node /Users/juan/.codex/worktrees/a41f/agent-index/dist/cli.js query \
  --target /Users/juan/Repos/firebase-ios-sdk \
  --index /tmp/agent-index-cpp-indexes/firebase-firestore-cpp.sqlite \
  --mode hybrid \
  --term RemoteStore \
  --term watch \
  --term listen \
  --term target \
  --term TargetData \
  --kind method \
  --kind function \
  --role source
```

```bash
node /Users/juan/.codex/worktrees/a41f/agent-index/dist/cli.js query \
  --target /Users/juan/Repos/firebase-ios-sdk \
  --index /tmp/agent-index-cpp-indexes/firebase-firestore-cpp.sqlite \
  --mode hybrid \
  --term WatchQuery \
  --term TargetData \
  --term WriteRequest \
  --term watch_stream \
  --kind method \
  --kind function \
  --role source \
  --expand callers \
  --expand callees
```

## Notes And Limits

- The C++ extractor is intentionally line-based. For this case it produced
  useful namespace, class, out-of-class method, include, call-name, gtest, and
  CMake ownership signals without needing compiler integration.
- The current real-repo C++ benchmark covers source navigation and authored
  tool-use behavior. The selected Firebase slice does not provide fair
  source-to-test completion because RemoteStore behavior is covered through
  adjacent remote/core protocol tests rather than a direct one-to-one test file.
- The live subagent trial was read-only. It shows that an autonomous worker chose
  agent-index first and reached useful C++ source context without broad `rg`,
  but it does not prove an edit-and-test loop for C++.
- A stronger future C++ evidence pass should add a real repository case with a
  direct C++ source-to-test hop, or run a controlled C++ bugfix fixture where a
  subagent edits code and verifies the fix.
