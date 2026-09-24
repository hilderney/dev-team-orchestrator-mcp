---
name: zteam
description: >-
  Run the Dev Team Orchestrator MCP pipeline (9router LangGraph team).
  Use when the user invokes /zteam or @zteam, or asks to run the full team /
  orchestrator on an idea under a project root.
disable-model-invocation: true
---

# zteam — Dev Team Orchestrator

## Instructions

When this skill is invoked (`/zteam`, `@zteam`, or explicit “run zteam”):

1. Call MCP **`run_development_pipeline`** on **`user-zteam`** (may also appear as `zteam`).
2. Do **not** use Cursor `Task` subagents (`software-engineer`, `qa-engineer`, `system-architect`, `technology-architect`) — they never hit 9router.
3. Always set a dedicated **`projectRoot`** (e.g. `samples/my-app`). Confirm MCP env has **`WORKSPACE_ROOT`** = Cursor workspace (or app parent). Bare `projectRoot: "."` against the MCP package cwd is **rejected**.
4. Put hard constraints in **`userIdea`** (stack, infinite lives, “hooks only”, “no X”) — the pipe anchors fidelity to that text.

### Arguments

| Arg | Required | Notes |
|-----|----------|--------|
| `userIdea` | yes | Idea **plus** non-negotiable constraints |
| `projectRoot` | strongly yes | Relative under `WORKSPACE_ROOT` (prefer `samples/…`) |
| `workflow` | no | `full` \| `docs` \| `feature` \| `punch` \| `fix` \| `resume`. Omit = auto |
| `docsOnly` | no | Deprecated → `workflow: "docs"` |

### Which workflow?

| Situation | Workflow |
|-----------|----------|
| New app, sensitive / large idea | **`docs` first** → you (or user) review `.docs/requirements.md` → then **`feature`** or **`full`** |
| New app, small / trusted | `full` (or omit) |
| Docs already good, new capability | `feature` |
| Tiny UI/copy tweak | `punch` |
| Bug / failing tests | `fix` |
| Mid-failure, todos still `[ ]` | **`resume`** (same `projectRoot`) |

**Requirements (full/docs):** bootstrap Resume + Pré Requirements → SA per item → clean README → **fidelity** gate → TA → specs → (SE/QA if full).

SE marks todo done only after **tsc smoke**; FILE paths/bodies are sanitized; QA may return `===SUMMARY===` only; missing `scripts.test` is injected as **vitest run**. Greenfield gets a **vite-vitest-react scaffold** + install before SE. Bootstrap/env failures (`failureKind=bootstrap`) do **not** burn feature fix rounds.

### Operator playbook (greenfield)

```text
1. workflow=docs + projectRoot=samples/…
2. Watch MCP notifications prefixed "Architecture:" (pré-req i/N, fidelity, tech, specs)
3. Read appRoot from the tool result; open:
   - .docs/architecture-progress.json  (live phase / events / slugs)
   - .docs/requirements.md
   - .docs/technologies.md
   - .docs/todo.md
4. If fidelityWarnings or drift vs userIdea → fix constraints in userIdea / requirements
   (do NOT blindly re-run docs “to correct” — that often worsens drift)
5. workflow=feature or full to implement
6. Watch "Implementation:" notifications (spec i/N, QA PASS/FAIL, bootstrap/fix)
   and .docs/implementation-progress.json
7. On failure → read .docs/pipeline-result.json (architecture + implementation snapshots) → workflow=resume
```

Heartbeats during requirements show `pré-req i/N: …; faltam K`. During SE/QA: `spec i/N: …` and `QA i/N: …`.

### Rescue (do not invent workarounds)

| Symptom | Do this |
|---------|---------|
| Recursion limit | `workflow=resume` or raise MCP `GRAPH_RECURSION_LIMIT` |
| `no_file_sections` / empty SE | `resume` or shrink the failing spec; **never** copy a sibling project |
| `failureKind=bootstrap` / vitest PATH | Check `npm install` under appRoot; `workflow=resume` after fix; do not ask SE to "fix tests" |
| Wrong/empty folder | Check `appRoot` + `WORKSPACE_ROOT`; restart MCP after env change |
| tsc smoke / todo still `[ ]` | `workflow=resume` same `projectRoot` |
| `fidelityWarnings` | Align requirements to `userIdea`; do not re-SA inventing new stack |
| MCP namespace `error` / auth | Ask user to restart the zteam MCP server; retry once |

**Never** copy a sibling sample (e.g. `pacman-z` → `pacman-z2`) as a silent substitute for the pipeline. If you must bypass zTeam, say so explicitly to the user.

**Never** open `pipeline-result.json` from the **orchestrator package** root to diagnose an app run — use `{appRoot}/.docs/pipeline-result.json`.

### After the tool returns

1. Report: `workflow`, `workflowReason`, **`appRoot`**, `filesWritten`, `fidelityWarnings`, `resumeHint`, key `notifications` (especially `Architecture:` / `Implementation:` lines).
2. Verify under **`appRoot`**: `README.md`, `.docs/architecture-progress.json`, `.docs/implementation-progress.json`, `.docs/requirements.md`, `.docs/todo.md`, and expected `src/` (or say what’s missing).
3. On failure: quote `failureKind` + `resumeHint`; propose the next MCP call (`resume` / `fix` / `docs`), not a Cursor Task rewrite.
4. Optional sanity: `git status` under the workspace; if old runs left fences/`→ skipped` in `.ts`, mention it (sanitize should prevent new ones).

## Examples

```text
User: /zteam build a pac-man canvas demo in samples/pacman (TS, infinite lives, sound hooks only)
→ docs first if greenfield sensível:
  run_development_pipeline({ userIdea: "…constraints…", projectRoot: "samples/pacman", workflow: "docs" })
→ after review:
  run_development_pipeline({ userIdea: "…", projectRoot: "samples/pacman", workflow: "feature" })

User: @zteam punch — submit button blue in samples/my-app
→ run_development_pipeline({ userIdea: "…", projectRoot: "samples/my-app", workflow: "punch" })

User: pipeline died mid-SE on samples/pacman
→ run_development_pipeline({ userIdea: "resume pending specs", projectRoot: "samples/pacman", workflow: "resume" })
```
