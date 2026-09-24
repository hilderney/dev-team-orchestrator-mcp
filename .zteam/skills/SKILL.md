---
name: zteam
description: >-
  Run the Dev Team Orchestrator MCP pipeline (9router LangGraph team).
  Use when the user invokes /zteam, @zteam, @zteam/config, @zteam/documentation,
  @zteam/tests, or asks to run the full team / orchestrator on an idea under a
  project root.
disable-model-invocation: true
---

# zteam — Dev Team Orchestrator

## Commands (route first)

When the user invokes a **subcommand**, follow that path **before** a generic full pipeline. Canonical list also lives in [`.zteam/README.MD`](../../.zteam/README.MD). A local copy of this skill is kept at **`.zteam/skills/SKILL.md`** (created/refreshed whenever `.zteam/` is bootstrapped — before any pipeline LLM call).

| Trigger | Action |
|---------|--------|
| **`@zteam/config`** / `/zteam config` | Setup only — create/update `.zteam/config.json` (source of truth for 9router models). Do **not** start the pipeline unless the user also asked to run it. |
| **`@zteam/documentation`** / `/zteam documentation` / `/zteam docs` | Docs-only — `workflow: "docs"`. |
| **`@zteam/tests`** / `/zteam tests` | Analyze app/specs and create or strengthen tests via MCP (QA-focused). |
| **`@zteam`** / `/zteam` (no subcommand) | Normal pipeline; pick workflow from the table below. |

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
1. Ensure config (same gate as below) if needsConfig
2. run_development_pipeline({
     workspaceRoot,
     projectRoot,
     userIdea: <idea + constraints>,
     workflow: "docs"
   })
3. Report appRoot; point to .docs/requirements.md, technologies.md, todo.md, specs
```

### `@zteam/tests`

```text
1. Ensure config if needsConfig
2. Inspect app under projectRoot (specs, existing tests, pipeline-state) briefly
3. Pick workflow:
   - Code + specs exist, need tests / failing tests → workflow "fix"
     (userIdea: analyze coverage gaps and add/fix tests for …)
   - Specs pending implementation then tests → workflow "feature" or "resume"
   - Greenfield with no docs → tell user to run @zteam/documentation first
4. run_development_pipeline({ workspaceRoot, projectRoot, userIdea, workflow })
5. Report tests result, filesWritten, resumeHint
```

## Shared instructions (all commands)

1. Call MCP tools on **`user-zteam`** (may also appear as `zteam`).
2. Do **not** use Cursor `Task` subagents (`software-engineer`, `qa-engineer`, `system-architect`, `technology-architect`) — they never hit 9router.
3. **Always** pass **`workspaceRoot`** = absolute path of the **Cursor-open folder**. Do **not** rely on sticky `WORKSPACE_ROOT` in `mcp.json`.
4. Always set a dedicated **`projectRoot`** relative to that workspace when the app is not the workspace root (e.g. `samples/my-app`). Bare `projectRoot: "."` against the MCP package cwd is **rejected**.
5. Put hard constraints in **`userIdea`**.

### Config gate (before any pipeline)

```text
1. workspaceRoot = absolute Cursor open folder
2. get_zteam_config({ workspaceRoot, projectRoot })
3. If needsConfig / !exists.workspace && !exists.app:
   - Prefer guiding the user through @zteam/config (or ask questions inline)
   - write_zteam_config(…)
4. Then run_development_pipeline(…)
If failureKind=needsConfig → same setup, then re-run.
```

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
| Mid-failure, todos still `[ ]` | **`resume`** (same `projectRoot` + `workspaceRoot`) |

**Requirements (full/docs):** bootstrap Resume + Pré Requirements → SA per item → clean README → **fidelity** gate → TA → specs → (SE/QA if full).

### Operator playbook (greenfield)

```text
1. @zteam/config (once per workspace/app)
2. @zteam/documentation + projectRoot=samples/…
3. Watch "Architecture:" notifications; read .docs/*
4. @zteam feature/full to implement
5. @zteam/tests if you want a dedicated test pass
6. On failure → workflow=resume (same workspaceRoot)
```

### Rescue

| Symptom | Do this |
|---------|---------|
| `failureKind=needsConfig` | `@zteam/config` then re-run |
| Wrong/empty folder | Correct **`workspaceRoot`**; remove sticky `WORKSPACE_ROOT` from mcp.json |
| Recursion / empty SE / bootstrap | `resume` / fix env — never copy sibling projects |
| MCP namespace error | Restart zteam MCP; retry once |

**Never** copy a sibling sample as a silent substitute. Diagnose via `{appRoot}/.docs/pipeline-result.json`.

### After the tool returns

1. Report: command used, `workflow`, **`workspaceRoot`**, **`appRoot`**, `filesWritten`, `fidelityWarnings`, `resumeHint`, key notifications.
2. Verify artefacts under **`appRoot`**.
3. On failure: quote `failureKind` + next MCP call — not a Cursor Task rewrite.

## Examples

```text
User: @zteam/config
→ get_zteam_config → questions → write_zteam_config({ scope: "workspace", models: … })

User: @zteam/documentation samples/pacman — TS canvas, infinite lives
→ run_development_pipeline({ workspaceRoot, projectRoot: "samples/pacman", workflow: "docs", userIdea: "…" })

User: @zteam/tests samples/pacman
→ run_development_pipeline({ workspaceRoot, projectRoot: "samples/pacman", workflow: "fix", userIdea: "Analyze and add missing tests…" })

User: /zteam build a pac-man in samples/pacman (TS, infinite lives)
→ docs first if greenfield sensível, else full/feature with workspaceRoot + projectRoot
```
