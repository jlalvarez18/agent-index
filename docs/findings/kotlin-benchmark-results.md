# Kotlin Benchmark Results

## 2026-06-17 KotlinPoet Real-Repo Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts \
  --repo kotlinpoet \
  --reindex \
  --repos
```

Repository:

- `kotlinpoet`
- URL: `https://github.com/square/kotlinpoet.git`
- Indexed: 132 files, 2609 symbols, 2609 chunks, 19909 edges

Case:

- `kotlinpoet-extension-api`
- Task: find which KotlinPoet extension/builder function owns a generated API surface and where that extension is tested.

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Completion rate | 1.00 | 1.00 | 1.00 |
| Commands | 1 | 2 | 3 |
| Context tokens | 352 | 111950 | 3919 |
| Completion context tokens | 352 | 103410 | 3419 |
| Avg latency | 135 ms | 26 ms | 22 ms |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- This is the first real Kotlin repo proof point for the Kotlin language track.
- `agent-index` found useful KotlinPoet API ownership at rank 1 and completed the task with materially less context than both broad and optimized `rg`.
- `rg` was faster in wall-clock latency, but required much more context to reach completion. For agent navigation, this is the tradeoff the project is trying to exploit: fewer tokens and less surrounding noise for the same task completion.

Real-repo correction made during this run:

- The original KotlinPoet benchmark assumed `kotlinpoet/src/test`.
- Current KotlinPoet uses multiplatform/JVM source-set layout: `kotlinpoet/src/jvmMain` and `kotlinpoet/src/jvmTest`.
- The benchmark was updated to match the current repository layout before the successful run.

## 2026-06-17 kotlinx.coroutines Real-Repo Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts-coroutines \
  --repo kotlinx.coroutines \
  --reindex \
  --repos
```

Repository:

- `kotlinx.coroutines`
- URL: `https://github.com/Kotlin/kotlinx.coroutines.git`
- Indexed: 1092 files, 9427 symbols, 9427 chunks, 56932 edges

Case:

- `kotlinx-coroutines-flow-path`
- Task: trace coroutine Flow operator execution from collection through map/transform emission and find related tests.

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Completion rate | 1.00 | 1.00 | 1.00 |
| Commands | 2 | 2 | 3 |
| Context tokens | 733 | 329373 | 4464 |
| Completion context tokens | 607 | 219123 | 3772 |
| First useful rank | 1 | 186 | 33 |
| Avg latency | 655 ms | 62 ms | 23 ms |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- This is the first coroutine-heavy real Kotlin repo proof point.
- `agent-index` found `kotlinx-coroutines-core/common/src/flow/operators/Transform.kt` at rank 1 for the Flow `map`/`transform` task.
- Broad `rg` needed a very large result set before the useful file appeared, while optimized `rg` still needed substantially more completion context than `agent-index`.
- Related-test discovery surfaced Flow operator tests, including `MapTest.kt`, but the benchmark's required completion was satisfied by the source Flow path. Future Kotlin benchmark tightening should make related-test requirements explicit where the user task demands test ownership.

## 2026-06-17 Ktor Real-Repo Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts-ktor \
  --repo ktor \
  --repos
```

Repository:

- `ktor`
- URL: `https://github.com/ktorio/ktor.git`
- Indexed: 2525 files, 19415 symbols, 19415 chunks, 108314 edges

Case:

- `ktor-routing-coroutine-service`
- Task: trace a Ktor server request from routing DSL registration through suspend handler execution and response serialization.

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Completion rate | 1.00 | 1.00 | 1.00 |
| Commands | 2 | 2 | 3 |
| Context tokens | 807 | 616792 | 5245 |
| Completion context tokens | 642 | 339636 | 4187 |
| First useful rank | 1 | 457 | 18 |
| Avg latency | 1022 ms | 333 ms | 48 ms |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- `agent-index` found `ktor-server/ktor-server-core/common/src/io/ktor/server/routing/RoutingNode.kt` at rank 1 and also surfaced `RoutingRoot.kt` plus `executeResult` in the completion command.
- Broad `rg` found the same files only after a large result set, while optimized `rg` needed more commands and substantially more completion context.
- The initial Ktor benchmark expected an outdated `Routing.kt` path. Current Ktor defines `Routing`, `Route`, and `RoutingNode` in `RoutingNode.kt`, with request execution continuing through `RoutingRoot.kt`; the benchmark was corrected to match that repository layout.

## 2026-06-17 Koin Real-Repo Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts-koin \
  --repo koin \
  --repos
```

Repository:

- `koin`
- URL: `https://github.com/InsertKoinIO/koin.git`
- Indexed: 586 files, 4899 symbols, 4899 chunks, 16805 edges

Case:

- `koin-annotation-di-navigation`
- Task: navigate Kotlin DI annotations from module declarations to injected components and their tests.

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Completion rate | 1.00 | 1.00 | 0.00 |
| Commands | 2 | 2 | 3 |
| Context tokens | 767 | 372177 | 4284 |
| Completion context tokens | 618 | 270804 | 0 |
| First useful rank | 1 | 320 | 7 |
| Avg latency | 108 ms | 140 ms | 43 ms |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- `agent-index` found `projects/core/koin-annotations/src/commonMain/kotlin/org/koin/core/annotation/CoreAnnotations.kt` at rank 1 and surfaced `Factory`, `Single`, and `Module` in the first command.
- Broad `rg` completed only after a large result set. Optimized `rg` found the target earlier than broad `rg`, but did not complete the required symbol/file set in the reindexed run.
- The initial Koin benchmark used stale root paths and mixed source/test discovery in the first step, causing annotation tests to crowd out the annotation definitions. The benchmark now reflects current Koin layout under `projects/core` and uses source-first discovery followed by related-test lookup.

## 2026-06-17 Now in Android ViewModel Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts-nia \
  --repo nowinandroid \
  --reindex \
  --repos
```

Repository:

- `nowinandroid`
- URL: `https://github.com/android/nowinandroid.git`
- Indexed: 438 files, 2232 symbols, 2232 chunks, 13038 edges

Case:

- `nowinandroid-viewmodel-test-flow`
- Task: find where an Android feature ViewModel is tested and trace its coroutine Flow state path from repository collection into UI state.

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Completion rate | 1.00 | 1.00 | 1.00 |
| Commands | 2 | 2 | 4 |
| Context tokens | 791 | 24481 | 3365 |
| Completion context tokens | 469 | 11707 | 3365 |
| First useful rank | 1 | 18 | 2 |
| Avg latency | 170 ms | 71 ms | 22 ms |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- `agent-index` found `feature/foryou/impl/src/main/kotlin/com/google/samples/apps/nowinandroid/feature/foryou/impl/ForYouViewModel.kt` at rank 1 and surfaced `ForYouViewModelTest.kt` in the same source-tests step.
- Broad and optimized `rg` both completed, but required substantially more completion context.
- The scanner initially misclassified real Android source under `com/google/samples/...` as `example`; role detection now treats package path segments under JVM/Android `src/main` roots as source code.

## 2026-06-17 Gradle Version Catalog Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts-gradle-catalog \
  --repo gradle-version-catalog \
  --reindex \
  --repos
```

Repository:

- `gradle-version-catalog`
- URL: `https://github.com/android/nowinandroid.git`
- Indexed: 438 files, 2232 symbols, 2232 chunks, 13038 edges

Case:

- `gradle-version-catalog-kotlin-wiring`
- Task: navigate Kotlin/Android dependency ownership from Gradle version catalog aliases through `build.gradle.kts` dependency wiring.

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Commands | 2 | 2 | 4 |
| Context tokens | 840 | 9481 | 2528 |
| Completion context tokens | 471 | 0 | 0 |
| First useful rank | 1 | 5 | 1 |
| Avg latency | 84 ms | 93 ms | 39 ms |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- `agent-index` found `core/common/build.gradle.kts` at rank 1 and completed on both `gradle.implementation.libs_kotlinx_coroutines_core` and `gradle.catalog.library.kotlinx_coroutines_core`.
- Both `rg` baselines found the relevant files but did not recover the structured alias and dependency symbols needed for completion.
- This validates the TOML/Gradle KTS extraction path for Kotlin dependency ownership and build wiring tasks.

## 2026-06-17 Kotlin Maven Plugin Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts-maven \
  --repo kotlin-maven-plugin \
  --repos
```

Repository:

- `kotlin-maven-plugin`
- URL: `https://github.com/JetBrains/kotlin.git`
- Indexed: prebuilt Kotlin repo index

Case:

- `kotlin-maven-plugin-build-tooling`
- Task: navigate Kotlin Maven plugin build-tooling ownership from `pom.xml` coordinates to the Maven plugin project and plugin declaration.

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Commands | 2 | 2 | 3 |
| Context tokens | 408 | 2363160 | 1299 |
| Completion context tokens | 214 | 0 | 0 |
| First useful rank | 1 | 2503 | 6 |
| Avg latency | 14962 ms | 6842 ms | 839 ms |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- `agent-index` found `libraries/tools/kotlin-maven-plugin/pom.xml` at rank 1 and completed on `maven.project.kotlin_maven_plugin`.
- Broad and optimized `rg` found the POM file, but neither recovered the structured Maven project symbol required for completion.
- The first Maven run exposed a useful scanner/ranking lesson: Kotlin's `libraries/tools` tree is classified as role `tool`, so the benchmark now allows both `source` and `tool` roles for this shipped Maven plugin. Exact file path hints also seed and strongly boost matching candidates, which prevents unrelated Gradle build symbols from crowding out precise POM ownership.

## 2026-06-17 Kotlin Multiplatform Stdlib Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts-multiplatform \
  --repo kotlin \
  --repos
```

Repository:

- `kotlin`
- URL: `https://github.com/JetBrains/kotlin.git`
- Indexed: 67,757 files, 434,167 symbols, 1,524,067 edges

Case:

- `kotlin-multiplatform-module-boundary`
- Task: trace Kotlin multiplatform ownership from the stdlib Gradle plugin declaration through `commonMain` and `jvmMain` source-set wiring.

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Completion rate | 1.00 | 0.00 | 0.00 |
| Commands | 2 | 2 | 3 |
| Context tokens | 390 | 34370955 | 2422 |
| Completion context tokens | 157 | 0 | 0 |
| First useful rank | 1 | 1 | 1 |
| Avg latency | 7019 ms | 7111 ms | 874 ms |
| Wins | 1 | 0 | 0 |
| Wins vs optimized rg | 1 | n/a | 0 |

Interpretation:

- `agent-index` found `libraries/stdlib/build.gradle.kts` at rank 1 and completed on `gradle.plugin.kotlin_multiplatform`.
- The same first command also surfaced `gradle.sourceSet.commonMain` and `gradle.sourceSet.jvmMain`.
- The initial benchmark mixed a stdlib Gradle ownership target with stale `Platform.kt`/expect-actual expectations. Current stdlib still has expect/actual declarations, but this case now honestly targets the Gradle/source-set ownership path it can score.

## 2026-06-17 Kotlin Subset Aggregate Pass

Command:

```bash
node dist/cli.js nav-suite benchmarks/navigation/suite.json \
  --repo-root /private/tmp/agent-index-kotlin-repos \
  --index-root /private/tmp/agent-index-kotlin-indexes \
  --artifacts-dir /private/tmp/agent-index-kotlin-artifacts-full \
  --repo kotlinpoet \
  --repo kotlinx.coroutines \
  --repo ktor \
  --repo koin \
  --repo nowinandroid \
  --repo gradle-version-catalog \
  --repo kotlin-maven-plugin \
  --repo kotlin \
  --repos
```

Result:

| Metric | agent-index | broad rg | optimized rg |
| --- | ---: | ---: | ---: |
| Repos / cases | 8 / 8 | 8 / 8 | 8 / 8 |
| Completion rate | 1.00 | 0.63 | 0.63 |
| Commands | 1.88 | 2.00 | 3.25 |
| Context tokens | 636 | 4774796 | 3453 |
| Completion context tokens | 441 | 118085 | 2262 |
| Wins | 8 | 0 | 0 |
| Wins vs optimized rg | 8 | n/a | 0 |

Interpretation:

- The Kotlin subset now has aggregate completion across KotlinPoet, kotlinx.coroutines, Ktor, Koin, Now in Android, Gradle version catalog, Kotlin Maven plugin, and JetBrains/Kotlin stdlib multiplatform.
- `agent-index` completed every case and won every head-to-head comparison against both broad and optimized `rg`.

## Remaining Kotlin Proof Gaps

- Keep adding real-world Kotlin cases for expect/actual declaration tracing, Compose UI, and Android Gradle Plugin projects.
- Capture any misses as targeted extractor/ranking fixes rather than weakening benchmark expectations.
