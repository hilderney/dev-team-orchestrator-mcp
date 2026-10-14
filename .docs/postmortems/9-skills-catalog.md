# Fase 9 — Catálogo de skills (role × fase × projectType)

> **Status: delivered** (2026-09-26) — inventário + stubs + **H4 wiring** + P0 pilots via lab. Próximo: [todo.md](../todo.md).

**Backlog vivo:** [`.docs/todo.md`](../todo.md) · catálogo: [`.docs/todo-skills.md`](../todo-skills.md)  
**On disk:** [`.zteam/skills/roles/`](../../.zteam/skills/roles/)  
**Origem:** postmortem [8](./8-zteam-pipeline-review-improvements.md) §5–§6 + auditoria workflow TDD.

---

## 1. Objectivo

Skills **focadas** (≤1 página) por `(role, phase, projectType|qualifier)` injectadas em `invokeRoleLlm` / playbook Cursor — sem monolito.

Distintas da skill de **uso** zteam (`.cursor/skills/zteam`, `.zteam/skills/SKILL.md`).

---

## 2. Taxonomia

| Campo | Valores |
|-------|---------|
| Role | `sa` · `ta` · `ux` · `se` · `qa` |
| Phase | `bootstrap` · `requirements` · `juice` · `technologies` · `look-and-feel` · `todo-plan` · `spec-write` · `spec-flow` · `spec-tech` · `tdd-red` · `tdd-green` · `tdd-verify` · `fix` · `summary` · `tech-debt` · `analyze` · `delivery-critic` |
| projectType | `core` · `webgame` · `webapp` · `crud` · `backend` · `frontend` · `fullstack` · `mobile` · `cli-dos` · `library` · `desktop` · `other` |
| Qualifier | `screenflow` · `api-contract` · `forms` (quando span tipos) |

**Ficheiro:** `{role}-{phase}-{qualifier|projectType}.md`  
**Resolução:** exact → senão `{role}-{phase}-core`.

```mermaid
flowchart TD
  detect[projectType] --> resolve[resolve]
  resolve -->|hit| skill[role-phase-type]
  resolve -->|miss| core[role-phase-core]
```

---

## 3. Critérios de aceite (fase 9)

1. [`.docs/todo-skills.md`](../todo-skills.md) lista **todas** as células de valor (on-disk + planned).
2. Stubs **core** + prioridade webgame/webapp/crud/backend existem em `.zteam/skills/roles/`.
3. Pilots existentes mantidos / referenciados (sem duplicar conteúdo útil).
4. Smoke verifica ficheiros `stub|pilot` on-disk.
5. [x] Wiring H4: `resolveSkill` + inject em `orchestrator` / playbook.

---

## 4. Fora de escopo (fase 9)

- Skills para nós heurísticos (`fidelityCritic`, `scaffoldPrepare`, …) além do stub `se-delivery-critic-core`
- Hosts Cursor ricos (F1) além do índice roles

---

## 5. Próximo

Backlog ativo: [`.docs/todo.md`](../todo.md) — **validar skills por tipo de projeto / função**.

- Enrich stubs → `ready` só após validação por tipo
- Re-run QA analyze quando 9router estável (lab QA body empty ×2)
- Tipos planned (mobile, cli-dos, …) após P0/P1
- Hosts Copilot / OpenCode (F2/F3) — postmortem 8
