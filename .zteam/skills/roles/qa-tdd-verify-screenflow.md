# Skill — QA TDD verify (screen-flow)

**Role:** qaEngineer · **Phase:** tdd-verify · **projectType:** webgame | webapp · **Status:** pilot

## Mission
After SE green: run the suite, close gaps, and mark `[x]` only when tests pass (incl. screen-flow / overlay exclusivity).

## Must deliver
- Suite green for focused slug(s)
- Gap/regression tests if ACs or `## Flow & states` still uncovered
- Overlay exclusivity still asserted (busy ⊥ paused ⊥ playing when applicable)
- `markTodoDone` / `[x]` only after pass
- Optional `===TECH_DEBT===` → `.docs/tech-debt.md`

## Anti-patterns
- Marking `[x]` while screen-flow tests are missing or red
- Re-implementing product code (send logic fails back to SE fix)
- Skipping verify because “SE said done”
