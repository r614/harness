# Harness

Harness is a filesystem-first Pi package for reusable agent capabilities.

It packages:
- `extensions/`
- `skills/`
- `themes/`
- a small set of shared runtime scripts
- standard tests run with `vitest`

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

## Structure

```text
.
├── AGENTS.md
├── README.md
├── package.json
├── tsconfig.json
├── commands/
├── extensions/
├── prompts/
├── scripts/
├── skills/
├── tests/
└── themes/
```

## Included capabilities

### Extensions

- `answer` — interactive extraction of unanswered questions from the last assistant response
- `autoresearch` — iterative optimization workflow helpers with logging and dashboard UI
- `browser-runtime` — persistent local Chrome-backed browser sessions with structured actions
- `context` — session/context inspection helpers
- `files` — interactive file browser for repo and session-referenced files
- `google-workspace` — Gmail and Calendar workflows through the local `gws` CLI
- `harness-help` — overview of installed Harness capabilities
- `review` — code review workflows for local changes, branches, commits, folders, and PRs

### Skills

Harness includes skills for:
- `autoresearch-create`
- `browser`
- `calendar`
- `commit`
- `github`
- `gmail`
- `native-web-search`
- `summarize`
- `web-browser`

### Themes

- `themes/harness.json`

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

### Browser runtime

Harness runs a persistent local browser daemon backed by Chrome DevTools Protocol.

Requirements:
- local Google Chrome or Chromium
- Chrome available via `HARNESS_CHROME_BIN`, `CHROME_BIN`, or the default macOS Chrome path

Persistent local state:
- profile dir: `tmp/browser-runtime/profile-default`
- screenshots: `tmp/browser-runtime/screenshots`
- daemon state: `tmp/browser-runtime/daemon.json`

Example commands:

```bash
/browser-runtime-start
/browser-session {"sessionId":"default","url":"https://example.com"}
/browser-action {"sessionId":"default","action":"snapshot"}
/browser-action {"sessionId":"default","action":"assert","selector":"h1","textIncludes":"Example Domain"}
```

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

## Attribution

Parts of this repository’s structure and selected capabilities were inspired by or adapted from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), licensed under Apache-2.0.
