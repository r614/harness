# Autoresearch: Optimize tests

## Objective
Reduce end-to-end test runtime without changing test coverage.

## Metrics
- Primary: seconds (lower is better)
- Secondary: heap_mb

## How to Run
`./autoresearch.sh`

## Files in Scope
- src/test-runner.ts — runner scheduling
- src/cache.ts — reusable state

## Off Limits
- package.json
- CI config

## Constraints
- Tests must still pass
- No benchmark cheating

## What's Been Tried
- Baseline captured
