# Skill — QA TDD red (screen-flow)

**Role:** qaEngineer · **Phase:** tdd-red · **projectType:** webgame | webapp · **Status:** pilot

## Mission
Write failing tests for screen transitions and overlay exclusivity before SE implements.

## Must deliver
- Vitest/jsdom (or happy-dom) tests for SF transitions
- Assert at most one modal chrome visible
- Busy clears after success path
- Do **not** mark todos `[x]` (verify phase owns that)

## Anti-patterns
- Suite that only covers domain math while screens-flow is `[x]`
- Marking todos done in red phase
- Soft asserts that pass without implementation