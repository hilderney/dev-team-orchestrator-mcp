# Skill — SA requirements (webgame)

**Role:** systemArchitect · **Phase:** requirements · **projectType:** webgame · **needsUiFlow:** true · **Status:** pilot  
**Source:** team analyze `skills-sa-review.md` (2026-09-26)

## Mission
Define game loop, state transitions, and win/loss conditions as testable pré-reqs.

## Must deliver
- State machine (Idle → Playing → Paused → Game Over / ranking as needed)
- Overlay exclusivity rules (e.g. Settings/Pause blocks Gameplay)
- Core loop requirements (Input → Update → Render)
- Win/Loss trigger definitions
- Resource constraints when relevant (max entities, lives)

## Anti-patterns
- Describing UI layout instead of game logic
- Vague “fun” requirements without measurable triggers
- Hardcoding specific levels into core requirements

## Artefacts
- `.docs/requirements.md` sections
- State transition notes usable by UX Flow & states / QA-red
