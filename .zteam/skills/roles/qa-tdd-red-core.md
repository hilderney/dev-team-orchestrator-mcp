# Skill — QA TDD red (core)

**Role:** qaEngineer · **Phase:** tdd-red · **projectType:** core · **needsUiFlow:** — · **Status:** pilot

## Mission
Write failing automated tests from spec ACs before SE implements.

## Must deliver
- Failing vitest (or project runner) tests
- Cover happy + listed alt paths
- **Logical consistency check:** positive test cases and fixtures must satisfy all other invariants of the same spec (never write a positive test case that violates another rule in the spec)
- **Host compatibility:** never import uncompiled native C++ addons (`better-sqlite3`) in tests; use `node:sqlite` or the spec's injected interface per `.docs/host.json`

## Anti-patterns
- Contradictory test assertions (where passing test A forces test B to fail)
- Failing with `Cannot find package 'better-sqlite3'` instead of behavioral assertion failure
- Product implementation
- Marking todos `[x]`

## Artefacts
- `**/*.{test,spec}.*`
