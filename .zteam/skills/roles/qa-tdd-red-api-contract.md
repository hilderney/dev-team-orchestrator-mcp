# Skill — QA TDD red (API / contract)

**Role:** qaEngineer · **Phase:** tdd-red · **projectType:** api | crud · **needsUiFlow:** false · **Status:** pilot  
**Source:** prior pilot + SA/SE consensus (QA LLM empty — reconciled)

## Mission
Write failing contract/integration tests for API or CRUD ACs before SE implements.

## Must deliver
- Failing tests for happy + alt paths in ACs
- Assert status codes / validation / not-found when listed
- Cover create validation fail when in spec
- Do **not** mark todos `[x]`

## Anti-patterns
- Only happy-path assertions
- Implementing handlers/routes in red
- Arcade/UI chrome tests for pure API

## Artefacts
- `**/*.{test,spec}.*` failing until green
