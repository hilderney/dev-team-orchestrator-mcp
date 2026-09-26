# MyPokeCards / zz-review — hygiene shipped (2026-09)

Post-mortem session write-up: repo root [`zz-review.md`](../../zz-review.md).

## Shipped in orchestrator (this wave)

| Defect | Fix |
|--------|-----|
| D05 bootstrap wipe | Preserve `requirements.md` when `##` sections exist; `ZTEAM_FORCE_BOOTSTRAP=1` to force |
| D06/D07 todo vs specs | `assertParsedTodoAndSpecs` requires 1:1 SPEC blocks; disk gate; resumeHint for orphans |
| D15 stdio JSON | MCP `ProgressSession.consoleEnabled=false` by default; CLI enables console |
| D09 batch | Default `maxBatch=1`; `ZTEAM_SE_BATCH` / punch=3 |
| D02 healthcache | Fail TTL ~20s, success ~3min; restart/tunnel hint in message |
| D11 Files to touch | Strict clean file paths only; specs stage asserts |
| D12 project-setup | Scaffold does not mark `[x]`; SE + `verifyDelivery` DoD |
| D16 empty | Immediate local `models.fallback` on first empty/no_file_sections |
| D10 ts→tsx | Skip `types.ts` / `*Store.ts` / `.d.ts`; stronger JSX heuristic |

Already present before this wave: fidelity stub tolerance (D03), config MCP tools + `workspaceRoot` (D01/D13).

## Out of scope (9router)

- Provider reporting `IN 0 · OUT 0` as success
- Cap `OUT 1600` on free SA combos

Configure better models / `fallback` in `.zteam/config.json`.

## Ops checklist

1. `npm run smoke:all`
2. Restart MCP `user-zteam`
3. Confirm `get_zteam_config` / `write_zteam_config` in tool discovery
