# Tiny-counter dry-run — revisão em raciocínio (2 tasks)

Exercício **sem MCP/LLM**: simular `workflow=full` para um app completo mínimo e checar se os gates da higiene ([6-zz-review-hygiene.md](./6-zz-review-hygiene.md)) se comportam como esperado.

Data: 2026-09-25 · Código: `src/orchestrator.ts`, `verify-delivery.ts`, `spec-batch.ts`, `healthcheck.ts`

---

## 1. Pedido imaginário (fixo)

| Campo | Valor |
|-------|--------|
| **workspaceRoot** | Pasta Cursor aberta (absoluta) |
| **projectRoot** | `samples/tiny-counter` |
| **workflow** | `full` |

**userIdea:**

> Vite + React + TypeScript. Single-page counter: one number, buttons +1 and −1, start at 0. No router, no API, no i18n. Portuguese UI labels (“Contador”, “Mais”, “Menos”).

### Duas tasks de produto (+ project-setup do scaffold)

| slug | Título | Files to touch (limpos) |
|------|--------|-------------------------|
| `counter-ui` | Contador com botões Mais/Menos | `src/App.tsx`, `src/components/Counter.tsx` |
| `counter-styles` | Estilo mínimo do contador | `src/index.css`, `src/components/Counter.tsx` |

Specs punch-sized; paths válidos para `parseFilesToTouch`; SE `maxBatch` default = **1**.

Chamadas hipotéticas do agent:

1. `get_zteam_config({ workspaceRoot, projectRoot: "samples/tiny-counter" })`
2. Se `needsConfig` → `@zteam/models` / `write_zteam_config` (parar até `needsConfig === false`)
3. `run_development_pipeline({ workspaceRoot, projectRoot, userIdea, workflow: "full" })`

---

## 2. Percurso `full` — estágio → pass/fail → gate

### A. Pré-pipeline

| Passo | Esperado | Gate | Hipótese |
|-------|----------|------|----------|
| `projectRoot` | `samples/tiny-counter` (não `.` na raiz do pacote MCP) | `assertSafeAppRoot` | **PASS** se não escrever no package root |
| Config | `.zteam/config.json` ou `MODEL_*` | `configGateSatisfied` | **PASS** com config; senão **FAIL** `needsConfig` (tools no fonte) |
| Healthcheck | `NINEROUTER_BASE` OK | fail TTL ~20s + hint túnel | **PASS** se 9router up; senão **FAIL** curto, não loopar `(cached)` |
| Progress | MCP stdio | `consoleEnabled=false` | **PASS** — sem `[stage]` no stdout (D15) |

### B. Bootstrap → SA pré-reqs → clean → fidelity

| Estágio | Artefato | Gate | Hipótese |
|---------|----------|------|----------|
| `orchestratorBootstrapReadme` | README charter + stub requirements (1ª vez) | `shouldWriteRequirementsStub` | **PASS** — pasta vazia → escreve stub |
| SA pré-reqs (~3–5) | Seções `##` em `.docs/requirements.md` | parse `##` / retries | **PASS** se LLM devolver headings; risco truncamento 9router (OUT cap) |
| `orchestratorCleanReadme` | Strip stub italic | strip + fidelity prep | **PASS** |
| `fidelityCriticRequirements` | vs userIdea | stub só falha **sem** `##`; sem API inventada | **PASS** esperado (idea sem TCGdex/router) |
| Re-`full` depois | requirements ricos | preserve se `##` + ≥80 chars | **PASS** — não wipe (D05); wipe só com `ZTEAM_FORCE_BOOTSTRAP=1` |

### C. TA + specs (2 tasks)

| Estágio | Artefato | Gate | Hipótese |
|---------|----------|------|----------|
| TA | `.docs/technologies.md` (Vite/React/TS/vitest) | empty → `llm_empty` | **PASS** se TA preencher; sem router/API |
| Arch critic | gaps idea↔tech/specs | tokens críticos | **PASS** — ideia sem APIs nomeadas |
| SA specs | `todo.md` + `.docs/specs/*.spec.md` | 1:1 todo↔`===SPEC===` + disco + Files to touch limpos | **PASS** se SA emitir p.ex. `project-setup` + `counter-ui` + `counter-styles` **com** 3 SPEC blocks e paths limpos |
| Anti-padrão | 3 slugs no todo, 2 SPEC | `assertParsedTodoAndSpecs` | **FAIL** `parse_failed` (D06) — correto |
| Anti-padrão | `src/features/x/ (or closest)` | `assertFilesToTouchClean` | **FAIL** `spec_incomplete` (D11) — correto |

Todo hipotético saudável:

```markdown
- [ ] project-setup: Vite React TS shell
- [ ] counter-ui: Contador com botões Mais/Menos
- [ ] counter-styles: Estilo mínimo do contador
```

### D. Scaffold + project-setup

| Estágio | Artefato | Gate | Hipótese |
|---------|----------|------|----------|
| `scaffoldPrepare` | template vite+vitest + npm install | não marca `[x]` | **PASS** — shell em disco, todo ainda `[ ]` project-setup |
| SE (1º) | `project-setup` | DoD: `package.json` + `App`/`main` + tsc se tsconfig | **PASS** sem LLM se disco já satisfaz (“already satisfies DoD”) |

### E. SE das 2 tasks (batch=1)

| Ordem | Spec | verifyDelivery | Hipótese |
|-------|------|----------------|----------|
| 1 | `counter-ui` | Files to touch + `tsc`; só então `[x]` | **PASS** se SE emitir os 2 ficheiros; **FAIL** `spec_incomplete` / `llm_empty` se 0 ficheiros ou partial |
| 2 | `counter-styles` | idem (`index.css` + `Counter.tsx`) | **PASS** em lote separado; overlap em `Counter.tsx` OK |
| Batch | `resolveSeMaxBatch("full")` → 1 | não agrupa as 2 | **PASS** (D09 mitigado) |
| Empty | `IN 0·OUT 0` no 9router | fallback imediato se `models.fallback` | **PASS** só com fallback configurado; senão esgota retries → `llm_empty` |

### F. QA + finalize

| Estágio | Esperado | Hipótese |
|---------|----------|----------|
| QA | vitest por spec / smoke | **PASS** se scaffold+tests mínimos; bootstrapFix se vitest ausente |
| Finalize | README status + `.docs/pipeline-result.json` | `batchSize: 1`, `ok: true`, sem `specsMarkedWithoutFiles` se DoD ok |

---

## 3. Caminhos laterais

| Cenário | Esperado no código atual |
|---------|---------------------------|
| `workflow=docs` | Para após specs/arch critic; **sem** SE/QA |
| `resume` com `[ ]` e sem `.spec.md` | Warning + `resumeHint: missing specs: … — rerun workflow=feature` |
| `resume` com specs no disco | Enfileira só slugs com ficheiro; SE batch=1 |
| Segundo `full` com requirements ricos | **Não** apaga sections; force só via env |
| `workflow=punch` | `maxBatch` até 3 (env pode forçar 1–3) |

---

## 4. Riscos que ainda dependem do 9router / LLM (não do orchestrator)

1. **SA/TA empty ou truncado** (cap OUT ~1600 free) → retries / `llm_empty` / pré-reqs incompletas.
2. **SE `IN 0 · OUT 0` “succeeded”** no 9router → client trata como empty; sem `fallback` no config o pipeline aborta.
3. **Healthcheck / túnel Cloudflare 1016** — bloqueia antes do grafo; cache de falha ~20s.
4. **Qualidade das 2 specs** — se o SA inventar prosa em Files to touch, o gate (agora) falha cedo (bom), mas exige re-run `feature`.
5. **QA flaky / modelo QA free** — menos crítico neste app (pouca lógica), mas ainda LLM-dependent.

---

## 5. Veredito

**Sim — o fluxo está hygiene-ready para um app completo mínimo de 2 tasks**, desde que config + 9router estejam saudáveis e o SA emita todo/specs 1:1 com paths limpos.

O orchestrator já cobre os sabotagens estruturais (wipe de requirements, todo sem specs, batch>1, stdio JSON, project-setup fantasma, paths ambíguos). O que resta para fechar E2E neste dry-run é só **qualidade/disponibilidade do combo LLM no 9router** e **config/fallback** no `.zteam/config.json`.
