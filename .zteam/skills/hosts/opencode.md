# zteam — OpenCode adapter

**Host:** OpenCode · **Status:** draft (P3-3)

## Prévias
1. CLI-first: `npm run pipeline -- --workflow <id> --project-root <app> "ideia"`.
2. Config `.zteam/config.json` com models **9router** (ou o runtime que OpenCode mapear ao MCP stdio).
3. Se MCP stdio estiver disponível: apontar para `tsx src/orchestrator.ts` como no Cursor `mcp.json`.
4. `projectType` no config quando conhecido; skills de role em `.zteam/skills/roles/` por fase.

## Ordem TDD (obrigatória)
```text
QA-red → SE green (sem [x]) → delivery critic → QA-verify (markTodoDone)
```
| Need | Flag |
|------|------|
| Só docs | `--workflow docs` |
| 1 feature | `--workflow feature` |
| Só testes | `--workflow tests` (+ slug) |
| Análise | `--workflow analyze` (+ scope/role) |
| Resume | `--workflow resume` |

## Diferenças vs Cursor
- Sem `@zteam` skill picker nativo — usar este ficheiro como system instructions.
- Não copiar playbook Task/`inherit` sem adaptar.

## Não fazer
- Misturar Task Cursor com 9router no mesmo run.
- Marcar `[x]` antes do QA-verify.
