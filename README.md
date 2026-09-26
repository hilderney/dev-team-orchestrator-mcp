# Dev Team Orchestrator MCP

MCP server that runs a **spec-driven** LangGraph pipeline against 9router models:

1. System Architect → `README.md` + `.docs/requirements.md` (pré-reqs loop)
2. UI/UX Designer → score + `## UX / Juice addendum` in requirements (action/reaction; score ≥7)
3. Fidelity critic → hard FAIL vs `userIdea` (redo SA) — no silent stub pass
4. Technology Architect → `.docs/technologies.md`
5. UI/UX Designer → `.docs/ui-ux.md` (look-and-feel, palette, sensory, evidence-based emotion)
6. System Architect → `.docs/todo.md` plan (testable chunks from pré-reqs)
7. Per todo slug → SA detailed spec → UI/UX enrich → TA technical enrich → `.docs/specs/{slug}.spec.md` (≥3 use cases)
8. Delivery critic (architecture) → idea ↔ tech/specs gaps
9. Scaffold → vite+vitest template / augment missing shell files
10. Software Engineer → specs in todo order; Clean Code + `===SELF_CHECK===` (functionalities / use cases / usability-emotions); `verifyDelivery` + `tsc`; redo with feedback
11. Delivery critic (delivery) → reopen incomplete slugs
12. QA Engineer → vitest (work → as described → all use cases); optional `===TECH_DEBT===` → `.docs/tech-debt.md`; fix loop (bootstrap → bootstrapFix; logic → SE fix)
13. System Architect → project summary from requirements + README → `.docs/project-summary.md` + `.docs/user-report.md`
14. System Architect (if tech debt) → judge vs requirements/spirit; update docs if needed; plan-mode `.docs/tech-debt-plan.md` for the owner to decide
15. Finalize → README status + `.docs/pipeline-result.json` (includes `userReport` / plan paths)

MCP also exposes `get_pipeline_state` and `approve_gate` (HITL when `ZTEAM_HITL=1`).

Package docs and pipeline graph live under **`.docs/`** (not `docs/`) — same convention as app artefacts (`.docs/requirements.md`, …).

## Requirements phase (bootstrap + pré-reqs)

This slice only turns the user idea into durable requirements artefacts. It does **not** choose stacks or write code.

**Delivers**
- `README.md` — Resume (product/audience) and, during the loop, a temporary Pré Requirements checklist
- `.docs/requirements.md` — one `##` section per pré-req (goals, functional/NFR, normal+alt flows, acceptance; technology-agnostic)
- Clean README after the loop — Resume + links to docs (pré-req list removed)
- UI/UX juice pass — score 1–10, write `## UX / Juice addendum` (action/reaction feedback); score must improve to ≥7
- Fidelity gate — hard fail if requirements drift from `userIdea` (SA redo)

```mermaid
flowchart TD
  idea[userIdea]
  bootstrap[orchestratorBootstrapReadme]
  readmeDraft["README Resume + Pré Requirements list"]
  loop{pendingPreReqs left?}
  saItem[systemArchitectReqItem]
  reqsMd[".docs/requirements.md append ## section"]
  selfCheck[SELF_CHECK all yes]
  clean[orchestratorCleanReadme]
  readmeClean["README Resume + Documentation links"]
  ux[uiUxRequirements]
  juice["UX Juice addendum + score to >=7"]
  fidelity[fidelityCritic]
  nextPhase[TA and later stages]

  idea --> bootstrap
  bootstrap --> readmeDraft
  readmeDraft --> loop
  loop -->|yes| saItem
  saItem --> selfCheck
  selfCheck -->|fail revise| saItem
  selfCheck -->|pass| reqsMd
  reqsMd --> loop
  loop -->|no| clean
  clean --> readmeClean
  readmeClean --> ux
  ux --> juice
  juice --> fidelity
  fidelity -->|FAIL| saItem
  fidelity -->|PASS| nextPhase
```

## Technology phase (`.docs/technologies.md`)

Runs after fidelity PASS. The Technology Architect turns approved requirements into production-oriented tech decisions — **no feature code**.

**Delivers**
- `.docs/technologies.md` — stack, folders, hosting, persistence, scalability, cost-benefit services, specialized services, schemas, security, standards
- README — Technology summary + link to technologies.md
- `===SELF_CHECK===` — nine yes/no gates (coverage ≥90%, folders, patterns, scale, cost, hosting, persistence, specialized services, owner can follow)

```mermaid
flowchart TD
  fidelityPass[fidelityCritic PASS]
  inputs[README + requirements.md + optional architectureGaps]
  ta[technologyArchitect]
  draft["===SUMMARY=== + ===TECH=== body"]
  headings["Required H2: decisions folders stacks hosting persistence scale cost services schemas security standards"]
  selfCheck[SELF_CHECK all nine yes]
  writeTech["write .docs/technologies.md"]
  readmeTech["README Technology section + link"]
  nextUx[uiUxDesignSystem]

  fidelityPass --> inputs
  inputs --> ta
  ta --> draft
  draft --> headings
  headings --> selfCheck
  selfCheck -->|fail revise| ta
  selfCheck -->|pass| writeTech
  writeTech --> readmeTech
  readmeTech --> nextUx
```

## UI/UX phase (juice + look-and-feel)

Two UI/UX stages: **juice** on requirements (before TA), then **look-and-feel** after technologies.md exists.

**Delivers**
- Juice: `## UX / Juice addendum` inside `.docs/requirements.md`; score before → after (≥7 and improved)
- Look-and-feel: `.docs/ui-ux.md` — style, hierarchy, palette, visual/sound/sensory behavior, evidence-based emotion strategies, evidence notes
- README link to ui-ux.md
- Design self-check: purposeful emotion, evidence-based techniques, no invented data

```mermaid
flowchart TD
  subgraph juicePass [1 Juice after clean README]
    cleanDone[orchestratorCleanReadme]
    readReqs[read requirements.md]
    scoreBefore[SCORE_BEFORE 1 to 10]
    addendum[ADDENDUM juice action reaction]
    scoreAfter[SCORE_AFTER must improve and >=7]
    juiceCheck[SELF_CHECK score_improved_to_at_least_7]
    writeAddendum["upsert UX Juice addendum in requirements.md"]
    toFidelity[fidelityCritic]
    cleanDone --> readReqs --> scoreBefore --> addendum --> scoreAfter --> juiceCheck
    juiceCheck -->|fail revise| addendum
    juiceCheck -->|pass| writeAddendum --> toFidelity
  end

  subgraph designPass [2 Look and feel after technologies.md]
    techDone[technologies.md written]
    readBoth[read requirements.md + technologies.md]
    design["===DESIGN=== look feel hierarchy palette sensory emotion evidence"]
    designCheck["SELF_CHECK purposeful_emotion evidence_based_techniques no_invented_data"]
    writeUiUx["write .docs/ui-ux.md"]
    readmeUx[README link to ui-ux.md]
    toSpecs[systemArchitectTodoPlan]
    techDone --> readBoth --> design --> designCheck
    designCheck -->|fail revise| design
    designCheck -->|pass| writeUiUx --> readmeUx --> toSpecs
  end

  toFidelity -.->|later after TA| techDone
```

## Specs phase (todo.md + three-handed `.spec.md`)

After `.docs/ui-ux.md` exists, the System Architect plans a **short** `todo.md` only. Then each checklist item is written **three-handed**: SA → UI/UX → TA, iterating until every slug has a finalized `.docs/specs/{slug}.spec.md`.

**Delivers**
- `.docs/todo.md` — plan notes + `- [ ] slug: title` checklist (testable chunks from pré-reqs)
- Per slug `.docs/specs/{slug}.spec.md` — functionalities, all actions/reactions, **≥3 use-case examples (≥1 per scenario)**, acceptance, Files to touch, usability/juice, technical approach
- Self-checks at each hand (all must be yes before writing)

```mermaid
flowchart TD
  uiUxDone[uiUxDesignSystem done]
  todoPlan[systemArchitectTodoPlan]
  planQ["PLAN: chunks per pré-req + what to test"]
  todoMd["write .docs/todo.md checklist"]
  draftLoop{pendingSpecDrafts left?}
  saSpec[systemArchitectSpecItem]
  saCheck["SELF_CHECK all_actions se_can_resolve fulfills_functionality"]
  uxSpec[uiUxSpecEnrich]
  uxCheck["SELF_CHECK builds_narrative emotion_in_sync"]
  taSpec[technologyArchitectSpecEnrich]
  taCheck["SELF_CHECK tech_helps_development contributes_to_ux_emotions"]
  writeSpec["write .docs/specs/slug.spec.md"]
  nextArch[deliveryCriticArchitecture]

  uiUxDone --> todoPlan
  todoPlan --> planQ --> todoMd --> draftLoop
  draftLoop -->|yes| saSpec
  saSpec --> saCheck
  saCheck -->|fail revise| saSpec
  saCheck -->|pass| writeSpec
  writeSpec --> uxSpec
  uxSpec --> uxCheck
  uxCheck -->|fail revise| uxSpec
  uxCheck -->|pass| writeSpec
  writeSpec --> taSpec
  taSpec --> taCheck
  taCheck -->|fail revise| taSpec
  taCheck -->|pass| writeSpec
  writeSpec --> draftLoop
  draftLoop -->|no| nextArch
```

## Implementation + owner report (SE → QA → SA)

Runs after scaffold (or punch/fix/resume prepare). Docs-only workflows skip this phase.

**Delivers**
- Code from each `.docs/specs/{slug}.spec.md` in todo order (Clean Code / readable; light SOLID)
- SE `===SELF_CHECK===`: `covers_all_functionalities`, `covers_all_use_cases`, `follows_usability_and_emotions`
- QA tests (vitest): must work → as described → all use cases; optional `.docs/tech-debt.md`
- `.docs/project-summary.md` + `.docs/user-report.md` — what the project does (for the owner)
- If tech debt exists: disposition + plan-mode `.docs/tech-debt-plan.md` (owner decides; not auto-implemented)

```mermaid
flowchart TD
  scaffold[scaffoldPrepare]
  se[softwareEngineer]
  delCritic[deliveryCriticDelivery]
  qa[qaEngineer]
  seFix[softwareEngineerFix]
  bootFix[bootstrapFix]
  saSummary[systemArchitectProjectSummary]
  saDebt[systemArchitectTechDebtReview]
  finalize[orchestratorFinalize]

  scaffold --> se
  se -->|pendingSpecs| se
  se -->|done| delCritic
  delCritic -->|reopen| se
  delCritic -->|PASS| qa
  qa -->|logic fail| seFix --> qa
  qa -->|bootstrap fail| bootFix --> qa
  qa -->|moreSpecs| qa
  qa -->|allPass| saSummary
  saSummary -->|no tech debt| finalize
  saSummary -->|tech debt| saDebt --> finalize
```

## Setup

1. `cp .env.example .env` and fill in `NINEROUTER_BASE` / `NINEROUTER_KEY` (optional `MODEL_*`, `GRAPH_RECURSION_LIMIT`, `MAX_QA_FIX_ROUNDS`, `MAX_DELIVERY_FIX_ROUNDS`, `PROGRESS_HEARTBEAT_MS`).
2. `npm install`
3. Register the MCP server in Cursor (`~/.cursor/mcp.json`) under the key **`zteam`**:

```json
{
  "mcpServers": {
    "zteam": {
      "command": "npx",
      "args": ["tsx", "C:/path/to/dev-team-orchestrator/src/orchestrator.ts"],
      "env": {
        "NODE_NO_WARNINGS": "1",
        "NINEROUTER_BASE": "https://your-9router-host/v1",
        "NINEROUTER_KEY": "sk-your-key"
      }
    }
  }
}
```

**Do not** set a sticky `WORKSPACE_ROOT` in `mcp.json` — MCP tools **require** `workspaceRoot` = the Cursor-open folder on every call and **never** fall back to that env (avoids writing into a previous repo). Omitting it returns `failureKind=needs_workspace_root`. Credentials stay in env; workspace is per-call.

Cursor exposes the tool namespace as **`user-zteam`**. Restart MCP after changing the key.

### Team models — `.zteam/config.json`

Models resolve as: `{app}/.zteam/config.json` → `{workspace}/.zteam/config.json` → env `MODEL_*` → built-in defaults.

The config gate opens when a config file exists **or** explicit `MODEL_*` env vars are set (`configGateSatisfied`). Otherwise the pipeline returns `failureKind=needsConfig` (CLI: `--skip-config-gate` for smoke).

Example:

```json
{
  "version": 1,
  "models": {
    "systemArchitect": "9RSA-system-architect-free",
    "technologyArchitect": "9RTA-technology-architect-free",
    "uiUxDesigner": "9RSA-system-architect-free",
    "softwareEngineer": "9RSE-software-engineer-free",
    "qaEngineer": "9RQA-qa-free",
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

MCP tools: `get_zteam_config`, `write_zteam_config`, `run_development_pipeline`, `get_pipeline_state`, `approve_gate`.

### Env vars (orchestrator)

| Var | Role |
|-----|------|
| `NINEROUTER_BASE` / `NINEROUTER_KEY` | 9router OpenAI-compat endpoint |
| `ZTEAM_FORCE_BOOTSTRAP=1` | Force wipe of `.docs/requirements.md` on full/docs bootstrap (default: preserve if file has real `##` sections) |
| `ZTEAM_SE_BATCH` | SE batch size 1–3 (default **1**; workflow `punch` defaults to 3) |
| `MODEL_FALLBACK` / `*Fallback` per role | Local handoff after primary exhausts retries |
| `MODEL_SYSTEM_ARCHITECT_FALLBACK` etc. | Env override for per-role fallback |
| `MAX_DELIVERY_FIX_ROUNDS` | SE verify redo rounds (default 3) |

**After changing orchestrator source:** restart the MCP server `user-zteam` (no hot-reload). Confirm discovery lists config tools.

## Cursor — `@zteam` / `/zteam`

| Trigger | What |
|---------|------|
| **`@zteam`** | Manual rule [`.cursor/rules/zteam.mdc`](.cursor/rules/zteam.mdc) in the mention picker |
| **`/zteam`** | Project skill [`.cursor/skills/zteam/SKILL.md`](.cursor/skills/zteam/SKILL.md) |
| Natural language (“roda o zteam…”) | Always-on rule [`.cursor/rules/dev-team-orchestrator.mdc`](.cursor/rules/dev-team-orchestrator.mdc) routes to the same MCP tool |

Always call `user-zteam.run_development_pipeline` (not Cursor Task subagents).

Examples:

```text
@zteam build a pac-man demo in samples/pacman
/zteam docs-only — plan a todo API in samples/todo-api
/zteam punch — make the submit button blue in samples/my-app
```

Always pass `workspaceRoot` (absolute Cursor open folder) and `projectRoot` when you can. Optional `workflow`: `full` | `docs` | `feature` | `punch` | `fix` | `resume` (omit = auto-router).

Skill subcommands: **`@zteam/config`**, **`@zteam/models`**, **`@zteam/documentation`**, **`@zteam/tests`** — see [`.zteam/README.MD`](.zteam/README.MD).

Also see the always-on routing rule for stage/env details. Rescue mid-failure with `workflow=resume` (see skill). Resume reopens phantom `[x]` todos whose Files to touch are missing on disk.

## Modes / workflows

| Mode | How | Route |
|------|-----|--------|
| **auto** | omit `workflow` | `workflowRouter` classifies from idea + `.docs` on disk |
| **full** | `workflow=full` | … → arch critic → scaffold → SE\* → QA\* → SA summary → optional tech-debt plan → finalize |
| **docs** | `workflow=docs` or `docsOnly=true` / `--docs-only` | … → (SA→UX→TA spec)\* → arch critic → finalize (no SE/QA/summary) |
| **feature** | `workflow=feature` | SA todo plan → (SA→UX→TA spec)\* → arch critic → scaffold → SE\* → QA\* → SA summary → optional tech-debt plan → finalize |
| **punch** | `workflow=punch` | prepare → SE → QA → SA summary → optional tech-debt plan → finalize |
| **fix** | `workflow=fix` | prepare → SE fix → QA → SA summary → optional tech-debt plan → finalize |
| **resume** | `workflow=resume` | reopen phantoms + pending `[ ]` → scaffold → SE\* → QA\* → SA summary → optional tech-debt plan → finalize |

Catalog + classifier: [`src/workflows/`](src/workflows/). Multiagent ideal (future): [`.docs/adr-multiagent-flow.md`](.docs/adr-multiagent-flow.md). Historical plans: [`.docs/postmortems/`](.docs/postmortems/).

### Workflow `full`

1. **Bootstrap** — Resume + Pré Requirements; stub `.docs/requirements.md` (empty LLM → `llm_empty`, no stub charter)
2. **SA loop** — expand each pré-req into `.docs/requirements.md`
3. **Clean README** — Resume + link to requirements
4. **Fidelity** — hard FAIL vs `userIdea` (API/locale/stub); one redo then classified abort
5. **TA** → `.docs/technologies.md`
6. **UI/UX look-and-feel** → `.docs/ui-ux.md`
7. **SA todo plan** → `.docs/todo.md` (testable chunks)
8. **Per-slug specs** → SA → UI/UX → TA on each `.docs/specs/{slug}.spec.md`
9. **Architecture critic** — coverage gaps; may reopen TA
10. **Scaffold** — template or augment missing shell files + install
11. **SE** — Clean Code / readable implementer; batch specs in todo order; `===SELF_CHECK===` (functionalities, use cases, usability/emotions); `verifyDelivery` + `tsc`; redo with `deliveryFixRound`; then `markTodoDone`
12. **Delivery critic** — reopen incomplete slugs
13. **QA** — priorities: work → as described → all use cases; `===SELF_CHECK===`; optional `===TECH_DEBT===` → `.docs/tech-debt.md` for orchestrator; bootstrapFix vs SE fix by error class
14. **SA project summary** — reads requirements + README; writes `.docs/project-summary.md` + `.docs/user-report.md` for the owner
15. **SA tech-debt review** (if `.docs/tech-debt.md` has content) — necessary vs not vs project spirit; updates docs when needed; writes plan-mode `.docs/tech-debt-plan.md` for the user to decide
16. **Finalize** → README + `.docs/pipeline-result.json` (includes `userReport` / plan paths)

```mermaid
flowchart TD
  startNode[START]
  router[workflowRouter]
  boot[orchestratorBootstrapReadme]
  saItem[systemArchitectReqItem]
  afterItem[orchestratorAfterPreReq]
  clean[orchestratorCleanReadme]
  juice[uiUxRequirements]
  fidelity[fidelityCriticRequirements]
  ta[technologyArchitect]
  uxDesign[uiUxDesignSystem]
  todoPlan[systemArchitectTodoPlan]
  saSpec[systemArchitectSpecItem]
  uxSpec[uiUxSpecEnrich]
  taSpec[technologyArchitectSpecEnrich]
  archCritic[deliveryCriticArchitecture]
  scaffold[scaffoldPrepare]
  se[softwareEngineer]
  delCritic[deliveryCriticDelivery]
  qa[qaEngineer]
  seFix[softwareEngineerFix]
  bootFix[bootstrapFix]
  saSummary[systemArchitectProjectSummary]
  saDebt[systemArchitectTechDebtReview]
  finalize[orchestratorFinalize]
  endNode[END]
  startNode --> router
  router -->|full| boot
  boot --> saItem
  saItem --> afterItem
  afterItem -->|pendingPreReqs| saItem
  afterItem -->|done| clean
  clean --> juice --> fidelity
  fidelity -->|FAIL| saItem
  fidelity -->|PASS| ta
  ta --> uxDesign --> todoPlan --> saSpec --> uxSpec --> taSpec
  taSpec -->|more drafts| saSpec
  taSpec -->|done| archCritic
  archCritic -->|gaps| ta
  archCritic -->|PASS| scaffold
  scaffold --> se
  se -->|pendingSpecs + SELF_CHECK| se
  se -->|done| delCritic
  delCritic -->|reopen| se
  delCritic -->|PASS| qa
  qa -->|logic fail| seFix
  seFix -->|SELF_CHECK| qa
  qa -->|bootstrap fail| bootFix
  bootFix --> qa
  qa -->|moreSpecs| qa
  qa -->|TECH_DEBT optional| qa
  qa -->|allPass| saSummary
  saSummary -->|no tech debt| finalize
  saSummary -->|tech debt| saDebt
  saDebt -->|plan for user| finalize
  finalize --> endNode
```

SE answers: `covers_all_functionalities`, `covers_all_use_cases`, `follows_usability_and_emotions`. QA answers: `tests_cover_all_use_cases`, `no_unresolved_spec_conflicts` (conflicts go to `.docs/tech-debt.md`). After QA, SA presents a project summary; if tech debt exists, SA judges it against requirements/spirit and leaves a plan-mode action plan for you to decide.

Hard guard: refuses to write when `projectRoot` is `.` and `appRoot` equals the orchestrator package, or when a path escapes `workspaceRoot`. `GRAPH_RECURSION_LIMIT` default **120**.

## Resilience (empty / invalid LLM)

- Empty/whitespace replies, missing `===FILE===`, empty file bodies, and failed docs section parses are **retryable** (re-prompt + optional model fallback).
- After exhausted retries on docs/SE: **`failureKind=llm_empty`** — no silent TBD / implement-core stubs.
- Network / 429 / 5xx are also retried.
- Delivery verify FAIL → structured feedback + redo until `MAX_DELIVERY_FIX_ROUNDS`.

## Live progress

While the pipeline runs (MCP tool or CLI):

- **stage** start/done with pending-spec hints
- **heartbeat** every ~30s of silence (`PROGRESS_HEARTBEAT_MS`, default `30000`) while waiting on LLM stream or `npm test`
- **partial** truncated preview after a heartbeat if stream text is interesting (`===FILE===` / section markers)
- MCP: `notifications/message` (logging) + `notifications/progress` when the client sends `progressToken`
- CLI: same lines on **stderr**; final `notifications[]` matches the live log
- Pre-pipeline **healthcheck** on 9router/tunnel for `full`/`docs`/`feature` (&lt;30s fail-fast)

## CLI

```bash
npm run pipeline:docs -- --workspace-root C:/path/to/open/folder --project-root samples/my-app "idea…"
npm run pipeline -- --workflow punch --workspace-root C:/path/to/open/folder --project-root samples/my-app "só muda a cor do botão"
npm run pipeline -- --project-root samples/my-app "idea…"   # workspace from env/cwd; prefer --workspace-root
npm run pipeline:feature -- --project-root samples/my-app "add CSV export"
npm run pipeline:resume -- --project-root samples/my-app "resume pending"
npm run graph
npm run smoke
npm run smoke:workflows
npm run smoke:reqs
npm run smoke:files
npm run smoke:improvements
npm run smoke:architecture
npm run smoke:implementation
npm run smoke:zteam-config
npm run smoke:role-prompts
npm run smoke:verify
npm run smoke:all
```

Use `--workspace-root` + `projectRoot` so generated docs land in the app folder, not this MCP package.

### Smoke

- `npm run smoke` — retryable empty LLM + heartbeat
- `npm run smoke:workflows` — classifier heuristics
- `npm run smoke:reqs` — Resume / Pré Requirements parsers + safe appRoot guard
- `npm run smoke:files` — FILE sanitize, recursion helper, test preflight, fidelity heuristic
- `npm run smoke:improvements` — bootstrap/vitest/scaffold/FILE repair/progress close/healthcheck/metrics
- `npm run smoke:architecture` — architecture progress pack
- `npm run smoke:implementation` — implementation progress pack
- `npm run smoke:zteam-config` — workspaceRoot override, `.zteam` merge, needsConfig, gitignore
- `npm run smoke:role-prompts` — personas, SELF_CHECK parsers, SE/QA/SA summary + tech-debt plan
- `npm run smoke:verify` — DoD / anti-batch / phantoms / architecture gaps / metrics
- CI: [`.github/workflows/zteam-smokes.yml`](.github/workflows/zteam-smokes.yml) runs `smoke:all`

Optional live check (needs 9router): run `npm run pipeline:docs -- --project-root samples/smoke-app "tiny idea"` and confirm heartbeats if a stage exceeds 30s.
