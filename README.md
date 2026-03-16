# Harness

Harness is a filesystem-first Pi package for reusable agent capabilities.

It packages:
- `extensions/`
- `skills/`
- `themes/`

## Use with Pi

Try it directly from git:

```bash
pi -e git:github.com/r614/harness
```

Install it as a Pi package:

```bash
pi install git:github.com/r614/harness
```

Harness exposes package resources through directory-based Pi metadata:
- `extensions/`
- `skills/`
- `themes/`

## Included capabilities

### Extensions

- `answer` — interactive extraction of unanswered questions from the last assistant response
- `autoresearch` — iterative optimization workflow helpers with logging and dashboard UI
- `google-workspace` — Gmail and Calendar workflows through the local `gws` CLI
- `handoff` — generate a structured handoff prompt and open a fresh session with it prefilled
- `review` — code review workflows for local changes, branches, commits, folders, and PRs
- `subagent` — persisted role-based subagents with single/parallel/chain execution, live inspection, and steering via `/subagents`
- `todos` — file-based todo management with a tool and interactive `/todos` UI

### Skills

Harness includes skills for:
- `autoresearch-create`
- `calendar`
- `commit`
- `github`
- `gmail`
- `native-web-search`
- `web-browser` — target-based live browser control over Chrome DevTools Protocol, plus logging/debugging helpers

Subagents ship with built-in roles:
- `researcher`
- `scout`
- `planner`
- `reviewer`
- `worker`
- `qa`

### Themes

- `themes/harness.json`

## Subagents

Harness ships a built-in `subagent` tool and `/subagents` UI.

Features:
- persisted child Pi sessions under `.pi/subagents/sessions/`
- single, parallel, and chain execution
- live widget + `/subagents` fleet view
- per-run focus view with transcript inspection
- steer, follow-up, cancel one, cancel all

### Built-in roles

Default model assignments are centralized in `extensions/subagent/roles.ts` via `SUBAGENT_ROLE_MODELS`.

| Role | Purpose | Model | Built-in tools | Notes |
|---|---|---|---|---|
| `researcher` | external/background research | `gpt-5.4` | `read`, `grep`, `find`, `ls` | prompt includes native web search helper instructions |
| `scout` | local repo reconnaissance | `gpt-5.4` | `read`, `grep`, `find`, `ls`, `bash` | fast local codebase mapping |
| `planner` | plans and decomposition | `gpt-5.4` | `read`, `grep`, `find`, `ls` | structured planning output |
| `reviewer` | review and critique | `gpt-5.4` | `read`, `grep`, `find`, `ls`, `bash` | read-only review role |
| `worker` | implementation | `gpt-5.3-codex` | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` | write-capable; expected to use `todo` actively when helpful |
| `qa` | validation, tests, UI verification | `gpt-5.4` | `read`, `bash`, `grep`, `find`, `ls` | can run code/tests and is prompted to use browser helpers when appropriate |

### Child capability loading

Subagent child processes explicitly load the Harness todos extension, so the `todo` tool is available inside subagents even when working in unrelated repos.

Browser and web-research workflows are currently enabled via built-in prompt/runtime instructions that point the subagent to Harness helper scripts:
- `skills/web-browser/scripts/cdp.mjs`
- `skills/native-web-search/search.mjs`

### Examples

Single:

```json
{subagent {"mode":"single","role":"worker","task":"Implement the requested change and update any relevant todos."}}
```

Parallel:

```json
{subagent {"mode":"parallel","tasks":[
  {"role":"researcher","task":"Research options for browser automation in this stack."},
  {"role":"scout","task":"Find the relevant test and UI entry points."},
  {"role":"planner","task":"Draft an implementation and validation plan."}
]}}
```

Chain:

```json
{subagent {"mode":"chain","chain":[
  {"role":"scout","task":"Map files relevant to authentication."},
  {"role":"planner","task":"Create an implementation plan from this context:\n\n{previous}"},
  {"role":"worker","task":"Implement the plan:\n\n{previous}"},
  {"role":"qa","task":"Validate the resulting changes:\n\n{previous}"}
]}}
```

## Local runtime setup

### Google Workspace

Harness shells out to the Google Workspace CLI for Gmail and Calendar operations.

Requirements:
- install `gws`
- authenticate it for the Google account Pi should use
- ensure `gws` is on `PATH`, or set `GWS_BIN`

Example commands:

```bash
/gmail-workspace {"kind":"gmail.search","query":"newer_than:7d","maxResults":5}
/calendar-workspace {"kind":"calendar.listUpcoming","timeMin":"2026-03-15T00:00:00Z","timeMax":"2026-04-15T00:00:00Z","maxResults":10}
```

## Development

Install dependencies:

```bash
npm install
```

## Attribution

Extensions adapted from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): `answer.ts`, `todos.ts`

Skills from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): commit, github, native-web-search

Browser CDP workflow inspiration: [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill)
