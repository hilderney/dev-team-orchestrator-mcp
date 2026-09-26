---
name: zteam
description: >-
  Run the Dev Team Orchestrator MCP pipeline (config-driven dual runtime:
  Cursor Task for inherit/auto, or 9router LangGraph for other model ids).
  Use when the user invokes /zteam, @zteam, @zteam/config, @zteam/models,
  @zteam/documentation, @zteam/tests, or asks to run the full team /
  orchestrator on an idea under a project root.
disable-model-invocation: true
---

# zteam — Dev Team Orchestrator

## Commands (route first)

When the user invokes a **subcommand**, follow that path **before** a generic full pipeline. Canonical list also lives in [`.zteam/README.MD`](../../.zteam/README.MD). A local copy of this skill is kept at **`.zteam/skills/SKILL.md`** (created/refreshed whenever `.zteam/` is bootstrapped — before any pipeline LLM call).

| Trigger | Action |
|---------|--------|
| **`@zteam/config`** / `/zteam config` | Full setup — `.zteam/config.json` (models, maxTokens, scope, gitignore). Do **not** start the pipeline unless the user also asked to run it. |
| **`@zteam/models`** / `/zteam models` | **LLMs only** — guided questions for SA/TA/SE/QA (+ fallback) → update `models` in this project's `.zteam/config.json`. |
| **`@zteam/documentation`** / `/zteam documentation` / `/zteam docs` | Docs-only — `workflow: "docs"`. |
| **`@zteam/tests`** / `/zteam tests` | Analyze app/specs and create or strengthen tests via MCP (QA-focused). |
| **`@zteam`** / `/zteam` (no subcommand) | Normal pipeline; pick workflow from the table below. |

## Dual runtime (config is absolute truth)

`.zteam/config.json` **primaries** pick the runtime. **Do not mix** families in one config.

| Config primary values | `llmRuntime` | What you do |
|----------------------|--------------|-------------|
| All `inherit` / `auto` / `cursor` / `cursor-auto` | **cursor** | MCP returns `delegationPlaybook` — run each stage with Cursor **Task** (`subagent_type` + `model` from stage). Do **not** send those ids to 9router. |
| All other ids (`9RSA-…`, `cu/default`, …) | **ninerouter** | Call `run_development_pipeline` and let MCP drive ChatOpenAI → 9router. Do **not** rewrite with Task. |
| Mix | `mixed_runtime` | Fix config so all primaries share one family; re-run. |

`get_zteam_config` returns `llmRuntime` when homogeneous.

### After `run_development_pipeline` (cursor)

```text
If response.llmRuntime === "cursor" (or delegated === true):
1. For each stage in delegationPlaybook.stages (in order):
   Task({
     subagent_type: stage.subagentType,  // system-architect | technology-architect | software-engineer | qa-engineer
     model: stage.model,                 // usually "inherit"
     description: stage.title,
     prompt: stage.instructions + " Write expected outputs: " + stage.expectedOutputs.join(", ")
   })
2. Verify artefacts under appRoot (.docs/*, code, tests)
3. Report stages completed; do not call 9router
```

### `@zteam/models`

Help the user choose models for **this** project (Cursor aliases **or** 9router ids — one family). Do **not** start a pipeline.

```text
1. workspaceRoot = absolute Cursor open folder
2. projectRoot = user app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. Show current models + llmRuntime + cursorAliases + modelSuggestions + suggestedDefaults
5. Ask modelQuestions: for EACH role (SA/TA/SE/QA) pick primary AND fallback
   - fallback only meaningful for ninerouter; empty ok for cursor
6. Prefer scope:
   - projectRoot != "." → "app" (write {appRoot}/.zteam/config.json)
   - else → "workspace" (write {workspaceRoot}/.zteam/config.json)
7. write_zteam_config({ workspaceRoot, projectRoot, scope, models, maxTokens: keep existing })
8. Confirm path written + final models + llmRuntime; point to .zteam/config.json
9. Stop (unless user asked to run a pipeline next)
```

### `@zteam/config`

```text
1. workspaceRoot = absolute Cursor open folder (Workspace Path)
2. projectRoot = user app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. Ask setup questions — show cursorAliases + modelSuggestions; ask primary + fallback (homogeneous family)
5. write_zteam_config({ workspaceRoot, projectRoot, scope, models (incl. *Fallback), maxTokens?, gitignoreIgnore })
6. Confirm paths written; point user to .zteam/config.json and .zteam/README.MD
7. Stop (unless user asked to run a pipeline next)
```

### `@zteam/documentation` / `@zteam/tests` / plain `@zteam`

```text
1. get_zteam_config({ workspaceRoot, projectRoot })
2. If needsConfig → STOP; @zteam/models or @zteam/config first
3. If runtimeError / mixed → fix config
4. run_development_pipeline({ workspaceRoot, projectRoot, userIdea, workflow })
5. If llmRuntime=cursor → execute delegationPlaybook via Task (see above)
6. If ninerouter → trust MCP result; report failureKind / resumeHint / filesWritten
```

## Shared instructions (all commands)

1. Call MCP tools on **`user-zteam`** (may also appear as `zteam`).
2. **Always** pass **`workspaceRoot`** = absolute path of the **Cursor-open folder**.
3. Always set **`projectRoot`** when the app is not the workspace root.
4. Put hard constraints in **`userIdea`**.
5. **Before any pipeline**: always `get_zteam_config` first until `needsConfig === false`.

### Config gate

```text
1. workspaceRoot = absolute Cursor open folder
2. projectRoot = app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. If needsConfig === true → write_zteam_config then re-check
5. Only then: run_development_pipeline(…)
6. Branch on llmRuntime (cursor Task playbook vs ninerouter MCP)
```

### Arguments

| Arg | Required | Notes |
|-----|----------|--------|
| `workspaceRoot` | **yes** (skill) | Absolute Cursor open folder |
| `userIdea` | yes (pipeline) | Idea **plus** non-negotiable constraints |
| `projectRoot` | strongly yes | Relative under `workspaceRoot` |
| `workflow` | no | `full` \| `docs` \| `feature` \| `punch` \| `fix` \| `resume` |

### Which workflow?

| Situation | Workflow |
|-----------|----------|
| New app, sensitive / large idea | **`docs` first** → then **`feature`** or **`full`** |
| New app, small / trusted | `full` (or omit) |
| Docs already good, new capability | `feature` |
| Tiny UI/copy tweak | `punch` |
| Bug / failing tests / add tests | `fix` |
| Mid-failure, todos still `[ ]` | **`resume`** |

### Rescue

| Symptom | Do this |
|---------|---------|
| `failureKind=needsConfig` | `@zteam/models` / `@zteam/config` |
| `failureKind=mixed_runtime` | Make all primaries cursor aliases **or** all 9router ids |
| `failureKind=invalid_model` | Fix ids to exist on 9router `/models` |
| `failureKind=llm_empty` / `spec_incomplete` / `tsc` / `fidelity` | Fix cause; `resume` |
| MCP namespace error | Restart zteam MCP; retry once |

### After the tool returns

1. Report: `workflow`, `llmRuntime`, `workspaceRoot`, `appRoot`, `failureKind`, `resumeHint`.
2. If cursor: list Task stages run + artefacts.
3. If ninerouter: quote MCP `filesWritten` / notifications.
