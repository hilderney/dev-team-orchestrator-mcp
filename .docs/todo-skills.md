# Todo — skills (role × phase × projectType)

Backlog vivo da **Fase 9**. Charter: [postmortems/9-skills-catalog.md](./postmortems/9-skills-catalog.md).  
Ficheiros: [`.zteam/skills/roles/`](../.zteam/skills/roles/).

**Status:** `pilot` = conteúdo útil · `stub` = ficheiro criado, enriquecer · `planned` = só nesta lista · `n/a` = sem skill LLM.

**Prioridade:** P0 = piloto webgame/crud/TDD · P1 = webapp/backend · P2 = outros tipos · P3 = analyze/wiring.

---

## Resolução

```text
exact {role}-{phase}-{projectType|qualifier} → else {role}-{phase}-core
```

---

## On disk (stub | pilot) — smoke verifica estes paths

Lista de ficheiros que **devem existir** sob `.zteam/skills/roles/`:

```
# ON_DISK_SKILLS
sa-bootstrap-core.md
sa-requirements-core.md
sa-requirements-crud.md
sa-requirements-webgame.md
sa-requirements-webapp.md
sa-requirements-backend.md
sa-todo-plan-core.md
sa-spec-write-core.md
sa-summary-core.md
sa-tech-debt-core.md
sa-analyze-core.md
ux-juice-core.md
ux-juice-webgame.md
ux-juice-webapp.md
ux-look-and-feel-core.md
ux-look-and-feel-webgame.md
ux-spec-flow-core.md
ux-flow-webgame.md
ux-flow-webapp.md
ux-analyze-core.md
ta-technologies-core.md
ta-technologies-webgame.md
ta-technologies-backend.md
ta-technologies-crud.md
ta-spec-tech-core.md
ta-spec-tech-webgame.md
ta-analyze-core.md
se-tdd-green-core.md
se-implement-tdd-green.md
se-tdd-green-webgame.md
se-tdd-green-crud.md
se-fix-core.md
se-analyze-core.md
se-delivery-critic-core.md
qa-tdd-red-core.md
qa-tdd-red-screenflow.md
qa-tdd-red-api-contract.md
qa-tdd-red-forms.md
qa-tdd-verify-core.md
qa-tdd-verify-screenflow.md
qa-tdd-verify-api-contract.md
qa-analyze-core.md
qa-analyze-coverage.md
README.md
```

---

## Catálogo detalhado

| ID | File | Role | Phase | Type | needsUiFlow | Prio | Status | Mission | Artefacts | DoD / anti-patterns | Prompt / node |
|----|------|------|-------|------|-------------|------|--------|---------|-----------|---------------------|---------------|
| S-SA-01 | sa-bootstrap-core.md | sa | bootstrap | core | — | P1 | stub | Resume + Pré Requirements checklist | README.md | Sem stack; sem código | systemArchitectBootstrapPrompt |
| S-SA-02 | sa-requirements-core.md | sa | requirements | core | — | P0 | stub | Expandir pré-reqs technology-agnostic | .docs/requirements.md | ACs testáveis; sem TBD | systemArchitectReqItemPrompt |
| S-SA-03 | sa-requirements-crud.md | sa | requirements | crud | false | P0 | pilot | CRUD + alt paths | requirements.md | Sem metáforas de jogo | same |
| S-SA-04 | sa-requirements-webgame.md | sa | requirements | webgame | true | P0 | stub | Loops, score, telas, input | requirements.md | Fluxos de ecrã explícitos | same |
| S-SA-05 | sa-requirements-webapp.md | sa | requirements | webapp | true | P1 | stub | Nav, auth UX, empty/error | requirements.md | Rotas + estados vazios | same |
| S-SA-06 | sa-requirements-backend.md | sa | requirements | backend | false | P1 | stub | Endpoints, schemas, authz | requirements.md | Contratos de falha | same |
| S-SA-07 | sa-todo-plan-core.md | sa | todo-plan | core | — | P0 | stub | Chunks testáveis → todo | .docs/todo.md | ≥1 AC testável por slug | systemArchitectTodoPlanPrompt |
| S-SA-08 | sa-spec-write-core.md | sa | spec-write | core | — | P0 | stub | Spec por slug (≥3 use cases) | .docs/specs/*.spec.md | Sem DoD “hook exists” | systemArchitectSpecItemPrompt |
| S-SA-09 | sa-summary-core.md | sa | summary | core | — | P2 | stub | Relatório dono | user-report.md | Fiel a requirements | systemArchitectProjectSummaryPrompt |
| S-SA-10 | sa-tech-debt-core.md | sa | tech-debt | core | — | P2 | stub | Julgar dívida vs espírito | tech-debt-plan.md | Plan-mode; não auto-implement | systemArchitectTechDebtReviewPrompt |
| S-SA-11 | sa-analyze-core.md | sa | analyze | core | — | P3 | stub | Parecer SA read-only | .docs/reviews/* | Sem implementar | analyzePrepare |
| S-UX-01 | ux-juice-core.md | ux | juice | core | true* | P0 | stub | Score + juice addendum ≥7 | requirements.md UX addendum | Sem inventar features | uiUxRequirementsPrompt |
| S-UX-02 | ux-juice-webgame.md | ux | juice | webgame | true | P0 | stub | Feedback ação/reação de jogo | same | Juice de input/score | same |
| S-UX-03 | ux-juice-webapp.md | ux | juice | webapp | true | P1 | stub | Feedback forms/nav | same | Empty/error juice | same |
| S-UX-04 | ux-look-and-feel-core.md | ux | look-and-feel | core | true* | P0 | stub | ui-ux.md look/palette/sensory | .docs/ui-ux.md | Evidence-based emotion | uiUxDesignSystemPrompt |
| S-UX-05 | ux-look-and-feel-webgame.md | ux | look-and-feel | webgame | true | P0 | stub | Chrome de jogo + hierarquia | ui-ux.md | Overlays no design system | same |
| S-UX-06 | ux-spec-flow-core.md | ux | spec-flow | core | true* | P0 | stub | Enrich Flow & states genérico | specs/*.spec.md | ACs testáveis | uiUxSpecEnrichPrompt |
| S-UX-07 | ux-flow-webgame.md | ux | spec-flow | webgame | true | P0 | pilot | Exclusão overlays | Flow & states | busy⊥paused⊥playing | same |
| S-UX-08 | ux-flow-webapp.md | ux | spec-flow | webapp | true | P1 | stub | Nav/forms flow | Flow & states | Rotas + empty | same |
| S-UX-09 | ux-analyze-core.md | ux | analyze | core | — | P3 | stub | Review UX read-only | reviews/* | Sem redesign total | analyze |
| S-TA-01 | ta-technologies-core.md | ta | technologies | core | — | P0 | stub | Stack + pastas + padrões | technologies.md | Cost-benefit; sem feature code | technologyArchitectPrompt |
| S-TA-02 | ta-technologies-webgame.md | ta | technologies | webgame | true | P0 | stub | Game loop + chrome DOM seguro | technologies.md | Sem flex+[hidden] armadilha | same |
| S-TA-03 | ta-technologies-backend.md | ta | technologies | backend | false | P1 | stub | Rotas/persistência/authz | technologies.md | Contratos API | same |
| S-TA-04 | ta-technologies-crud.md | ta | technologies | crud | false* | P1 | stub | Forms/API stack | technologies.md | Validação partilhada | same |
| S-TA-05 | ta-spec-tech-core.md | ta | spec-tech | core | — | P0 | stub | How-to técnico na spec | specs | Ajuda SE; sem reescrever UX | technologyArchitectSpecEnrichPrompt |
| S-TA-06 | ta-spec-tech-webgame.md | ta | spec-tech | webgame | true | P0 | stub | State machine chrome | specs | Estados exclusivos | same |
| S-TA-07 | ta-analyze-core.md | ta | analyze | core | — | P3 | stub | Review stack | reviews | Sem migrar stack | analyze |
| S-SE-01 | se-tdd-green-core.md | se | tdd-green | core | — | P0 | stub | Pointer → se-implement-tdd-green | src/** | Sem [x] | softwareEngineerImplementPrompt |
| S-SE-02 | se-implement-tdd-green.md | se | tdd-green | multi | — | P0 | pilot | Green multi-type | src/** | Sem enfraquecer red | same |
| S-SE-03 | se-tdd-green-webgame.md | se | tdd-green | webgame | true | P0 | stub | Overlays/chrome exclusivos | src/** | Sem stack de modais | same |
| S-SE-04 | se-tdd-green-crud.md | se | tdd-green | crud | false* | P1 | stub | Forms/API green | src/** | Validação + empty | same |
| S-SE-05 | se-fix-core.md | se | fix | core | — | P1 | stub | Corrigir bug/suite | src/** | Escopo mínimo | softwareEngineerFixPrompt |
| S-SE-06 | se-analyze-core.md | se | analyze | core | — | P3 | stub | Review código | reviews | Sem refactor amplo | analyze |
| S-SE-07 | se-delivery-critic-core.md | se | delivery-critic | core | — | P1 | stub | Spot-check Files to touch | todo + src | Sem [x]; reopen gaps | playbook delivery-critic |
| S-QA-01 | qa-tdd-red-core.md | qa | tdd-red | core | — | P0 | stub | Testes a falhar genéricos | *.{test,spec}.* | Sem [x]; sem product code | qaEngineerTddRedPrompt |
| S-QA-02 | qa-tdd-red-screenflow.md | qa | tdd-red | screenflow | true | P0 | pilot | Red SF/overlays | *test* | Exclusividade chrome | same |
| S-QA-03 | qa-tdd-red-api-contract.md | qa | tdd-red | api-contract | false | P0 | pilot | Red contratos API | *test* | Happy+alt | same |
| S-QA-04 | qa-tdd-red-forms.md | qa | tdd-red | forms | true | P1 | stub | Red forms/validação UI | *test* | Empty/error | same |
| S-QA-05 | qa-tdd-verify-core.md | qa | tdd-verify | core | — | P0 | stub | Suite + gaps; mark [x] | *test* + todo | [x] só se pass | qaEngineerVerifyPrompt |
| S-QA-06 | qa-tdd-verify-screenflow.md | qa | tdd-verify | screenflow | true | P0 | pilot | Verify SF | *test* | Sem [x] se chrome falha | same |
| S-QA-07 | qa-tdd-verify-api-contract.md | qa | tdd-verify | api-contract | false | P1 | stub | Verify API contracts | *test* | Auth/fail paths | same |
| S-QA-08 | qa-analyze-core.md | qa | analyze | core | — | P3 | stub | Review QA genérico | reviews | Sem escrever suite completa | analyze |
| S-QA-09 | qa-analyze-coverage.md | qa | analyze | coverage | — | P2 | stub | Gaps de cobertura vs specs | reviews | Listar ACs sem teste | analyze |

\* `needsUiFlow` segue `src/zteam-config.ts` (`crud` true no set UI; skills API/contract usam false).

---

## Planned (sem ficheiro ainda) — P2/P3

| ID | Skill key sugerida | Role | Phase | Type | Notas |
|----|-------------------|------|-------|------|-------|
| P-SA-M1 | sa-requirements-mobile | sa | requirements | mobile | Nav stacks, gestos |
| P-SA-C1 | sa-requirements-cli-dos | sa | requirements | cli-dos | Args, exit codes |
| P-SA-L1 | sa-requirements-library | sa | requirements | library | API pública |
| P-SA-F1 | sa-requirements-frontend | sa | requirements | frontend | UI-only |
| P-SA-FS1 | sa-requirements-fullstack | sa | requirements | fullstack | FE↔BE |
| P-SA-D1 | sa-requirements-desktop | sa | requirements | desktop | Janelas FS leve |
| P-UX-M1 | ux-flow-mobile | ux | spec-flow | mobile | Stack nav |
| P-UX-FS1 | ux-flow-fullstack | ux | spec-flow | fullstack | Journey FE→BE |
| P-TA-W1 | ta-technologies-webapp | ta | technologies | webapp | SPA patterns |
| P-TA-M1 | ta-technologies-mobile | ta | technologies | mobile | PWA/mobile |
| P-TA-L1 | ta-technologies-library | ta | technologies | library | Package surface |
| P-TA-C1 | ta-technologies-cli-dos | ta | technologies | cli-dos | CLI layout |
| P-QA-M1 | qa-tdd-red-mobile | qa | tdd-red | mobile | Nav/loading |
| P-QA-C1 | qa-tdd-red-cli | qa | tdd-red | cli-dos | Help/exit |
| P-QA-L1 | qa-tdd-red-library | qa | tdd-red | library | Export contract |
| P-SE-W1 | se-tdd-green-webapp | se | tdd-green | webapp | Routes/forms |
| P-SE-B1 | se-tdd-green-backend | se | tdd-green | backend | Handlers |
| P-AN-* | {role}-analyze-{type} | * | analyze | * | Parecer por tipo |

---

## N/A — nós sem skill LLM

| Node | Motivo |
|------|--------|
| workflowRouter, punch/fix/resumePrepare | Heurística / prepare |
| fidelityCriticRequirements | Heurística |
| deliveryCriticArchitecture / Delivery | Heurística (playbook SE critic = stub se-delivery-critic-core) |
| scaffoldPrepare, bootstrapFix, orchestratorFinalize | Sem LLM de papel |

---

## Futuro — wiring (não fase 9)

- [ ] `resolveSkillKey(role, phase, projectType)` em `zteam-config` ou `role-prompts`
- [ ] Inject corpo da skill no SystemMessage de cada stage
- [ ] Playbook Cursor referencia `skillKey`
- [ ] Smoke: resolve webgame → screenflow paths; backend → api-contract
- [ ] Enrich stubs P0 → `ready`; criar planned P2 sob demanda

---

## Checklist fase 9

- [x] Postmortem 9 + roles/README
- [x] Este catálogo
- [x] Stubs core + tipo prioritário (ver ON_DISK_SKILLS)
- [x] `.docs/todo.md` §H + postmortems README
- [x] Smoke on-disk
