# Skill — QA TDD red (screen-flow)

**Role:** qaEngineer · **Phase:** tdd-red · **projectType:** webgame | webapp · **needsUiFlow:** true · **Status:** pilot  
**Source:** prior pilot + SA/UX/SE team consensus + `pacman-z2` gate rules (2026-10-14)

## Mission
Write failing tests for screen transitions, overlay exclusivity, and domain invariants before SE implements.

## Must deliver
- Vitest/jsdom (or happy-dom) tests for SF transitions from `## Flow & states`
- Assert at most one modal chrome visible
- Busy clears after success path
- Cover listed SF ACs (not only domain math)
- **Logical consistency check:** a positive test case or fixture MUST NOT violate another invariant from the same spec (e.g., never assert or construct a fixture requiring 13 consecutive free cells if another rule caps free cells at 3)
- **Zero native addon lock-in:** never import optional native C++ packages (`better-sqlite3`, `bcrypt`) directly in the test harness; follow `.docs/host.json` (`node:sqlite` built-in or injectable interface) so red tests fail on missing behavior, never on `Cannot find package`
- Do **not** mark todos `[x]`

## Anti-patterns
- Contradictory assertions where satisfying test A makes test B mathematically impossible
- Importing `better-sqlite3` when `.docs/host.json` prefers `node:sqlite`
- Suite that only covers domain math while screens-flow is `[x]`
- Soft asserts that pass without implementation
- Product implementation in red phase

## Artefacts
- `**/*.{test,spec}.*` failing until SE green
