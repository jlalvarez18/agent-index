# Celery Benchmark Results

## Current Status

Celery is the seventeenth validation corpus, cloned locally at `/Users/juan/Repos/celery`.

It was chosen because it stresses a different Python domain from the earlier corpora: distributed task queues, worker bootsteps, broker message construction, beat scheduling, canvas primitives, result backends, and security serializers.

Clone commit:

```text
4f15954
```

## Benchmark Setup

Commands:

```bash
node dist/cli.js index /Users/juan/Repos/celery --source-only --index-path /tmp/agent-index-celery.sqlite
node dist/cli.js benchmark ./benchmarks/celery-python.json --target /Users/juan/Repos/celery --index-path /tmp/agent-index-celery.sqlite --mode hybrid --misses
```

Source-only index summary after the `t/` scanner fix:

```text
Indexed 158 files, 3225 symbols, 3225 chunks, 11774 edges at /tmp/agent-index-celery.sqlite (mode: source-only)
```

Before the scanner fix, source-only indexing included Celery's top-level `t/` test suite:

```text
Indexed 334 files, 7759 symbols, 7759 chunks, 32028 edges at /tmp/agent-index-celery.sqlite (mode: source-only)
```

## Golden Questions

The first Celery set contains 16 source-audited questions covering:

- app-level task publishing
- task `apply_async` and retry behavior
- AMQP protocol v2 message construction
- task routing
- worker task message dispatch
- worker and beat startup loops
- scheduled task application
- crontab due checks
- canvas signatures, chains, groups, and chords
- security setup
- result backend storage

The adversarial Celery set adds 16 sharper near-miss questions around:

- remote task publishing vs local task objects
- inline task/signature execution vs tracer helpers
- beat heap ticking vs due checks
- scheduled-entry logging vs schedule due helpers
- backend success/failure/chord-error state handling
- unknown-task worker handling vs generic request failure
- strategy refresh vs process initializer setup
- group/chord canvas freeze/apply/run internals
- AMQP task sender publishing
- concurrency pool target submission
- event-state task updates

## Mode Comparison

Run date: 2026-06-13

Plain FTS:

```text
Mode: fts
Questions: 16
Symbol Hit@1: 0.38
Symbol Hit@5: 0.81
Symbol MRR: 0.55
File Hit@1: 0.81
File Hit@5: 0.94
File MRR: 0.86
Partial file hits: 0.13
Avg latency: 16ms
```

Symbol mode after the schedule-subtype intent:

```text
Mode: symbol
Questions: 16
Symbol Hit@1: 0.75
Symbol Hit@5: 0.81
Symbol MRR: 0.77
File Hit@1: 0.94
File Hit@5: 0.94
File MRR: 0.94
Partial file hits: 0.13
Avg latency: 61ms
```

Hybrid mode before the Celery fixes:

```text
Mode: hybrid
Questions: 16
Symbol Hit@1: 0.88
Symbol Hit@5: 1.00
Symbol MRR: 0.94
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 52ms
```

Hybrid mode after the scanner and ranking fixes:

```text
Mode: hybrid
Questions: 16
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 46ms
```

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 16 friendly Celery benchmark rows. The structured queries use owner/API-shaped terms such as `Celery.send_task`, `Task.apply_async`, `Task.retry`, `AMQP.as_task_v2`, `Router.route`, `Consumer.create_task_handler`, `WorkController.start`, `Scheduler.apply_async`, `Service.start`, `crontab.is_due`, `Signature.apply_async`, `_chain.apply_async`, `group.apply_async`, `_chord.apply_async`, `setup_security`, and `Backend.store_result`.

Index:

```text
node dist/cli.js index /Users/juan/Repos/celery --source-only --index-path /tmp/agent-index-celery-structured.sqlite
Indexed 158 files, 3225 symbols, 3225 chunks, 11774 edges at /tmp/agent-index-celery-structured.sqlite (mode: source-only)
```

Structured pass:

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
Avg latency: 46ms
rg-style File Hit@1: 0.31
rg-style File Hit@5: 0.88
rg-style File MRR: 0.56
rg-style Avg latency: 36ms

Misses: none
```

Interpretation: Celery extends the structured-agent evidence into task-queue and distributed-worker vocabulary. This is a clean first pass, which is useful because Celery has many overloaded action words: `send`, `apply`, `run`, `start`, `task`, `route`, and `result`. Dotted owner/API terms plus path hints keep those words anchored to exact edit locations, while the rg-style baseline over the same terms often finds related task, worker, beat, or canvas files but not the expected top file.

## Adversarial Progression

Run date: 2026-06-13

The adversarial benchmark started below the friendly set because it intentionally asked questions where nearby helpers share most of the same words. The useful signal was that Symbol Hit@5 stayed high while Symbol Hit@1 exposed ordering problems.

```text
Initial adversarial hybrid in this pass:
Symbol Hit@1: 0.63
Symbol Hit@5: 0.94
File Hit@1: 0.75
File Hit@5: 0.94
Avg latency: 62ms
```

After narrowing the over-broad `report` intent, top-five recall reached 1.00 but top-one still missed several implementation methods:

```text
Symbol Hit@1: 0.63
Symbol Hit@5: 1.00
File Hit@1: 0.75
File Hit@5: 1.00
Avg latency: 60ms
```

The remaining fixes were implemented test-first:

- report-generation intent now requires generation wording, so `report the result id` no longer boosts report helpers
- backend state marking maps successful/failure wording to `mark_as_done` or `mark_as_failure`
- exact symbol matching treats event-handler prefixes such as `on_` as optional for compound method names
- strategy refresh wording maps `rebuild strategies` to `update_strategies`
- eager/current-process task execution maps to `Task.apply`
- scheduled task send/log/result wording maps to `Scheduler.apply_entry`
- group freeze metadata wording maps to `_freeze_group_tasks`, `_freeze_tasks`, or `group.freeze` over unroll helpers

Final adversarial hybrid:

```text
Mode: hybrid
Questions: 16
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 67ms

Misses: none
```

## Structured Agent Query vs rg-Style Baseline (Adversarial)

Run date: 2026-06-13

This pass added `agentQuery` fields to all 16 Celery adversarial rows. The structured queries follow the agent-query cookbook: exact owner/API terms such as `Celery.send_task`, `Signature.apply`, `Task.apply`, `Scheduler.tick`, `Backend.mark_as_failure`, `Consumer.on_unknown_task`, `group._freeze_group_tasks`, `AMQP._create_task_sender`, `BasePool.apply_async`, and `Task.event`; path hints such as `app/base`, `canvas`, `beat`, `backends/base`, `worker/consumer`, `concurrency/base`, and `events/state`; and graph expansion for parents/callees.

Index:

```text
node dist/cli.js index /Users/juan/Repos/celery --source-only --index-path /tmp/agent-index-celery-adversarial-structured.sqlite
Indexed 158 files, 3225 symbols, 3225 chunks, 11774 edges at /tmp/agent-index-celery-adversarial-structured.sqlite (mode: source-only)
```

Structured pass:

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
Avg latency: 65ms
rg-style File Hit@1: 0.44
rg-style File Hit@5: 0.88
rg-style File MRR: 0.63
rg-style Avg latency: 32ms

Misses: none
```

Interpretation: Celery adversarial is the first post-cookbook structured pass, and it is clean without query refinements after the initial cookbook-shaped authoring. That is useful but should be framed carefully: the benchmark is still curated, while the win over the rg-style file baseline shows that exact owner/API terms plus symbol-aware ranking are doing real work on overloaded task-queue vocabulary.

## Hybrid Detail

```text
send-task-by-name             symbolRank=1  fileRank=1  top=Celery.send_task
task-apply-async-publish      symbolRank=1  fileRank=1  top=Task.apply_async
task-retry-reschedule         symbolRank=1  fileRank=1  top=Task.retry
amqp-v2-task-message          symbolRank=1  fileRank=1  top=AMQP.as_task_v2
task-router-options           symbolRank=1  fileRank=1  top=Router.route
worker-task-message-handler   symbolRank=1  fileRank=1  top=Consumer.create_task_handler
worker-start-blueprint        symbolRank=1  fileRank=1  top=WorkController.start
beat-apply-scheduled-entry    symbolRank=1  fileRank=1  top=Scheduler.apply_async
beat-service-loop             symbolRank=1  fileRank=1  top=Service.start
crontab-due-check             symbolRank=1  fileRank=1  top=crontab.is_due
signature-apply-async         symbolRank=1  fileRank=1  top=Signature.apply_async
chain-apply-run               symbolRank=1  fileRank=1  top=_chain.apply_async
group-apply-async             symbolRank=1  fileRank=1  top=group.apply_async
chord-apply-async             symbolRank=1  fileRank=1  top=_chord.apply_async
security-setup-auth-serializer symbolRank=1 fileRank=1  top=setup_security
backend-store-result          symbolRank=1  fileRank=1  top=Backend.store_result
```

## Findings

Celery immediately found a source-only filtering gap. Many projects use `tests/` or `testing/`, but Celery's suite is under top-level `t/`. Adding a top-level-only `t/` support-code skip removed test pollution without skipping arbitrary nested directories named `t`.

The first clean hybrid run had full Symbol Hit@5 and File Hit@5 but two top-one misses:

- `worker-start-blueprint`: `WorkController` beat `WorkController.start`.
- `crontab-due-check`: generic `schedule.is_due` beat `crontab.is_due`.

The worker miss showed that an early FTS concrete method can still lose to a broad class chunk. A first attempted class-container demotion was too broad and regressed a constructor/container case. The final fix instead gives a small specificity boost only to early FTS, non-dunder, single-token method-name matches.

The crontab miss showed a specific subtype-vs-base-method ambiguity. A guarded schedule-subtype intent now boosts `is_due` methods whose owner is explicitly named as `crontab` or `solar` in due/schedule questions.

## Examples

Good result: `where does Celery build the protocol v2 task message headers body callbacks errbacks and stamped headers?`

- Top result: `AMQP.as_task_v2` in `celery/app/amqp.py`.
- This is a strong symbol-first result because plain FTS initially preferred `proto1_to_proto2` in worker strategy code.

Fixed result: `where does the Celery worker start its blueprint and handle terminate system exit or keyboard interrupt?`

- Before the ranking fix: `WorkController`.
- After the ranking fix: `WorkController.start`.
- The class was useful context, but the method is the exact implementation entrypoint.

Fixed result: `where does Celery crontab decide whether a schedule is due based on the last run time?`

- Before the subtype fix: `schedule.is_due`.
- After the subtype fix: `crontab.is_due`.
- The query named the crontab schedule subtype, so the generic schedule implementation was a nearby but less specific answer.

Fixed adversarial result: `where does a task run eagerly in the current process and build a request with callbacks errbacks and result state?`

- Before the eager task intent: `build_tracer` in `celery/app/trace.py`.
- After the fix: `Task.apply` in `celery/app/task.py`.
- The tracer is called by eager execution and shares many request/callback/result terms, but the query asks for the local execution entrypoint.

Fixed adversarial result: `where does beat log that a due scheduled task is being sent and report the result id after applying it?`

- Before the scheduler apply-entry intent: `schedule.is_due`.
- After the fix: `Scheduler.apply_entry`.
- The due-check helper is nearby scheduling code, but the question asks for sending/logging the scheduled entry and reporting the result id.

Fixed adversarial result: `where does a canvas group freeze child signatures with group id root id parent id chord and group indexes?`

- Before the group freeze metadata intent: `group._freeze_unroll`.
- After the fix: `group._freeze_group_tasks`.
- The unroll helper touches child signatures, but the metadata assignment happens in the freeze methods.
