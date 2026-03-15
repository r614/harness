# Browser Evals

This suite is executable through `npm run evals`.

## Coverage

- task classification into read-only vs side-effectful browsing
- approval gating before side effects
- minimal fixture validation for browser tasks

## Cases

### 1. Read-only research task

Input: `fixtures/browser/sample-task.json`

Expected:

- classified as `read_only`
- approval not required

### 2. Form submission task

Input: `fixtures/browser/form-task.json`

Expected:

- classified as `side_effect`
- approval required before submit
