# Skill — QA TDD red (API / contract)

**Role:** qaEngineer · **Phase:** tdd-red · **projectType:** api | crud

## Mission
Write failing contract/integration tests for API or CRUD ACs before SE implements (`needsUiFlow=false`).

## Must deliver
- Failing vitest (or project runner) tests for happy + alt paths
- Assert status codes / validation / not-found when in ACs
- Do **not** mark todos `[x]`

## Anti-patterns
- Only happy-path assertions when spec lists validation/error ACs
- Implementing handlers/routes in the red phase
