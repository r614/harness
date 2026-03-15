---
name: repo-operator
description: "Improve the Harness repo safely within allowed paths, required checks, and PR review guardrails."
---

# Repo Operator

Use this skill when Pi is improving Harness itself.

## Allowed Targets

- `skills/`
- `extensions/`
- `commands/`
- `evals/`
- `fixtures/`
- `manifests/`

## Required Checks

- `npm run validate`
- `npm run evals`

## PR Requirements

- clear problem statement
- linked evidence from runs or evals
- risk classification
- rollback guidance
