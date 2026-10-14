# Skill — QA TDD verify (API contract)

**Role:** qaEngineer · **Phase:** tdd-verify · **projectType:** api-contract · **needsUiFlow:** false · **Status:** pilot  
**Source:** stub enriched from SA/SE team consensus (QA LLM empty — reconciled)

## Mission
After SE green: verify API/CRUD contract tests; mark `[x]` only when pass.

## Must deliver
- Suite green for contract ACs (API, DB/Cache persistence, queue/worker idempotency, and Auth 401/403 when in spec)
- Auth/fail path coverage if in spec
- Gap tests only when ACs still uncovered
- `markTodoDone` on pass

## Anti-patterns
- `[x]` with only happy-path
- Rewriting handlers in verify
- Inventing endpoints not in requirements

## Artefacts
- Green contract suite + todo `[x]`
