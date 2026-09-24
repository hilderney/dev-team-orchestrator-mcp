/**
 * Implementation progress pack smoke (no LLM).
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";

import "dotenv/config";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  implNotify,
  readImplementationProgress,
  writeImplementationProgress,
  emptyImplementationProgress,
  implementationSnapshot,
  formatFileList,
  MAX_IMPL_EVENTS,
} = await import("../src/implementation-progress.ts");

const { createProgressSession, withProgressSession } = await import(
  "../src/orchestrator.ts"
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];

// formatFileList
{
  assert(formatFileList(["a.ts", "b.ts"], 1).includes("+"), "more");
  assert(formatFileList([]) === "(none)", "empty");
  results.push("formatFileList");
}

// ring buffer + prefix
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-impl-"));
  try {
    const lines = [];
    for (let i = 0; i < MAX_IMPL_EVENTS + 3; i++) {
      await implNotify(
        (stage, message) => lines.push(`[${stage}] ${message}`),
        dir,
        "softwareEngineer",
        `event ${i}`,
        { phase: "implement" }
      );
    }
    const prog = await readImplementationProgress(dir);
    assert(prog, "exists");
    assert(prog.events.length === MAX_IMPL_EVENTS, `len ${prog.events.length}`);
    assert(lines[0].includes("Implementation:"), "prefix");
    const snap = implementationSnapshot(prog);
    assert(snap && snap.phase === "implement", "snapshot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("implNotify ring");
}

// write/read
{
  const dir = await mkdtemp(join(tmpdir(), "zteam-impl2-"));
  try {
    const empty = emptyImplementationProgress({ phase: "qa" });
    await writeImplementationProgress(dir, empty);
    const raw = await readFile(
      join(dir, ".docs/implementation-progress.json"),
      "utf8"
    );
    assert(JSON.parse(raw).phase === "qa", "phase");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  results.push("writeImplementationProgress");
}

// remainingHint spec/QA indices
{
  const session = createProgressSession();
  await withProgressSession(session, async () => {
    session.setPending({
      pendingSpecs: ["maze-system", "ghosts"],
      specIndex: 3,
      specTotal: 12,
      pendingQaSpecs: ["maze-system"],
      qaIndex: 2,
      qaTotal: 12,
    });
    const hint = session.remainingHint();
    assert(hint.includes("spec 3/12"), `hint=${hint}`);
    assert(hint.includes("QA 2/12"), `hint qa=${hint}`);
  });
  results.push("remainingHint specs/qa");
}

console.log(
  JSON.stringify({ ok: true, smoke: "implementation-progress", results }, null, 2)
);
