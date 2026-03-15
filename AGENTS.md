# Harness Agents Guide

Harness is the trusted toolbox repo for the personal agent runtime.

## Goals

- keep agent capabilities as source-controlled assets
- make improvements inspectable
- require tests and human review before merge

## Allowed Self-Improvement Targets

- `skills/`
- `extensions/`
- `commands/`
- `evals/`
- `fixtures/`
- `manifests/`
- `README.md`

## Disallowed Targets

- deployment or infrastructure config
- arbitrary shell access outside helper scripts
- secrets or local machine state

## Operating Rules

1. Prefer narrow edits to one capability at a time.
2. Run `npm run validate` and `npm run evals` before proposing a PR.
3. Use `npm run self-improve -- --title "..." --problem "..."` to prepare a change summary.
4. Never auto-merge; every PR requires human review.
