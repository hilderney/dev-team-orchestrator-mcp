# zteam — GitHub Copilot adapter

**Host:** GitHub Copilot · **Status:** draft (P3-2)

## Prévias (sem Cursor Task)
1. Node + `npm i` neste pacote se fores usar CLI.
2. `.zteam/config.json` com primaries **9router** (não uses `inherit` — Copilot não executa `delegationPlaybook` Cursor).
3. Opcional: `ensure_zteam_setup` / stubs `.docs` antes do pipeline.
4. Definir `projectType` no config quando conhecido (`webgame` | `webapp` | `crud` | `api`).

## Ordem TDD (obrigatória)
```text
QA-red (testes a falhar) → SE green (sem [x]) → delivery critic → QA-verify (markTodoDone)
```
Workflows CLI:
- Docs: `npm run pipeline -- --workflow docs --project-root <app> "ideia"`
- Feature: `--workflow feature` (+ foco num slug via MCP `slug` se disponível)
- Tests only: `--workflow tests` (+ slug)
- Analyze: `--workflow analyze` (+ scope / role)
- Full / punch / fix / resume: conforme catálogo

## Diferenças vs Cursor
- Sem GetDynamicTools / Task subagents.
- Preferir CLI `npm run pipeline` / `pipeline:docs` / `pipeline:feature`.
- Colar este ficheiro nas agent instructions do Copilot.

## Não fazer
- Assumir `llmRuntime=cursor` ou stages Task.
- Marcar todos `[x]` no SE.
- Correr `@zteam/tests` como `fix` — usar `workflow=tests` + slug.
