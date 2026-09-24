/**
 * Copy zteam SKILL.md (+ README) into a project's `.zteam/` before any pipeline/LLM.
 *
 * Usage:
 *   npm run zteam:bootstrap -- [targetDir]
 *   npm run zteam:bootstrap -- C:/path/to/workspace
 *
 * Default targetDir = cwd.
 */
import { resolve } from "node:path";

const target = resolve(process.argv[2] || process.cwd());

const { ensureZteamBootstrap, ZTEAM_SKILL_SOURCE } = await import(
  "../src/zteam-config.ts"
);

const result = await ensureZteamBootstrap(target);
console.log(
  JSON.stringify(
    {
      ok: true,
      target,
      dir: result.dir,
      readme: result.readme,
      skill: result.skill,
      skillSource: ZTEAM_SKILL_SOURCE,
    },
    null,
    2
  )
);
