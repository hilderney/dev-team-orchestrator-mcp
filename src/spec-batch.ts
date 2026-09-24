/**
 * Batch small punch-sized specs (P2-1).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PUNCH_MAX_CHARS = 800;
const PUNCH_KEYWORDS = /\b(copy|color|cor|label|texto|typo|spacing|css|style|ui tweak)\b/i;

export async function pickSpecBatch(
  appRoot: string,
  pending: string[],
  maxBatch = 3
): Promise<string[]> {
  if (pending.length <= 1) return pending.slice(0, 1);
  const batch: string[] = [];
  const pathHints = new Set<string>();

  for (const slug of pending) {
    if (batch.length >= maxBatch) break;
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
