# Autonomous Comparison Pilot

This pilot compares three autonomous agent conditions on the same real-world tasks:

- Graphify available.
- agent-index available.
- No special code-navigation tool available.

The harness prepares task prompts and review templates for each condition. It does
not run the agent and does not script search steps. Treat it like handing three
drivers the same destination and different maps, then recording what actually
happened on the trip.

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
  "wallTimeMinutes": 14,
  "filesOpened": 5,
  "contextTokens": 1200,
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

## Summarize Results

After `review.json` files exist under the artifacts directory, summarize the
completed runs:

```bash
node dist/cli.js autonomous-summary /tmp/agent-index-autonomous-artifacts
node dist/cli.js autonomous-summary /tmp/agent-index-autonomous-artifacts --json
```

Report results by scenario and condition. One run per task is useful qualitative
evidence about how agents behave, but it is not enough to claim statistical
dominance for any condition.
