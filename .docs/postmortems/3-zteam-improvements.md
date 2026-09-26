# Plano de melhorias — zTeam MCP

> **Status: implemented (2026-09-25)** — archived historical backlog (P0–P2 largely shipped). Not an active todo list.

**Base (external session notes, not in this repo):** `zz-zteam-report.md`, `zz-zteam-errors-mcp.md`, `zz-zteam-errors-9router.md`, `zz-zteam-cross-analysis.md`  
**Princípio:** atacar P0 de harness/contrato antes de otimizar modelos.

**Evidência-chave do relatório (2026-09-24):**

- Pipeline `full` gastou **41,5 min** e terminou em falha QA (`search-cards`), não por bug de feature, e sim porque `vitest`/dependências nunca foram instalados no `appRoot`.
- Pipeline `fix` (4,6 min) falhou porque `vitest` **não estava no PATH**.
- 3 rounds de fix SE (~7 min de LLM) foram gastos tentando "corrigir testes" sem que o ambiente de teste existisse — ou seja, o P0-1/P0-2 abaixo eliminariam ~7 min de trabalho 100% desperdiçado por execução.
- Retries `no_file_sections`: 3 ocorrências no estágio SE + 4 consecutivas em 1 fix (`card-detail`, até 4/6) — indício de que o contrato `===FILE:===` precisa de re-prompt mais agressivo, não apenas de mais tentativas.
- 26 heartbeats rotulados `[error]` no log MCP — ruído puro, sem relação com falha real.
- Uma falha histórica de **562 s (~9,4 min)** até detectar Cloudflare 530/DNS 1016 — sem healthcheck, esse tempo é 100% perdido antes do primeiro spec.
- 9router (33 chamadas, 100% `succeeded`, sem fallback exercitado) mostra que o modelo/roteador **não é o gargalo** — reforça a priorização P0/P1 sobre P2.

---

## 1. Objetivos

1. Pipeline `full` greenfield terminar com **`npm test` verde** (ou falha de asserção real, não de bootstrap).
2. Reduzir retries `no_file_sections` e eliminar `retries exhausted` em condições normais.
3. Manter MCP **conectado** após falhas (progress token válido / sem spam pós-teardown).
4. Tornar logs **triáveis** (níveis corretos) e correlacionáveis com 9router.
5. Eliminar o desperdício medido: **zero rounds de fix gastos em causa raiz de ambiente** (install/PATH/runner) e **< 30 s** para detectar infra fora do ar.

---

## 2. Backlog priorizado

### P0 — Desbloqueia conclusão do pipeline

| ID | Melhoria | Onde | Critério de aceite | Esforço |
|----|----------|------|--------------------|--------:|
| P0-1 | **Bootstrap gate greenfield:** antes do primeiro QA, exigir `package.json` + script `test` + `npm install` (ou `npm ci`) no `appRoot` | prepare / SE / QA | Se install falhar, abortar com erro classificado `bootstrap`, sem 3 rounds de fix de spec. Elimina os ~7 min de fix desperdiçado observados no `full` de 2026-09-24 | M |
| P0-2 | **QA runner canônico:** sempre `npx vitest run` (ou `npm test` após install); nunca `node --test` em `.ts/.tsx` com JSX | qaEngineer | TAP/vitest report; zero `ERR_INVALID_TYPESCRIPT_SYNTAX` por extensão errada no harness; corrige a causa exata do fail de `card-detail` (`vitest` não reconhecido) | S |
| P0-3 | **Classificador de falha de teste:** se output contém `ERR_MODULE_NOT_FOUND`, `não é reconhecido`, `ETARGET` → rota `bootstrap-fix`, não `softwareEngineerFix` de feature | qaEngineer / router | 1 round de bootstrap; não consumir os 3 fix rounds de spec (hoje: 3/3 gastos em causa raiz de ambiente) | M |
| P0-4 | **Scaffold mínimo no início do `full`:** `package.json`, `vite.config`, `vitest.config`, `tsconfig`, `index.html`, `src/main.tsx` como primeira entrega SE (ou template) | SE / TA | App `npm run build` smoke antes de gerar as ~18-20 features; elimina cenário "features sem app shell" visto no corpus | M |
| P0-5 | **Sanitizar writes:** proibir append de notas PONYTAIL/markdown dentro de arquivos de código/teste; exigir `.tsx` se há JSX | SE writer | `create-deck.test.ts` sem `→ omitido`; testes JSX só em `.tsx` | S |

### P1 — Estabilidade de agentes e MCP

| ID | Melhoria | Onde | Critério de aceite | Esforço |
|----|----------|------|--------------------|--------:|
| P1-1 | **Validação estrita `===FILE:===`** com re-prompt focado (“emit ONLY FILE sections”) e métrica no 9router/zTeam | SE / SE-fix | Taxa `no_file_sections` < 5% das calls (hoje: 3 no estágio SE + até 4/6 consecutivas em 1 fix); zero `retries exhausted` em smoke | M |
| P1-2 | **Lifecycle do progressToken:** parar notifications ao finalizar tool; não reenviar TAP gigante como progress pós-close | MCP server | Zero `unknown token` em falhas controladas (hoje: ~1 por falha de pipeline, ex.: 16:35 `transport_error`) | M |
| P1-3 | **Log levels corretos:** heartbeat/partial/notify → `info`/`debug`; só falhas → `error` | Shared MCP process | Grep `[error]` ≈ falhas reais (hoje: 26 heartbeats rotulados `[error]` são ruído puro) | S |
| P1-4 | **Healthcheck 9router/tunnel** antes de `full` (GET barato / timeout 5s) | pipeline start | Se Cloudflare 1016/530, falhar rápido (<30s) com mensagem clara (hoje: até 562 s/9,4 min até detectar) | S |
| P1-5 | **`WORKSPACE_ROOT` / `projectRoot` safety:** recusar write se `appRoot` ≠ workspace Cursor esperado; nunca default silencioso para outro repo | MCP env | Nenhum artefato em `pacman-z2` quando workspace é `mypokecards` | S |

### P2 — Desempenho, custo e DX

| ID | Melhoria | Onde | Critério de aceite | Esforço |
|----|----------|------|--------------------|--------:|
| P2-1 | **Batch de specs pequenas** (agrupar punch-sized) para reduzir overhead de ~46s/spec (média medida) | SE scheduler | Menos calls SE para N specs triviais; meta: reduzir soma de `dones` (hoje ~13,9 min p/ 18 specs) em ≥ 20% | M |
| P2-2 | **Correlação request-id** (zTeam stage ↔ 9router DONE) | ambos | Um ID rastreável nos dois logs; hoje a amostra 9router (33 chamadas) não referencia spec/stage diretamente | S |
| P2-3 | **Fallback 9router real** sob latência > limiar ou resposta sem FILE | 9router combo | `Trying model 2/N` aparece em caos (hoje: strategy `sticky: 1`, fallback nunca exercitado nas 33 chamadas amostradas) | M |
| P2-4 | **QA smoke separado:** `vitest run tests/smoke` (install+import) antes da suíte por spec | QA | Fail rápido (<10 s) se ambiente quebrado, no mesmo patamar de latência do QA hoje (~5,6 s média) | S |
| P2-5 | **Métricas de pipeline** em `pipeline-result.json`: tempo SE/QA/fix, retries, classeDeErro | finalize | Relatórios automáticos como este, sem análise manual de logs brutos | M |

> Esforço: **S** = pequeno (config/validação pontual), **M** = médio (mudança de fluxo/estado), **L** = grande (nenhum item aqui é L; se crescer, quebrar em sub-tarefas).

---

## 3. Ordem de implementação sugerida

```text
Sprint A (P0):  P0-4 scaffold → P0-1 install gate → P0-2 runner → P0-3 classificador → P0-5 sanitize
Sprint B (P1):  P1-1 FILE contract → P1-2 progress → P1-3 log levels → P1-4 healthcheck → P1-5 workspace
Sprint C (P2):  P2-4 smoke → P2-2 correlation → P2-1 batch → P2-3 fallback → P2-5 metrics
```

Dependência forte: **P0-1/P0-2** desbloqueiam valor imediato; sem eles, P2 de modelo/latência economiza pouco.

---

## 4. Mudanças de comportamento desejadas (antes → depois)

| Situação | Hoje | Depois |
|----------|------|--------|
| `vitest` ausente | 3× SE-fix + abort | 1× bootstrap-fix ou fail classificado |
| Resposta sem FILE | retry até 6 / exhausted | re-prompt curto + métrica; fallback modelo |
| Pipeline falha | disconnect `unknown token` | erro estruturado, MCP permanece usable |
| DNS tunnel down | ~9 min até 530 HTML | <30 s healthcheck |
| Heartbeat | `[error]` | `[info]` |
| Greenfield 20 specs | features sem app shell | shell primeiro, features depois |

---

## 5. Testes de regressão do próprio zTeam

1. **Fixture greenfield vazio** → `full` mínimo (1–2 specs) → assert `npm test` exit 0.
2. **Fixture sem node_modules** → QA deve classificar `bootstrap`, não loop de feature.
3. **Mock LLM sem FILE** → retries limitados + mensagem clara; sem crash MCP.
4. **Mock progress após close** → zero `unknown token` no client.
5. **Healthcheck fail** → pipeline não inicia SE.

---

## 6. Fora de escopo (neste plano)

- Trocar `muse-spark` / `gemma4` só por performance (só após P0). 9router já está em 100% de sucesso neste corpus (33/33 chamadas), então ganho de troca de modelo é marginal frente ao P0.
- Reescrever LangGraph inteiro.
- Alterar o app `mypokecards` (já recuperado manualmente fora do pipeline).

---

## 7. Riscos e mitigações da implementação

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Bootstrap gate (P0-1) falso-positivo em specs que só editam docs/config | Bloqueia trabalho legítimo sem `test` script | Gate só entra em vigor quando o QA for de fato executado; permitir bypass explícito por flag de pipeline |
| Classificador de erro (P0-3) baseado em regex de string pode ter falsos negativos em outros idiomas/runtimes | Falha de ambiente ainda cai no loop de fix de feature | Cobrir os padrões já observados (`ERR_MODULE_NOT_FOUND`, `não é reconhecido`, `ETARGET`) + revisar lista a cada novo corpus de erro |
| Healthcheck (P1-4) adiciona latência fixa a todo pipeline | +alguns segundos mesmo quando tudo está saudável | Timeout curto (5s) e cache do resultado por poucos minutos dentro da mesma sessão |
| Log levels (P1-3) mudar heartbeat para `info` pode esconder heartbeat perdido de fato relevante | Perda de sinal de "processo travado" | Manter um `warn` específico se heartbeat atrasar > 2× o intervalo esperado (30s) |
| Sanitização de writes (P0-5) rejeitar arquivos legítimos com markdown embutido (ex.: fixtures de teste) | Falso bloqueio de specs válidas | Escopo da regra a arquivos `*.test.ts(x)`/`*.spec.ts(x)` e código-fonte, não a fixtures/dados |

---

## 8. Monitoramento pós-implementação

- Rodar as fixtures de regressão da seção 5 em CI a cada mudança no zTeam MCP, não só manualmente.
- Emitir `pipeline-result.json` (P2-5) desde o Sprint A, mesmo antes de todos os itens P2 estarem prontos, para já começar a coletar baseline real e comparar com os números deste relatório.
- Revisar KPIs da seção 9 a cada 2 semanas nas primeiras 4 semanas pós-rollout; depois, mensal.

---

## 9. KPIs de sucesso (30 dias)

| KPI | Baseline (relatório 2026-09-24) | Meta |
|-----|----------------------------------|------|
| Taxa de `full` greenfield que passa QA | 0/2 neste corpus | ≥ 70% em fixtures |
| Fix rounds gastos em causa raiz de ambiente (bootstrap/PATH) | 3/3 rounds (~7 min) no `full` analisado | 0 (classificado antes de consumir round de fix) |
| `no_file_sections` por 100 calls SE | alta o suficiente para atingir 4/6 retries num único fix | < 5 |
| `unknown token` por falha de pipeline | ~1 (ex.: 16:35 `transport_error`) | 0 |
| Tempo até detectar tunnel/DNS down | ~562 s (9,4 min) | < 30 s |
| Heartbeats logados como `[error]` | 26 no trecho analisado | 0 (rotulados corretamente como `info`/`debug`) |
| Tempo médio de fix SE (`stage: fix`) | ~69 s (máx. 198 s) | Sem alvo de redução direta — deve cair naturalmente ao remover fixes de bootstrap |

---

## 10. Referência rápida de prioridade de erros (espelho)

1. Harness/install/vitest  
2. Artefatos de teste inválidos  
3. `no_file_sections`  
4. Progress / disconnect MCP  
5. Cloudflare DNS  
6. Ruído de log  
7. Latência SE (otimização)  
8. Fallback 9router (resiliência)


Backlog de tarefas (checklist, pouco detalhado)
Contrato de saída / parsing
 Especificar tool write_file(path, content) via function calling
 Migrar SE Agent para emitir writes só via tool call, não texto livre
 Remover parser regex de ===FILE:=== após migração
 Validar schema da tool call (path relativo, extensão coerente com conteúdo)
 Criar passo de "reparo de formato" barato (corrige contrato sem regenerar conteúdo)
 Métrica: taxa de tool-calls malformadas por 100 calls
Bootstrap / ambiente
 Implementar bootstrap gate antes do primeiro QA (P0-1)
 Padronizar runner para npx vitest run (P0-2)
 Criar classificador de erro de ambiente (regex ERR_MODULE_NOT_FOUND, não é reconhecido, ETARGET) (P0-3)
 Scaffold mínimo automático no início do full (P0-4)
 Bypass de gate via flag explícita de pipeline (para specs só-doc)
 Testar gate em modo shadow/log-only antes de bloquear
 Expandir lista de padrões de erro de ambiente a cada novo corpus
Isolamento / sandbox
 Definir imagem base com Node/npm/vitest pré-instalados
 Rodar cada pipeline em container/venv efêmero
 Cache de layer de dependências entre runs
 Recusar write fora do workspace esperado (P1-5)
 Teste automatizado: pipeline não deve tocar repo diferente do configurado
 Limite de recursos (CPU/mem/disco) por container de pipeline
Máquina de estados / checkpoint
 Modelar pipeline como FSM explícita (estágios e transições nomeados)
 Persistir estado após cada transição de estágio
 Implementar resume a partir do último checkpoint válido
 Teste: matar processo no meio do full e validar resume
 Expor estado atual do pipeline via tool de leitura (para debug)
Orçamentos / circuit breakers
 Definir orçamento de retry por classe de erro (bootstrap, contrato, lógica)
 Definir timeout de wall-clock por estágio
 Circuit breaker: abortar estágio com erro estruturado ao estourar orçamento
 Healthcheck de 9router/tunnel antes do full (P1-4)
 Cache de resultado do healthcheck por poucos minutos
 QA smoke separado (tests/smoke) antes da suíte completa (P2-4)
MCP / lifecycle
 Encerrar notifications de progresso ao finalizar a tool (P1-2)
 Impedir reenvio de TAP grande como progress pós-close
 Teste: mock de progress após close, assert zero unknown token
 Padronizar erro estruturado ao invés de disconnect cru
 Garantir MCP permanece "usable" após falha de pipeline
Observabilidade / logs
 Corrigir log levels: heartbeat/partial/notify → info/debug (P1-3)
 Adicionar warn específico se heartbeat atrasar > 2x intervalo
 Gerar trace_id único por pipeline run
 Propagar trace_id/correlation-id entre zTeam e 9router (P2-2)
 Emitir logs em JSONL estruturado
 Emitir pipeline-result.json com tempos por estágio, retries, classe de erro (P2-5)
 Montar dashboard simples (ou queries jq) sobre os JSONL acumulados
Roteamento de modelo (9router)
 Rotear classificação de erro para modelo mais barato/rápido
 Rotear reparo de contrato para modelo barato
 Manter modelo forte só para geração de feature/código
 Implementar fallback real sob latência/resposta sem FILE (P2-3)
 Medir custo/latência por função de chamada, não só por chamada agregada
Escalonamento humano
 Definir evento formal "pipeline pausado — aguardando decisão"
 Gerar pacote de diagnóstico ao pausar (logs, último estado, causa)
 Notificação (webhook/console) ao entrar em pausa
 Interface simples para humano retomar/abortar/redirecionar
Cache / custo
 Levantar padrões repetidos de scaffold/boilerplate entre projetos
 Criar biblioteca de outputs validados reaproveitáveis (cache por similaridade)
 Curto-circuitar geração quando padrão já validado existe
 Batch de specs pequenas (P2-1)
Testes / CI do próprio MCP
 Fixture greenfield vazio → assert npm test exit 0 (seção 5.1)
 Fixture sem node_modules → assert classificação bootstrap (seção 5.2)
 Mock LLM sem FILE → assert retries limitados, sem crash (seção 5.3)
 Mock progress pós-close → assert zero unknown token (seção 5.4)
 Healthcheck fail → assert pipeline não inicia SE (seção 5.5)
 Rodar as 5 fixtures acima em CI a cada mudança no zTeam MCP
 Cenário de caos: simular DNS/Cloudflare down em CI
 Sanitização de writes: bloquear notas markdown em *.test.ts(x)/*.spec.ts(x) (P0-5)
Sanitização / código gerado
 Exigir .tsx quando há JSX (P0-5)
 Escopar regra de sanitização a código-fonte/teste, não fixtures/dados
 Lint automático pós-write antes de considerar arquivo "aceito"
Rollout / governança
 Rodar gates novos (P0-1, P0-3) em modo shadow antes de bloquear
 Revisar KPIs da seção 9 a cada 2 semanas nas primeiras 4 semanas
 Comparar baseline do relatório 2026-09-24 com métricas pós-rollout