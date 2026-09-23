# Dev Team Orchestrator MCP

MCP server that runs a **spec-driven** LangGraph pipeline against 9router models:

1. System Architect → `README.md` + `.docs/requirements.md`
2. Technology Architect → `.docs/technologies.md`
3. System Architect → `.docs/todo.md` + `.docs/specs/*.spec.md`
4. Software Engineer → one spec at a time
5. QA Engineer → tests + fix loop with SE
6. Finalize → README status

## Setup

1. `cp .env.example .env` and fill in `NINEROUTER_BASE` / `NINEROUTER_KEY` (optional `MODEL_*`, `WORKSPACE_ROOT`, `MAX_QA_FIX_ROUNDS`).
2. `npm install`
3. Point Cursor MCP at: `npx tsx src/orchestrator.ts` (or `npm start`) from this directory.

## CLI

```bash
npm run pipeline:docs -- --project-root samples/my-app "idea…"
npm run pipeline -- --project-root samples/my-app "idea…"
npm run graph
```

Use `projectRoot` so generated docs land in the app folder, not this MCP package.

## Cursor

See [`.cursor/rules/dev-team-orchestrator.mdc`](.cursor/rules/dev-team-orchestrator.mdc).
