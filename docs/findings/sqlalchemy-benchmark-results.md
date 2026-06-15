# SQLAlchemy Benchmark Results

## Current Status

SQLAlchemy is the tenth validation corpus, cloned locally at `/Users/juan/Repos/sqlalchemy`.

This corpus was chosen because it adds ORM, SQL construction, engine/pool, async proxy, event, inspection, and compiler pressure that differs from the previous framework, packaging, validation, terminal, and graph-algorithm corpora.

Local source revision:

```text
bfe559a7e
```

## Benchmark Setup

Command:

```bash
node dist/cli.js index /Users/juan/Repos/sqlalchemy --source-only --index-path /tmp/agent-index-sqlalchemy.sqlite
node dist/cli.js benchmark ./benchmarks/sqlalchemy-python.json --target /Users/juan/Repos/sqlalchemy --index-path /tmp/agent-index-sqlalchemy.sqlite --mode hybrid
```

Source-only index summary:

```text
Indexed 221 files, 10579 symbols, 10579 chunks, 35475 edges at /tmp/agent-index-sqlalchemy.sqlite (mode: source-only)
```

## Golden Questions

The seed set contains 16 source-audited questions covering:

- engine creation
- connection and session execution
- ORM relationship and declarative construction
- mapped columns
- metadata table creation
- `select()` construction
- SELECT compilation
- custom type bind processing
- async session and connection delegation
- inspection dispatch
- event listener registration
- queue pool checkout

The adversarial set contains 13 source-audited questions around overloaded SQLAlchemy terms:

- `bind` as bind parameters versus session/connection binds
- `literal_execute` wording versus actual statement execution
- compilation entrypoints versus compiler visitors
- mapper and relationship configuration
- loader options
- event registry internals versus public event APIs
- URL parsing versus URL rendering
- scalar result exactness
- engine disposal versus disposal event hooks

## Mode Comparison

Run date: 2026-06-13

Plain FTS:

```text
Mode: fts
Questions: 16
Symbol Hit@1: 0.13
Symbol Hit@5: 0.81
Symbol MRR: 0.38
File Hit@1: 0.50
File Hit@5: 0.94
File MRR: 0.65
Partial file hits: 0.13
Avg latency: 46ms
```

Symbol mode:

```text
Mode: symbol
Questions: 16
Symbol Hit@1: 0.69
Symbol Hit@5: 0.88
Symbol MRR: 0.76
File Hit@1: 0.75
File Hit@5: 1.00
File MRR: 0.85
Partial file hits: 0.13
Avg latency: 222ms
```

Hybrid mode after SQLAlchemy fixes:

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
Avg latency: 247ms
```

Hybrid mode after adversarial fixes, latest run:

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
Avg latency: 434ms
```

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 16 friendly SQLAlchemy benchmark rows. The structured queries use explicit owner/API terms such as `Connection.execute`, `Session.commit`, `Session.execute`, `MetaData.create_all`, `SQLCompiler.visit_select`, `TypeDecorator.process_bind_param`, `AsyncSession.execute`, `AsyncConnection.run_sync`, and `QueuePool._do_get`.

Index:

```text
node dist/cli.js index /Users/juan/Repos/sqlalchemy --source-only --index-path /tmp/agent-index-sqlalchemy-structured.sqlite
Indexed 221 files, 10579 symbols, 10579 chunks, 35475 edges at /tmp/agent-index-sqlalchemy-structured.sqlite (mode: source-only)
```

Structured benchmark:

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
Avg latency: 264ms
rg-style File Hit@1: 0.31
rg-style File Hit@5: 0.69
rg-style File MRR: 0.47
rg-style Avg latency: 111ms

Misses: none
```

Interpretation: SQLAlchemy is a strong structured-agent result because the corpus has dense public APIs and many overloaded words: `execute`, `select`, `bind`, `compile`, `connection`, `session`, and `event`. The rg-style baseline over the same terms often finds related files, but top-one and top-five file recall are much weaker than structured `agent-index`. Dotted owner/API terms are doing real work here by anchoring broad vocabulary to exact symbols and edit locations.

Adversarial hybrid after fixes:

```text
Mode: hybrid
Questions: 13
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 418ms
```

## Before And After

Initial hybrid result on the first SQLAlchemy golden set:

```text
Symbol Hit@1: 0.63
Symbol Hit@5: 0.88
File Hit@1: 0.81
File Hit@5: 0.94
```

After source-auditing ambiguous labels for `registry.generate_base` and `SQLCompiler._compose_select_body`:

```text
Symbol Hit@1: 0.69
Symbol Hit@5: 0.94
File Hit@1: 0.81
File Hit@5: 0.94
```

After execution/factory intent fixes and overload-result dedupe:

```text
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
```

Initial adversarial hybrid result:

```text
Symbol Hit@1: 0.54
Symbol Hit@5: 0.85
File Hit@1: 0.69
File Hit@5: 0.85
```

After guarded bind-parameter, URL-parse, exact-scalar, engine-disposal, and event-key-listener intents:

```text
Symbol Hit@1: 0.77
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
```

After the current owner/action repair pass:

```text
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
```

This pass fixed the stale-doc mismatch found during rerun: the main SQLAlchemy set initially reran at Symbol Hit@1 `0.63`, not the saturated value recorded above. The fixes that restored saturation were test-first and targeted the actual misses:

- public `create_<object>` factories over internal create helpers;
- compiler visitor methods for render-node wording, narrowed so compile-object and bind-parameter questions do not over-trigger;
- `sync` / `synchronous` token equivalence;
- public action APIs such as `inspect` and `listen`;
- template-method actions on explicitly named compound owners such as `QueuePool._do_get`;
- bind-parameter constructor and compiler ordering;
- bind resolution, loader-option, and transaction-begin intent.

## Concrete Examples

### Good: `select()` Construction

Question:

```text
where does SQLAlchemy construct a Select statement from columns entities or ORM classes?
```

Before the fix, `Select.from_statement` and `Select.selected_columns` outranked the public `select()` constructor. After adding the guarded factory-constructor intent, `select` ranks first with:

```text
factory constructor intent
```

The debug output also exposed an overload usability issue: multiple `select` overloads could fill the top five. Query results now dedupe by file and qualified symbol, keeping the highest-ranked copy.

### Good: Sync Versus Async Execution

Question:

```text
where does SQLAlchemy Session execute ORM statements with bind arguments and execution options?
```

The first execution-action fix over-boosted `AsyncSession.execute`. A regression test now keeps execution ranking scoped: async methods need async wording, while plain `Session` questions prefer `Session.execute`.

### Good: Bind Parameter Wording

Question:

```text
where does SQLAlchemy create a bind parameter expression object with key value type callable expanding and literal_execute options?
```

The adversarial wording split `literal_execute` into `literal` and `execute`, which initially triggered the generic execution-action rule and ranked `Session.execute` first. Bind-parameter questions now block that execution rule and use a guarded bind-parameter intent.

### Good: Event Registry Internals

Question:

```text
where does SQLAlchemy event registry attach an event key listener with once named retval propagate insert and wrapper options?
```

The first hybrid result returned the public `listen` API and broad event classes before `_EventKey.listen`. The event-key listener intent now prefers the registry method only when the query names event keys or registry attachment.

### Good: Main Action Over Supporting Words

Question:

```text
where does SQLAlchemy Connection begin a transaction and return a RootTransaction for commit or rollback?
```

The miss ranked `RootTransaction._do_commit` first because commit/rollback appeared in the question. The transaction-begin intent now treats those as supporting words and ranks `Connection.begin` first when the action is beginning a transaction.

### Good: Declarative Base Factory

Question:

```text
where does SQLAlchemy create a declarative base class from a registry with metadata and constructor options?
```

The source audit showed that both `declarative_base` and `registry.generate_base` are valid answers. The latter is the implementation method used by the public function, so the benchmark accepts both.

### Good: Relationship Constructor

Question:

```text
where does SQLAlchemy define the relationship constructor for ORM attributes with secondary joins back_populates cascade and loader options?
```

A legacy adversarial rerun after the structured-agent work ranked `RelationshipProperty.__init__` first and the public `relationship()` helper second. The fix treats `relationship` as a guarded factory-constructor object, so public factory wording now ranks `relationship` first while preserving explicit `__init__` lookups elsewhere.

## Surprising Findings

- Overloads are a user-facing retrieval problem, not only an extraction detail. Returning five copies of `select` made debug output much less useful even when the top symbol was correct.
- Execution queries are easy to over-broaden because `execution_options` contains the same lexical stem as `execute`. The rule needs action wording, not just token overlap.
- Async wrappers are close enough to sync APIs that intent rules need explicit scope. A plain `Session.execute` question should not prefer `AsyncSession.execute`.
- Source audit matters even in mature APIs. `registry.generate_base` and `_compose_select_body` are source-valid answers that the original expected list was too narrow to admit.
- Query tokenization can create false action words. `literal_execute` produced an `execute` token, which is correct linguistically but wrong for statement-execution intent.
- Some public APIs and internal registry methods are both legitimate navigation points. Adversarial questions need wording precise enough to identify which layer is expected.

## Remaining Risk

Both SQLAlchemy sets are now saturated. This is useful dogfood evidence, but the next pressure should come from a different domain or an even larger adversarial set that includes dialect-specific behavior and schema reflection.
