# Harness Agents Guide

Harness is a filesystem-first Pi package repo for reusable agent capabilities.

## Repo layout

- `extensions/` — Pi extensions
- `skills/` — skill directories with `SKILL.md`
- `themes/` — JSON themes
- `scripts/` — shared helper and runtime scripts

## Working rules

1. Keep changes narrow and capability-local.
2. Prefer keeping helper code close to the owning extension or skill.
3. Do not introduce new top-level manifest or fixture registries unless absolutely necessary.
4. Never auto-merge; human review is required.

## Preferred change targets

- `extensions/`
- `skills/`
- `themes/`
- `scripts/`
- `README.md`
- `AGENTS.md`
