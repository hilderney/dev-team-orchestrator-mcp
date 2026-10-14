# Analysis — skills-catalog (merged)

Lab: `samples/zteam-skills-lab` · Date: 2026-09-26  
Runs: per-role `workflow=analyze` (CLI). Live MCP schema was stale — used CLI.

| Role | Review file | Notes |
|------|-------------|-------|
| SA | [skills-sa-review.md](./skills-sa-review.md) | Applied → P0 SA skills |
| TA | [skills-ta-review.md](./skills-ta-review.md) | Applied → P0 TA skills |
| UX | [skills-ux-review.md](./skills-ux-review.md) | Applied → P0 UX skills |
| SE | [skills-catalog-review.md](./skills-catalog-review.md) (SE section) | Applied → SE webgame/crud/critic |
| QA | [skills-qa-review.md](./skills-qa-review.md) | LLM body empty ×2 — QA skills reconciled from pilots + SA/UX/SE consensus |

## Cross-cutting team consensus
- Keep skills lean (checklists, not manuals).
- Webgame: explicit state machine + overlay exclusivity in SA/UX/TA/QA/SE.
- CRUD: validation + alt paths; no arcade metaphors.
- TDD: red → green (no `[x]`) → critic → verify (`[x]`).
- “Ready enough?” should be binary: can a junior execute without another meeting?

## Applied to package skills
See `.zteam/skills/roles/*` files marked **Status:** pilot with **Source:** team analyze.
