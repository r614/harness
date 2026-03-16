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
- `review` — code review workflows for local changes, branches, commits, folders, and PRs

### Skills

Harness includes skills for:
- `autoresearch-create`
- `calendar`
- `commit`
- `github`
- `gmail`
- `native-web-search`
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

## Development

Install dependencies:

```bash
npm install
```

## Attribution

Parts of this repository’s structure and selected capabilities were inspired by or adapted from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), licensed under Apache-2.0.

Extensions from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): answer.ts, todos.ts

Skills from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): commit, github, native-web-search, web-browser
