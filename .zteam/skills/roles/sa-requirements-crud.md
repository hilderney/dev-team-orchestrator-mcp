# Skill — SA requirements (CRUD)

**Role:** systemArchitect · **Phase:** requirements · **projectType:** crud · **needsUiFlow:** false · **Status:** pilot  
**Source:** team analyze `skills-sa-review.md` (2026-09-26) + prior pilot

## Mission
Define data entities, validation rules, and API/boundary contracts — not arcade juice. Chunks must be testable → `.docs/todo.md`.

## Must deliver
- Pré-reqs for create/read/update/delete + empty/error states
- Field-level validation rules (required, format, range)
- Success/error path definitions for each mutation
- Use cases with alternate paths (validation fail, not found)
- User role permissions per endpoint when authz is in scope

## Anti-patterns
- Specifying DB schema instead of business requirements
- Forcing game-loop metaphors onto admin apps
- Over-engineering “future” fields
- Vague make-it-work ACs

## Artefacts
- `.docs/requirements.md`
- Data dictionary / API requirement matrix notes
