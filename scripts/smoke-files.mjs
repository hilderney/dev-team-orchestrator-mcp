/**
 * Contract smoke: sanitize FILE paths/bodies, recursion helper, test preflight.
 * No live LLM.
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";

import "dotenv/config";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  sanitizeFilePath,
  sanitizeFileBody,
  parseFileSections,
  resolveGraphRecursionLimit,
  assertSafeAppRoot,
  PACKAGE_ROOT,
  ensureTestScript,
  findFidelityViolations,
} = await import("../src/orchestrator.ts");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- path sanitize ---
{
  const app = join(PACKAGE_ROOT, "samples", "pacman");
  const cleaned = sanitizeFilePath(app, "samples/pacman", "samples/pacman/src/x.ts");
  assert(cleaned === "src/x.ts", `expected src/x.ts got ${cleaned}`);
  const byBase = sanitizeFilePath(app, "samples/pacman", "pacman/src/y.ts");
  assert(byBase === "src/y.ts", `expected src/y.ts got ${byBase}`);
  let threw = false;
  try {
    sanitizeFilePath(app, "samples/pacman", "../etc/passwd");
  } catch {
    threw = true;
  }
  assert(threw, "should reject ..");
}

// --- body sanitize ---
{
  const body = sanitizeFileBody("```ts\nconst x = 1;\n```\n→ skipped: foo\n");
  assert(body.includes("const x = 1"), "keeps code");
  assert(!body.includes("```"), "strips fence");
  assert(!body.includes("skipped"), "strips skip line");
}

// --- parse FILE ---
{
  const files = parseFileSections(
    "===FILE: src/a.ts===\nhello\n===FILE: src/b.ts===\nworld\n"
  );
  assert(files.length === 2, "two files");
  assert(files[0].path === "src/a.ts", "path a");
}

// --- recursion ---
{
  delete process.env.GRAPH_RECURSION_LIMIT;
  assert(resolveGraphRecursionLimit() === 120, "default 120");
  assert(resolveGraphRecursionLimit(20) === Math.max(100, 10 + 4 * 20), "estimate");
  process.env.GRAPH_RECURSION_LIMIT = "200";
  assert(resolveGraphRecursionLimit() === 200, "env override");
  delete process.env.GRAPH_RECURSION_LIMIT;
}

// --- assertSafeAppRoot ---
{
  let threw = false;
  try {
    assertSafeAppRoot(PACKAGE_ROOT, ".");
  } catch {
    threw = true;
  }
  assert(threw, "refuse package root with projectRoot=.");
}

// --- fidelity heuristic ---
{
  const v = findFidelityViolations(
    "TypeScript canvas pacman with infinite lives and death counter",
    "## Rules\nPlayer has 3 lives and game over.\n"
  );
  assert(v.length > 0, "detects lives drift");
}

// --- coerce skips types.ts ---
{
  const { coercePathForContent } = await import("../src/file-contract.ts");
  const p = coercePathForContent(
    "src/types.ts",
    "type X = Array<string>;\nconst y = <T>(x: T) => x;"
  );
  assert(p === "src/types.ts", "do not coerce types.ts");
}

// --- ensureTestScript ---
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-smoke-"));
  try {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "t", version: "1.0.0" }, null, 2),
      "utf8"
    );
    await writeFile(join(dir, "tsconfig.json"), "{}", "utf8");
    const r = await ensureTestScript(dir, "smoke");
    assert(r.injected, "should inject test script");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert(pkg.scripts.test === "vitest run", `got ${pkg.scripts.test}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, smoke: "files" }, null, 2));
