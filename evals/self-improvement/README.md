# Self-Improvement Evals

This suite is executed by `npm run evals` through deterministic fixtures and script-level checks.

## Coverage Goals

- allowed path enforcement blocks disallowed files
- PR summary output includes all required fields
- risk classification defaults are sensible for changed file types
- the `npm run self-improve` helper emits the same structured summary shape as the repo-operator workflow

## Fixture Cases

### 1. Valid change set

Input: `fixtures/repos/self-improvement-valid.json`

Expected:

- `allowed` is `true`
- `changedFiles` exactly match the fixture files
- `riskClassification` defaults to `medium` because an extension file changed
- `requiredChecks` include `npm run validate` and `npm run evals`

### 2. Disallowed path rejection

Input: `fixtures/repos/self-improvement-invalid.json`

Expected:

- `allowed` is `false`
- `invalidTargets` includes `package.json`
- next step instructs the operator to remove disallowed files before opening a PR

### 3. Structured PR summary shape

Expected summary payload contains:

- `problemStatement`
- `changedFiles`
- `evidence`
- `riskClassification`
- `requiredChecks`
- `rollbackGuidance`

### 4. CLI parity

The `open-pr` helper should produce the same structured fields as the repo-operator extension when given the same fixture input.
