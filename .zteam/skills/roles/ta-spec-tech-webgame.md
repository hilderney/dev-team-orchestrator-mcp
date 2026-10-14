# Skill — TA spec-tech (webgame)

**Role:** technologyArchitect · **Phase:** spec-tech · **projectType:** webgame · **needsUiFlow:** true · **Status:** pilot  
**Source:** team analyze `skills-ta-review.md` (2026-09-26)

## Mission
Encode chrome state machine and safe DOM/game interfaces on the slug spec.

## Must deliver
- Interface definitions for GameState / Entity systems as needed
- Overlay exclusivity logic (Modal vs HUD vs GameWorld)
- How SE toggles overlays safely
- Performance budgets when relevant (FPS, load)

## Anti-patterns
- Specifying line-by-line code instead of system contracts
- Ignoring mobile browser constraints when in scope
- Tight coupling rendering ↔ game logic in the spec

## Artefacts
- `.docs/specs/{slug}.spec.md` technical section
