/**
 * Regression smokes for verifyDelivery / DoD (plan §7).
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";
process.env.NINEROUTER_BASE ??= "http://127.0.0.1:9";

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const {
  parseFilesToTouch,
  filesToTouchSectionIssues,
  verifyDelivery,
  formatVerifyFeedback,
  findArchitectureCoverageGaps,
  findPhantomDoneSlugs,
  unmarkTodoSlugs,
} = await import("../src/verify-delivery.ts");
const {
  ensureAppScaffold,
} = await import("../src/bootstrap.ts");
const {
  createMetrics,
  metricsSnapshot,
  recordLlmEmpty,
  recordSpecsMarkedWithoutFiles,
  clearMetrics,
} = await import("../src/metrics.ts");
const {
  configGateSatisfied,
  hasExplicitEnvModels,
  hasAnyTeamConfig,
} = await import("../src/zteam-config.ts");
const { assertPathInsideWorkspace } = await import("../src/sandbox.ts");
const { findFidelityViolations } = await import("../src/orchestrator.ts");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];

// --- parse Files to touch ---
{
  const paths = parseFilesToTouch(`
# api-client
## Files to touch
- src/api/types.ts
- \`src/api/cards.ts\`
- As needed under src/
## Out of scope
- tests
`);
  assert(paths.includes("src/api/types.ts"), "types");
  assert(paths.includes("src/api/cards.ts"), "cards");
  assert(!paths.some((p) => /as needed/i.test(p)), "skip vague");
  results.push("parseFilesToTouch");
}

// --- prose / ambiguous Files to touch rejected ---
{
  const paths = parseFilesToTouch(`
# storage
## Files to touch
- \`src/features/storage-layer/\` (or closest feature folder)
- src/App.tsx\` / routes as needed
- src/shared/storage/db.ts
## Out of scope
`);
  assert(
    !paths.some((p) => /closest|storage-layer\/$/i.test(p)),
    "reject prose/dir paths"
  );
  assert(paths.includes("src/shared/storage/db.ts"), "keep clean path");
  results.push("parseFilesToTouch prose reject");
}

{
  const issues = filesToTouchSectionIssues(`
## Files to touch
- src/features/x/ (or closest)
`);
  assert(issues.length > 0, "section issues when only prose");
  results.push("filesToTouchSectionIssues");
}

// --- A3: N specs, 1 file → FAIL ---
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-verify-"));
  try {
    await mkdir(join(dir, ".docs", "specs"), { recursive: true });
    await writeFile(
      join(dir, ".docs", "specs", "a.spec.md"),
      "# a\n\n## Files to touch\n- src/a.ts\n",
      "utf8"
    );
    await writeFile(
      join(dir, ".docs", "specs", "b.spec.md"),
      "# b\n\n## Files to touch\n- src/b.ts\n",
      "utf8"
    );
    const r = await verifyDelivery({
      stage: "softwareEngineer",
      slugs: ["a", "b"],
      filesWritten: ["package.json"],
      appRoot: dir,
    });
    assert(!r.ok, "should fail batch fake");
    assert(r.failureKind === "spec_incomplete", `kind ${r.failureKind}`);
    assert(r.reopenSlugs.length >= 1, "reopen");
    assert(formatVerifyFeedback(r).includes("VERIFY FAIL"), "feedback");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("anti-batch-fake");
}

// --- A2: mark only when files exist ---
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-dod-"));
  try {
    await mkdir(join(dir, "src", "api"), { recursive: true });
    await mkdir(join(dir, ".docs", "specs"), { recursive: true });
    await writeFile(
      join(dir, ".docs", "specs", "api-client.spec.md"),
      "# api-client\n\n## Files to touch\n- src/api/types.ts\n- src/api/cards.ts\n",
      "utf8"
    );
    await writeFile(join(dir, "src", "api", "types.ts"), "export type T = 1;\n");
    await writeFile(join(dir, "src", "api", "cards.ts"), "export const c = 1;\n");
    const ok = await verifyDelivery({
      stage: "softwareEngineer",
      slugs: ["api-client"],
      filesWritten: ["src/api/types.ts", "src/api/cards.ts"],
      appRoot: dir,
      tscOk: true,
    });
    assert(ok.ok, "DoD pass when files present");

    const miss = await verifyDelivery({
      stage: "softwareEngineer",
      slugs: ["api-client"],
      filesWritten: ["src/api/types.ts"],
      appRoot: dir,
      tscOk: true,
    });
    // cards.ts exists on disk from earlier write — should still pass
    assert(miss.ok, "on-disk files count for DoD");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("DoD files");
}

// --- llm_empty OUT=0 ---
{
  const r = await verifyDelivery({
    stage: "softwareEngineer",
    slugs: ["x"],
    filesWritten: [],
    appRoot: process.cwd(),
  });
  assert(!r.ok && r.failureKind === "llm_empty", "empty write");
  results.push("llm_empty");
}

// --- C1 phantoms ---
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-phantom-"));
  try {
    await mkdir(join(dir, ".docs", "specs"), { recursive: true });
    await writeFile(
      join(dir, ".docs", "todo.md"),
      "- [x] ghost: Ghost spec\n- [ ] real: Real\n",
      "utf8"
    );
    await writeFile(
      join(dir, ".docs", "specs", "ghost.spec.md"),
      "# ghost\n\n## Files to touch\n- src/ghost.ts\n",
      "utf8"
    );
    const phantoms = await findPhantomDoneSlugs(dir, [
      { slug: "ghost", done: true },
      { slug: "real", done: false },
    ]);
    assert(phantoms.includes("ghost"), "phantom ghost");
    const updated = await unmarkTodoSlugs(dir, phantoms);
    assert(updated && updated.includes("[ ] ghost"), "unmark");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("phantom reopen");
}

// --- B2 architecture gaps ---
{
  const gaps = findArchitectureCoverageGaps(
    "Build a card search with TCGdex API and favorites",
    "## Stacks\n- React\n",
    ["search-cards"]
  );
  assert(
    gaps.some((g) => /TCGdex/i.test(g)),
    `expected TCGdex gap, got ${gaps.join("; ")}`
  );
  assert(
    gaps.some((g) => /favorites/i.test(g)),
    "favorites gap"
  );
  results.push("architecture gaps");
}

// --- B1 fidelity API ---
{
  const v = findFidelityViolations(
    "Use TCGdex for card data",
    "# Requirements\n\nUse pokemontcg.io instead.\n\nEnough text here to pass the stub length check for requirements body content.\n"
  );
  assert(v.some((x) => /TCGdex/i.test(x)), `fidelity ${v.join("; ")}`);
  results.push("fidelity API");
}

// --- fidelity stub + ## sections OK; stub-only FAIL ---
{
  const stubOnly = findFidelityViolations(
    "MyPokeCards collection app",
    "# Requirements\n\n_Sections are filled one pré-requirement at a time._\n"
  );
  assert(
    stubOnly.some((x) => /stub/i.test(x)),
    "stub-only should fail"
  );
  const stubPlus = findFidelityViolations(
    "MyPokeCards collection app with TCGdex",
    `# Requirements

_Sections are filled one pré-requirement at a time._

## Collection

User can save cards locally via TCGdex API and browse their collection with filters.
Enough content here to exceed eighty characters for the length gate.
`
  );
  assert(
    !stubPlus.some((x) => /stub/i.test(x)),
    "stub + ## sections should not hard-fail on stub alone"
  );
  results.push("fidelity stub tolerance");
}

// --- C2 scaffold augment ---
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-aug-"));
  try {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "t", version: "1.0.0", scripts: { test: "vitest run" } }),
      "utf8"
    );
    const r = await ensureAppScaffold(dir);
    assert(r.augmented, "augmented");
    assert(r.files.length > 0, "copied files");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("scaffold augment");
}

// --- A5 workspace guard ---
{
  let threw = false;
  try {
    assertPathInsideWorkspace("C:\\ws\\app", "C:\\other\\evil.ts");
  } catch {
    threw = true;
  }
  assert(threw, "refuse outside workspace");
  results.push("workspace guard");
}

// --- A7 env models ---
{
  const prev = process.env.MODEL_SOFTWARE_ENGINEER;
  process.env.MODEL_SOFTWARE_ENGINEER = "test-model";
  assert(hasExplicitEnvModels(), "env models");
  const cfg = {
    models: {
      systemArchitect: "a",
      technologyArchitect: "b",
      uiUxDesigner: "ux",
      softwareEngineer: "c",
      qaEngineer: "d",
      fallback: "",
    },
    maxTokens: {
      systemArchitect: 1,
      technologyArchitect: 1,
      uiUxDesigner: 1,
      softwareEngineer: 1,
      qaEngineer: 1,
    },
    sources: { workspaceConfig: null, appConfig: null },
    exists: { workspace: false, app: false },
  };
  assert(configGateSatisfied(cfg), "gate open via env");
  assert(!hasAnyTeamConfig(cfg), "no file config");
  if (prev === undefined) delete process.env.MODEL_SOFTWARE_ENGINEER;
  else process.env.MODEL_SOFTWARE_ENGINEER = prev;
  results.push("needsConfig env");
}

// --- C4 metrics ---
{
  clearMetrics();
  createMetrics("verify-smoke");
  recordLlmEmpty();
  recordSpecsMarkedWithoutFiles(2);
  const snap = metricsSnapshot();
  assert(snap.llmEmpty === 1, "llmEmpty");
  assert(snap.specsMarkedWithoutFiles === 2, "specsMarked");
  clearMetrics();
  results.push("metrics C4");
}

console.log(JSON.stringify({ ok: true, smoke: "verify-delivery", results }, null, 2));
