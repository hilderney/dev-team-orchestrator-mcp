import "dotenv/config";
import { access, readdir, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOCS_ONLY_RELS = [
  "README.md",
  ".docs/requirements.md",
  ".docs/technologies.md",
  ".docs/todo.md",
];

function parseArgs(argv) {
  let docsOnly = false;
  let projectRoot = ".";
  const ideaParts = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--docs-only") {
      docsOnly = true;
      continue;
    }
    if (a === "--project-root") {
      projectRoot = argv[++i] || ".";
      continue;
    }
    if (a.startsWith("--project-root=")) {
      projectRoot = a.slice("--project-root=".length) || ".";
      continue;
    }
    ideaParts.push(a);
  }

  return {
    docsOnly,
    projectRoot,
    userIdea: ideaParts.join(" ").trim(),
  };
}

const DEFAULT_IDEA = [
  "Build a self-contained Pac-Man demo.",
  "Pac-Man walks on a canvas with ASDW.",
  "Clicking anywhere changes Pac-Man's color.",
  "Single HTML file with embedded CSS/JS — no build step.",
].join(" ");

async function fileExists(abs) {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { docsOnly, projectRoot, userIdea: ideaArg } = parseArgs(
    process.argv.slice(2)
  );
  const userIdea = ideaArg || DEFAULT_IDEA;
  const mode = docsOnly ? "docs-only" : "full";

  console.error(`[pipeline] importing graphs…`);
  const { compiledGraph, resolveAppRoot, PACKAGE_ROOT: pkg } = await import(
    "../src/orchestrator.ts"
  );

  const appRoot = resolveAppRoot(projectRoot);
  const workspace =
    process.env.WORKSPACE_ROOT?.trim() || process.cwd();

  console.error(`[pipeline] PACKAGE_ROOT=${pkg ?? PACKAGE_ROOT}`);
  console.error(`[pipeline] WORKSPACE_ROOT/cwd=${workspace}`);
  console.error(`[pipeline] projectRoot=${projectRoot}`);
  console.error(`[pipeline] appRoot=${appRoot}`);
  console.error(`[pipeline] mode=${mode}`);
  console.error(
    `[pipeline] userIdea=${userIdea.slice(0, 120)}${userIdea.length > 120 ? "…" : ""}`
  );
  console.error(
    docsOnly
      ? "[pipeline] invoking docs graph (SA req → TA → SA specs → finalize)…"
      : "[pipeline] invoking full graph (… → SE loop → QA/fix → finalize)…"
  );

  const started = Date.now();
  console.error(`[pipeline] start (${mode})`);

  let result;
  try {
    result = await compiledGraph.invoke({
      userIdea,
      projectRoot,
      docsOnly,
      notifications: [],
      pendingSpecs: [],
      completedSpecs: [],
      pendingQaSpecs: [],
      qaFixRound: 0,
    });
  } catch (err) {
    console.error(
      `[pipeline] FAILED after ${Date.now() - started}ms:`,
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
    const failure = {
      ok: false,
      mode,
      projectRoot,
      appRoot,
      error: err instanceof Error ? err.message : String(err),
      userIdea,
    };
    await writeFile(
      join(PACKAGE_ROOT, "pipeline-result.json"),
      JSON.stringify(failure, null, 2),
      "utf8"
    );
    return;
  }

  console.error(`[pipeline] done in ${Date.now() - started}ms (${mode})`);

  const outPath = join(PACKAGE_ROOT, "pipeline-result.json");
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
  console.error(`[pipeline] wrote ${outPath}`);

  console.error("[pipeline] artifact check:");
  for (const rel of DOCS_ONLY_RELS) {
    const exists = await fileExists(join(appRoot, rel));
    console.error(`  ${exists ? "OK" : "MISSING"}  ${rel}`);
  }

  const specsDir = join(appRoot, ".docs", "specs");
  if (await fileExists(specsDir)) {
    const specs = (await readdir(specsDir)).filter((n) =>
      n.toLowerCase().endsWith(".spec.md")
    );
    console.error(`  ${specs.length > 0 ? "OK" : "MISSING"}  .docs/specs/*.spec.md (${specs.length})`);
  } else {
    console.error(`  MISSING  .docs/specs/`);
  }

  if (!docsOnly && Array.isArray(result.notifications)) {
    console.error("[pipeline] notifications:");
    for (const n of result.notifications) {
      console.error(`  ${n}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode,
        projectRoot,
        appRoot,
        outPath,
        stages: Object.keys(result),
        ms: Date.now() - started,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[pipeline] unexpected error:", err);
  process.exit(1);
});
