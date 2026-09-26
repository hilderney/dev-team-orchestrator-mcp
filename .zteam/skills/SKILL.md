---
name: zteam
description: >-
  Run the Dev Team Orchestrator MCP pipeline (9router LangGraph team).
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

### `@zteam/models`

Help the user choose which 9router LLMs each team role uses by default in **this** project. Do **not** start a pipeline.

```text
1. workspaceRoot = absolute Cursor open folder
2. projectRoot = user app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. Show current models + suggestedDefaults / DEFAULT_MODELS (9RSA / 9RTA / 9RSE / 9RQA)
5. Ask modelQuestions from the tool payload (SA, TA, SE, QA, fallback, where to write)
6. Prefer scope:
   - projectRoot != "." → "app" (write {appRoot}/.zteam/config.json)
   - else → "workspace" (write {workspaceRoot}/.zteam/config.json)
7. write_zteam_config({
     workspaceRoot, projectRoot, scope,
     models: { systemArchitect, technologyArchitect, softwareEngineer, qaEngineer, fallback },
     maxTokens: keep existing from get_zteam_config if present (do not force defaults unless missing)
   })
8. Confirm path written + final models; point to .zteam/config.json
9. Stop (unless user asked to run a pipeline next)
```

Difference vs `@zteam/config`: **models-only** (no maxTokens/gitignore interview unless the user asks). Use `@zteam/config` for full first-time setup.

### `@zteam/config`

```text
1. workspaceRoot = absolute Cursor open folder (Workspace Path)
2. projectRoot = user app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. Ask setup questions (scope workspace|app|both, model ids, maxTokens, gitignore)
5. write_zteam_config({ workspaceRoot, projectRoot, scope, models, maxTokens?, gitignoreIgnore })
6. Confirm paths written; point user to .zteam/config.json and .zteam/README.MD
7. Stop (unless user asked to run a pipeline next)
```

`.zteam/config.json` is the **source of truth** for which 9router models/maxTokens each role uses. Root folder for runs is always the live Cursor folder via **`workspaceRoot`** (not sticky `mcp.json`).

### `@zteam/documentation`

```text
1. get_zteam_config({ workspaceRoot, projectRoot })
2. If needsConfig === true → STOP; run @zteam/models (or @zteam/config) → write_zteam_config → only then continue
3. run_development_pipeline({
     workspaceRoot,
     projectRoot,
     userIdea: <idea + constraints>,
     workflow: "docs"
   })
4. Report appRoot; point to .docs/requirements.md, technologies.md, todo.md, specs
```

### `@zteam/tests`

```text
1. get_zteam_config({ workspaceRoot, projectRoot })
2. If needsConfig === true → STOP; run @zteam/models (or @zteam/config) → write_zteam_config → only then continue
3. Inspect app under projectRoot (specs, existing tests, pipeline-state) briefly
4. Pick workflow:
   - Code + specs exist, need tests / failing tests → workflow "fix"
     (userIdea: analyze coverage gaps and add/fix tests for …)
   - Specs pending implementation then tests → workflow "feature" or "resume"
   - Greenfield with no docs → tell user to run @zteam/documentation first
5. run_development_pipeline({ workspaceRoot, projectRoot, userIdea, workflow })
6. Report tests result, filesWritten, resumeHint
```

## Shared instructions (all commands)

1. Call MCP tools on **`user-zteam`** (may also appear as `zteam`).
2. Do **not** use Cursor `Task` subagents (`software-engineer`, `qa-engineer`, `system-architect`, `technology-architect`) — they never hit 9router.
3. **Always** pass **`workspaceRoot`** = absolute path of the **Cursor-open folder**. Do **not** rely on sticky `WORKSPACE_ROOT` in `mcp.json`.
4. Always set a dedicated **`projectRoot`** relative to that workspace when the app is not the workspace root (e.g. `samples/my-app`). Bare `projectRoot: "."` against the MCP package cwd is **rejected**.
5. Put hard constraints in **`userIdea`**.
6. **Before any pipeline** (`full` / `docs` / `feature` / `punch` / `fix` / `resume` / plain `@zteam`): **always** call `get_zteam_config` first (see Config gate). Never call `run_development_pipeline` until `needsConfig === false`. Exceptions: `@zteam/config` and `@zteam/models` (they are the setup flow).

### Config gate (mandatory before any pipeline)

**Do this every time** the user asks to run / document / test / resume — before `run_development_pipeline`:

```text
1. workspaceRoot = absolute Cursor open folder
2. projectRoot = app folder if given (else ".")
3. get_zteam_config({ workspaceRoot, projectRoot })
4. If needsConfig === true:
   - Do NOT call run_development_pipeline
   - Prefer @zteam/models (LLMs) or @zteam/config (full setup)
   - write_zteam_config(…)
   - Re-check get_zteam_config until needsConfig === false
5. Only then: run_development_pipeline(…)
```

If a pipeline still returns `failureKind=needsConfig`, run the same setup, then re-run.
### Arguments

| Arg | Required | Notes |
|-----|----------|--------|
| `workspaceRoot` | **yes** (skill) | Absolute Cursor open folder |
| `userIdea` | yes (pipeline) | Idea **plus** non-negotiable constraints |
| `projectRoot` | strongly yes | Relative under `workspaceRoot` (prefer `samples/…`) |
| `workflow` | no | `full` \| `docs` \| `feature` \| `punch` \| `fix` \| `resume`. Omit = auto |
| `docsOnly` | no | Deprecated → `workflow: "docs"` |

### Which workflow? (when no subcommand)

| Situation | Workflow |
|-----------|----------|
| New app, sensitive / large idea | **`docs` first** (`@zteam/documentation`) → then **`feature`** or **`full`** |
| New app, small / trusted | `full` (or omit) |
| Docs already good, new capability | `feature` |
| Tiny UI/copy tweak | `punch` |
| Bug / failing tests / add tests | `fix` (`@zteam/tests`) |
| Mid-failure, todos still `[ ]` (or phantom `[x]`) | **`resume`** (same `projectRoot` + `workspaceRoot`) |

**Requirements (full/docs):** bootstrap → SA per pré-req → clean README → **fidelity hard FAIL** → TA → specs → **architecture critic** → (scaffold → SE **verifyDelivery** loop → delivery critic → QA if full).

Empty LLM after retries → `failureKind=llm_empty` (no silent stubs). Report `failureKind` + `resumeHint`.

### Operator playbook (greenfield)

```text
1. get_zteam_config — if needsConfig → @zteam/models (or @zteam/config) first
2. @zteam/documentation + projectRoot=samples/…
3. Watch "Architecture:" notifications; read .docs/*
4. @zteam feature/full to implement (again: get_zteam_config first)
5. @zteam/tests if you want a dedicated test pass
6. On failure → workflow=resume (same workspaceRoot; config gate first)
```
### Rescue

| Symptom | Do this |
|---------|---------|
| `failureKind=needsConfig` | `@zteam/models` / `@zteam/config` or set `MODEL_*`, then re-run |
| `failureKind=llm_empty` / `spec_incomplete` / `tsc` / `fidelity` | Fix cause; `resume` with same roots — never copy sibling projects |
| Wrong/empty folder | Correct **`workspaceRoot`**; remove sticky `WORKSPACE_ROOT` from mcp.json |
| Recursion / bootstrap | `resume` / fix env |
| MCP namespace error | Restart zteam MCP; retry once |

**Never** copy a sibling sample as a silent substitute. Diagnose via `{appRoot}/.docs/pipeline-result.json`.

### After the tool returns

1. Report: command used, `workflow`, **`workspaceRoot`**, **`appRoot`**, `filesWritten`, `failureKind`, `fidelityWarnings`, `resumeHint`, key notifications.
2. Verify artefacts under **`appRoot`**.
3. On failure: quote `failureKind` + next MCP call — not a Cursor Task rewrite.

## Examples

```text
User: @zteam/models
→ get_zteam_config → show current/suggested models → ask SA/TA/SE/QA/fallback
→ write_zteam_config({ scope: "workspace", models: … }) — keep existing maxTokens

User: @zteam/config
→ get_zteam_config → questions → write_zteam_config({ scope: "workspace", models: … })

User: @zteam/documentation samples/pacman — TS canvas, infinite lives
→ get_zteam_config first; if needsConfig → models/config; else
→ run_development_pipeline({ workspaceRoot, projectRoot: "samples/pacman", workflow: "docs", userIdea: "…" })

User: @zteam/tests samples/pacman
→ get_zteam_config first; if needsConfig → models/config; else
→ run_development_pipeline({ workspaceRoot, projectRoot: "samples/pacman", workflow: "fix", userIdea: "Analyze and add missing tests…" })

User: /zteam build a pac-man in samples/pacman (TS, infinite lives)
→ get_zteam_config first; if needsConfig → models/config; else
→ docs first if greenfield sensível, else full/feature with workspaceRoot + projectRoot
```
