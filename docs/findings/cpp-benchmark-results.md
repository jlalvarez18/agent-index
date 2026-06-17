# C++ Benchmark Results

Date: 2026-06-17

## Scope

This run validates the first C++ navigation slice against the local
`firebase-ios-sdk` checkout. The case focuses on Firestore's C++ core:
`RemoteStore::Listen`, watch-stream startup, and watch request sending.

The repository was already present at `/Users/juan/Repos/firebase-ios-sdk`.

## Command

```bash
npm run nav:suite -- --repo-root /Users/juan/Repos \
  --index-root /tmp/agent-index-cpp-indexes \
  --artifacts-dir /tmp/agent-index-cpp-artifacts \
  --repo firebase-firestore-cpp \
  --reindex \
  --repos
```

## Indexed Corpus

| Suite entry | Files | Symbols |
| --- | ---: | ---: |
| `firebase-firestore-cpp` | 3,175 | 45,163 |

## Result

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Average commands | 2.00 | 2.00 | 2.00 |
| Average context tokens | 545 | 92,482 | 1,553 |
| Average completion context tokens | 222 | 0 | 0 |
| Wins | 1 | 0 | 0 |

Average savings were 91,937 tokens versus broad `rg` and 1,008 tokens versus
optimized `rg`.

## Notes

- The C++ extractor is intentionally line-based. For this case it produced
  useful namespace, class, out-of-class method, include, call-name, and CMake
  ownership signals without needing compiler integration.
- The fixture is source-navigation only. The local Firebase checkout does not
  have a direct `remote_store_test.cc`; remote-store behavior is covered through
  adjacent remote/core tests rather than a one-to-one related-test file.
