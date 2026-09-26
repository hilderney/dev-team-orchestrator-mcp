# Skill — UX flow (webgame)

**Role:** uiUxDesigner · **Phase:** spec-flow · **projectType:** webgame · **needsUiFlow:** true

## Mission
Define exclusive screen/overlay states and juice for game loops (title → play → pause → death → ranking).

## Must deliver
- `## Flow & states` with mutual exclusion (e.g. busy ⊥ paused ⊥ playing)
- Testable ACs for each transition (QA-red must be able to assert them)
- No invented features beyond requirements

## Anti-patterns
- DoD that only says “busy hook exists”
- Overlays that can stack visually
- Skipping Flow & states when `needsUiFlow=true` / projectType=webgame
