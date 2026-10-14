# Role skills — índice

Skills focadas por **(role × phase × projectType|qualifier)**.  
Catálogo, charter e backlog: [`.docs/todo-skills.md`](../../../.docs/todo-skills.md)

## Resolução (runtime H4)

```text
skillKey = resolve(role, phase, projectType)
  → try exact:  {role}-{phase}-{projectType|qualifier}
  → else fall:  {role}-{phase}-core
```

Implementação: [`src/skill-resolve.ts`](../../../src/skill-resolve.ts) — inject em `invokeRoleLlm` + playbook Cursor (`skillKey`).

`needsUiFlow(projectType)` em `src/zteam-config.ts` decide se fases UX / screenflow são obrigatórias (`webgame`, `godotgame`, `webapp`, `crud`, … vs `backend` / `library` / `cli-dos`).

**Docs (fluxo + árvore de decisão):** [README — Role skills injection](../../../README.md#role-skills-injection).

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
| [qa-tdd-red-ai-rag.md](./qa-tdd-red-ai-rag.md) | qa | tdd-red (AI/RAG/Vector layers 6–8) |
| [se-implement-tdd-green.md](./se-implement-tdd-green.md) | se | tdd-green (multi-type pilot; prefer over thin core) |
| [qa-tdd-verify-screenflow.md](./qa-tdd-verify-screenflow.md) | qa | tdd-verify |

## On disk (stub) — ver `todo-skills.md` secção On disk

Hosts (não matrix role): [../hosts/copilot.md](../hosts/copilot.md), [../hosts/opencode.md](../hosts/opencode.md).
