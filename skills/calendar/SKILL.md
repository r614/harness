---
name: calendar
description: "List upcoming events and prepare approval-gated Google Calendar create/update actions through gws."
---

# Calendar

Use this skill for Google Calendar workflows backed by the local `gws` CLI.

## Supported tasks

- list upcoming events
- summarize upcoming schedule blocks
- draft event creation payloads
- draft event update payloads
- apply approved event creates/updates

## Approval boundary

- listing and summarizing events are read-only
- creating or updating events requires explicit approval

## Expected task kinds

- `calendar.listUpcoming`
- `calendar.draftEvent`
- `calendar.applyDraft`
