# Role skills — índice

Skills focadas por **(role × phase × projectType|qualifier)**.  
Catálogo completo + backlog: [`.docs/todo-skills.md`](../../../.docs/todo-skills.md)  
Charter: [`.docs/postmortems/9-skills-catalog.md`](../../../.docs/postmortems/9-skills-catalog.md)

## Resolução (futuro runtime)

```text
skillKey = resolve(role, phase, projectType)
  → try exact:  {role}-{phase}-{projectType|qualifier}
  → else fall:  {role}-{phase}-core
```

`needsUiFlow(projectType)` em `src/zteam-config.ts` decide se fases UX / screenflow são obrigatórias.

## Header obrigatório

```markdown
**Role:** … · **Phase:** … · **projectType:** … · **needsUiFlow:** … · **Status:** stub|pilot|ready
```

## On disk (pilot)

| File | Role | Phase |
|------|------|-------|
| [sa-requirements-crud.md](./sa-requirements-crud.md) | sa | requirements |
| [ux-flow-webgame.md](./ux-flow-webgame.md) | ux | spec-flow |
| [qa-tdd-red-screenflow.md](./qa-tdd-red-screenflow.md) | qa | tdd-red |
| [qa-tdd-red-api-contract.md](./qa-tdd-red-api-contract.md) | qa | tdd-red |
| [se-implement-tdd-green.md](./se-implement-tdd-green.md) | se | tdd-green (multi-type pilot; prefer over thin core) |
| [qa-tdd-verify-screenflow.md](./qa-tdd-verify-screenflow.md) | qa | tdd-verify |

## On disk (stub) — ver `todo-skills.md` secção On disk

Hosts (não matrix role): [../hosts/copilot.md](../hosts/copilot.md), [../hosts/opencode.md](../hosts/opencode.md).
