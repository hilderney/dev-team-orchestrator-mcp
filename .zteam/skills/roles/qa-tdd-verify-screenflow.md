# Skill — QA TDD verify (screen-flow)

**Role:** qaEngineer · **Phase:** tdd-verify · **projectType:** webgame | webapp · **needsUiFlow:** true · **Status:** pilot  
**Source:** prior pilot + team consensus (QA LLM empty — reconciled)

## Mission
After SE green: run suite, close SF gaps, mark `[x]` only when screen-flow tests pass.

## Must deliver
- Suite green for focused slug(s) including Flow & states
- Gap/regression tests if overlays still uncovered
- Overlay exclusivity still asserted
- `markTodoDone` / `[x]` only after pass
- Optional `===TECH_DEBT===`

## Anti-patterns
- Marking `[x]` while SF tests missing or red
- Re-implementing product code (send to SE fix)
- Skipping verify because “SE said done”

## Artefacts
- Green suite + `.docs/todo.md` `[x]`
