/**
 * Architecture progress pack smoke (no LLM).
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";

import "dotenv/config";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  extractSectionTitle,
  summarizeTech,
  listSpecSlugsFromTodo,
  formatSlugList,
  archNotify,
  readArchitectureProgress,
  MAX_ARCH_EVENTS,
  emptyArchitectureProgress,
  writeArchitectureProgress,
  architectureSnapshot,
} = await import("../src/architecture-progress.ts");

const { createProgressSession, withProgressSession } = await import(
  "../src/orchestrator.ts"
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];

// extractSectionTitle
{
  const t = extractSectionTitle("## 1. Player movement\n\ngoal...");
  assert(t === "1. Player movement", `got ${t}`);
  results.push("extractSectionTitle");
}

// summarizeTech
{
  const s = summarizeTech(
    "Use Vite + React + Vitest for a canvas game shell.",
    "## Stacks\n\n- Vite\n\n## Security\n\n- n/a\n"
  );
  assert(s.summary.includes("Vite"), "summary");
  assert(s.headingsPresent.includes("Stacks"), "Stacks");
  assert(s.headingsPresent.includes("Security"), "Security");
  results.push("summarizeTech");
}

// todo slugs
{
  const slugs = listSpecSlugsFromTodo(
    "- [ ] project-setup: Scaffold\n- [ ] maze: Maze\n- [x] done-item: Done\n"
  );
  assert(slugs.includes("project-setup") && slugs.includes("maze"), "slugs");
  assert(formatSlugList(slugs, 1).includes("+"), "format +more");
  results.push("listSpecSlugsFromTodo");
}

// ring buffer + archNotify
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-arch-"));
  try {
    const lines = [];
    for (let i = 0; i < MAX_ARCH_EVENTS + 5; i++) {
      await archNotify(
        (stage, message) => lines.push(`[${stage}] ${message}`),
        dir,
        "test",
        `event ${i}`,
        { phase: "requirements" }
      );
    }
    const prog = await readArchitectureProgress(dir);
    assert(prog, "progress exists");
    assert(prog.events.length === MAX_ARCH_EVENTS, `events ${prog.events.length}`);
    assert(lines.length === MAX_ARCH_EVENTS + 5, "emits");
    assert(lines[0].includes("Architecture:"), "prefix");
    const snap = architectureSnapshot(prog);
    assert(snap && snap.phase === "requirements", "snapshot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("archNotify ring buffer");
}

// ProgressSession remainingHint pré-reqs
{
  const session = createProgressSession();
  await withProgressSession(session, async () => {
    session.setPending({
      pendingPreReqs: ["Player moves with WASD", "Score display"],
      preReqIndex: 1,
      preReqTotal: 2,
    });
    const hint = session.remainingHint();
    assert(hint.includes("pré-req 1/2"), `hint=${hint}`);
    assert(hint.includes("faltam 2"), `hint faltam=${hint}`);
  });
  results.push("remainingHint preReqs");
}

// empty write/read
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-arch2-"));
  try {
    const empty = emptyArchitectureProgress({ phase: "technology" });
    await writeArchitectureProgress(dir, empty);
    const raw = await readFile(
      join(dir, ".docs/architecture-progress.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw);
    assert(parsed.phase === "technology", "phase");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("writeArchitectureProgress");
}

console.log(
  JSON.stringify({ ok: true, smoke: "architecture-progress", results }, null, 2)
);
