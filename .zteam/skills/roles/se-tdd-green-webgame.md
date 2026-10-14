# Skill — SE TDD green (webgame)

**Role:** softwareEngineer · **Phase:** tdd-green · **projectType:** webgame · **needsUiFlow:** true · **Status:** pilot  
**Source:** team analyze `skills-catalog-review.md` (SE section, 2026-09-26)

## Mission
Minimal TDD green for webgame core mechanics with state flow and overlay exclusivity.

## Must deliver
- Make QA-red SF / state-transition tests pass
- Overlay exclusivity (at most one modal chrome visible)
- Busy cleared after success path
- State-driven updates (Input → State → Render); no logic-only-in-render
- Do **not** mark todos `[x]` (QA-verify owns that)

## Anti-patterns
- Building full game loop polish before state-transition tests pass
- Adding score/sound/levels before core flow is green
- Stacking PAUSED + busy overlays
- Deleting or weakening red tests

## Artefacts
- `src/**` implementation
- Green suite for SF/state tests written in red
