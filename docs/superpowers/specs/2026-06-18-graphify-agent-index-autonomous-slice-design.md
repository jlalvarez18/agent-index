# Graphify vs agent-index Autonomous Slice Design

## Goal

Run a cheap, real-world pilot that compares how well agents do actual coding
work when they have one of three tool conditions:

1. Graphify available.
2. agent-index available.
3. No special code-navigation tool available.

The pilot is intentionally about autonomous agent behavior, not handcrafted
retrieval scripts. The question is:

```text
Given the same repository snapshot and task, does a coding agent complete the
work better, faster, or with less context when it has Graphify or agent-index?
```

Think of this as a road test rather than an engine test. Each tool is evaluated
by whether it helps the agent drive to a correct fix or explanation under normal
working conditions.

## Scope

The first slice includes:

- 8 to 12 real-world tasks.
- Three autonomous runs per task, one per tool condition.
- Existing local repositories already used by the navigation suite when possible.
- Bugfix, feature enhancement, code explanation, and test-discovery tasks.
- Transcript and artifact capture for later analysis.
- Human review of task success and quality.
- Indexing cost measurement for Graphify and agent-index.

The first slice excludes:

- Setup complexity scoring.
- Installer, onboarding, or harness polish.
- Optimized rg baselines.
- Scripted retrieval workflows.
- Statistical claims stronger than "pilot evidence."
- Full automation of correctness judgment.

## Conditions

Each task runs in three isolated worktrees or fresh checkouts at the same commit.

```text
graphify
  Agent receives the task, normal shell/editor tools, and instructions that
  Graphify is available for codebase navigation.

agent-index
  Agent receives the task, normal shell/editor tools, and instructions that
  agent-index is available for codebase navigation.

no-special-tool
  Agent receives the task and normal shell/editor tools only.
```

All conditions get the same task prompt, time budget, repo snapshot, and success
criteria. The no-special-tool condition may still use ordinary tools such as
`rg`, file reads, package scripts, and tests.

## Task Mix

Use a small but varied set so the pilot exposes where each tool helps or hurts.

Recommended first slice:

- 2 behavior-only bugfix tasks where the prompt does not leak target file paths
  or exact symbol names.
- 2 bugfix tasks that require source plus tests.
- 2 feature-enhancement tasks crossing multiple modules.
- 1 or 2 code-explanation tasks with no edit required.
- 1 test-discovery task.
- 1 large or noisy repository task.
- 1 incremental follow-up after a small patch or changed file.

Prefer tasks from repos already represented in `benchmarks/navigation/` because
the project has known expected files, symbols, and tests for many of them.

Candidate starting repos:

- Click: color/default behavior bugfix.
- HTTPX: redirect history behavior and tests.
- Pydantic: computed fields serialization path.
- TanStack Query: infinite query flow across React and core packages.
- Django or SQLAlchemy: larger Python behavior change.
- Vite, Axios, or Redux Toolkit: TypeScript feature or bugfix path.
- A Graphify task can be included, but it should not dominate the slice.

## Run Protocol

For each task and condition:

1. Prepare a clean worktree or checkout at the selected commit.
2. Run a short tool preflight for Graphify and agent-index to capture the exact
   commands exposed by the installed versions.
3. Build any required index before starting the agent timer.
4. Record indexing wall time, output size, indexed file count, and indexed
   symbol/node count when available.
5. Start the autonomous agent with the condition-specific instructions.
6. Let the agent work until it finishes, times out, or asks for impossible
   external input.
7. Capture the transcript, commands, files read, files edited, tests run, final
   answer, and git diff.
8. Reset or discard the worktree before the next condition.

Index build time is measured separately from task time. This prevents a slow
initial index from hiding retrieval quality while still keeping indexing cost
visible.

Pilot defaults:

- 10 tasks.
- 30 autonomous runs total.
- 30 minute wall-clock cap per run.
- One run per task per condition.
- Explanation-only tasks require file and line citations in the final answer.
- Human review is the source of truth for pass, partial, or fail.
- The autonomous-agent runner should be whichever local runner can provide the
  most complete transcript and command log with the least harness work. If two
  runners are equally easy, prefer Codex because this repository is already
  maintained through Codex-oriented workflows.

## Metrics

Primary outcome:

```text
success: fixed or explained the task correctly under the stated criteria
```

Secondary outcomes:

- Time to first useful file.
- Time to first relevant edit.
- Time to final answer.
- Files opened.
- Approximate context read, measured by file/snippet character count and token
  estimate.
- Tool calls made.
- Whether the special tool was used.
- Whether the special tool produced useful context before broad search.
- Tests run.
- Test result.
- Diff size and locality.
- Reviewer quality score.

Indexing outcomes for Graphify and agent-index:

- Full index wall time.
- Incremental reindex wall time after a small edit, when supported.
- Index artifact size.
- Indexed files.
- Indexed symbols, nodes, or graph records.

## Review Rubric

Each completed run gets a short review record:

```text
success: pass | partial | fail
quality: 1-5
firstUsefulFile: path or null
firstUsefulTool: graphify | agent-index | rg | file-read | other | null
specialToolHelped: yes | no | ignored | misleading
tests: passed | failed | not-run | not-applicable
failureMode: wrong-file | over-read | bad-edit | test-gap | timeout | tool-ignored | tool-misled | other
notes: short reviewer explanation
```

Quality should judge whether the agent made a minimal, correct change or gave a
grounded explanation. A run can find the right file quickly and still fail if it
edits poorly.

## Fairness Rules

- The task prompt is identical across conditions except for tool availability.
- Tool instructions may explain how to call the available tool, but may not
  include task-specific file paths or symbols.
- Expected files and symbols are never shown to the agent.
- Each condition starts from the same repository state.
- The no-special-tool agent is not blocked from using `rg` or tests.
- A task that needs internet access, credentials, or unavailable services is out
  of scope for the first slice.
- Pilot results are reported as exploratory, not as statistically settled.

## Artifacts

Store one directory per run:

```text
artifacts/autonomous-comparison/<task-id>/<condition>/
  transcript.md
  commands.jsonl
  files-read.json
  diff.patch
  tests.txt
  metrics.json
  review.md
```

Store one task definition per task:

```text
benchmarks/autonomous/<task-id>.json
```

Suggested task definition shape:

```json
{
  "id": "click-color-default-behavior",
  "repo": "click",
  "commit": "commit-sha",
  "kind": "bugfix",
  "prompt": "Find and fix where Click decides default color behavior from environment state.",
  "successCriteria": [
    "NO_COLOR disables color by default.",
    "Explicit color=True still wins.",
    "Relevant tests pass."
  ],
  "expectedEvidence": {
    "files": ["src/click/globals.py", "tests/test_globals.py"],
    "symbols": ["resolve_color_default"]
  },
  "testCommand": "pytest tests/test_globals.py"
}
```

`expectedEvidence` is for reviewers and analysis only. The agent never sees it.

## Initial Reporting

The first report should avoid a single winner headline unless the evidence is
overwhelming. It should group results by scenario:

- Where Graphify helped.
- Where agent-index helped.
- Where no-special-tool matched or beat both.
- Where tools were ignored.
- Where tools misled the agent.
- What task types need repeated trials next.

Useful first-slice summary:

```text
tasks: 10
runs: 30
success by condition
median time to first useful file by condition
median files opened by condition
median context estimate by condition
special-tool-used rate
special-tool-helped rate
notable failure modes
recommended repeated-trial subset
```

## Pilot Batch

Start with these 10 tasks unless preflight shows a repo is unavailable locally:

- Click color/default behavior bugfix.
- HTTPX redirect history bugfix plus tests.
- Pydantic computed fields serialization explanation or bugfix.
- TanStack Query infinite query feature tracing.
- Rich `print_json(file=...)` feature behavior.
- SQLAlchemy rowcount preservation bugfix.
- FastAPI response serialization path explanation.
- Vite environment prefix behavior.
- Redux Toolkit create-slice bugfix path.
- One Graphify bugfix or explanation task, included as a sanity check but not
  treated as representative by itself.

If a repo is missing or too expensive to prepare, replace it with a task from
the existing navigation suite that has known expected files, symbols, and tests.
