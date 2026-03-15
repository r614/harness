---
name: repo-operator
description: "Improve the Harness repo safely within allowed paths, required checks, and PR review guardrails."
---

# Repo Operator

Use this skill when Pi is improving Harness itself.

## Allowed Targets

- `skills/`
- `extensions/`
- `evals/`
- `fixtures/`
- `manifests/`
- `scripts/`
- `README.md`

## Workflow

1. Restate the workflow problem in one sentence.
2. Limit the change set to the smallest allowed files.
3. Validate every touched file against the allowed targets before drafting PR output.
4. Update fixtures and eval coverage alongside behavior changes.
5. Run the required checks.
6. Use `npm run self-improve` to generate a structured PR summary.
7. Produce a PR-ready summary for human review.

## Required Checks

- `npm run validate`
- `npm run evals`

## PR-Ready Output

Every self-improvement pass should include:

- problem statement
- changed files
- evidence
- risk classification
- required checks
- rollback guidance

## Risk Guidance

- `low`: docs, skills, fixtures, or eval-only changes
- `medium`: extension, manifest, or script changes that alter workflow behavior
- `high`: anything broader than the repo self-improvement boundary

## Command Hints

- `/self-improve-policy` shows the current repo policy and required PR fields.
- `/prepare-self-improvement-pr` prints the end-to-end workflow plus a JSON summary template.
- `npm run self-improve -- --title "..." --problem "..."` writes `tmp/self-improvement-pr.json`.

## Merge Guardrail

Never auto-merge. Every change must go through human review.
