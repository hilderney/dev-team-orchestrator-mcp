/**
 * Section E smoke: workflow classifier heuristics (no LLM).
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  classifyWorkflow,
  resolveExplicitWorkflow,
} = await import("../src/workflows/index.ts");

async function withTempApp(hasDocs, fn) {
  const dir = join(
    tmpdir(),
    `zteam-wf-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await mkdir(join(dir, ".docs"), { recursive: true });
  if (hasDocs) {
    await writeFile(join(dir, ".docs", "requirements.md"), "# reqs\n", "utf8");
    await writeFile(join(dir, ".docs", "technologies.md"), "# tech\n", "utf8");
  }
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected '${expected}', got '${actual}'`);
  }
}

const cases = [];

cases.push({
  name: "explicit docsOnly alias",
  run: async () => {
    assertEq(
      resolveExplicitWorkflow({ docsOnly: true }),
      "docs",
      "docsOnly"
    );
    assertEq(
      resolveExplicitWorkflow({ workflow: "punch" }),
      "punch",
      "workflow arg"
    );
  },
});

cases.push({
  name: "greenfield → full",
  run: async () => {
    await withTempApp(false, async (appRoot) => {
      const r = await classifyWorkflow({
        userIdea: "Build a pac-man canvas game",
        appRoot,
      });
      assertEq(r.workflow, "full", "greenfield");
    });
  },
});

cases.push({
  name: "docs keywords → docs",
  run: async () => {
    await withTempApp(false, async (appRoot) => {
      const r = await classifyWorkflow({
        userIdea: "só planejar uma API de todos",
        appRoot,
      });
      assertEq(r.workflow, "docs", "docs keywords");
    });
  },
});

cases.push({
  name: "punch with docs → punch",
  run: async () => {
    await withTempApp(true, async (appRoot) => {
      const r = await classifyWorkflow({
        userIdea: "só muda a cor do botão para azul",
        appRoot,
      });
      assertEq(r.workflow, "punch", "punch");
    });
  },
});

cases.push({
  name: "bug with docs → fix",
  run: async () => {
    await withTempApp(true, async (appRoot) => {
      const r = await classifyWorkflow({
        userIdea: "bug no login — erro 500 ao autenticar",
        appRoot,
      });
      assertEq(r.workflow, "fix", "fix");
    });
  },
});

cases.push({
  name: "feature with docs → feature",
  run: async () => {
    await withTempApp(true, async (appRoot) => {
      const r = await classifyWorkflow({
        userIdea:
          "Add export-to-CSV for the reports page including filters and date range",
        appRoot,
      });
      assertEq(r.workflow, "feature", "feature");
    });
  },
});

cases.push({
  name: "override wins",
  run: async () => {
    await withTempApp(true, async (appRoot) => {
      const r = await classifyWorkflow({
        userIdea: "só muda a cor do botão",
        appRoot,
        explicit: "full",
      });
      assertEq(r.workflow, "full", "override");
    });
  },
});

let failed = 0;
for (const c of cases) {
  try {
    await c.run();
    console.error(`[smoke:workflows] OK  ${c.name}`);
  } catch (err) {
    failed += 1;
    console.error(
      `[smoke:workflows] FAIL ${c.name}:`,
      err instanceof Error ? err.message : err
    );
  }
}

if (failed > 0) {
  console.error(`[smoke:workflows] ${failed} case(s) failed`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, cases: cases.length }, null, 2));
}
