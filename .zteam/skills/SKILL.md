---
name: zteam
description: >-
  Run the Dev Team Orchestrator MCP pipeline (config-driven dual runtime:
  Cursor Task for inherit/auto + optional cursorModels per role, or 9router
  LangGraph for other model ids). Use when the user invokes /zteam, @zteam,
  @zteam/config, @zteam/models, @zteam/documentation, @zteam/tests, or asks
  to run the full team / orchestrator on an idea under a project root.
disable-model-invocation: true
---

# zteam — Dev Team Orchestrator

## Commands (route first)

When the user invokes a **subcommand**, follow that path **before** a generic full pipeline. Canonical list also lives in [`.zteam/README.MD`](../../.zteam/README.MD). A local copy of this skill is kept at **`.zteam/skills/SKILL.md`** (created/refreshed whenever `.zteam/` is bootstrapped — before any pipeline LLM call).

| Trigger | Action |
|---------|--------|
| **`@zteam/config`** / `/zteam config` | Full setup — `.zteam/config.json` (`projectType`, `models`, `cursorModels`, `maxTokens`, `scope`, `gitignoreIgnore`). Do **not** start the pipeline unless the user also asked to run it. |
| **`@zteam/models`** / `/zteam models` | **LLMs only** — guided questions for SA/TA/**UX**/SE/QA (+ fallback or `cursorModels` per role) → update `models` / `cursorModels` in this project's `.zteam/config.json`. |
| **`@zteam/documentation`** / `/zteam documentation` / `/zteam docs` | Docs-only — `workflow: "docs"`. |
| **`@zteam/tests`** / `/zteam tests` | TDD tests only — `workflow: "tests"` + `slug` (QA-red → QA-verify). |
| **`@zteam`** / `/zteam` (no subcommand) | Normal pipeline; pick workflow from the table below. |

## MCP tools (must match GetDynamicTools after MCP restart)

| Tool | Purpose |
|------|---------|
| `get_zteam_config` | Read merged config, `projectType`, `cursorModels`, `needsConfig`, `llmRuntime`, suggestions |
| `write_zteam_config` | Write `.zteam/config.json` (always include **uiUxDesigner**, optional `projectType` & `cursorModels`) |
| `ensure_zteam_setup` | Skill + `.docs` stubs + optional config template (no LLM) |
| `run_development_pipeline` | Pipeline / 2-wave playbook (`workspaceRoot` **required**, `workflow` optional) |
| `get_pipeline_state` | Live Canvas Dashboard state + push subagent telemetry (`recordStage`, `recordRole`, `recordStatus`, `recordMessage`, `checkGate`) |
| `approve_gate` | HITL when `ZTEAM_HITL=1` |

If GetDynamicTools shows an outdated schema (missing `projectType`, `cursorModels`, or `recordStage`), **restart the zteam MCP server** so Cursor reloads `src/orchestrator.ts`.

## Capability matrix (isolated vs pipeline)

| Need | Tool / workflow | Writes |
|------|-----------------|--------|
| Só skill + `.docs` stubs (+ optional config template) | `ensure_zteam_setup` | `.zteam/**`, `.docs/**` — never `src/**` |
| Só models / config | `get_zteam_config` → `write_zteam_config` | `.zteam/config.json` (`projectType`, `models`, `cursorModels`) |
| Só docs/specs | `workflow: "docs"` | `.docs/**` |
| Uma feature (1 slug) | `workflow: "feature"` + `slug` | that slug only |
| Só testes de um requisito | `workflow: "tests"` + `slug` | `*.{test,spec}.*` |
| Análise (time ou 1 papel) | `workflow: "analyze"` + `scope` + optional `role` | `.docs/reviews/**` |
| Pipeline completo | `workflow: "full"` / omit | app + docs |

**Role skills** (`.zteam/skills/roles/`): pick by `(role, phase, projectType)` — e.g. `sa-todo-plan-webgame`, `ta-technologies-webgame`, `qa-tdd-red-screenflow`, `se-implement-tdd-green`, `qa-tdd-verify-screenflow`.

## Dual runtime & `cursorModels` (config is absolute truth)

`.zteam/config.json` **primaries** (`models.*`) pick the runtime. **Do not mix** families in one config.

| Config `models.*` primary values | `llmRuntime` | What you do |
|----------------------|--------------|-------------|
| All `inherit` / `auto` / `cursor` / `cursor-auto` | **cursor** | MCP returns `delegationPlaybook` — run each stage with Cursor **Task** (`subagent_type: stage.subagentType`, `model: stage.model`). Optional `cursorModels` per role (e.g. `"softwareEngineer": "composer-2.5"`) populates `stage.model` without triggering 9router validation! |
| All other ids (`9RSA-…`, `cu/default`, …) | **ninerouter** | Call `run_development_pipeline` and let MCP drive ChatOpenAI → 9router. Do **not** rewrite with Task. |
| Mix | `mixed_runtime` | Fix config so all primaries share one family; re-run. |

### After `run_development_pipeline` (cursor) — 2-Wave Playbook, Mechanical Gates & Live Canvas Dashboard

When `run_development_pipeline` runs on `llmRuntime="cursor"`, it writes `.docs/host.json` (Node/SQLite/native-compile probe), `.zteam/dashboard/index.html`, and returns a **2-wave `delegationPlaybook`**:

- **Wave 1** (when `.docs/todo.md` has no open slugs yet): `sa-requirements` → `ux-juice` → `fidelity-critic` → `ta-stack` → `architecture-critic` → `ux-design-system` → `sa-todo-and-specs`.
- **Wave 2** (expanded per open `[ ]` slug in `.docs/todo.md` when you call `run_development_pipeline` again with `workflow: "resume"` after `sa-todo-and-specs`):
  - Three-handed spec per slug: `sa-spec:{slug}` → `ux-spec:{slug}` → `ta-spec:{slug}`
  - TDD per slug: `qa-tdd-red:{slug}` → `se-implement:{slug}` → `delivery-critic:{slug}`
  - Final suite verification: `qa-tdd-verify`

```text
If response.llmRuntime === "cursor" (or delegated === true):
0. Tell the user once: "Live Canvas Dashboard: `.zteam/dashboard/index.html`"
1. For each stage in delegationPlaybook.stages (in order):
   a) HOST ONLY: Call get_pipeline_state({
        workspaceRoot, projectRoot,
        recordStage: stage.id, recordRole: stage.role,
        recordStatus: "start", skillKey: stage.skillKey,
        recordMessage: "Starting " + stage.title
      })
      Print ONLY the 1-line `chatBanner` in chat (keep chat ultra-clean).
   b) Run Task({
        subagent_type: stage.subagentType,  // system-architect | technology-architect | generalPurpose | software-engineer | qa-engineer
        model: stage.model,                 // from cursorModels[role] or "inherit"
        description: stage.title,
        prompt: stage.instructions + "\n\nFull User Idea / Constraints:\n" + delegationPlaybook.userIdea + "\n\nWrite expected outputs: " + stage.expectedOutputs.join(", ")
      })
   c) HOST ONLY: Call get_pipeline_state({
        workspaceRoot, projectRoot,
        recordStage: stage.id, recordRole: stage.role,
        recordStatus: "done", skillKey: stage.skillKey,
        checkGate: true,
        recordMessage: "Completed " + stage.title
      })
      Print ONLY the 1-line `chatBanner` in chat.
      If `gate.ok === false` (e.g. contradictory QA-red tests or forbidden native addon like better-sqlite3), re-run the subagent to fix `gate.reasons` before advancing!
   d) If `stage.id === "sa-todo-and-specs"` just finished and `.docs/todo.md` now has open `- [ ] slug: title` items:
      Call `run_development_pipeline({ workspaceRoot, projectRoot, userIdea, workflow: "resume" })` to expand Wave 2 per-slug stages (`sa-spec:{slug}`, `ux-spec:{slug}`, `ta-spec:{slug}`, `qa-tdd-red:{slug}`, `se-implement:{slug}`, `delivery-critic:{slug}`, `qa-tdd-verify`) and execute them in order!
2. When all stages finish, call:
   get_pipeline_state({
     workspaceRoot, projectRoot,
     recordStage: "pipeline", recordStatus: "done",
     recordMessage: "Pipeline completed"
   })
   so `.zteam/dashboard/index.html` transitions to "Pipeline Completed ✓".
```

### `@zteam/models`

Help the user choose models for **this** project (Cursor aliases + optional `cursorModels` **or** 9router ids — one family). Do **not** start a pipeline.

```text
1. workspaceRoot = absolute Cursor open folder
2. projectRoot = user app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. Show current models + cursorModels + projectType + llmRuntime + cursorAliases + modelSuggestions
5. Ask modelQuestions: for EACH role (SA/TA/**uiUxDesigner**/SE/QA) pick primary AND fallback (or cursorModels slug like "composer-2.5" when using Cursor runtime)
6. Prefer scope:
   - projectRoot != "." → "app" (write {appRoot}/.zteam/config.json)
   - else → "workspace" (write {workspaceRoot}/.zteam/config.json)
7. write_zteam_config({ workspaceRoot, projectRoot, scope, projectType, models, cursorModels, maxTokens: keep existing })
8. Confirm path written + final models + cursorModels + llmRuntime; point to .zteam/config.json
9. Stop (unless user asked to run a pipeline next)
```

### `@zteam/config`

```text
1. workspaceRoot = absolute Cursor open folder (Workspace Path)
2. projectRoot = user app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. Ask setup questions — projectType (webgame/webapp/crud/backend/...), models, cursorModels, maxTokens, gitignoreIgnore
5. write_zteam_config({ workspaceRoot, projectRoot, scope, projectType, models, cursorModels, maxTokens?, gitignoreIgnore })
6. Confirm paths written; point user to .zteam/config.json and .zteam/README.MD
7. Stop (unless user asked to run a pipeline next)
```
