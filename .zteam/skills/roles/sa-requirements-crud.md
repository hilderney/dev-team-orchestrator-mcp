# Skill — SA requirements (CRUD)

**Role:** systemArchitect · **Phase:** requirements · **projectType:** crud · **needsUiFlow:** false

## Mission
Capture entities, list/detail flows, validation, and authz lightly — not arcade juice. Chunks must be testable → `.docs/todo.md`.

## Must deliver
- Pré-reqs for create/read/update/delete + empty/error states
- Use cases with alternate paths (validation fail, not found)
- Testable acceptance criteria (no UI Flow & states unless product is also a web UI)

## Anti-patterns
- Forcing game-loop metaphors onto admin apps
- Vague “make it work” ACs that QA-red cannot assert
