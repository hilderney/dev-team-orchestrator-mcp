/**
 * Regression smokes for zTeam improvements (plan §5).
 * No live LLM / network except optional healthcheck mock.
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";
process.env.NINEROUTER_BASE ??= "http://127.0.0.1:9";
process.env.ZTEAM_SKIP_BOOTSTRAP_GATE ??= "0";
process.env.ZTEAM_BOOTSTRAP_GATE_MODE ??= "hard";

import "dotenv/config";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const {
  sanitizeFileBody,
  createProgressSession,
  withProgressSession,
  ensureTestScript,
  PACKAGE_ROOT,
} = await import("../src/orchestrator.ts");

const { classifyTestFailure } = await import("../src/test-failure.ts");
const {
  ensureAppScaffold,
  runBootstrapGate,
  bootstrapGateMode,
} = await import("../src/bootstrap.ts");
const {
  repairFileContract,
  coercePathForContent,
  stripAgentNotesFromCode,
} = await import("../src/file-contract.ts");
const { healthcheckNineRouter, clearHealthcheckCache } = await import(
  "../src/healthcheck.ts"
);
const { createMetrics, metricsSnapshot, clearMetrics } = await import(
  "../src/metrics.ts"
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];

// --- 5.2 / P0-3: classify bootstrap ---
{
  const c = classifyTestFailure(
    "vitest : O termo 'vitest' não é reconhecido como nome de cmdlet"
  );
  assert(c === "bootstrap", `expected bootstrap got ${c}`);
  const logic = classifyTestFailure("AssertionError: expected 1 to equal 2");
  assert(logic === "logic", `expected logic got ${logic}`);
  results.push("classifyTestFailure");
}

// --- P0-5 sanitize ---
{
  const body = stripAgentNotesFromCode("const x = 1;\n→ omitido: foo\n");
  assert(!body.includes("omitido"), "strips omitido");
  const path = coercePathForContent("src/A.ts", "export const A = () => <div/>;");
  assert(path === "src/A.tsx", `jsx coerce got ${path}`);
  results.push("sanitize jsx/notes");
}

// --- P0-4 scaffold ---
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-scaffold-"));
  try {
    const r = await ensureAppScaffold(dir);
    assert(r.applied, "scaffold applied");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert(pkg.scripts.test.includes("vitest"), "vitest test script");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("scaffold");
}

// --- P0-1 bootstrap gate without node_modules ---
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-boot-"));
  try {
    await cp(join(ROOT, "templates/vite-vitest-react/package.json"), join(dir, "package.json"));
    process.env.ZTEAM_BOOTSTRAP_GATE_MODE = "hard";
    // Force skip install by pointing to missing npm? Instead shadow:
    process.env.ZTEAM_BOOTSTRAP_GATE_MODE = "shadow";
    const gate = await runBootstrapGate(dir);
    assert(gate.shadowWouldAbort || gate.ok, "shadow gate runs");
    assert(bootstrapGateMode() === "shadow", "mode shadow");
  } finally {
    process.env.ZTEAM_BOOTSTRAP_GATE_MODE = "hard";
    await rm(dir, { recursive: true, force: true });
  }
  results.push("bootstrap gate shadow");
}

// --- P0-2 ensureTestScript injects vitest ---
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-testscript-"));
  try {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "t", version: "1.0.0" }, null, 2),
      "utf8"
    );
    const r = await ensureTestScript(dir, "smoke");
    assert(r.injected, "injected");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert(pkg.scripts.test === "vitest run", `got ${pkg.scripts.test}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("ensureTestScript vitest");
}

// --- 5.3 FILE repair ---
{
  const repaired = repairFileContract(
    "Here is the code:\n\n```ts\n===FILE: src/a.ts===\nexport const a = 1;\n```"
  );
  assert(repaired.includes("===FILE:"), "repair keeps FILE");
  results.push("repairFileContract");
}

// --- 5.4 progress close ---
{
  let progressAfterClose = 0;
  const session = createProgressSession({
    sendNotification: async (n) => {
      if (n.method === "notifications/progress") progressAfterClose += 1;
    },
    progressToken: "tok-1",
  });
  await withProgressSession(session, async () => {
    session.emit("t", "notify", "before");
    session.close();
    session.emit("t", "notify", "after close should not progress");
  });
  // first emit may send progress; after close must not
  assert(session.isClosed, "closed");
  // only the pre-close notify should have incremented once
  assert(progressAfterClose <= 1, `progress spam after close: ${progressAfterClose}`);
  results.push("progressToken close");
}

// --- 5.5 healthcheck fail fast ---
{
  clearHealthcheckCache();
  process.env.NINEROUTER_BASE = "http://127.0.0.1:1";
  const h = await healthcheckNineRouter(undefined, {
    timeoutMs: 500,
    force: true,
  });
  assert(!h.ok, "healthcheck should fail");
  assert(h.ms < 30_000, `healthcheck too slow: ${h.ms}`);
  results.push("healthcheck fail");
}

// --- metrics ---
{
  clearMetrics();
  createMetrics("test-trace");
  const snap = metricsSnapshot();
  assert(snap.traceId === "test-trace", "traceId");
  clearMetrics();
  results.push("metrics");
}

console.log(
  JSON.stringify({ ok: true, smoke: "improvements", results }, null, 2)
);
