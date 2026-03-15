# Harness

Harness is a portable repo of skills, extensions, commands, fixtures, and scripts for a personal Pi-style agent.

The repo is designed to be:

- cloneable onto any machine
- readable and editable as normal source
- safe to evolve through tests and PRs
- local-first for setup, with optional Railway/GitHub automation

## Structure

- `skills/`: human-readable capability packs with `SKILL.md`
- `extensions/`: runtime extensions loaded by the agent
- `commands/`: reusable workflow prompts and operating procedures
- `scripts/`: bootstrap, eval, validation, and PR helper scripts
- `evals/`: regression fixtures and expected outcomes
- `fixtures/`: sample inputs for local tests
- `manifests/`: explicit registries and policy boundaries
- `intercepted-commands/`: wrappers for sensitive local commands

## Quick Start

```bash
npm install
npm run validate
npm run evals
```

## Self-Improvement Workflow

1. Update only files under `skills/`, `extensions/`, `commands/`, `evals/`, `fixtures/`, or `manifests/`.
2. Run validation and evals.
3. Create a branch and open a PR with rationale, evidence, and rollback guidance.
4. Wait for human review before merge.
