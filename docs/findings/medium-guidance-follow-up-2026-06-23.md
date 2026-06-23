# Medium Guidance Follow-Up Benchmark

Date: 2026-06-23

Task: make medium-confidence `agent-index task --agent-guidance` output more
actionable so agents do not over-edit helper files after a weak first hit.

## Change

Medium-confidence guidance now:

- uses cautionary next-step text before editing;
- emits a source-focused follow-up `agent-index task` command;
- prefers a strong alternate implementation symbol from the implementation
  query when the top file is a helper or artifact;
- includes one path hint from the alternate implementation file when available.

## Click Smoke

Command:

```bash
node dist/cli.js task bugfix \
  "Find and fix where Click decides default color behavior from environment state. The fix should honor the standard environment signal for disabling color output while preserving explicit color enablement." \
  --target /Users/juan/Repos/click \
  --index-path /tmp/agent-index-medium-guidance-click.sqlite \
  --format compact \
  --agent-guidance
```

Initial guidance:

```text
Guidance: open-top-result confidence=medium
  open: src/click/testing.py:1
  why: source hit rank 1, evidence available, implementation query corroborated, related tests found, support/artifact path
  next: inspect only to rule out helper/artifact ownership; run the follow-up query before editing
```

Generated follow-up included:

```text
--term resolve_color_default --path globals --role source --kind function --kind method --kind class --limit 5 --agent-guidance
```

Follow-up result:

```text
Guidance: open-top-result confidence=high
  open: src/click/globals.py:55
```

Interpretation: this addresses the live A/B Click failure mode. The first hit is
still `testing.py`, but medium guidance now gives the agent a concrete
source-owner refinement that moves to `globals.py` before editing.

## Limit

This is a targeted benchmark smoke, not a fresh live-agent A/B run. It validates
that the generated medium-confidence command leads to the desired source owner
on the known Click helper-file case. A follow-up live run should verify whether
agents actually execute the command before editing.
