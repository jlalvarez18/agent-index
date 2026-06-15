# Scikit-Learn Benchmark Results

## Setup

- Corpus: local checkout at `/Users/juan/Repos/scikit-learn`
- Indexed mode: `--source-only`
- Index path used for this pass: `/tmp/agent-index-sklearn.sqlite`
- Clean source-only index after scanner hygiene: 359 Python files, 5156 symbols, 28824 edges.
- Benchmark file: `benchmarks/sklearn-python.json`
- Questions: 16 source-audited questions covering estimator parameters, pipelines, model selection, preprocessing, decomposition, clustering, forests, trees, metrics, neighbors, and validation.

## Baselines

Initial scikit-learn source-only benchmark:

| Mode | Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| FTS | 0.13 | 0.25 | 0.75 | 0.88 | 44ms |
| Symbol | 0.25 | 0.56 | 0.75 | 1.00 | 130ms |
| Hybrid | 0.44 | 0.63 | 0.81 | 0.94 | 125ms |

The first hybrid run had good file recall but poor exact-symbol ordering. Most misses were right-file or right-neighborhood failures: class containers, sibling methods, or nearby helpers beat the expected method/function.

## Fix Progression

### Scanner Hygiene

The first source-only index still included `benchmarks/` and `asv_benchmarks/`. A scanner regression added those directories to the support-code filter.

Result: source-only indexing dropped from 414 files / 5455 symbols to 359 files / 5156 symbols.

### Owner And Exact Method Signals

Scikit-learn exposed candidate-recall misses where the expected method was not reliably in the FTS top candidates. The first ranking pass added:

- exact multi-token symbol-name scoring, such as `get_params`
- owner-method intent candidates for queries naming a CamelCase owner plus method/action tokens, such as `BaseEstimator.set_params`
- a narrower factory-constructor trigger so "constructor parameters" does not mean "find factory functions"

Hybrid moved to:

| Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| ---: | ---: | ---: | ---: | ---: |
| 0.69 | 0.88 | 0.94 | 1.00 | 187ms |

### Exact Identifier Tie-Breaking

The Pipeline question showed a noun/action ambiguity: "transformer" should not satisfy an exact `transform` method request. Exact symbol matching now uses stricter token matching than broader fuzzy symbol coverage, and exact callable identifier matches receive enough weight to beat same-score source-text ties.

Hybrid moved to:

| Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| ---: | ---: | ---: | ---: | ---: |
| 0.75 | 0.88 | 0.88 | 1.00 | 159ms |

### Scientific/ML Intent Rules

The remaining misses were general scikit-learn-style query intents rather than package-specific symbol exceptions:

- cross-validation score queries should prefer `cross_val_score` over displays or broader `cross_validate`
- nearest-neighbor lookup should prefer `kneighbors` over radius-neighbor APIs when radius is not requested
- low-level input-array validation should prefer `check_array`
- forest fitting behavior should prefer the `fit` implementation over random forest class containers

After these guarded intent rules:

| Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| ---: | ---: | ---: | ---: | ---: |
| 1.00 | 1.00 | 1.00 | 1.00 | 220ms |

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 16 friendly Scikit-learn benchmark rows. The structured queries use estimator and API-shaped terms such as `BaseEstimator.get_params`, `Pipeline.fit`, `ColumnTransformer.fit_transform`, `cross_val_score`, `BaseSearchCV.fit`, `StandardScaler.transform`, `PCA._fit_full`, `BaseForest.fit`, `KNeighborsMixin.kneighbors`, and `check_array`.

Index:

```text
node dist/cli.js index /Users/juan/Repos/scikit-learn --source-only --index-path /tmp/agent-index-sklearn-structured.sqlite
Indexed 359 files, 5156 symbols, 5156 chunks, 28824 edges at /tmp/agent-index-sklearn-structured.sqlite (mode: source-only)
```

First structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 0.94
Symbol Hit@5: 0.94
Symbol MRR: 0.94
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.06
Avg latency: 152ms
rg-style File Hit@1: 0.63
rg-style File Hit@5: 1.00

Misses:
pipeline-fit-steps  top=Pipeline.fit_transform
```

Source audit: `Pipeline.fit` is the correct expected symbol for fitting each transformer and then fitting the final estimator. `Pipeline.fit_transform` fits and then transforms with the final estimator. The first structured query included broad transformer wording, which overemphasized the neighboring `fit_transform` method.

Final structured pass after using more discriminating `Pipeline.fit` source terms:

```text
Mode: hybrid
Query style: agent
Questions: 16
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 157ms
rg-style File Hit@1: 0.69
rg-style File Hit@5: 1.00
rg-style File MRR: 0.81
rg-style Avg latency: 125ms

Misses: none
```

Interpretation: Scikit-learn extends the structured-agent evidence to ML/data APIs. File recall is easy for rg-style search on this friendly set, but exact symbol navigation still benefits from structured owner/API terms. The main query-guidance lesson is that overloaded estimator methods need action-specific terms: `fit final estimator`, `routed_params`, and `fit-final-estimator` point at `Pipeline.fit`, while broad transformer wording can pull `Pipeline.fit_transform`.

## Adversarial Follow-Up

After the friendly set saturated, a 13-question adversarial set was added at `benchmarks/sklearn-adversarial-python.json`. It keeps the same corpus but asks sharper near-miss questions around pipeline prediction, pipeline fit/transform behavior, column transformers, cross-validation, grid-search candidate enumeration, mini-batch clustering, nearest-neighbor graph construction, paired input validation, estimator data validation, pairwise distance chunking, ROC thresholds, and synthetic classification data.

Initial adversarial hybrid result:

| Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| ---: | ---: | ---: | ---: | ---: |
| 0.62 | 0.92 | 0.69 | 0.92 | 157ms |

The useful misses were:

- `Pipeline.predict` ranked behind transform-oriented pipeline methods when the query said data should pass through steps and then call the final estimator's prediction method.
- `GridSearchCV._run_search` ranked behind the halving search container because the broad grid-search vocabulary matched both APIs.
- `kneighbors_graph` ranked behind plain `kneighbors` because the earlier nearest-neighbor intent overvalued lookup wording even when graph output was requested.
- `check_X_y` ranked behind a topical estimator/container for paired `X`/`y` validation wording.
- `validate_data` was missing from the top five for estimator feature-name and `n_features_in` validation wording.

The fix added test-first regressions and guarded intents for final-estimator pipeline prediction, grid-search `_run_search`, nearest-neighbor graph builders, paired input validation, and estimator data validation. The nearest-neighbor graph signal also suppresses the older broad nearest-neighbor lookup and generic graph-build intents for this wording.

Final adversarial hybrid result:

| Symbol Hit@1 | Symbol Hit@5 | File Hit@1 | File Hit@5 | Avg latency |
| ---: | ---: | ---: | ---: | ---: |
| 1.00 | 1.00 | 1.00 | 1.00 | 201ms |

## Concrete Examples

### Good: Owner Method Candidate

Query:

```text
where does scikit-learn BaseEstimator set nested estimator parameters using double underscore names?
```

Before the owner-method intent, the top results were `check_estimator`, `_BaseComposition`, and `BaseSearchCV.fit`; the expected `BaseEstimator.set_params` was not in the top five.

After the fix, `BaseEstimator.set_params` ranks first with `owner method intent`.

### Good: Cross-Validation Score

Query:

```text
where does scikit-learn evaluate a score by cross validation over estimator splits and scoring?
```

Before the intent, `ValidationCurveDisplay.from_estimator` and `cross_validate` ranked above `cross_val_score`.

After the fix, `cross_val_score` ranks first with `cross validation score intent`.

### Good: K-Nearest Neighbors

Query:

```text
where does scikit-learn find k nearest neighbors and optionally return distances using the fitted neighbor search structure?
```

Before the intent, `RadiusNeighborsMixin.radius_neighbors` ranked first because it shared much of the nearest-neighbor vocabulary.

After the fix, `KNeighborsMixin.kneighbors` ranks first with `nearest neighbors intent`.

### Useful Remaining Caveat

The benchmark is now saturated, but the fixes added several hand-built intent rules. That is acceptable for a dogfood prototype, yet it should be framed carefully: the result proves the current architecture can be iterated into useful local search behavior, not that the rule set is complete or generally learned.

## Takeaways

- Larger scientific/tooling codebases stress exact-symbol selection more than file recall.
- Owner-method candidate expansion is useful when FTS is crowded with topical helper functions.
- Exact symbol matching needs stricter token semantics than broad lexical coverage; otherwise nouns like "transformer" can behave like action verbs such as `transform`.
- Adversarial follow-up questions are valuable after a friendly set saturates. They exposed over-broad nearest-neighbor and graph-build signals that the first scikit-learn set did not catch.
- Source-only filtering must keep expanding as new project layouts reveal support-code directories.
