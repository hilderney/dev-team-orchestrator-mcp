# Skill — UX flow (webgame)

**Role:** uiUxDesigner · **Phase:** spec-flow · **projectType:** webgame · **needsUiFlow:** true · **Status:** pilot  
**Source:** team analyze `skills-ux-review.md` (2026-09-26) + prior pilot

## Mission
Map player journey and exclusive screen/overlay states (title → play → pause → death → ranking).

## Must deliver
- `## Flow & states` with mutual exclusion (busy ⊥ paused ⊥ playing)
- Testable ACs for each transition
- Clear Exit/Back paths for nested menus
- Critical path for core loop
- No invented features beyond requirements

## Anti-patterns
- Dead-end screens with no return path
- Stackable modals / conflicting overlays
- DoD that only says “busy hook exists”
- Hidden state changes that confuse the player

## Artefacts
- `.docs/specs/{slug}.spec.md` Flow & states
- State transition map usable by QA-red
