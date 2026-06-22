# Autonomous Comparison Pilot

This pilot compares three autonomous agent conditions on the same real-world tasks:

- Graphify available.
- agent-index available.
- No special code-navigation tool available.

The harness prepares task prompts and review templates for each condition. It does
not run the agent and does not script search steps. Treat it like handing three
drivers the same destination and different maps, then recording what actually
happened on the trip.

## Telemetry Protocol

New run packets include a `telemetry` object in `review-template.json`. The
template is intentionally file-based and portable: it records task metadata,
generated artifact paths, and prepare-time timestamps without depending on
private agent UI internals.

Keep the legacy top-level metrics (`wallTimeMinutes`, `agentTurns`,
`toolCalls`, `filesOpened`, `contextTokens`, and `outputTokens`) for backwards
compatibility. For new runs, also fill `telemetry.metrics` whenever a value can
be substantiated:

```json
{
  "telemetry": {
    "schemaVersion": 1,
    "metrics": {
      "wallTimeSeconds": {
        "value": 720,
        "source": "measured",
        "method": "coordinator stopwatch"
      },
      "contextTokens": {
        "value": 1200,
        "source": "estimated",
        "method": "transcript characters divided by four"
      }
    }
  }
}
```

Use `source: "measured"` for values derived from a clock, filesystem stat,
command transcript, tool log, or explicit token counter. Use
`source: "estimated"` only when an exact value is unavailable, and record the
method. The validator rejects estimated telemetry metrics without a method, so a
summary reader can tell whether a number came from an instrument or a judgment
call.

When `agent-index autonomous-summary` loads reviews, it annotates the in-memory
summary with `telemetry.artifacts.reviewPath`,
`telemetry.timestamps.reviewWrittenAt`, and validation timestamps from the local
filesystem. Existing `review.json` files that lack `telemetry` still load; their
legacy numeric metrics are counted as estimated in summary confidence output.

## Prepare A Run Packet

Build the CLI, list the pilot tasks, then prepare one task and condition:

```bash
npm run build
node dist/cli.js autonomous-list benchmarks/autonomous/graphify-agent-index-pilot.json
node dist/cli.js autonomous-prepare benchmarks/autonomous/graphify-agent-index-pilot.json \
  --task click-color-default-behavior \
  --condition agent-index \
  --artifacts-dir /tmp/agent-index-autonomous-artifacts
```

Run the generated packet in a clean checkout of the target repository. Give the
autonomous agent the generated `prompt.md` as its task prompt, make only the
condition's tool available, and let the agent choose its own navigation and edit
strategy within the time limit.

Use the same target repository commit for all three conditions. Before each run,
check out that commit and verify the worktree is clean. Record the target SHA in
`review.json` `notes`, or in `indexing.notes` when the note is about tool setup.

Use the same task text and success criteria for all three conditions. The
generated `prompt.md` includes condition-specific tool instructions, so the only
intended prompt difference is the Tool Condition section:

- `graphify`: Graphify is available and agent-index is not.
- `agent-index`: agent-index is available and Graphify is not.
- `no-special-tool`: neither Graphify nor agent-index is available; normal shell
  and editor tools are still allowed.

## Tool Setup Protocol

Prepare any tool indexes before starting the autonomous task timer. Measure that
setup separately in the `review.json` `indexing` block, not in
`wallTimeMinutes`.

Indexes must be task-neutral: build them from the whole checked-out target
snapshot, without narrowing by task-specific files, symbols, expected evidence,
or likely edit locations. Use the same cold or warm index policy across tool
conditions and record the policy in `indexing.notes`.

For example, if the agent-index run starts from a fresh full index, the Graphify
run should use the comparable cold-start setup policy for that task. If a warm
index is reused, record that consistently for both tool conditions.

## Dependency Setup Protocol

Prepare target-repository dependencies before starting the autonomous task
timer. Dependency setup is part of the trial preflight, not part of the
navigation/editing run. Use the same cache, network, and permission policy for
all three conditions.

For example, if a pnpm workspace needs to hydrate `node_modules` from a warm
local store, do that for the Graphify, agent-index, and no-special-tool
checkouts before dispatching agents. Record the setup in `review.json`
`dependencySetup`, including whether packages came from a warm local cache or
required network access. Do not let one condition run tests with privileged cache
access while another condition is scored as `not-run` for the same setup issue.

Before dispatch, run a cheap neutral check that the target test runner starts,
such as `pytest --version`, `pnpm --version`, or a test-list command. Avoid
task-specific test selection during preflight unless the same command is used
for every condition and recorded as setup verification rather than autonomous
task work.

## Record A Review

After the run, copy `review-template.json` to `review.json` in the run directory
and fill in the observed outcome. Include indexing metrics for tool conditions
when you can measure them without muddying the autonomous run timer.

```json
{
  "taskId": "click-color-default-behavior",
  "condition": "agent-index",
  "success": "pass",
  "quality": 5,
  "firstUsefulFile": "src/click/globals.py",
  "firstUsefulTool": "agent-index",
  "specialToolHelped": "yes",
  "tests": "passed",
  "failureMode": null,
  "indexing": {
    "fullIndexWallTimeSeconds": 18,
    "indexArtifactBytes": 1048576,
    "indexedFiles": 142,
    "indexedSymbols": 3081,
    "notes": "Measured before starting the autonomous run timer. Built a cold task-neutral index from the full target snapshot at commit 9f4c2d1."
  },
  "dependencySetup": {
    "dependencySetupWallTimeSeconds": 11,
    "dependencyArtifactBytes": 52428800,
    "notes": "Measured before starting the autonomous run timer. Installed dependencies from a warm local package cache with network disabled."
  },
  "coordinatorVerification": {
    "tests": "passed",
    "command": "pytest tests/test_globals.py",
    "notes": "Coordinator reran the same focused tests after normalizing dependency setup across all conditions."
  },
  "telemetry": {
    "schemaVersion": 1,
    "metadata": {
      "taskId": "click-color-default-behavior",
      "condition": "agent-index",
      "repo": "click",
      "taskKind": "bugfix",
      "commit": "9f4c2d1",
      "testCommand": "pytest tests/test_globals.py"
    },
    "artifacts": {
      "runDir": "/tmp/agent-index-autonomous-artifacts/click-color-default-behavior/agent-index",
      "promptPath": "/tmp/agent-index-autonomous-artifacts/click-color-default-behavior/agent-index/prompt.md",
      "reviewTemplatePath": "/tmp/agent-index-autonomous-artifacts/click-color-default-behavior/agent-index/review-template.json",
      "generatedPaths": [
        "/tmp/agent-index-autonomous-artifacts/click-color-default-behavior/agent-index/prompt.md",
        "/tmp/agent-index-autonomous-artifacts/click-color-default-behavior/agent-index/review-template.json"
      ]
    },
    "timestamps": {
      "runStartedAt": "2026-06-22T12:05:00.000Z",
      "runEndedAt": "2026-06-22T12:19:00.000Z"
    },
    "metrics": {
      "wallTimeSeconds": {
        "value": 840,
        "source": "measured",
        "method": "coordinator stopwatch from prompt handoff to final answer"
      },
      "agentTurns": {
        "value": 8,
        "source": "measured",
        "method": "transcript assistant-turn count"
      },
      "toolCalls": {
        "value": 22,
        "source": "measured",
        "method": "transcript tool-call count"
      },
      "filesOpened": {
        "value": 5,
        "source": "measured",
        "method": "distinct repository file-read/edit paths in transcript"
      },
      "contextTokens": {
        "value": 1200,
        "source": "estimated",
        "method": "transcript characters divided by four because exact UI counter was unavailable"
      },
      "outputTokens": {
        "value": 650,
        "source": "estimated",
        "method": "assistant-output characters divided by four because exact UI counter was unavailable"
      }
    },
    "indexSetup": {
      "fullIndexWallTimeSeconds": {
        "value": 18,
        "source": "measured",
        "method": "time command"
      },
      "indexArtifactBytes": {
        "value": 1048576,
        "source": "measured",
        "method": "fs.stat on generated SQLite artifact"
      }
    },
    "testCommands": [
      {
        "command": "pytest tests/test_globals.py",
        "outcome": "passed",
        "exitCode": 0,
        "source": "measured",
        "startedAt": "2026-06-22T12:18:00.000Z",
        "endedAt": "2026-06-22T12:18:20.000Z"
      }
    ]
  },
  "wallTimeMinutes": 14,
  "agentTurns": 8,
  "toolCalls": 22,
  "filesOpened": 5,
  "contextTokens": 1200,
  "outputTokens": 650,
  "notes": "Target commit 9f4c2d1. The agent used agent-index first, found the default-color logic, patched behavior, and ran focused tests."
}
```

For the no-special-tool condition, leave `indexing` absent unless there is a
separate setup cost worth recording in `notes`.

Use `tests` for what the autonomous agent actually ran during its task. If the
coordinator later reruns tests because setup was uneven, keep the agent's
original test outcome in `tests` and record the later result in
`coordinatorVerification`. When reporting results, call out coordinator reruns
explicitly.

Record benchmark measurements consistently:

- `wallTimeMinutes`: elapsed wall-clock time from the agent receiving the prompt to its final answer.
- `agentTurns`: assistant turns in the autonomous run.
- `toolCalls`: total shell/file/edit/special-tool calls used by the agent.
- `filesOpened`: distinct repository files inspected by the agent, excluding generated artifacts.
- `contextTokens` and `outputTokens`: exact UI counters when available; otherwise estimates with matching `telemetry.metrics.*.method`.

For every new run, prefer `telemetry.metrics` as the source of truth and mirror
values into the legacy top-level fields for older scripts. If a field is present
only at the top level, summary output treats it as estimated because no
measurement provenance is available.

## Summarize Results

After `review.json` files exist under the artifacts directory, summarize the
completed runs:

```bash
node dist/cli.js autonomous-summary /tmp/agent-index-autonomous-artifacts
node dist/cli.js autonomous-summary /tmp/agent-index-autonomous-artifacts --json
```

Text summaries include telemetry confidence counts for each metric:

```text
agent-index: ... medianContextTokens=1200 medianOutputTokens=650 telemetry=wallTimeMinutes measured=1 estimated=0 missing=0; ... contextTokens measured=0 estimated=1 missing=0
```

The legacy medians continue to summarize all available values. The JSON summary
also includes `measuredMedians`, `estimatedMedians`, and `metricConfidence` so
reports can separate exact measurements from estimates.

Report results by scenario and condition. One run per task is useful qualitative
evidence about how agents behave, but it is not enough to claim statistical
dominance for any condition.
