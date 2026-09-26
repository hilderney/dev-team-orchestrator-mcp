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

const WORKFLOW_ALIASES = new Set([
  "full",
  "docs",
  "feature",
  "punch",
  "fix",
  "resume",
]);

function parseArgs(argv) {
  let docsOnly = false;
  let projectRoot = ".";
  let workspaceRoot = "";
  let workflow = "";
  let skipConfigGate = false;
  const ideaParts = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--docs-only") {
      docsOnly = true;
      continue;
    }
    if (a === "--skip-config-gate") {
      skipConfigGate = true;
      continue;
    }
    if (a === "--workflow") {
      workflow = (argv[++i] || "").trim().toLowerCase();
      continue;
    }
    if (a.startsWith("--workflow=")) {
      workflow = a.slice("--workflow=".length).trim().toLowerCase();
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
    if (a === "--workspace-root") {
      workspaceRoot = argv[++i] || "";
      continue;
    }
    if (a.startsWith("--workspace-root=")) {
      workspaceRoot = a.slice("--workspace-root=".length) || "";
      continue;
    }
    ideaParts.push(a);
  }

  if (workflow && !WORKFLOW_ALIASES.has(workflow)) {
    throw new Error(
      `Invalid --workflow '${workflow}'. Use: ${[...WORKFLOW_ALIASES].join("|")}`
    );
  }

  return {
    docsOnly,
    workflow,
    projectRoot,
    workspaceRoot,
    skipConfigGate,
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
  const {
    docsOnly,
    workflow: workflowArg,
    projectRoot,
    workspaceRoot: workspaceArg,
    skipConfigGate,
    userIdea: ideaArg,
  } = parseArgs(process.argv.slice(2));
  const userIdea = ideaArg || DEFAULT_IDEA;

  console.error(`[pipeline] importing graphs…`);
  const {
    compiledGraph,
    resolveAppRoot,
    resolveWorkspaceRoot,
    resolveGraphRecursionLimit,
    PACKAGE_ROOT: pkg,
    createProgressSession,
    withProgressSession,
  } = await import("../src/orchestrator.ts");
  const { resolveExplicitWorkflow } = await import("../src/workflows/index.ts");
  const {
    loadTeamConfig,
    configGateSatisfied,
    needsConfigPayload,
    diagnoseWorkspace,
    ensureZteamBootstrapRoots,
  } = await import("../src/zteam-config.ts");
  const { withRunContext } = await import("../src/run-context.ts");
  const {
    healthcheckNineRouter,
    shouldHealthcheckForWorkflow,
  } = await import("../src/healthcheck.ts");

  const explicit = resolveExplicitWorkflow({
    workflow: workflowArg,
    docsOnly,
    userIdea,
  });
  const mode = explicit || "auto";

  const ws = resolveWorkspaceRoot(workspaceArg || undefined);
  const appRoot = resolveAppRoot(projectRoot, ws.root);
  const recursionLimit = resolveGraphRecursionLimit();

  // Before config gate / any LLM
  const boot = await ensureZteamBootstrapRoots(ws.root, appRoot);
  console.error(
    `[pipeline] .zteam bootstrap skill=${boot.workspace.skill.status} readme=${boot.workspace.readme.status}`
  );

  const teamConfig = await loadTeamConfig(ws.root, appRoot);

  console.error(`[pipeline] PACKAGE_ROOT=${pkg ?? PACKAGE_ROOT}`);
  console.error(`[pipeline] workspaceRoot=${ws.root} (source=${ws.source})`);
  console.error(`[pipeline] projectRoot=${projectRoot}`);
  console.error(`[pipeline] appRoot=${appRoot}`);
  console.error(`[pipeline] workflow=${mode}`);
  console.error(`[pipeline] recursionLimit=${recursionLimit}`);
  console.error(
    `[pipeline] userIdea=${userIdea.slice(0, 120)}${userIdea.length > 120 ? "…" : ""}`
  );

  if (!skipConfigGate && !configGateSatisfied(teamConfig)) {
    const payload = needsConfigPayload({
      workspaceRoot: ws.root,
      appRoot,
      workspace: diagnoseWorkspace(ws.root, ws.source),
    });
    console.error(`[pipeline] needsConfig — write .zteam/config.json or pass --skip-config-gate`);
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = 2;
    return;
  }

  if (shouldHealthcheckForWorkflow(explicit || "full")) {
    const health = await healthcheckNineRouter();
    console.error(`[pipeline] ${health.message}`);
    if (!health.ok) {
      const failure = {
        ok: false,
        failureKind: "healthcheck",
        error: health.message,
        resumeHint: "Fix NINEROUTER_BASE / tunnel, then re-run",
        workspaceRoot: ws.root,
        appRoot,
      };
      await writeFile(
        join(PACKAGE_ROOT, "pipeline-result.json"),
        JSON.stringify(failure, null, 2),
        "utf8"
      );
      process.exitCode = 1;
      return;
    }
  }

  console.error(
    `[pipeline] invoking graph (router → ${mode === "auto" ? "classify" : mode})…`
  );

  const started = Date.now();
  const session = createProgressSession({ consoleEnabled: true });

  let result;
  try {
    result = await withRunContext(
      {
        workspaceRoot: ws.root,
        workspaceSource: ws.source,
        teamConfig,
      },
      () =>
        withProgressSession(session, async () => {
          session.emit("pipeline", "stage", `start (workflow=${mode})`);
          const out = await compiledGraph.invoke(
            {
              userIdea,
              projectRoot,
              workflow: explicit || "",
              docsOnly: Boolean(docsOnly) || explicit === "docs",
              workflowReason: "",
              notifications: [],
              resume: "",
              pendingPreReqs: [],
              completedPreReqs: [],
              currentPreReq: "",
              preReqTotal: 0,
              pendingSpecs: [],
              completedSpecs: [],
              pendingQaSpecs: [],
              qaFixRound: 0,
              deliveryFixRound: 0,
              deliveryVerifyFeedback: "",
              fidelityFixRound: 0,
              architectureGaps: [],
              appRoot,
              filesWritten: [],
              fidelityWarnings: [],
              failureKind: "",
              resumeHint: "",
            },
            { recursionLimit }
          );
          session.emit(
            "pipeline",
            "stage",
            `done in ${Date.now() - started}ms (workflow=${out.workflow || mode})`
          );
          return {
            ...out,
            appRoot: out.appRoot || appRoot,
            workspaceRoot: ws.root,
            recursionLimit,
            notifications:
              session.lines.length > 0
                ? session.lines
                : Array.isArray(out.notifications)
                  ? out.notifications
                  : [],
          };
        })
    );
  } catch (err) {
    console.error(
      `[pipeline] FAILED after ${Date.now() - started}ms:`,
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
    const failure = {
      ok: false,
      mode,
      workflow: explicit || null,
      projectRoot,
      workspaceRoot: ws.root,
      appRoot,
      recursionLimit,
      error: err instanceof Error ? err.message : String(err),
      resumeHint: `workflow=resume --project-root ${projectRoot}`,
      userIdea,
    };
    await writeFile(
      join(PACKAGE_ROOT, "pipeline-result.json"),
      JSON.stringify(failure, null, 2),
      "utf8"
    );
    try {
      await writeFile(
        join(appRoot, ".docs", "pipeline-result.json"),
        JSON.stringify(failure, null, 2),
        "utf8"
      );
    } catch {
      /* app may not exist yet */
    }
    return;
  }

  console.error(
    `[pipeline] done in ${Date.now() - started}ms (workflow=${result.workflow || mode})`
  );

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

  if (Array.isArray(result.notifications)) {
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
        workflow: result.workflow || mode,
        workflowReason: result.workflowReason || null,
        projectRoot,
        workspaceRoot: ws.root,
        appRoot: resolve(appRoot),
        recursionLimit,
        filesWritten: result.filesWritten ?? [],
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
