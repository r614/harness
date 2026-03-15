---
name: autoresearch-create
description: Set up and run an autonomous experiment loop for a repo-local optimization target. Use when asked to improve a measurable metric iteratively with UI, git logging, and resumable session files.
---

# Autoresearch

Use this skill to set up a repo-local optimization loop that measures a benchmark, keeps wins, and discards regressions.

## Tools

- `init_experiment` — initialize the session name, primary metric, unit, and direction
- `run_experiment` — run the benchmark command, capture output, time it, and run `autoresearch.checks.sh` when present
- `log_experiment` — record the result, update the widget, and auto-commit `keep` results

## Workflow

1. Ask for or infer:
   - optimization goal
   - benchmark command
   - primary metric and whether lower/higher is better
   - files in scope
   - constraints
2. Create a branch for the session, for example:
   - `git checkout -b autoresearch/<goal>-<date>`
3. Read the relevant code before proposing benchmark changes.
4. Write `autoresearch.md` with:
   - objective
   - metric definition
   - how to run the benchmark
   - files in scope
   - off-limits files
   - constraints
   - what has been tried

   Use this structure:

   ```markdown
   # Autoresearch: <goal>

   ## Objective
   <what is being optimized and why>

   ## Metrics
   - Primary: <name> (<unit>, lower/higher is better)
   - Secondary: <optional metrics>

   ## How to Run
   `./autoresearch.sh`

   ## Files in Scope
   - <path> — <why it matters>

   ## Off Limits
   - <path or category>

   ## Constraints
   - <hard rules>

   ## What's Been Tried
   - baseline captured
   ```

5. Write `autoresearch.sh` as a fast benchmark wrapper using `set -euo pipefail`.

   Preferred shape:

   ```bash
   #!/bin/bash
   set -euo pipefail
   # fast prechecks here
   # run benchmark here
   # emit parseable metric lines if useful
   # METRIC seconds=12.34
   ```

6. If correctness checks are required, write `autoresearch.checks.sh` using `set -euo pipefail`.

   Preferred shape:

   ```bash
   #!/bin/bash
   set -euo pipefail
   # tests, typecheck, lint, etc.
   ```
7. Call `init_experiment`.
8. Run the baseline with `run_experiment`.
9. Call `log_experiment`.
10. Continue the loop until interrupted.

## Ideas backlog

When you discover a promising path that you are not pursuing immediately, record it in `autoresearch.ideas.md`.

- You can pass an `idea` string to `log_experiment` to append it automatically.
- Periodically prune stale or already-tried entries.
- Use `/autoresearch-ideas-prune item one,item two` to remove ideas that have already been explored.

Keep ideas short and actionable, for example:

- reuse parser objects across runs
- batch disk reads before parsing
- move serialization off the hot path

## Keep / discard rules

- `keep` only when the **primary metric** improves.
- `discard` when the primary metric is worse or unchanged.
- `crash` when the benchmark fails or times out.
- `checks_failed` when the benchmark passes but `autoresearch.checks.sh` fails.

## Git rules

- Let `log_experiment` handle the commit for `keep` results.
- Do not make a manual keep-commit before `log_experiment`.
- For discarded or failed runs, revert working changes before the next attempt.
- Prefer `log_experiment` with `revertWorkingTree: true` for discard/crash/checks_failed when you want the tool to reset the worktree immediately.

## Session files

Keep these files up to date so a later agent can resume safely:

- `autoresearch.md`
- `autoresearch.sh`
- `autoresearch.jsonl`
- optional: `autoresearch.checks.sh`
- optional: `autoresearch.ideas.md`

## Constraints

- Prefer small, measurable changes.
- Do not broaden scope beyond the benchmark target.
- Avoid overfitting or benchmark cheating.
- Update `autoresearch.md` as useful findings accumulate.
