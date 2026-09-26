# zteam — comandos e configuração

Fonte de verdade local do time neste projeto: **`.zteam/config.json`** (verdade absoluta dos modelos). Ver também a skill Cursor **`zteam`** (`/zteam`, `@zteam`).

## Dual runtime (modelos)

O valor de cada primary em `models` escolhe o runtime (**família homogénea** — não misturar):

| Valor no config | Runtime | O que acontece |
|-----------------|---------|----------------|
| `inherit` / `auto` / `cursor` / `cursor-auto` | **cursor** | Skill corre SA/TA/SE/QA via Cursor Task (Auto do chat pai). MCP **não** chama 9router. |
| Qualquer outro id (`9RSA-…`, `cu/default`, …) | **ninerouter** | MCP `ChatOpenAI` com o id **literal** → 9router. |

Mix (`inherit` + `9RSE-…`) → `failureKind: mixed_runtime` (fail cedo).

Precedência: ficheiro app → ficheiro workspace → (só se **não** houver ficheiro) env `MODEL_*` / defaults.

## Comandos

Use estes atalhos no chat Cursor (skill `zteam` / `@zteam`). O agent **sempre** passa `workspaceRoot` = pasta aberta no Cursor.

| Comando | O que faz | MCP |
|---------|-----------|-----|
| **`@zteam/config`** | Setup completo: `.zteam/config.json` (modelos, maxTokens, escopo workspace/app, gitignore). | `get_zteam_config` → perguntas → `write_zteam_config` |
| **`@zteam/models`** | Só LLMs por papel — perguntas guiadas → atualiza `models` em `.zteam/config.json` neste projeto. | `get_zteam_config` → `modelQuestions` → `write_zteam_config` |
| **`@zteam/documentation`** | Só documentação / arquitetura (requirements, technologies, todo, specs). Sem SE/QA. | `run_development_pipeline` com `workflow: "docs"` |
| **`@zteam/tests`** | Só testes (TDD red → verify) para um requisito. | `run_development_pipeline` com `workflow: "tests"` + `slug` |
| **`@zteam`** / **`/zteam`** | Pipeline completo ou o workflow que pedires (`full` \| `docs` \| `feature` \| `punch` \| `fix` \| `resume` \| `tests` \| `analyze`). | `run_development_pipeline` (ou Task playbook se runtime=cursor) |
| **`ensure_zteam_setup`** | Stubs skill + `.docs` (+ template config opcional), sem LLM. | MCP `ensure_zteam_setup` |

### Exemplos

```text
@zteam/models
→ mostra modelos atuais + defaults → pergunta SA/TA/UX/SE/QA/fallback → grava .zteam/config.json

@zteam/config
→ pergunta modelos / escopo / maxTokens → grava .zteam/config.json (+ .gitignore para config)

@zteam/documentation samples/pacman — canvas TS, infinite lives
→ workflow=docs, projectRoot=samples/pacman

@zteam/tests samples/pacman — slug=screens-flow
→ workflow=tests + slug, projectRoot=samples/pacman

@zteam build a todo API in samples/todo-api
→ auto ou full/feature conforme contexto
```

**TDD (implementação):** QA-red (testes a falhar) → SE green (sem `[x]`) → delivery critic → QA-verify (`markTodoDone` só aqui).

## Ficheiros

| Path | Papel |
|------|--------|
| `.zteam/config.json` | **Verdade absoluta** — modelos e maxTokens por papel |
| `.zteam/README.MD` | Este guia (comandos) |
| `.zteam/skills/SKILL.md` | Cópia local da skill Cursor zteam (sincronizada ao criar `.zteam/`) |
| `.docs/*` | Artefactos da pipeline (requirements, technologies, specs, progress, …) |

### Exemplo `config.json` (9router)

```json
{
  "version": 1,
  "models": {
    "systemArchitect": "9RSA-system-architect-free",
    "systemArchitectFallback": "9RSA-system-architect",
    "technologyArchitect": "9RTA-technology-architect-free",
    "technologyArchitectFallback": "",
    "uiUxDesigner": "9RUX-ui-ux-designer-free",
    "uiUxDesignerFallback": "",
    "softwareEngineer": "9RSE-software-engineer-free",
    "softwareEngineerFallback": "9RSE-software-engineer",
    "qaEngineer": "9RQA-qa-free",
    "qaEngineerFallback": "",
    "fallback": ""
  },
  "maxTokens": {
    "systemArchitect": 1600,
    "technologyArchitect": 2500,
    "uiUxDesigner": 2000,
    "softwareEngineer": 8000,
    "qaEngineer": 2000
  }
}
```

### Exemplo Cursor Auto (fora do 9router)

```json
{
  "version": 1,
  "models": {
    "systemArchitect": "inherit",
    "systemArchitectFallback": "",
    "technologyArchitect": "inherit",
    "technologyArchitectFallback": "",
    "uiUxDesigner": "inherit",
    "uiUxDesignerFallback": "",
    "softwareEngineer": "inherit",
    "softwareEngineerFallback": "",
    "qaEngineer": "inherit",
    "qaEngineerFallback": "",
    "fallback": ""
  }
}
```

Handoff (só runtime **ninerouter**): se o primary esgotar retries, o MCP promove o `*Fallback` do papel. Papéis ativos podem consultar-se nos gates (SE↔SA após VERIFY FAIL; TA↔SA em gaps de arquitetura).

No `@zteam/config` / `@zteam/models`, pergunta primary+fallback por papel e mostra `modelSuggestions` (2 free + 2 paid) **e** aliases Cursor (`inherit`).

## Workspace (pasta raiz)

A pasta raiz **não** fica sticky no `mcp.json`. Em cada chamada o agent passa:

- **`workspaceRoot`** — path absoluto da pasta aberta no Cursor (**obrigatório** no MCP; sem arg → `failureKind=needs_workspace_root`; o MCP **ignora** `WORKSPACE_ROOT` no env)
- **`projectRoot`** — pasta relativa da app (ex. `samples/my-app` ou `.` se a app for a raiz do workspace)

Evita o footgun de pipelines a escrever noutro repo (ex. `pacman-z2` / `mypokecards`).

## Precedência de modelos

```text
{appRoot}/.zteam/config.json   (SoT se existir)
  → {workspaceRoot}/.zteam/config.json
    → (só sem ficheiro) env MODEL_* / MAX_TOKENS_*
      → defaults 9RSA / 9RTA / 9RSE / 9RQA
```

Credenciais (`NINEROUTER_*`) ficam só no env do MCP — nunca neste JSON.

## Playbook operador (greenfield / resume)

1. Garantir `.zteam/config.json` (`@zteam/models` ou `@zteam/config`) — escolher família cursor **ou** 9router.
2. Após patch no orchestrator: **reiniciar MCP** `user-zteam` (sem hot-reload).
3. Evitar re-rodar `full`/`docs` após requirements bons — o bootstrap **preserva** `.docs/requirements.md` com seções `##` (use `ZTEAM_FORCE_BOOTSTRAP=1` só para recomeçar de propósito).
4. Antes de `resume`: cada `[ ]` no todo precisa de `.docs/specs/{slug}.spec.md`. Órfãos → `workflow=feature`.
5. Modelos free no 9router: default `ZTEAM_SE_BATCH=1`. Se `IN 0 · OUT 0` / empty SE → configure `models.fallback` no config.
6. Healthcheck falhou: aguardar ~20s ou reiniciar MCP / verificar túnel Cloudflare; não spamar retries com `(cached)`.

| Env | Default | Nota |
|-----|---------|------|
| `ZTEAM_FORCE_BOOTSTRAP` | off | Força stub novo de requirements |
| `ZTEAM_SE_BATCH` | `1` (`punch`→3) | Lotes SE |
| `MODEL_FALLBACK` | — | Fallback após empty LLM (só sem config file) |
