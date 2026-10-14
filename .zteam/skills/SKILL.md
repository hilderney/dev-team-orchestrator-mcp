---
name: zteam
description: >-
  Run the Dev Team Orchestrator MCP pipeline (hybrid runtime: Path A Cursor Task
  with inherit / allowlisted slugs, or Path B MCP role-agents on 9router /
  OmniRoute / OpenRouter via package .env). Use when the user invokes /zteam,
  @zteam, @zteam/config, @zteam/models, @zteam/documentation, @zteam/tests, or
  asks to run the full team / orchestrator on an idea under a project root.
disable-model-invocation: true
---

# zteam — Dev Team Orchestrator

## Commands (route first)

When the user invokes a **subcommand**, follow that path **before** a generic full pipeline. Canonical list also lives in [`.zteam/README.MD`](../../.zteam/README.MD). A local copy of this skill is kept at **`.zteam/skills/SKILL.md`** (created/refreshed whenever `.zteam/` is bootstrapped — before any pipeline LLM call).

| Trigger | Action |
|---------|--------|
| **`@zteam/config`** / `/zteam config` | Full setup — `.zteam/config.json` (`provider`, `projectType`, `models`, `cursorModels`, `maxTokens`, `scope`, `gitignoreIgnore`). Do **not** start the pipeline unless the user also asked to run it. |
| **`@zteam/models`** / `/zteam models` | **LLMs only** — guided questions for SA/TA/**UX**/SE/QA (+ fallback or `cursorModels` per role) → update `models` / `cursorModels` / `provider` in this project's `.zteam/config.json`. |
| **`@zteam/documentation`** / `/zteam documentation` / `/zteam docs` | Docs-only — `workflow: "docs"`. |
| **`@zteam/tests`** / `/zteam tests` | TDD tests only — `workflow: "tests"` + `slug` (QA-red → QA-verify). |
| **`@zteam`** / `/zteam` (no subcommand) | Normal pipeline; pick workflow from the table below. |

## MCP tools (must match GetDynamicTools after MCP restart)

| Tool | Purpose |
|------|---------|
| `get_zteam_config` | Read merged config, `provider`, `projectType`, `cursorModels`, `envEndpoint`, `needsConfig`, `llmRuntime`, suggestions |
| `write_zteam_config` | Write `.zteam/config.json` (always include **uiUxDesigner**, optional `provider`, `projectType` & `cursorModels`) |
| `ensure_zteam_setup` | Skill + `.docs` stubs + optional config template (no LLM) |
| `run_development_pipeline` | Pipeline / 2-wave playbook (`workspaceRoot` **required**, `workflow` optional) |
| `get_pipeline_state` | Live Canvas Dashboard state + push subagent telemetry (`recordStage`, `recordRole`, `recordStatus`, `recordMessage`, `checkGate`) |
| `approve_gate` | HITL when `ZTEAM_HITL=1` |

If GetDynamicTools shows an outdated schema (missing `provider`, `projectType`, `cursorModels`, or `recordStage`), **restart the zteam MCP server** so Cursor reloads `src/orchestrator.ts`.

## Hybrid Strategy: Using 9router / OmniRoute / OpenRouter Models as Subagents

Cursor's `Task` tool **intentionally blocks custom / BYOK / OpenAPI model slugs** (like `9r-code-heavy` or `9r-code-light`) in `Task({ model })` — only `"inherit"` and native Cursor allowlisted slugs (`composer-2.5-fast`, `claude-sonnet-5-5-high`, etc.) are accepted. Also, never pass `"auto"` to `Task({ model })` — always use `"inherit"`.

To run your 9router / OmniRoute / OpenRouter models across isolated team roles, `.zteam/config.json` supports **`provider`: `"hybrid"` (default) | `"cursor-task"` | `"ninerouter-direct"`**:

| Path | Condition (`provider: "hybrid"`) | `llmRuntime` | How it executes |
|------|----------------------------------|--------------|-----------------|
| **Path A — Cursor Task (`inherit`)** | `provider: "cursor-task"`, OR all primaries are `"inherit"`, OR all 5 roles share **one** custom model (e.g. all `9r-code-heavy` with `provider: "hybrid"`) | **`cursor`** | MCP returns `delegationPlaybook` where every `stage.model` is `"inherit"` (or an allowlisted `cursorModels` slug) and `stage.requestedModel` records the desired `9r-*` id. Select `9r-code-heavy` in the Cursor parent chat picker → all `Task(model: "inherit")` subagents run on `9r-code-heavy`! |
| **Path B — MCP Role-Agents (`.env` Gateway)** | `provider: "ninerouter-direct"`, OR `provider: "hybrid"` with **multiple distinct** custom models across roles (e.g. `SA/TA/SE = 9r-code-heavy`, `UX/QA = 9r-code-light`) | **`ninerouter`** | MCP runs LangGraph role-agents via `ChatOpenAI` directly against the OpenAI-compatible gateway configured in `dev-team-orchestrator/.env` (`NINEROUTER_BASE`/`NINEROUTER_KEY`, `OMNIROUTE_*`, or `OPENROUTER_API_KEY`). Secrets stay in `.env`, **never** in `~/.cursor/mcp.json`. |

### Gateway doctor (before any Path B run)

`get_zteam_config` returns `gatewayDoctor`. `run_development_pipeline` on `llmRuntime=ninerouter` stops **before** the graph when the gateway is not usable.

| `gatewayDoctor.failureKind` | What you tell the user | What you must not do |
|---|---|---|
| *(absent, `ok: true`)* | Continue. If `usedLocalFallback` is true, say this run used `http://127.0.0.1:20128/v1` because the configured tunnel is dead, and they should set `NINEROUTER_BASE` to that URL. | — |
| `gateway_auth` | 9router is up but rejected `NINEROUTER_KEY` (hint is only the last 4 characters). Copy the API key from the **9router UI** and set `NINEROUTER_BASE=http://127.0.0.1:20128/v1`. | Do not read `%AppData%\\Roaming\\9router` SQLite. That `key` column is not a Bearer token. |
| `gateway_down` | Open the 9router app on port 20128, or point `NINEROUTER_BASE` at a host that answers `GET /v1/models`. | Do not probe random trycloudflare hostnames. |
| `invalid_model` | The gateway is up and is missing the role ids (`9r-code-heavy` / `9r-code-light`). Quote `sampleModelIds`. | Do not start the pipeline. |
| `missing_env_credentials` | Fill `dev-team-orchestrator/.env` from `.env.example`. | Do not put the key in `mcp.json`. |

If `gatewayDoctor.ok === false`, stop. Do not start the game pipeline.

### After `run_development_pipeline` (Path A: `llmRuntime === "cursor"`) — 2-Wave Playbook, Mechanical Gates & Live Canvas Dashboard

When `run_development_pipeline` runs on `llmRuntime="cursor"`, it writes `.docs/host.json` (Node/SQLite/native-compile probe), `.zteam/dashboard/index.html`, and returns a **2-wave `delegationPlaybook`**:

- **Wave 1** (when `.docs/todo.md` has no open slugs yet): `sa-requirements` → `ux-juice` → `fidelity-critic` → `ta-stack` → `architecture-critic` → `ux-design-system` → `sa-todo-and-specs`.
- **Wave 2** (expanded per open `[ ]` slug in `.docs/todo.md` when you call `run_development_pipeline` again with `workflow: "resume"` after `sa-todo-and-specs`):
  - Three-handed spec per slug: `sa-spec:{slug}` → `ux-spec:{slug}` → `ta-spec:{slug}`
  - TDD per slug: `qa-tdd-red:{slug}` → `se-implement:{slug}` → `delivery-critic:{slug}`
  - Final suite verification: `qa-tdd-verify`

```text
If response.llmRuntime === "cursor" (or delegated === true):
0. Tell the user once: "Live Canvas Dashboard: `.zteam/dashboard/index.html`"
   If response.parentPickerBanner is present, show it once so the user knows which 9r model to select in the parent chat picker.
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
        model: stage.model,                 // ALWAYS "inherit" or allowlisted Cursor slug; NEVER pass 9r-* or "auto" here!
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

Help the user choose models for **this** project (`provider: "hybrid"` | `"cursor-task"` | `"ninerouter-direct"`, Cursor aliases, or 9router/OmniRoute/OpenRouter ids). Do **not** start a pipeline.

```text
1. workspaceRoot = absolute Cursor open folder
2. projectRoot = user app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. Show current provider + models + cursorModels + projectType + llmRuntime + envEndpoint + modelSuggestions
5. Ask modelQuestions: for EACH role (SA/TA/**uiUxDesigner**/SE/QA) pick primary AND fallback (default fallbacks to "inherit", never "auto")
6. Prefer scope:
   - projectRoot != "." → "app" (write {appRoot}/.zteam/config.json)
   - else → "workspace" (write {workspaceRoot}/.zteam/config.json)
7. write_zteam_config({ workspaceRoot, projectRoot, scope, provider, projectType, models, cursorModels, maxTokens: keep existing })
8. Confirm path written + final provider + models + llmRuntime; point to .zteam/config.json
9. Stop (unless user asked to run a pipeline next)
```

### `@zteam/config`

```text
1. workspaceRoot = absolute Cursor open folder (Workspace Path)
2. projectRoot = user app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. Ask setup questions — provider (hybrid/cursor-task/ninerouter-direct), projectType (webgame/webapp/crud/backend/...), models (fallbacks="inherit"), cursorModels, maxTokens, gitignoreIgnore
5. write_zteam_config({ workspaceRoot, projectRoot, scope, provider, projectType, models, cursorModels, maxTokens?, gitignoreIgnore })
6. Confirm paths written; point user to .zteam/config.json and .zteam/README.MD
7. Stop (unless user asked to run a pipeline next)
```
