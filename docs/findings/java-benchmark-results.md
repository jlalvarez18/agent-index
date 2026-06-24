# Java Benchmark Results

Date: 2026-06-17

## Scope

This run validates the first Java navigation slice across:

- Spring MVC and Maven service/test layout: `spring-petclinic-java`
- Spring annotation-driven dependency injection: `spring-framework-java-di`
- Interface-heavy Java library code: `guava-java`
- Test-heavy Java framework internals: `junit5-java`
- Gradle Java plugin ownership and build wiring: `gradle-java`
- Android Java UI/ViewModel/Room data flow: `android-architecture-components-java`

Repositories were shallow-cloned into `/tmp/agent-index-java-repos` from the `repoUrl` entries in `benchmarks/navigation/suite.json`.

## Command

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-java-repos \
  --index-root /tmp/agent-index-java-indexes \
  --artifacts-dir /tmp/agent-index-java-artifacts \
  --repo spring-petclinic-java \
  --repo spring-framework-java-di \
  --repo guava-java \
  --repo junit5-java \
  --repo gradle-java \
  --repo android-architecture-components-java \
  --repos
```

The indexes were produced with the same command plus `--reindex` after the repositories were cloned.

## Indexed Corpus

| Suite entry | Files | Symbols | Edges |
| --- | ---: | ---: | ---: |
| `spring-petclinic-java` | 51 | 375 | 2,252 |
| `spring-framework-java-di` | 10,293 | 141,719 | 761,182 |
| `guava-java` | 3,265 | 82,101 | 446,853 |
| `junit5-java` | 1,930 | 24,158 | 137,391 |
| `gradle-java` | 15,995 | 142,921 | 595,354 |
| `android-architecture-components-java` | 527 | 2,037 | 10,038 |

## Aggregate Result

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.33 | 0.17 |
| Average commands | 2.00 | 2.00 | 3.00 |
| Average context tokens | 859 | 521,536 | 1,991 |
| Average completion context tokens | 658 | 436,327 | 105 |
| Wins | 6 | 0 | 0 |

Average savings were 520,677 tokens versus broad `rg` and 1,132 tokens versus optimized `rg`.

## Per-Repository Result

| Suite entry | agent complete | broad rg complete | optimized rg complete | agent tokens | broad rg tokens | optimized rg tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `spring-petclinic-java` | 1.00 | 0.00 | 0.00 | 615 | 2,877 | 1,168 |
| `spring-framework-java-di` | 1.00 | 0.00 | 0.00 | 1,100 | 227,605 | 3,268 |
| `guava-java` | 1.00 | 0.00 | 0.00 | 1,123 | 219,402 | 961 |
| `junit5-java` | 1.00 | 1.00 | 0.00 | 950 | 226,408 | 4,814 |
| `gradle-java` | 1.00 | 1.00 | 1.00 | 879 | 2,423,295 | 1,003 |
| `android-architecture-components-java` | 1.00 | 0.00 | 0.00 | 488 | 29,629 | 734 |

## Agent Tool-Use Follow-Up

Date: 2026-06-24

Two Java component-navigation fixtures now include `agentToolUse` expectations:

- `spring-petclinic-owner-controller-java-flow`
- `android-architecture-components-java-room-path`

These expectations measure whether the authored coding-agent workflow calls agent-index first, reaches a useful result on command 1, and completes inside bounded context before an edit would happen.

The original `/tmp/agent-index-java-repos` directories were no longer usable for fresh validation because the Spring Petclinic and Android sample checkouts had become skeletal directories with no Java files. The two follow-up repositories were shallow-cloned again:

```bash
node scripts/prepare-navigation-repos.mjs benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-java-repos-live \
  --repo spring-petclinic-java \
  --repo android-architecture-components-java
```

Fresh validation command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /tmp/agent-index-java-repos-live \
  --index-root /tmp/agent-index-java-indexes-tooluse-live \
  --artifacts-dir /tmp/agent-index-java-artifacts-tooluse-live \
  --repo spring-petclinic-java \
  --repo android-architecture-components-java \
  --reindex \
  --repos
```

Follow-up result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Useful rate | 1.00 | 1.00 | 1.00 |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Tool-use cases | 2 | n/a | n/a |
| Tool-use satisfied rate | 1.00 | n/a | n/a |
| Average first-useful latency | 91 ms | 46 ms | 14 ms |
| Average context tokens | 551 | 16,253 | 951 |
| Average completion context tokens | 420 | 0 | 0 |
| Wins | 2 | 0 | 0 |

Per-case tool-use result:

| Suite entry | indexed files | indexed symbols | tool-use satisfied | first useful command | completion command | completion context tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `spring-petclinic-java` | 59 | 389 | 1.00 | 1 | 1 | 356 |
| `android-architecture-components-java` | 550 | 2,060 | 1.00 | 1 | 1 | 484 |

The authored Java tool-use cases are still benchmark workflows, not autonomous LLM simulations. They now provide stable CI-style evidence that realistic Java component navigation starts with agent-index and reaches bounded edit context.

## Live-Agent Java Trial

A live subagent also performed a navigation-only Java trial against the fresh Spring Petclinic checkout at `/tmp/agent-index-java-repos-live/spring-petclinic`.

Task:

- Owner search by last-name prefix in Spring Petclinic is returning the wrong result path. Locate the Spring MVC owner controller code path and related controller tests before editing.

Observed agent behavior:

- First command: `node dist/cli.js index /tmp/agent-index-java-repos-live/spring-petclinic --index-path /tmp/agent-index-spring-petclinic-live-trial.sqlite`
- Index result: 59 files, 389 symbols, 389 chunks, 2,287 edges.
- Agent-index before broad `rg`: yes.
- First useful source symbol: `OwnerController.processFindForm` in `src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java`.
- Supporting source symbols: `OwnerController.findPaginatedForOwnersLastName` and `OwnerRepository.findByLastNameStartingWith`.
- Related tests found: `OwnerControllerTests.processFindFormSuccess`, `OwnerControllerTests.processFindFormByLastName`, and `OwnerControllerTests.processFindFormNoOwnersFound`.
- Files inspected: `OwnerController.java`, `OwnerRepository.java`, and `OwnerControllerTests.java`.
- Files edited: none.
- Tests run: none; this was a navigation-only trial.
- Broad `rg` fallback: none.
- Outcome: enough context found to proceed with an edit around the single-owner redirect branch in `OwnerController.processFindForm` and the matching controller tests.

## Corrections Made During The Run

- Updated the JUnit 5 test path from `junit-jupiter-engine/src/test/java` to `jupiter-tests/src/test/java`.
- Updated Gradle `JavaBasePlugin` ownership from `plugins-java` to `plugins-java-base`.
- Updated Gradle Java plugin tests from `src/test` to current `src/integTest/groovy` roots.
- Removed a nonexistent Android `BasicSample/app/src/test/java` optimized-rg path; the current sample has `src/androidTest/java` for this case.
- Made Java benchmark `requiredSymbols` use the qualified names emitted by the Java extractor.
- Added a contract-focused Guava agent step for `ListenableFuture.addListener` before implementation/test expansion.

## Notes

The Java extractor is intentionally lightweight and line-based. The benchmark result shows enough signal for first-class navigation tasks: package/import ownership, Java type and method symbols, interface/override edges, annotation call-name edges, Spring DI paths, Android source/test layout, and Maven/Gradle module ownership through existing XML/Kotlin/TOML extractors.
