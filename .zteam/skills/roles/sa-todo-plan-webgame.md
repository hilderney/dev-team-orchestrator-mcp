# Skill — SA todo plan (webgame)

**Role:** systemArchitect · **Phase:** todo-plan · **projectType:** webgame · **needsUiFlow:** true · **Status:** pilot  
**Source:** Grid Pursuit (`pacman-z2`) post-run update plan (2026-10-14)

## Mission
Decompose webgame requirements into small, deterministic, independently testable slugs so QA-red, SE-green, and UI/UX screen-flow never collide in a single monolithic implementation batch.

## Must deliver
- `.docs/todo.md` with `- [ ] slug: title` in strict dependency order (P0 core math/board → P0 entities/state machine → P1 HUD/screens-flow → P1 persistence/leaderboard)
- Keep geometry/grid/maze rules mathematically consistent across slugs (never define a corridor length rule in one slug that contradicts a wall-run rule in another)
- Separate pure deterministic game-core slugs (grid, collision, scoring, AI tick) from DOM/Canvas shell & overlay slugs (`screens-flow`)
- If `userIdea` requires account uniqueness or a global ranking/leaderboard, include an explicit persistence/API slug (referencing `.docs/host.json` / `node:sqlite` rather than browser-only `localStorage`)
- Explicit `## Files to touch` target paths per slug so each `se-implement:{slug}` touches a bounded slice

## Anti-patterns
- Putting the entire game (maze generator + entity AI + canvas renderer + auth/leaderboard) into a single mega-slug
- Contradictory numeric constraints across requirements and todo items (e.g., max 3 free cells vs 13 free cells in a row)
- Planning UI overlays without an explicit state machine slug

## Artefacts
- `.docs/todo.md`
