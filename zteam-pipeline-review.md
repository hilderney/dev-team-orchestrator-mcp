# Review — tentativa zteam (Pacman-Z)

**Data:** 2026-09-26  
**Workspace:** `c:\GIT\ZAPFCOORP\pacman-z`  
**Pedido:** pipeline full com modelos `inherit` em todos os papéis  
**Desfecho:** pipeline **concluído com sucesso** após correções manuais (runtime `cursor` + 7 stages Task).  
**Testes finais:** 36/36 passando (`npm test`) — **falso verde** face a bug crítico de UI/estados de tela encontrado em playtest manual.

Este documento registra **erros reais da orquestração zteam**, fricções do fluxo, **riscos recorrentes** e um **defeito de produto** (overlays de tela) que o pipeline deveria ter barrado via specs/testes e não barraram.

---

## Resumo executivo

| Severidade | Tema | Impacto |
|------------|------|---------|
| **Crítica (produto)** | Overlays Play: `PAUSED` + `Generating maze…` simultâneos; jogo jogável por teclado | UX quebrada no fluxo Title→Play; DoD de `screens-flow` violado |
| Alta | Surface MCP ≠ skill / README | Config gate oficial impossível; agent improvisou arquivos |
| Alta | `mixed_runtime` por papel `uiUxDesigner` omitido | 1ª tentativa de pipeline falhou após validação de modelos |
| Média | Schema de `run_development_pipeline` incompleto / contraditório | `-32602` em `workspaceRoot`; parâmetros da skill não documentados |
| Média | Documentação desatualizada (README/skill/exemplos) | Templates sem UX; texto ainda “só 9router / não use Task” |
| Média | QA sem testes de screen-flow / DOM overlays | Bug de UI escapou com suite “verde” |
| Baixa–média | Gaps de produto reportados por SE/QA | Gerador cai no fallback; cobertura de testes limitada |

**Causa-raiz dominante (orquestração):** o pacote MCP `user-zteam` exposto no Cursor **não está alinhado** com a skill `zteam` / `.zteam/README.MD`.

**Causa-raiz dominante (bug de tela):** falha encadeada **SE (implementação CSS/`[hidden]`)** + **QA (não testou `screens-flow`)**; specs já descreviam o contrato — ver §8.

---

## 1. Erros ocorridos (cronologia)

### 1.1 Tools de config ausentes no MCP

**Esperado (skill / README):**

- `get_zteam_config`
- `write_zteam_config`
- Gate: `needsConfig === false` antes de `run_development_pipeline`

**Observado no namespace `user-zteam`:**

| Tool | Status |
|------|--------|
| `mcp_auth` | presente |
| `run_development_pipeline` | presente |
| `get_zteam_config` | **ausente** |
| `write_zteam_config` | **ausente** |

**Consequência:**

- Impossível seguir o fluxo canônico `@zteam/config` / `@zteam/models` via MCP.
- Bootstrap manual: criação de `.zteam/config.json`, cópia de `SKILL.md` e `README.MD` (este último a partir de `mypokecards`).
- Risco de config incompleta ou README de outro projeto (conteúdo parcialmente desatualizado).

---

### 1.2 Validação de argumentos: `workspaceRoot` obrigatório mas fora do schema publicado

**1ª chamada** a `run_development_pipeline` (sem `workspaceRoot`):

```text
MCP error -32602: Input validation error:
Invalid arguments for tool run_development_pipeline:
Invalid input: expected string, received undefined at workspaceRoot
```

**Schema anunciado pelo Cursor** (GetDynamicTools) lista apenas:

- `userIdea` (required)
- `projectRoot` (default `"."`)
- `docsOnly` (default `false`)

**Skill exige** também: `workspaceRoot`, `workflow` (`full` | `docs` | …).

**Consequência:**

- O schema público **não documenta** o campo que o servidor **valida como obrigatório**.
- Agents que confiam só no schema falham na primeira chamada.
- Workaround: passar `workspaceRoot` (e opcionalmente `workflow`) mesmo sem estarem no `inputSchema` publicado.

---

### 1.3 `failureKind: mixed_runtime` — papel `uiUxDesigner`

Após passar `workspaceRoot`, o MCP retornou:

```text
ok: false
failureKind: mixed_runtime
error: All primary models must share one runtime (cursor aliases OR 9router ids).
Got mixed:
  systemArchitect=inherit(cursor)
  technologyArchitect=inherit(cursor)
  uiUxDesigner=9RSA-system-architect-free(ninerouter)   ← default injetado
  softwareEngineer=inherit(cursor)
  qaEngineer=inherit(cursor)
```

**Causa:**

1. Config inicial copiada de `mypokecards` **sem** `uiUxDesigner` / `uiUxDesignerFallback`.
2. Exemplos em `.zteam/README.MD` e skill ainda listam SA/TA/SE/QA — **não** mencionam UX como primary obrigatório.
3. Runtime MCP preencheu o primary ausente com default **9router** (`9RSA-system-architect-free`), quebrando a homogeneidade `inherit`.

**Correção aplicada:**

```json
"uiUxDesigner": "inherit",
"uiUxDesignerFallback": "",
"maxTokens.uiUxDesigner": 32000
```

**2ª chamada** → `ok: true`, `llmRuntime: "cursor"`, `delegated: true`, playbook com **7 stages**.

---

### 1.4 Contradição de instruções: MCP description vs dual runtime

Descrição atual de `run_development_pipeline` ainda diz, em essência:

- Modelos via 9router / IDs `9RSA-…` etc.
- **“Do not use Cursor Task subagents for this work.”**

Com `inherit`, o próprio MCP devolve `delegationPlaybook` e `resumeHint` mandando rodar **Cursor Task** por stage.

**Consequência:** agents/documentação conflitantes; risco de alguém “obedecer” a description e **não** executar o playbook (pipeline “ok” sem artefactos).

Nesta sessão o skill prevaleceu e os 7 stages Task foram executados.

---

## 2. Dificuldades do fluxo (mesmo com sucesso)

### 2.1 Config gate improvisado

Sem `get_zteam_config` / `write_zteam_config`:

- Não há `needsConfig`, `cursorAliases`, `modelSuggestions` oficiais.
- Não há confirmação tipada de `llmRuntime` antes do run (só após falha ou playbook).
- Usuário pediu `inherit` para todos; ainda assim o default de UX quebrou a intenção.

### 2.2 Playbook cursor = orquestração longa e sequencial

Stages executados:

1. SA — requirements  
2. UI/UX — juice (`generalPurpose`)  
3. TA — technologies  
4. UI/UX — look & feel (`generalPurpose`)  
5. SA — todo + specs  
6. SE — implement  
7. QA — tests  

**Dificuldades:**

- Wall-clock alto (vários subagents grandes em série).
- Papel UX mapeado para `subagentType: "generalPurpose"` (não há tipo dedicado `ui-ux` na lista de subagents).
- Prompts do playbook repetem a `userIdea` inteira em cada stage (ruído / custo de contexto).
- Parent agent precisa reforçar paths absolutos (`appRoot`) — histórico prévio com MCP em `mypokecards` aumenta paranoia de path errado.

### 2.3 Bootstrap de documentação zteam

- `README.MD` local foi copiado de outro repo → exemplos de config **sem** `uiUxDesigner`, comandos citando tools MCP inexistentes.
- Skill local (`.zteam/skills/SKILL.md`) espelha o mesmo gap em relação ao servidor real.

### 2.4 Entrega SE/QA (fricção de produto, não de MCP)

Relatados pelos stages (não bloquearam o “pipeline ok”):

| Fonte | Observação |
|-------|------------|
| SE | Gerador procedural **cai com frequência no fallback** curado (ainda válido, mas menos variedade). |
| SE | AI de túnel / reverse ao sair de fright podem precisar de playtest. |
| QA | Fixture MV-4 `unreachableRegion` “inatingível” por construção do grafo. |
| QA | Property tests com `numRuns` baixo (15–20) — cobertura de seeds limitada. |
| QA | Infinite lives: retenção coberta; matriz completa de timing D1–D4 / fright não. |

---

## 3. Possíveis problemas recorrentes / riscos

### 3.1 Drift skill ↔ MCP (estrutural)

| Documento / skill | Servidor MCP atual |
|-------------------|--------------------|
| `get_zteam_config`, `write_zteam_config` | ausentes |
| `workflow`, `workspaceRoot` na API | schema publicado omite; server exige `workspaceRoot` |
| Exemplos SA/TA/SE/QA | runtime exige também `uiUxDesigner` |
| “não use Task” | cursor runtime **exige** Task |

Sem alinhar versões, **toda** nova tentativa `inherit` tende a repetir os mesmos rough edges.

### 3.2 Defaults 9router em papéis novos

Qualquer primary novo (ex.: UX) com default ninerouter + resto `inherit` → **`mixed_runtime` garantido** até o config ser atualizado.

**Mitigação sugerida (produto zteam):**

- Defaults de papéis novos na mesma família do config existente; ou
- Falha `needsConfig` / `missing_role` em vez de silently inject 9router; ou
- Template oficial de `config.json` com **todos** os primaries listados.

### 3.3 Path / WORKSPACE_ROOT errado

Sessão anterior (mesmo workspace) reportou MCP apontando `mypokecards`. Nesta run, com `workspaceRoot` explícito, `appRoot` veio correto.  
**Risco residual:** se o agent omitir `workspaceRoot` ou o MCP ignorar e usar cwd global, artefactos podem ir para o repo errado.

### 3.4 Falsa sensação de “pipeline completo” no MCP

Com `llmRuntime=cursor`, `run_development_pipeline` retorna rápido (`ms: 3` nesta run) só com o playbook.  
O trabalho real é **fora** do MCP. Se o parent não executar Tasks, o usuário vê “ok: true” sem código.

### 3.5 Inconsistência `docsOnly` vs `workflow`

Schema ainda privilegia `docsOnly: boolean`; skill fala em `workflow: "docs" | "full" | …`.  
Risco de modes `feature` / `punch` / `fix` / `resume` não mapeados ou ignorados pelo schema publicado.

### 3.6 Propriedade intelectual / naming

Produto entregue como **Pacman-Z** (inspirado, assets originais). OK legalmente como fan-inspired, mas naming próximo a marca registrada continua sensível em distribuição pública — fora do escopo de erro zteam, mas decisão de produto a monitorar.

---

## 4. O que funcionou bem

- Após corrigir config UX + `workspaceRoot`, o dual-runtime **cursor** comportou-se como desenhado: `delegationPlaybook` claro, stages ordenados, `model: inherit`.
- Artefactos sob `appRoot` correto: `.docs/*`, `src/**`, testes, README.
- QA fechou com **36 testes verdes**.
- Hard constraints do usuário (vidas infinitas, ranking, mazes validados, elementos Pac-Man) foram cobertos em specs + MVP.

---

## 5. Recomendações (zteam / skill / MCP)

### Curto prazo (operacional)

1. Manter sempre `uiUxDesigner` (e qualquer primary novo) no `config.json` quando usar `inherit`.
2. Sempre passar `workspaceRoot` absoluto = pasta aberta no Cursor.
3. Tratar description “Do not use Task” como **obsoleta** quando `delegated === true`.
4. Não copiar `config.json` de projetos antigos sem diff contra o schema de roles atuais.

### Médio prazo (produto)

1. Expor de novo `get_zteam_config` / `write_zteam_config` **ou** atualizar skill/README para o surface real.
2. Publicar no `inputSchema` os campos reais (`workspaceRoot`, `workflow`, …) alinhados à validação.
3. Incluir `uiUxDesigner` em todos os exemplos e no bootstrap automático.
4. Em `mixed_runtime` / missing role: mensagem com **snippet de config sugerido** (já parcial no `resumeHint` — reforçar).
5. Atualizar description da tool para refletir dual runtime (cursor Task vs 9router LangGraph).

### Verificação pós-run (checklist)

- [ ] `.zteam/config.json` tem **todos** os primaries na mesma família  
- [ ] `run_development_pipeline` → `ok` + se `cursor`, playbook executado stage a stage  
- [ ] Artefactos em `appRoot` esperado (não noutro repo)  
- [ ] `npm test` / build locais verdes  

---

## 6. Evidências (referências da sessão)

| Evento | Evidência |
|--------|-----------|
| Tools MCP | GetDynamicTools `user-zteam` → só `mcp_auth`, `run_development_pipeline` |
| Erro schema | `-32602` … `workspaceRoot` undefined |
| Erro runtime | `failureKind: mixed_runtime` + roles dump com UX em 9router |
| Sucesso | `ok: true`, `llmRuntime: "cursor"`, `delegated: true`, 7 stages |
| Config final | `.zteam/config.json` com SA/TA/UX/SE/QA = `inherit` |
| Testes | `vitest run` → 7 files / 36 tests passed |

---

## 7. Conclusão (orquestração)

A orquestração **falhou duas vezes na porta de entrada do zteam** (schema/`workspaceRoot`, `mixed_runtime` UX) e depois o playbook cursor entregou um MVP **aparentemente** completo. Em playtest, porém, o fluxo de telas estava quebrado (§8) — ou seja, “pipeline ok + testes verdes” **não** equivaleram a DoD de produto.

ROI de correção em duas frentes:

1. **MCP + skill + template de config** (surface de tools, schema, papel `uiUxDesigner`, texto anti-Task).
2. **Gate de qualidade do playbook** — QA obrigatório para specs de screen-flow / UI state; SE não marca `[x]` em `screens-flow` sem verificação visual ou teste de overlay exclusivity.

---

## 8. Defeito de produto: telas/overlays sobrepostos (playtest)

### 8.1 Sintoma (evidência)

Playtest manual após o pipeline mostrou na **mesma** vista de Play:

- HUD ativo (`SCORE 730`, `LEVEL 1`) e labirinto jogável (personagem + pellets).
- Overlay **PAUSED** (Resume / Quit).
- Texto **“Generating maze…”** por cima do menu de pause.

Ou seja: estados **loading**, **paused** e **gameplay** coexistindo. A jogabilidade por **teclado** continua (score sobe), mas a tela “não troca” corretamente — chrome de loading/pause nunca some de forma exclusiva. Isso **deveria ter sido pego em testes** ligados a `screens-flow` / busy UI; a suite atual **não cobre** essas classes.

Evidência visual: screenshot de playtest anexado à sessão (overlays `PAUSED` + `Generating maze…` sobre maze com score > 0).

### 8.2 Causa técnica (código)

Em `PlayScreen.ts`, busy e pause usam o atributo HTML `hidden`. Em `main.css`:

```css
.busy-overlay { display: flex; /* … */ z-index: 6; }
.overlay       { display: flex; /* … */ z-index: 5; }
```

No cascade do browser, `display: flex` do autor **vence** o `display: none` implícito de `[hidden]`. Resultado:

- `showBusy(false)` / `setPaused(false)` só mexem no atributo — **visualmente o overlay continua montado**.
- Busy (z-index 6) e pause (z-index 5) podem aparecer juntos.
- Input de teclado ainda alimenta a simulação → score sobe “atrás” dos overlays.

Contrato já existia nas specs:

| Spec | Contrato violado |
|------|------------------|
| `screens-flow` SF-7 / §2.2 | Pause é overlay de Play; busy só quando gen > 100 ms |
| `screens-flow` §1.4 AC | Path Title→Play→Esc pause→Resume; busy não silencioso |
| `screens-flow` §3.4 | **Unit tests** de transições SF-1…SF-7 (não implementados) |
| `maze-generation` | Busy UI hook; overlay some após maze validado |
| TA `technologies` / App state | Spec pediu `'play-paused'` na state machine; SE colapsou pause em flags locais sem exclusão mútua de overlays |

### 8.3 Falha por responsabilidade de subagente / estágio

| Estágio (playbook) | Papel | O que fez | Falha relevante? | Por quê |
|--------------------|-------|-----------|------------------|---------|
| `sa-requirements` | System Architect | Requirements + depois specs | **Contributória baixa** | Contrato de telas/busy/pause está escrito; DoD de `screens-flow` §3.5 (“busy state **hook exists**”) é fraco demais — aceita hook sem “busy **clears** e é exclusivo vs pause”. |
| `ux-juice` / `ux-design-system` | UI/UX (`generalPurpose`) | Juice + `ui-ux.md` | **Contributória baixa** | Pediu busy só se gen > 100 ms; não exigiu matriz de exclusão de overlays (loading ⊥ pause ⊥ playing) como critério testável. |
| `ta-stack` | Technology Architect | `technologies.md` | **Contributória média** | Spec TA em `screens-flow` pediu state machine com `'play-paused'` e testes de router; não fixou padrão DOM seguro (`hidden` + `display`, ou classe `.is-visible`). |
| `sa-todo-and-specs` | System Architect | 14 specs + todo | **Contributória média** | Marcou testes de SF como “light”; backlog não tornou **bloqueante** um teste de overlay exclusivity / transição Start→Play limpa. |
| **`se-implement`** | **Software Engineer** | MVP + `[x]` em todos os todos | **Falha primária** | Implementou overlays com `display:flex` + `[hidden]`; não validou visualmente Title→Play→pause; assinalou `screens-flow` completo sem cumprir AC de UI limpa. |
| **`qa-tests`** | **QA Engineer** | 36 testes maze/ranking/lives/score | **Falha primária (escape)** | **Zero** testes de `PlayScreen` / App router / busy/pause. Spec §3.4 pediu unit de SF-1…SF-7; QA restringiu-se ao que o SE já destacou (maze/ranking) e reportou residual risk sem cobrir screen chrome. Suite verde = **falso sinal de pronto**. |

**Síntese:** o prompt/pipeline **gerou** o defeito no estágio **SE**; o estágio **QA** **deveria ter barrado** e não barrou. SA/TA/UX deixaram o contrato testável **subespecificado** (DoD fraco + testes “light”), o que facilitou o escape.

```text
[SA/UX/TA] contrato parcial → [SE] bug CSS/estado → [QA] não testa screens-flow → playtest humano encontra
```

### 8.4 Correção sugerida

**Código (SE / hotfix):**

1. Não usar `display:` fixo em elementos toggláveis por `[hidden]`. Opções:
   - `.busy-overlay[hidden], .overlay[hidden] { display: none !important; }`, ou
   - toggle de classe `.is-open { display: flex }` e default `display: none`.
2. Garantir exclusão mútua: ao `showBusy(true)`, forçar pause fechado; ao `setPaused(true)`, busy deve estar off (e vice-versa).
3. Opcional: alinhar App a `'play' | 'play-paused'` como na spec, com um único “mode” de chrome.

**Testes (QA — o que faltou):**

1. Unit/DOM (jsdom ou happy-dom): após `showBusy(false)`, overlay busy **não** está visível (`hidden` efetivo / `getComputedStyle` / classe).
2. Após Start simulado: busy ausente e pause ausente; após Esc: só pause; busy ausente.
3. Transições SF-1…SF-7 do reducer/router (como `screens-flow` §3.4).
4. Regressão: score/HUD podem atualizar só com `paused === false` e busy off.

**Processo zteam (playbook):**

1. QA **não** pode dar stage done só com maze/ranking se existir spec `screens-flow` `[x]`.
2. SE **não** marca `screens-flow` `[x]` sem checklist visual mínimo (Title→Play limpo; Esc pause; Resume).
3. Endurecer DoD da spec: “no máximo um overlay modal visível; busy never stuck after validated maze”.

### 8.5 Relação com o “sucesso” do pipeline

| Sinal do pipeline | Realidade |
|-------------------|-----------|
| `ok: true` / stages Task complete | Orquestração cursor OK |
| `.docs/todo.md` 14/14 `[x]` | Inclui `screens-flow` marcado feito **incorretamente** |
| `npm test` 36/36 | Não inclui UI de telas → **falso verde** |
| Playtest | Fluxo de tela quebrado; jogabilidade por teclado mascara o bug |

Isto é exatamente o tipo de falha que um gate “QA cobre acceptance das specs marcadas `[x]`” deveria impedir antes de declarar o produto pronto.
