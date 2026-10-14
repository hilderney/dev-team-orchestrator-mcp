# Skill — QA TDD red (screen-flow)

**Role:** qaEngineer · **Phase:** tdd-red · **projectType:** webgame | webapp · **needsUiFlow:** true · **Status:** pilot  
**Source:** prior pilot + SA/UX/SE team consensus (QA LLM empty 2026-09-26 — content reconciled)

## Mission
Write failing tests for screen transitions and overlay exclusivity before SE implements.

## Must deliver
- Vitest/jsdom (or happy-dom) tests for SF transitions from `## Flow & states`
- Assert at most one modal chrome visible
- Busy clears after success path
- Cover listed SF ACs (not only domain math)
- Do **not** mark todos `[x]`

## Anti-patterns
- Suite that only covers domain math while screens-flow is `[x]`
- Soft asserts that pass without implementation
- Product implementation in red phase

## Artefacts
- `**/*.{test,spec}.*` failing until SE green
