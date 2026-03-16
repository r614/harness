---
name: web-browser
description: Interact with a live local Chrome-family browser session over CDP, using target-based commands for listing tabs, inspecting pages, clicking, typing, and debugging.
license: Stolen from Mario
---

# Web Browser Skill

Target-based Chrome DevTools Protocol tooling for live browser sessions.

> Harness note: this skill now centers on `scripts/cdp.mjs`. Helper scripts for cookie dismissal, picking, and logging remain available, but the primary workflow is tab selection via `list` and a target prefix.

## Prerequisites

- Chrome-family browser with remote debugging enabled in `chrome://inspect/#remote-debugging`
- Node.js 22+
- Optional: set `CDP_PORT_FILE` if your browser stores `DevToolsActivePort` in a non-standard location

Supported browser discovery includes Chrome, Chromium, Brave, Edge, and Vivaldi.

## Primary workflow

List open tabs first:

```bash
./scripts/cdp.mjs list
```

Use the unique target prefix from `list` for all tab commands.

## Core commands

```bash
./scripts/cdp.mjs list
./scripts/cdp.mjs shot <target> [file]
./scripts/cdp.mjs snap <target>
./scripts/cdp.mjs html <target> [".selector"]
./scripts/cdp.mjs eval <target> "expression"
./scripts/cdp.mjs nav <target> https://example.com
./scripts/cdp.mjs net <target>
./scripts/cdp.mjs click <target> "selector"
./scripts/cdp.mjs clickxy <target> <x> <y>
./scripts/cdp.mjs type <target> "text"
./scripts/cdp.mjs loadall <target> "selector"
./scripts/cdp.mjs evalraw <target> <method> [json]
./scripts/cdp.mjs open [url]
./scripts/cdp.mjs stop [target]
```

Notes:
- `clickxy` uses CSS pixels, not screenshot image pixels
- `type` uses CDP input events and is better than JS eval for text entry
- first access to a tab may trigger Chrome's approval prompt; repeated commands reuse a persistent daemon

## Helper scripts

### Pick elements

```bash
./scripts/pick.js "Click the submit button"
```

Interactive picker for the active page.

### Dismiss cookie dialogs

```bash
./scripts/dismiss-cookies.js
./scripts/dismiss-cookies.js --reject
```

Runs against the active page and attempts to accept or reject common consent dialogs.

### Background logging

```bash
./scripts/watch.js
./scripts/logs-tail.js
./scripts/logs-tail.js --follow
./scripts/net-summary.js
```

Writes JSONL logs to:

```text
~/.cache/agent-web/logs/YYYY-MM-DD/<targetId>.jsonl
```

## Legacy wrappers

These wrappers now delegate to `cdp.mjs`:

```bash
./scripts/nav.js <target> <url>
./scripts/eval.js <target> "expression"
./scripts/screenshot.js <target> [file]
```

## Best practices

- Prefer stable selectors over index-based DOM access across multiple commands
- Use `snap` for semantic structure and `html` when you need exact markup
- Use `evalraw` for unsupported CDP methods instead of adding one-off scripts
- Use browser interaction only when the user explicitly wants page inspection or manipulation
