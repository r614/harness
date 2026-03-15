---
name: browser
description: "Use the persistent local browser runtime for authenticated browsing, structured inspection, repeated interaction, and approval-gated side effects."
---

# Browser

Use this skill when Pi needs real local browser automation through Harness.

## Runtime path

Harness provides a persistent Chrome-backed browser subsystem via:

- `/browser-runtime-start`
- `/browser-runtime-status`
- `/browser-session`
- `/browser-action`

## Supported actions

- navigate
- snapshot / inspect
- click
- fill / type
- extract
- screenshot
- assert

## Safe default workflow

1. Start the browser runtime.
2. Create or reuse a named session.
3. Navigate and capture a snapshot.
4. Use structured targets from the snapshot for later actions.
5. Require explicit approval before risky clicks and all fill/type actions.

## Notes

- sessions reuse a persistent local Chrome profile directory
- snapshots produce stable refs plus selectors for actionable targets
- use screenshots and assertions as durable artifacts for automation/test flows
