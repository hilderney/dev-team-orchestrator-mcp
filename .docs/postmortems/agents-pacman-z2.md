# Agents Review — Zteam nesta tarefa (Pac-Man Z2)

> Archived postmortem (2026-09-24). Workflow sibling: [workflow-pacman-z2.md](./workflow-pacman-z2.md).

**Data:** 2026-09-24  
**Projeto:** `pacman-z2`  
**Pedido do usuário:** jogo Pac-Man em TypeScript + Canvas (WASD, pellets, fantasmas, energizers, vidas infinitas + contador de mortes, teleporte, hooks de som documentados), via `@zteam`.  
**Resultado final:** jogo entregue, mas **não** como saída limpa da pipeline full do Zteam — documentação inicial e SE falharam; conclusão por recuperação manual a partir de artefato irmão (`pacman-z`).

---

## 1. Resumo executivo

O Zteam **iniciou** a pipeline (SA → TA → specs → SE), mas **não concluiu** um produto alinhado ao pedido. Falhas críticas: (1) gravação fora do workspace Cursor, (2) **drift** forte dos requirements vs. ideia do usuário, (3) SE abortando em specs grandes com respostas LLM vazias / sem `===FILE:===`, (4) erros de runtime (`Cannot read properties of undefined (reading 'message')`) e overload do upstream Nvidia.

**Veredito:** o orquestrador é utilizável como esqueleto de fluxo, mas **ainda não é confiável para greenfield sem supervisão**. Nesta tarefa, o agente Cursor teve de compensar o Zteam.

---

## 2. Linha do tempo do comportamento

| Etapa | O que aconteceu | Impacto |
|-------|----------------|---------|
| 1ª chamada MCP `run_development_pipeline` | Falha imediata (`undefined.message`); depois `mcp_auth` | Atraso; UX frágil |
| 2ª chamada MCP (full) | Relatou QA: `Missing script: "test"` | Artefatos **não** apareceram em `pacman-z2` (workspace vazio) |
| Diagnóstico | `WORKSPACE_ROOT` ausente no MCP → `appRoot` = cwd do processo MCP, não o repo Cursor | Escrita no lugar errado / risco de poluir o pacote do orchestrator |
| CLI com `WORKSPACE_ROOT=pacman-z2` | SA + TA + specs OK; SE concluiu `project-setup` e `types-constants`; **falhou em `maze-system`** após retries (`empty` / `no_file_sections`) | Projeto parcial (scaffold + `types.ts` apenas) |
| Conteúdo gerado (SA/TA) | Requirements/tech com **3 vidas, fruit, CRT, sprite sheet, sem Vite**, etc. | Contradição direta com “vida infinita + simples + hooks de som” |
| `pipeline:docs` corretivo | SA/TA reescreveram docs **ainda piores** (JS puro, esbuild, service worker, 3 vidas); specs crasharam com `undefined.message` | Docs piores que o pedido; pipeline docs incompleta |
| Recuperação | Cópia/adaptação de `pacman-z` (pipeline zteam anterior bem-sucedida) + branding Z2 + evento `teleport` | Entrega jogável; Zteam não “fechou” sozinho |

---

## 3. Falhas cometidas (por categoria)

### 3.1 Infra / orquestração (bloqueantes)

1. **`WORKSPACE_ROOT` não defaulta para o workspace Cursor**  
   Sem env no `mcp.json`, `projectRoot: "."` resolve para o cwd do servidor MCP. Sintoma: Cursor mostra pasta vazia; QA/npm rodam em outro lugar (ou em estado inconsistente).

2. **`projectRoot: "."` é perigoso**  
   Skill/README já alertam para usar pastas tipo `samples/...`, mas o default `.` + cwd errado = risco de sobrescrever README/package do próprio orchestrator.

3. **Crash `Cannot read properties of undefined (reading 'message')`**  
   Ocorreu no cold start do MCP e de novo no estágio de specs (`systemArchitectSpecs`). Indica tratamento de erro incompleto em falhas de stream/upstream (acesso a `.message` sem guard).

4. **Falha silenciosa / pouco acionável para o usuário do IDE**  
   MCP retornou erros de QA ou “retries exhausted”, mas o agente Cursor não tinha path claro “onde foram os arquivos?” sem inspecionar o código do orchestrator.

5. **Estado do MCP instável**  
   Após runs, discovery chegou a marcar namespace `user-zteam` em `error` / STATUS.md pedindo checagem nas settings — atrito operacional.

### 3.2 Qualidade do time LLM (produto)

6. **Requirements drift (falha de fidelidade ao `userIdea`)**  
   Pedido explícito: vida infinita + contador de mortes, TypeScript, Canvas simples, sons só como hooks.  
   Gerado: 3 vidas, game over, fruit, CRT, sprite sheet, bundle &lt;15KB, depois até **ES2020 JS + esbuild + SW**.  
   Não há gate “reler userIdea e rejeitar contradições”.

7. **SE não entrega specs médias/grandes de forma estável**  
   `maze-system` (mapa 28×31 + API) → respostas vazias / sem seções `===FILE:===` → `retries exhausted`. Specs anteriores menores passaram. Padrão: **capacidade/estabilidade do modelo free insuficiente para arquivos densos**.

8. **Upstream overloaded**  
   Logs: `Upstream error from Nvidia: Service temporarily overloaded`. Retries existem, mas 3 tentativas não bastam sob saturação; o grafo aborta em vez de degradar com graça (fila, modelo fallback, spec split).

9. **QA acoplado a `npm test` sem garantir o script**  
   Na 1ª narrativa MCP, QA falhou por script `test` ausente — ou seja, SE/scaffold incompleto ou package.json driftado, e o loop de fix (3 rounds) não recuperou.

10. **Docs-only corretivo piorou o alinhamento**  
    Pedido de “corrigir drift” ainda produziu stack e regras diferentes do usuário. O SA trata “reenquadrar o produto” em vez de “ancorar no userIdea”.

### 3.3 Processo / DX do agente Cursor

11. **Skill Zteam proíbe Task subagents** (`software-engineer`, etc.)  
    Correto para forçar 9router, mas **não há workflow de rescue** documentado quando a pipeline mid-flight falha (ex.: `workflow=fix` + checklist, ou “resume from todo”).

12. **Sem progresso granular acionável no IDE**  
    Heartbeats ajudam, mas o resultado final (“FAILED after 705929ms”) não deixa o workspace em estado “resume-ready” claro (todo parcialmente marcado vs. arquivos reais).

13. **Inconsistência entre artefatos**  
    Em runs falhos, `README` / `requirements` / `todo` / `src` ficaram dessincronizados (todo antigo vs. requirements novos vs. pouco código).

---

## 4. O que deve melhorar **urgentemente**

Prioridade P0 — sem isto o Zteam continua enganoso em greenfield:

| # | Melhoria urgente | Por quê |
|---|------------------|---------|
| U1 | **Default / injeção de `WORKSPACE_ROOT` = pasta do workspace Cursor** (ou exigir no `mcp.json` + falhar cedo se ausente) | Evita “pipeline ok” com pasta vazia no projeto do usuário |
| U2 | **Hard fail se `appRoot` == package root do orchestrator** quando `projectRoot` é `.` | Evita overwrite acidental do MCP |
| U3 | **Guard em todos os `error.message` / stream errors** (fim do crash `undefined.message`) | Estabilidade mínima do MCP |
| U4 | **Fidelity check pós-SA:** diff `userIdea` vs. requirements (regras explícitas: vidas infinitas, stack TS, sem game-over por vidas, etc.) com **re-prompt obrigatório** se violar | Drift foi a falha de produto mais grave |
| U5 | **Split automático de specs grandes** (maze/map em layout + collision + pellets) ou aumentar `MAX_TOKENS` / fallback de modelo no SE | `maze-system` matou a pipeline |
| U6 | **Scaffold sempre gera `test` script + Vitest (ou o que o TA escolheu) antes do QA** | Evita loop QA inútil em “Missing script: test” |
| U7 | **Resume workflow** (`workflow=feature`/`fix` a partir de `.docs/todo.md` + arquivos reais) com validação de progresso | Mid-failure não pode exigir recomeçar do zero |

---

## 5. O que deve melhorar (importante, não bloqueante imediato)

| # | Melhoria | Notas |
|---|----------|-------|
| M1 | Fallback de modelo quando free tier sobrecarrega (paid / outro provider / fila com backoff maior) | Overload Nvidia foi recorrente |
| M2 | Telemetria estruturada: `appRoot`, lista de arquivos escritos, checksum, stage timings → `pipeline-result.json` sempre atualizado | Facilitaria debug no Cursor |
| M3 | Validação de formato LLM **antes** de marcar stage done (markers + bodies não vazios + paths sob `appRoot`) | Já há retries; falta “não promover” artefato ruim |
| M4 | TA deve **respeitar stack pedida** (Vite+TS se o usuário citou) em vez de reinventar esbuild/JS | Preferência do userIdea &gt; “otimização” do TA |
| M5 | Caps de escopo: proibir CRT, fruit, SW, sprite sheet base64 se o userIdea pede “simples” | Reduz tokens e falhas no SE |
| M6 | Notificação MCP com path absoluto de cada write | O agente Cursor gasta tempo caçando arquivos |
| M7 | Smoke pós-SE por spec: `tsc --noEmit` / `vitest` incremental, não só QA no fim | Detecta regressão cedo |
| M8 | Documentar no skill: o que fazer se pipeline falhar (não copiar projetos irmãos sem aviso; preferir `WORKSPACE_ROOT` + resume) | DX do operador humano/agente |
| M9 | Isolar runs: não deixar `pipeline-result.json` de outro app (`testepac`) confundir diagnóstico | Estado global do pacote MCP |
| M10 | Testes de contrato do orchestrator (unit): resolveAppRoot, parse FILE sections, error wrapping | Regressão das falhas U1–U3 |

---

## 6. O que funcionou bem

- Fluxo LangGraph **claro** (router → SA → TA → specs → SE→QA→finalize) e logs de stage/heartbeat úteis.  
- Em condições boas (artefato `pacman-z` anterior), o mesmo time **já entregou** um Pac-Man alinhado (vidas infinitas, SoundBus, Vite, testes).  
- Specs granulares quando bem geradas (`01`…`10` no sibling) são um bom contrato para SE.  
- Retry de stream→invoke e retries de conteúdo inválido existem (só não bastam sob overload + specs grandes).  
- Skill Zteam evita misturar Task subagents do Cursor com 9router — intenção correta de “um time”.

---

## 7. Recomendações práticas para o operador (até o P0 existir)

1. Sempre definir `WORKSPACE_ROOT` no env do MCP (já apontado para `pacman-z2` nesta máquina) e **reiniciar o servidor MCP**.  
2. Preferir `projectRoot` dedicado (`"."` só se `WORKSPACE_ROOT` já for a pasta do app).  
3. Em greenfield sensível: rodar **`docs` primeiro**, revisar requirements à mão, só então `full`/`feature`.  
4. Se SE falhar em uma spec: reduzir a spec, subir tokens do SE, ou retomar com ideia “implement only remaining todo items”.  
5. Não confiar em “pipeline FAILED” sem listar `appRoot` e `dir` do projeto.

---

## 8. Conclusão

Nesta tarefa o Zteam **comportou-se como um pipeline frágil**: orquestra estágios, mas **perde o workspace**, **distorce o pedido** e **para no meio da implementação** sob pressão do modelo free. As melhorias urgentes são de **ancoragem de path**, **fidelidade ao userIdea**, **robustez a erro/LLM vazio** e **resume**. Sem isso, `@zteam` continua a exigir um agente Cursor (ou humano) como rede de segurança — o oposto do valor prometido do time autônomo.
