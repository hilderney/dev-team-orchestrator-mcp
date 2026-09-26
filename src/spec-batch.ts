/**
 * Batch small punch-sized specs (P2-1).
 * Default maxBatch=1 (safe for free 9router SE models); override via ZTEAM_SE_BATCH or punch.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PUNCH_MAX_CHARS = 800;
const PUNCH_KEYWORDS =
  /\b(copy|color|cor|label|texto|typo|spacing|css|style|ui tweak)\b/i;

/** Resolve SE batch size: env ZTEAM_SE_BATCH (1–3) → punch=3 → default 1. */
export function resolveSeMaxBatch(workflow?: string): number {
  const env = Number.parseInt(process.env.ZTEAM_SE_BATCH ?? "", 10);
  if (Number.isFinite(env) && env >= 1 && env <= 3) return env;
  if ((workflow || "").toLowerCase() === "punch") return 3;
  return 1;
}

export async function pickSpecBatch(
  appRoot: string,
  pending: string[],
  maxBatch = 1
): Promise<string[]> {
  const limit = Math.max(1, Math.min(3, maxBatch));
  if (pending.length <= 1 || limit <= 1) return pending.slice(0, 1);
  const batch: string[] = [];
  const pathHints = new Set<string>();

  for (const slug of pending) {
    if (batch.length >= limit) break;
    const specPath = join(appRoot, ".docs", "specs", `${slug}.spec.md`);
    let body = "";
    try {
      body = await readFile(specPath, "utf8");
    } catch {
      break;
    }
    const short = body.length <= PUNCH_MAX_CHARS || PUNCH_KEYWORDS.test(body);
    if (!short && batch.length === 0) {
      return [slug];
    }
    if (!short) break;

    // crude path overlap: look for `src/` mentions
    const mentioned = [...body.matchAll(/`?(src\/[a-zA-Z0-9_./-]+)`?/g)].map(
      (m) => m[1]
    );
    const overlap = mentioned.some((p) => pathHints.has(p));
    if (overlap && batch.length > 0) break;
    for (const p of mentioned) pathHints.add(p);
    batch.push(slug);
  }

  return batch.length > 0 ? batch : pending.slice(0, 1);
}
