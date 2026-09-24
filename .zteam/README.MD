# zteam — comandos e configuração

Fonte de verdade local do time 9router neste projeto. Ver também a skill Cursor **`zteam`** (`/zteam`, `@zteam`).

## Comandos

Use estes atalhos no chat Cursor (skill `zteam` / `@zteam`). O agent **sempre** passa `workspaceRoot` = pasta aberta no Cursor.

| Comando | O que faz | MCP |
|---------|-----------|-----|
| **`@zteam/config`** | Cria/atualiza `.zteam/config.json` (modelos, maxTokens, escopo workspace/app). Fonte de verdade dos modelos 9router. | `get_zteam_config` → perguntas → `write_zteam_config` |
| **`@zteam/documentation`** | Só documentação / arquitetura (requirements, technologies, todo, specs). Sem SE/QA. | `run_development_pipeline` com `workflow: "docs"` |
| **`@zteam/tests`** | Analisa o app/specs e cria ou reforça testes (QA + fix loop se falhar). | `run_development_pipeline` com foco em testes (`workflow: "fix"` ou `"feature"` / `"resume"` conforme o estado) |
| **`@zteam`** / **`/zteam`** | Pipeline completo ou o workflow que pedires (full, feature, punch, resume, …). | `run_development_pipeline` |

### Exemplos

```text
@zteam/config
→ pergunta modelos / escopo → grava .zteam/config.json (+ .gitignore para config)

@zteam/documentation samples/pacman — canvas TS, infinite lives
→ workflow=docs, projectRoot=samples/pacman

@zteam/tests samples/pacman
→ analisa specs/código e corre pipeline de testes

@zteam build a todo API in samples/todo-api
→ auto ou full/feature conforme contexto
```

## Ficheiros

| Path | Papel |
|------|--------|
| `.zteam/config.json` | Modelos e maxTokens por papel (app override → workspace → env) |
| `.zteam/README.MD` | Este guia (comandos) |
| `.zteam/skills/SKILL.md` | Cópia local da skill Cursor zteam (sincronizada ao criar `.zteam/`) |
| `.docs/*` | Artefactos da pipeline (requirements, technologies, specs, progress, …) |

### Exemplo `config.json`

```json
{
  "version": 1,
  "models": {
    "systemArchitect": "9RSA-system-architect-free",
    "technologyArchitect": "9RTA-technology-architect-free",
    "softwareEngineer": "9RSE-software-engineer-free",
    "qaEngineer": "9RQA-qa-free",
    "fallback": ""
  },
  "maxTokens": {
    "systemArchitect": 1600,
    "technologyArchitect": 2500,
    "softwareEngineer": 8000,
    "qaEngineer": 2000
  }
}
```

## Workspace (pasta raiz)

A pasta raiz **não** fica sticky no `mcp.json`. Em cada chamada o agent passa:

- **`workspaceRoot`** — path absoluto da pasta aberta no Cursor
- **`projectRoot`** — pasta relativa da app (ex. `samples/my-app` ou `.` se a app for a raiz do workspace)

Evita o footgun de pipelines a escrever noutro repo (ex. `pacman-z2`).

## Precedência de modelos

```text
{appRoot}/.zteam/config.json
  → {workspaceRoot}/.zteam/config.json
    → env MODEL_* / MAX_TOKENS_*
      → defaults 9RSA / 9RTA / 9RSE / 9RQA
```

Credenciais (`NINEROUTER_*`) ficam só no env do MCP — nunca neste JSON.
