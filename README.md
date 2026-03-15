# Harness

Harness is a portable repo of skills, extensions, fixtures, and scripts for a personal Pi-style agent.

The repo is designed to be:

- cloneable onto any machine
- readable and editable as normal source
- safe to evolve through tests and PRs
- local-first for setup, with optional Railway/GitHub automation

## Use With Pi

Test it directly from git without installing:

```bash
pi -e git:github.com/r614/harness
```

Install it as a Pi package:

```bash
pi install git:github.com/r614/harness
```

After installation, Pi can load:

- package extensions from `extensions/`
- skills from `skills/`
- themes from `themes/`

Imported Pi-native capabilities currently include:

- `context`, `files`, `review`, `repo-operator`, `gmail-workspace`, `calendar-workspace`, and `browser-runtime` extensions
- `github`, `commit`, `summarize`, `native-web-search`, `browser`, `gmail`, `calendar`, and `web-browser` skills

## Real runtime workflows

- `repo-operator`: repo-scoped self-improvement workflow with policy checks, fixture-backed evals, and structured PR summaries
- `gmail-workspace`: real Gmail runtime path through local `gws` for search, thread read/summarize, reply draft creation, low-value mail classification, bounded archive handling, and unsubscribe preparation
- `calendar-workspace`: real Calendar runtime path through local `gws` for upcoming-event summaries plus approval-gated create/update flows
- `browser-runtime`: persistent local Chrome-backed browser sessions with structured actions for navigate, snapshot, click, fill, extract, screenshot, and assert

## Local Google Workspace setup

Harness shells out to the Google Workspace CLI for Gmail and Calendar operations.

- install `gws` locally
- authenticate it locally for the Google account you want Pi to use
- ensure `gws` is on `PATH`, or set `GWS_BIN` to the binary path

The command templates used for CLI execution live in `manifests/google-workspace.json`.

## Local browser runtime setup

Harness runs a persistent local browser daemon backed by Chrome DevTools Protocol.

Requirements:
- local Google Chrome or Chromium
- Chrome accessible via `HARNESS_CHROME_BIN`, `CHROME_BIN`, or the default macOS Chrome path

Persistent local state:
- profile dir: `tmp/browser-runtime/profile-default`
- screenshots: `tmp/browser-runtime/screenshots`
- daemon state: `tmp/browser-runtime/daemon.json`

Pi commands:
- `/browser-runtime-start`
- `/browser-runtime-status`
- `/browser-session { ... }`
- `/browser-action { ... }`

Example:

```bash
/browser-runtime-start
/browser-session {"sessionId":"default","url":"https://example.com"}
/browser-action {"sessionId":"default","action":"snapshot"}
/browser-action {"sessionId":"default","action":"assert","selector":"h1","textIncludes":"Example Domain"}
```

Approval-gated actions:
- risky `click`
- all `fill` / `type`

To execute a risky action, pass `"approved": true` after explicit user approval.

## Structure

- `skills/`: human-readable capability packs with `SKILL.md`
- `extensions/`: runtime extensions loaded by the agent
- `scripts/`: bootstrap, eval, validation, PR helper scripts, and runtime wrappers
- `evals/`: regression fixtures and expected outcomes
- `fixtures/`: sample inputs for local tests
- `manifests/`: explicit registries and policy boundaries
- `intercepted-commands/`: future local command wrappers; currently not part of the eval-covered workflow

## Attribution

Some packaged skills and extensions are adapted or vendored from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), which is licensed under Apache-2.0.

See:
- [NOTICE](NOTICE)
- [vendor/agent-stuff/LICENSE](vendor/agent-stuff/LICENSE)

## Quick Start

```bash
npm install
npm run validate
npm run evals
```

## Gmail runtime examples

Search threads:

```bash
/gmail-workspace {"kind":"gmail.search","query":"newer_than:7d","maxResults":5}
```

Draft a reply:

```bash
/gmail-workspace {"kind":"gmail.draftReply","threadId":"thread-123","body":"Thanks — I will send the draft by Friday."}
```

Classify low-value mail:

```bash
/gmail-workspace {"kind":"gmail.classifySlop","threadId":"thread-123"}
```

Prepare unsubscribe handling:

```bash
/gmail-workspace {"kind":"gmail.prepareUnsubscribe","threadId":"thread-123"}
```

## Calendar runtime examples

List upcoming events:

```bash
/calendar-workspace {"kind":"calendar.listUpcoming","timeMin":"2026-03-15T00:00:00Z","timeMax":"2026-04-15T00:00:00Z","maxResults":10}
```

Draft an event change:

```bash
/calendar-workspace {"kind":"calendar.draftEvent","summary":"Planning sync","start":"2026-03-15T15:00:00Z","end":"2026-03-15T15:30:00Z","attendees":["teammate@example.com"]}
```

Apply an approved draft:

```bash
/calendar-workspace {"kind":"calendar.applyDraft","approved":true,"eventDraft":{"summary":"Planning sync","start":"2026-03-15T15:00:00Z","end":"2026-03-15T15:30:00Z","attendees":["teammate@example.com"]}}
```

## Self-Improvement Workflow

### Policy boundary

Only change files under:

- `skills/`
- `extensions/`
- `evals/`
- `fixtures/`
- `manifests/`
- `scripts/`
- `README.md`

Never auto-merge. Every self-improvement PR requires human review.

### Run a self-improvement pass from Pi

1. Start Pi against this repo.
2. Use the `repo-operator` skill for repo-scoped changes.
3. Run `/self-improve-policy` to confirm allowed paths and required checks.
4. Make the smallest workflow-focused change.
5. Update fixtures and eval coverage with the change.
6. Run:

```bash
npm run validate
npm run evals
```

7. Generate a PR summary:

```bash
npm run self-improve -- \
  --title "Short change title" \
  --problem "Workflow gap being fixed"
```

8. If needed, pass explicit changed files and evidence:

```bash
npm run self-improve -- \
  --title "Short change title" \
  --problem "Workflow gap being fixed" \
  --files extensions/repo-operator.mjs,scripts/open-pr.mjs \
  --evidence "npm run validate" \
  --evidence "npm run evals"
```

9. Use `/prepare-self-improvement-pr` to get a PR-ready summary template.
10. Open a PR that includes:
   - problem statement
   - changed files
   - evidence
   - risk classification
   - required checks
   - rollback guidance
11. Wait for human review before merge.

## Autoresearch workflow

Harness includes an autoresearch extension and skill for iterative optimization loops with git-backed result logging and a live widget.

Core pieces:

- `/autoresearch <goal>` to enable or resume autoresearch mode
- `/autoresearch dashboard` or `ctrl+shift+x` to open the fullscreen dashboard
- `ctrl+x` to toggle the inline widget expansion
- `init_experiment` to define the metric and direction
- `run_experiment` to execute the benchmark command and optional `autoresearch.checks.sh`
- `log_experiment` to append `autoresearch.jsonl` and auto-commit kept wins
- `skills/autoresearch-create/SKILL.md` to scaffold `autoresearch.md` and `autoresearch.sh`

Repo-local session files:

- `autoresearch.md`
- `autoresearch.sh`
- `autoresearch.jsonl`
- optional `autoresearch.checks.sh`
- optional `autoresearch.ideas.md`

Helpful commands and patterns:

- `/autoresearch-ideas-prune foo,bar` to remove stale or already-tried backlog items
- pass `idea` to `log_experiment` to append a promising deferred idea
- pass `revertWorkingTree: true` to `log_experiment` on discard/crash/checks_failed to run `git checkout -- .`

## Executable eval coverage

`npm run evals` now executes:

- `evals/self-improvement/cases.json`
- `evals/browser/cases.json`
- `evals/browser-runtime/cases.json`
- `evals/gmail/cases.json`
- `evals/calendar/cases.json`
- `evals/autoresearch/cases.json`

These suites cover self-improvement policy enforcement, browser approval gating, persistent browser page-model gating, Gmail normalization/drafting/slop workflows, approval-gated Calendar event handling, and autoresearch state/replay/git logging behavior.
