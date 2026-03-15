---
name: gmail
description: "Search mail, read threads, draft replies, classify low-value mail, and require approval before send or unsubscribe actions."
---

# Gmail

Use this skill for Google Workspace Gmail workflows backed by the local `gws` CLI.

## Supported tasks

- search threads
- read and summarize threads
- draft reply emails
- classify likely low-value/slop mail
- archive explicit low-value mail
- prepare unsubscribe workflows

## Approval boundary

- reading, searching, summarizing, drafting, and bounded auto-archive are allowed
- sending replies requires explicit approval
- unsubscribe actions require explicit approval

## Expected task kinds

- `gmail.search`
- `gmail.read`
- `gmail.draftReply`
- `gmail.classifySlop`
- `gmail.archive`
- `gmail.prepareUnsubscribe`
