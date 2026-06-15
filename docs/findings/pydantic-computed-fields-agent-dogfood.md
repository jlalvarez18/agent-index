# Pydantic Computed Fields Agent Dogfood Trial

Date: 2026-06-15

## Goal

Run a warm traced dogfood comparison on Pydantic using the new trace lesson
workflow from the start.

Question:

```text
Can agent-index help an agent navigate a dense serialization task faster or with
fewer wasted searches than an rg-first workflow?
```

Task prompt:

```text
A model serialization option works for normal fields but is awkward to verify
around computed fields. Add focused coverage proving that computed fields are
excluded when the explicit computed-field exclusion flag is enabled, while
normal fields, aliases, JSON mode, and JSON string output keep their existing
behavior.
```

## Setup

Original repo:

```text
/Users/juan/Repos/pydantic
```

The original checkout was not modified. Two fresh temp copies were created:

```text
/tmp/pydantic-agent-index-trial
/tmp/pydantic-rg-trial
```

Agent-index setup:

```bash
npm run build
node dist/cli.js index /tmp/pydantic-agent-index-trial \
  --index-path /tmp/pydantic-agent-index.sqlite
```

Index result:

```text
Indexed 404 files, 8423 symbols, 8423 chunks, 36658 edges at /tmp/pydantic-agent-index.sqlite (mode: all-files)
```

Index time:

```text
3.832s total
```

Indexing was measured as setup cost, not agent implementation time.

## Agent A: agent-index First

Worker:

```text
Pauli
```

Scope:

```text
/tmp/pydantic-agent-index-trial
/tmp/pydantic-computed-fields-agent-index-trace.jsonl
```

Commands:

```bash
node /Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/pydantic-agent-index-trial \
  --index /tmp/pydantic-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/pydantic-computed-fields-agent-index-trace.jsonl \
  --trace-task pydantic-computed-fields-serialization \
  --term computed \
  --term fields \
  --term serialization \
  --term exclude \
  --term dump \
  --term json \
  --role source \
  --kind function \
  --kind method \
  --path pydantic \
  --limit 10
```

```bash
node /Users/juan/Repos/agent-index/dist/cli.js query \
  --target /tmp/pydantic-agent-index-trial \
  --index /tmp/pydantic-agent-index.sqlite \
  --mode hybrid \
  --trace /tmp/pydantic-computed-fields-agent-index-trace.jsonl \
  --trace-task pydantic-computed-fields-serialization \
  --term computed \
  --term fields \
  --term exclude \
  --term model_dump \
  --term model_dump_json \
  --role test \
  --kind function \
  --path tests \
  --limit 10
```

Results:

- First useful implementation hit: rank 5,
  `pydantic/main.py::BaseModel.model_dump_json`.
- First useful test hit: rank 1,
  `tests/test_computed_fields.py::test_computed_fields_exclude`.
- Agent-index query count: 2.
- `rg` fallback count: 0.
- Invalid command count: 0.
- Sandbox retry count: 1, because `uv` needed access to
  `/Users/juan/.cache/uv`.
- Reported wall time excluding warm index time: about 10 minutes.

Trace report after annotation and lesson note:

```text
Trace events: 3
Query events: 2
Avg query latency: 290ms
First useful hit rank: 5
rg fallbacks: 0
Bad results: 0
Unreviewed queries: 0
Code changes: 0
Verifications: 0
Lessons: 1
Elapsed wall time: 233.6s

Query path:
#1 useful rank=5 query="computed fields serialization exclude dump json pydantic" top=computed_field pydantic/fields.py:1693
#2 useful rank=1 query="computed fields exclude model_dump model_dump_json tests" top=test_computed_fields_exclude tests/test_computed_fields.py:844

Lessons learned:
- Agent-index found the exact computed-field test neighborhood at rank 1, but the behavior-shaped source query landed on decorator/core-schema results before BaseModel serialization methods. Evidence: Agent A used 2 queries, 0 rg fallbacks, implementation rank 5, test rank 1, and took about 10 minutes; rg used 2 searches and took about 6 minutes.

Recommended next step:
- For serialization dogfood tasks, keep behavior-shaped queries but add public API owner terms such as BaseModel or exact option names after the first pass.
```

## Agent B: rg First

Worker:

```text
Einstein
```

Scope:

```text
/tmp/pydantic-rg-trial
```

Results:

- First useful implementation location:
  `pydantic/main.py::BaseModel.model_dump`.
- First useful test location:
  `tests/test_computed_fields.py::test_computed_fields_exclude`.
- `rg` search count: 2.
- Invalid command count: 0.
- Sandbox retry count: 1, because `uv` needed access to
  `/Users/juan/.cache/uv`.
- Reported wall time: about 6 minutes.

## Code Changes

Both workers made test-only changes in `tests/test_computed_fields.py`.

Agent A added coverage using an aliased tuple field:

```python
def test_exclude_computed_fields_preserves_regular_field_serialization() -> None:
    class Model(BaseModel):
        numbers: tuple[int, int] = Field(alias='the_numbers')

        @computed_field(alias='the_total')
        def total(self) -> int:
            return sum(self.numbers)

    m = Model(the_numbers=(1, 2))
    assert m.model_dump() == {'numbers': (1, 2), 'total': 3}
    assert m.model_dump(exclude_computed_fields=True) == {'numbers': (1, 2)}
    assert m.model_dump(by_alias=True) == {'the_numbers': (1, 2), 'the_total': 3}
    assert m.model_dump(by_alias=True, exclude_computed_fields=True) == {'the_numbers': (1, 2)}
    assert m.model_dump(mode='json', by_alias=True) == {'the_numbers': [1, 2], 'the_total': 3}
    assert m.model_dump(mode='json', by_alias=True, exclude_computed_fields=True) == {'the_numbers': [1, 2]}
    assert m.model_dump_json(by_alias=True) == '{"the_numbers":[1,2],"the_total":3}'
    assert m.model_dump_json(by_alias=True, exclude_computed_fields=True) == '{"the_numbers":[1,2]}'
```

Agent B added similar coverage using an aliased integer plus datetime field:

```python
def test_exclude_computed_fields_preserves_normal_field_serialization_options() -> None:
    class Model(BaseModel):
        value: int = Field(alias='aliasValue')
        when: datetime

        @computed_field(alias='computedAlias')
        def double(self) -> int:
            return self.value * 2

    when = datetime(2032, 6, 1, 12, 13, 14)
    m = Model(aliasValue=4, when=when)

    assert m.model_dump() == {'value': 4, 'when': when, 'double': 8}
    assert m.model_dump(exclude_computed_fields=True) == {'value': 4, 'when': when}
    assert m.model_dump(by_alias=True, exclude_computed_fields=True) == {'aliasValue': 4, 'when': when}
    assert m.model_dump(mode='json', exclude_computed_fields=True) == {'value': 4, 'when': '2032-06-01T12:13:14'}
    assert m.model_dump_json(exclude_computed_fields=True) == '{"value":4,"when":"2032-06-01T12:13:14"}'
```

Both are valid focused coverage. Agent A's version checks alias behavior both
with and without `exclude_computed_fields=True`; Agent B's version checks a more
realistic JSON conversion type.

## Independent Verification

Agent-index copy:

```bash
cd /tmp/pydantic-agent-index-trial
uv run pytest tests/test_computed_fields.py -q
```

Result:

```text
34 passed, 2 skipped, 2 xfailed
```

rg copy:

```bash
cd /tmp/pydantic-rg-trial
uv run pytest tests/test_computed_fields.py -q
```

Result:

```text
34 passed, 2 skipped, 2 xfailed
```

Both first attempts hit the sandbox restriction on `/Users/juan/.cache/uv` and
passed after rerunning with approval. That is target-repo tooling friction, not a
Pydantic test failure.

## Assessment

This trial is a modest win for `rg` on elapsed time, and a useful but not
decisive result for `agent-index`.

What worked for `agent-index`:

- It found the exact test neighborhood at rank 1.
- It completed the task without any `rg` fallback.
- It produced a traceable query path and first-useful-rank evidence.
- The source query still surfaced the public serialization path in the top five.

What did not work cleanly:

- The behavior-shaped source query ranked `computed_field` and core-schema
  serialization symbols above `BaseModel.model_dump_json`.
- The worker took about 10 minutes versus the rg worker's about 6 minutes.
- This was partly a coverage task, so exact text search was naturally strong
  once the phrase `exclude_computed_fields` was known.

What worked for `rg`:

- Two searches found the relevant implementation and test area quickly.
- The task was already close to existing test names, which made text search a
  strong baseline.

Conclusion:

```text
For this Pydantic coverage task, agent-index helped most with test-location
navigation, but rg was faster overall because the behavior already had an exact
option name in source and tests. The useful product lesson is query shaping:
behavior-shaped terms are good first-pass exploration, but public API owner terms
such as BaseModel and exact option names should be added when the agent is
looking for serialization entrypoints.
```

## Final Test Summary

What we tested:

```text
A warm traced agent-index workflow versus an rg-first workflow on a Pydantic
computed-field serialization coverage task.
```

Result:

```text
Both agents added valid test-only coverage and passed the focused Pydantic test
file. rg was faster by reported wall time, while agent-index required no fallback
and found the exact test function at rank 1.
```

Lessons learned:

```text
agent-index is useful for locating test neighborhoods in dense libraries, but
source navigation can still drift toward decorators or lower-level schema helpers
when the query lacks public API owner terms.
```

Recommended next step:

```text
Run another warm traced trial on a task where exact option names are not already
present in nearby tests, or update the using-agent-index skill to teach a
two-pass pattern: behavior terms first, then discovered public API owner terms.
```
