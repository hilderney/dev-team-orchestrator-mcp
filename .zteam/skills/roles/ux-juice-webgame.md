# Skill — UX juice (webgame)

**Role:** uiUxDesigner · **Phase:** juice · **projectType:** webgame · **needsUiFlow:** true · **Status:** pilot  
**Source:** team analyze `skills-ux-review.md` (2026-09-26)

## Mission
Add sensory feedback so game interactions feel responsive until juice score ≥7.

## Must deliver
- Feedback loops for key actions (visual/audio cues)
- Tweening/easing for UI transitions (no instant snaps where juice matters)
- Game-state visual indicators (active/disabled/loading)
- Win/loss / score feedback notes
- Input latency masking (immediate visual response)

## Anti-patterns
- Over-animation that obscures gameplay
- Sound that cannot be muted / harsh loops
- Juice that hides critical state errors or exclusivity bugs

## Artefacts
- `## UX / Juice addendum` in `.docs/requirements.md`
- Feedback matrix (Action → Visual → Audio)
