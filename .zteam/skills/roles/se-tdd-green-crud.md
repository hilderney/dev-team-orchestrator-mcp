# Skill — SE TDD green (crud)

**Role:** softwareEngineer · **Phase:** tdd-green · **projectType:** crud · **needsUiFlow:** varies · **Status:** pilot  
**Source:** team analyze `skills-catalog-review.md` (SE section, 2026-09-26)

## Mission
TDD green for CRUD/API validation and alt paths without forced arcade UX.

## Must deliver
- Make red contract/validation tests pass
- Boundary validation (fail fast)
- Explicit error responses for listed 4xx paths
- Happy + alt paths from the spec
- Do **not** mark todos `[x]`

## Anti-patterns
- Full ORM/migration scaffold before validation tests pass
- Coupling auth beyond scoped ACs
- Pagination/caching before basic CRUD is green
- Swallowing errors in empty catch blocks

## Artefacts
- `src/**` + green contract tests from red phase
