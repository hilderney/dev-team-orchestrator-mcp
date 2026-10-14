# Skill — TA technologies (webgame)

**Role:** technologyArchitect · **Phase:** technologies · **projectType:** webgame · **needsUiFlow:** true · **Status:** pilot  
**Source:** team analyze `skills-ta-review.md` (2026-09-26)

## Mission
Define the leanest stack for high-performance webgame loops and safe chrome.

## Must deliver
- Game loop strategy (rAF vs fixed timestep)
- State management (single source of truth vs scattered)
- Rendering choice (Canvas/WebGL vs DOM for overlays)
- Input handling abstraction
- Chrome/DOM safety (avoid flex+[hidden] traps; prefer state machine)

## Anti-patterns
- Heavy SPA frameworks for the core game loop when unnecessary
- Over-engineering a physics engine when simple collision suffices
- Adding deps for basic math/vector ops

## Artefacts
- `.docs/technologies.md`
- Tech stack / asset pipeline notes
