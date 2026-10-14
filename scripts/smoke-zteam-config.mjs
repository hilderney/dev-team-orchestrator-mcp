/**
 * Smoke: zteam config merge, needsConfig, gitignore, workspaceRoot override.
 * No live LLM.
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";

import "dotenv/config";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const {
  resolveWorkspaceRoot,
  resolveAppRoot,
  requireMcpWorkspaceRoot,
} = await import("../src/orchestrator.ts");
const {
  loadTeamConfig,
  writeTeamConfig,
  ensureGitignoreIgnoresZteam,
  hasAnyTeamConfig,
  DEFAULT_MODELS,
  ROLE_MODEL_SUGGESTIONS,
  resolveRoleFallbackModel,
  resolveTeamRuntime,
  isCursorModelAlias,
  buildCursorDelegationPlaybook,
  defaultsOnlyTeamConfig,
  diagnoseWorkspace,
  needsWorkspaceRootPayload,
} = await import("../src/zteam-config.ts");
const { missingNineRouterModels } = await import("../src/healthcheck.ts");
const { withRunContext } = await import("../src/run-context.ts");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const prevWs = process.env.WORKSPACE_ROOT;
const base = await mkdtemp(join(tmpdir(), "zteam-config-"));

try {
  // --- resolveWorkspaceRoot: arg wins over env ---
  {
    process.env.WORKSPACE_ROOT = join(base, "env-ws");
    await mkdir(process.env.WORKSPACE_ROOT, { recursive: true });
    const argWs = join(base, "arg-ws");
    await mkdir(argWs, { recursive: true });
    const r = resolveWorkspaceRoot(argWs);
    assert(r.root === resolve(argWs), `arg wins: ${r.root}`);
    assert(r.source === "arg", `source arg got ${r.source}`);
  }

  // --- relative workspaceRoot rejected ---
  {
    let threw = false;
    try {
      resolveWorkspaceRoot("relative/path");
    } catch (e) {
      threw = /absolute/i.test(String(e.message || e));
    }
    assert(threw, "relative workspaceRoot must throw");
  }

  // --- ALS override ---
  {
    const alsWs = join(base, "als-ws");
    await mkdir(alsWs, { recursive: true });
    process.env.WORKSPACE_ROOT = join(base, "env-ws");
    await withRunContext(
      { workspaceRoot: alsWs, workspaceSource: "arg" },
      () => {
        const r = resolveWorkspaceRoot();
        assert(r.root === resolve(alsWs), `ALS wins: ${r.root}`);
        const app = resolveAppRoot("samples/foo");
        assert(
          app === resolve(alsWs, "samples/foo"),
          `app under ALS: ${app}`
        );
      }
    );
  }

  // --- MCP requireMcpWorkspaceRoot: ignores sticky env ---
  {
    const sticky = join(base, "sticky-ws");
    const argWs = join(base, "mcp-arg-ws");
    await mkdir(sticky, { recursive: true });
    await mkdir(argWs, { recursive: true });
    process.env.WORKSPACE_ROOT = sticky;

    const withArg = requireMcpWorkspaceRoot(argWs);
    assert(withArg.root === resolve(argWs), `MCP arg wins over sticky: ${withArg.root}`);
    assert(withArg.source === "arg", "MCP source is arg");
    assert(
      withArg.root !== resolve(sticky),
      "MCP must not resolve to sticky env path"
    );

    let threw = false;
    let kind = "";
    try {
      requireMcpWorkspaceRoot(null);
    } catch (e) {
      threw = true;
      kind = e.failureKind || "";
    }
    assert(threw && kind === "needs_workspace_root", "MCP missing arg fails closed");

    let emptyThrew = false;
    try {
      requireMcpWorkspaceRoot("   ");
    } catch (e) {
      emptyThrew = e.failureKind === "needs_workspace_root";
    }
    assert(emptyThrew, "MCP empty arg fails closed");

    // CLI still may use env when no arg
    const cli = resolveWorkspaceRoot(null);
    assert(cli.source === "env" && cli.root === resolve(sticky), "CLI still uses env");

    const diag = diagnoseWorkspace(argWs, "arg");
    assert(diag.stickyEnvValue === sticky, "diag exposes sticky value");
    assert(
      typeof diag.stickyEnvWarning === "string" &&
        diag.stickyEnvWarning.includes("ignores"),
      "diag stickyEnvWarning"
    );

    const payload = needsWorkspaceRootPayload();
    assert(payload.failureKind === "needs_workspace_root", "payload kind");
    assert(payload.stickyEnvPresent === true, "payload sticky present");
  }

  // --- needsConfig when no files ---
  {
    const ws = join(base, "empty-ws");
    const app = join(ws, "app");
    await mkdir(app, { recursive: true });
    const cfg = await loadTeamConfig(ws, app);
    assert(!hasAnyTeamConfig(cfg), "no config files");
    assert(cfg.models.systemArchitect === DEFAULT_MODELS.systemArchitect, "env/default models");
  }

  // --- write + merge: app overrides workspace ---
  {
    const ws = join(base, "merge-ws");
    const app = join(ws, "my-app");
    await mkdir(app, { recursive: true });
    await writeTeamConfig(ws, {
      models: {
        systemArchitect: "ws-sa",
        technologyArchitect: "ws-ta",
        softwareEngineer: "ws-se",
        qaEngineer: "ws-qa",
        fallback: "",
      },
    });
    await writeTeamConfig(app, {
      models: {
        systemArchitect: "app-sa",
        technologyArchitect: "ws-ta",
        softwareEngineer: "ws-se",
        qaEngineer: "ws-qa",
        fallback: "app-fb",
      },
      maxTokens: { softwareEngineer: 9999 },
    });
    const cfg = await loadTeamConfig(ws, app);
    assert(cfg.exists.workspace && cfg.exists.app, "both exist");
    assert(cfg.models.systemArchitect === "app-sa", "app overrides SA");
    assert(cfg.models.technologyArchitect === "ws-ta", "workspace TA kept");
    assert(cfg.models.fallback === "app-fb", "app fallback");
    assert(cfg.maxTokens.softwareEngineer === 9999, "app maxTokens");
    assert(
      resolveRoleFallbackModel(cfg, "softwareEngineer") === "app-fb",
      "SE fallback resolves legacy fallback"
    );
    await writeTeamConfig(app, {
      models: {
        systemArchitect: "app-sa",
        technologyArchitect: "ws-ta",
        softwareEngineer: "ws-se",
        qaEngineer: "ws-qa",
        softwareEngineerFallback: "se-fb-2",
        fallback: "app-fb",
      },
    });
    const cfg2 = await loadTeamConfig(ws, app);
    assert(
      resolveRoleFallbackModel(cfg2, "softwareEngineer") === "se-fb-2",
      "per-role SE fallback wins over legacy"
    );
    assert(
      ROLE_MODEL_SUGGESTIONS.systemArchitect.filter((s) => s.tier === "free")
        .length === 2,
      "2 free SA suggestions"
    );
    assert(
      ROLE_MODEL_SUGGESTIONS.softwareEngineer.filter((s) => s.tier === "paid")
        .length === 2,
      "2 paid SE suggestions"
    );
    const readme = await readFile(join(ws, ".zteam", "README.MD"), "utf8");
    assert(readme.includes("@zteam/config"), "README documents @zteam/config");
    assert(readme.includes("@zteam/models"), "README documents @zteam/models");
    assert(
      readme.includes("@zteam/documentation"),
      "README documents @zteam/documentation"
    );
    assert(readme.includes("@zteam/tests"), "README documents @zteam/tests");
    assert(
      /handoff|Fallback|\*Fallback/i.test(readme),
      "README mentions handoff/fallback"
    );
    const skillText = await readFile(
      join(ws, ".zteam", "skills", "SKILL.md"),
      "utf8"
    );
    assert(
      skillText.includes("@zteam/models") && skillText.includes("@zteam/config"),
      "skill documents @zteam/models"
    );
  }

  // --- gitignore helper ---
  {
    const dir = join(base, "gi");
    await mkdir(dir, { recursive: true });
    const no = await ensureGitignoreIgnoresZteam(dir, { createIfMissing: false });
    assert(no.status === "no_gitignore", "no gitignore");
    const created = await ensureGitignoreIgnoresZteam(dir, {
      createIfMissing: true,
    });
    assert(created.status === "created", "created gitignore");
    const text = await readFile(join(dir, ".gitignore"), "utf8");
    assert(text.includes(".zteam/config.json"), "has .zteam/config.json");
    const again = await ensureGitignoreIgnoresZteam(dir);
    assert(again.status === "already", "already ignored");

    const dir2 = join(base, "gi2");
    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir2, ".gitignore"), "node_modules/\n", "utf8");
    const added = await ensureGitignoreIgnoresZteam(dir2);
    assert(added.status === "added", "appended");
    const t2 = await readFile(join(dir2, ".gitignore"), "utf8");
    assert(
      t2.includes("node_modules/") && t2.includes(".zteam/config.json"),
      "both lines"
    );
  }

  // --- Zod rejects empty model on write ---
  {
    const dir = join(base, "bad");
    await mkdir(dir, { recursive: true });
    let threw = false;
    try {
      await writeTeamConfig(dir, {
        models: {
          systemArchitect: "  ",
          technologyArchitect: "ok",
          softwareEngineer: "ok",
          qaEngineer: "ok",
        },
      });
    } catch {
      threw = true;
    }
    assert(threw, "empty model rejected");
  }

  // --- config SoT: file present ignores MODEL_* env ---
  {
    const ws = join(base, "sot-ws");
    await mkdir(ws, { recursive: true });
    process.env.MODEL_SYSTEM_ARCHITECT = "env-should-not-win";
    await writeTeamConfig(ws, {
      models: {
        systemArchitect: "inherit",
        technologyArchitect: "inherit",
        uiUxDesigner: "inherit",
        softwareEngineer: "inherit",
        qaEngineer: "inherit",
      },
    });
    const cfg = await loadTeamConfig(ws, ws);
    assert(cfg.models.systemArchitect === "inherit", "config SoT beats env");
    assert(
      resolveTeamRuntime(cfg).ok &&
        resolveTeamRuntime(cfg).ok &&
        /** @type {{ok:true,runtime:string}} */ (resolveTeamRuntime(cfg))
          .runtime === "cursor",
      "cursor runtime"
    );
    assert(isCursorModelAlias("auto"), "auto alias");
    delete process.env.MODEL_SYSTEM_ARCHITECT;
  }

  // --- mixed runtime rejected ---
  {
    const mixed = {
      models: {
        systemArchitect: "inherit",
        technologyArchitect: "9RTA-technology-architect-free",
        uiUxDesigner: "inherit",
        softwareEngineer: "inherit",
        qaEngineer: "inherit",
        fallback: "",
        systemArchitectFallback: "",
        technologyArchitectFallback: "",
        uiUxDesignerFallback: "",
        softwareEngineerFallback: "",
        qaEngineerFallback: "",
      },
    };
    const res = resolveTeamRuntime(mixed);
    assert(!res.ok && res.failureKind === "mixed_runtime", "mixed fails");
  }

  // --- omit uiUxDesigner with all-inherit peers → cursor homogeneous ---
  {
    const ws = join(base, "omit-ux-ws");
    await mkdir(ws, { recursive: true });
    await mkdir(join(ws, ".zteam"), { recursive: true });
    await writeFile(
      join(ws, ".zteam", "config.json"),
      JSON.stringify({
        version: 1,
        models: {
          systemArchitect: "inherit",
          technologyArchitect: "inherit",
          softwareEngineer: "inherit",
          qaEngineer: "inherit",
        },
      }) + "\n",
      "utf8"
    );
    const cfg = await loadTeamConfig(ws, ws);
    assert(
      cfg.models.uiUxDesigner === "inherit",
      `omit UX should inherit peer family, got ${cfg.models.uiUxDesigner}`
    );
    const rt = resolveTeamRuntime(cfg);
    assert(rt.ok && rt.runtime === "cursor", "omit-UX→cursor runtime");

    await writeTeamConfig(ws, {
      models: {
        systemArchitect: "inherit",
        technologyArchitect: "inherit",
        softwareEngineer: "inherit",
        qaEngineer: "inherit",
      },
    });
    const cfg2 = await loadTeamConfig(ws, ws);
    assert(
      cfg2.models.uiUxDesigner === "inherit",
      "writeTeamConfig infers UX inherit"
    );
  }

  // --- playbook + missing models helper ---
  {
    const pb = buildCursorDelegationPlaybook({
      workflow: "docs",
      userIdea: "pacman",
      workspaceRoot: base,
      projectRoot: ".",
      appRoot: base,
      models: {
        ...defaultsOnlyTeamConfig().models,
        systemArchitect: "inherit",
        technologyArchitect: "inherit",
        uiUxDesigner: "inherit",
        softwareEngineer: "inherit",
        qaEngineer: "inherit",
      },
      maxTokens: defaultsOnlyTeamConfig().maxTokens,
    });
    assert(pb.llmRuntime === "cursor", "playbook cursor");
    assert(pb.stages.length >= 5, "docs has SA req+UX+TA+UX design+todo/specs");
    assert(
      pb.stages.every((s) => s.model === "inherit"),
      "stage models inherit"
    );
    const fullPb = buildCursorDelegationPlaybook({
      workflow: "full",
      userIdea: "pacman",
      workspaceRoot: base,
      projectRoot: ".",
      appRoot: base,
      models: pb.models,
      maxTokens: pb.maxTokens,
    });
    const ids = fullPb.stages.map((s) => s.id);
    const redIdx = ids.indexOf("qa-tdd-red");
    const seIdx = ids.indexOf("se-implement");
    const criticIdx = ids.indexOf("delivery-critic");
    const verIdx = ids.indexOf("qa-tdd-verify");
    assert(
      redIdx >= 0 &&
        seIdx > redIdx &&
        criticIdx > seIdx &&
        verIdx > criticIdx,
      "TDD order red→SE→delivery-critic→verify"
    );
    const miss = missingNineRouterModels(
      { models: { systemArchitect: "no-such-model", qaEngineer: "" } },
      new Set(["ok"])
    );
    assert(miss.includes("systemArchitect=no-such-model"), "missing detect");
  }

  // --- ensureZteamSetup: skill + docs, never src ---
  {
    const { ensureZteamSetup, ensureDocsDirs } = await import(
      "../src/zteam-config.ts"
    );
    const ws = join(base, "setup-ws");
    const app = join(ws, "app");
    await mkdir(app, { recursive: true });
    const r = await ensureZteamSetup({
      workspaceRoot: ws,
      appRoot: app,
      skill: true,
      docsDirs: true,
      configTemplate: true,
      configFamily: "cursor",
    });
    assert(r.ok && r.capability === "setup", "setup ok");
    assert(
      r.pathsTouched.every((p) => !/[\\/]src[\\/]/.test(p)),
      "setup must not touch src"
    );
    const skillPath = join(app, ".zteam", "skills", "SKILL.md");
    assert(
      (await readFile(skillPath, "utf8")).includes("@zteam"),
      "app skill copied"
    );
    const docs = await ensureDocsDirs(app);
    assert(
      docs.existed.includes(".docs") || docs.created.length === 0,
      "docs dirs present"
    );
    assert(r.config?.written === true, "config template written");
    const cfg = JSON.parse(
      await readFile(join(app, ".zteam", "config.json"), "utf8")
    );
    assert(cfg.models.uiUxDesigner === "inherit", "cursor template has UX");

    const lgDir = join(app, ".zteam", "langgraph");
    const pkgMeta = JSON.parse(
      await readFile(join(lgDir, "package-root.json"), "utf8")
    );
    assert(
      typeof pkgMeta.packageRoot === "string" && pkgMeta.packageRoot.length > 0,
      "langgraph packageRoot set"
    );
    await access(join(pkgMeta.packageRoot, "langgraph.json"));
    assert(
      (await readFile(join(lgDir, "dev.mjs"), "utf8")).includes(
        "@langchain/langgraph-cli"
      ),
      "langgraph dev.mjs present"
    );
    assert(
      (await readFile(join(lgDir, "README.md"), "utf8")).includes(
        "LangGraph Studio"
      ),
      "langgraph README present"
    );
    assert(
      r.pathsTouched.some((p) => /[\\/]\.zteam[\\/]langgraph/.test(p)),
      "setup pathsTouched includes langgraph"
    );
    const dashHtml = join(app, ".zteam", "dashboard", "index.html");
    const liveJs = join(app, ".docs", "zteam-live.js");
    assert(
      (await readFile(dashHtml, "utf8")).includes("zTeam Live Orchestrator"),
      "9Router-style dashboard HTML materialized"
    );
    assert(
      (await readFile(liveJs, "utf8")).includes("window.__ZTEAM_LIVE__"),
      "initial zteam-live.js written"
    );
    const { emitLiveEvent, readLiveDashboardState, formatCompactChatLine } =
      await import("../src/live-dashboard.ts");
    await emitLiveEvent({
      appRoot: app,
      stage: "qaTddRed",
      role: "qaEngineer",
      model: "9RQA-qa-free",
      skillKey: "qa-tdd-red-api-contract",
      status: "start",
      charsIn: 1200,
      message: "Writing failing tests for login-form",
      specsDone: 1,
      specsTotal: 4,
    });
    const liveState = await readLiveDashboardState(app);
    assert(
      liveState?.activeNode === "qaTddRed" && liveState.kpis.charsIn === 1200,
      "emitLiveEvent updates activeNode and KPIs"
    );
    const banner = formatCompactChatLine({
      workflow: "full",
      stage: "qaTddRed",
      role: "qaEngineer",
      skillKey: "qa-tdd-red-api-contract",
      message: "Writing failing tests",
      specsDone: 1,
      specsTotal: 4,
    });
    assert(
      banner.includes("[zTeam · full [1/4]]") && banner.includes("qaTddRed"),
      "compact 1-line chat banner"
    );

    // --- Dashboard orphan start reconciliation + disk scan + pipeline completion ---
    await writeFile(
      join(app, ".docs", "todo.md"),
      "- [x] maze-gen: Maze Generator\n- [ ] ghost-ai: Ghost AI\n",
      "utf8"
    );
    await writeFile(
      join(app, ".docs", "specs", "maze-gen.spec.md"),
      "# Maze Gen\n## Files to touch\n- src/maze.ts\n",
      "utf8"
    );
    // Starting next stage without closing qaTddRed must auto-close qaTddRed and scan disk specs
    const afterNext = await emitLiveEvent({
      appRoot: app,
      stage: "se-implement:maze-gen",
      role: "softwareEngineer",
      status: "start",
      message: "Implementing maze-gen",
    });
    assert(
      afterNext?.nodes.qaTddRed.status === "done",
      "orphan qaTddRed start auto-closed to done"
    );
    assert(
      afterNext?.events.some(
        (e) => e.stage === "qaTddRed" && e.status === "done"
      ),
      "synthetic done event emitted for orphan start"
    );
    assert(
      afterNext?.kpis.specsTotal === 2 && afterNext?.kpis.specsDone === 1,
      `disk scan updated specs KPI (got ${afterNext?.kpis.specsDone}/${afterNext?.kpis.specsTotal})`
    );
    assert(
      (afterNext?.kpis.filesWritten || 0) >= 2,
      "disk scan counted files touched"
    );

    // Terminal pipeline done event sets pipelineStatus = completed
    const afterFinish = await emitLiveEvent({
      appRoot: app,
      stage: "pipeline",
      status: "done",
      message: "Pipeline completed",
    });
    assert(
      afterFinish?.pipelineStatus === "completed" &&
        afterFinish?.activeStage === "completed",
      "pipeline completion state set"
    );
  }

  // --- Update Plan Item 1: cursorModels per role (e.g. composer-2.5) ---
  {
    const ws = join(base, "cursor-models-ws");
    await mkdir(ws, { recursive: true });
    await writeTeamConfig(ws, {
      projectType: "webgame",
      models: {
        systemArchitect: "inherit",
        technologyArchitect: "inherit",
        uiUxDesigner: "inherit",
        softwareEngineer: "inherit",
        qaEngineer: "inherit",
      },
      cursorModels: {
        softwareEngineer: "composer-2.5",
        qaEngineer: "claude-sonnet-5-5-high",
      },
    });
    const cfg = await loadTeamConfig(ws, ws);
    assert(cfg.projectType === "webgame", "projectType persisted");
    assert(
      cfg.cursorModels.softwareEngineer === "composer-2.5",
      "cursorModels.softwareEngineer persisted"
    );
    const rt = resolveTeamRuntime(cfg);
    assert(
      rt.ok && rt.runtime === "cursor",
      "all inherit + cursorModels resolves to cursor runtime without 9router"
    );
    const pb = buildCursorDelegationPlaybook({
      workflow: "full",
      userIdea: "Grid Pursuit webgame",
      workspaceRoot: ws,
      projectRoot: ".",
      appRoot: ws,
      models: cfg.models,
      cursorModels: cfg.cursorModels,
      maxTokens: cfg.maxTokens,
      projectType: cfg.projectType,
    });
    const seStage = pb.stages.find((s) => s.role === "softwareEngineer");
    const saStage = pb.stages.find((s) => s.role === "systemArchitect");
    const qaStage = pb.stages.find((s) => s.role === "qaEngineer");
    assert(
      seStage?.model === "composer-2.5",
      `SE stage uses cursorModels composer-2.5, got ${seStage?.model}`
    );
    assert(
      qaStage?.model === "claude-sonnet-5-5-high",
      `QA stage uses cursorModels claude-sonnet-5-5-high, got ${qaStage?.model}`
    );
    assert(
      saStage?.model === "inherit",
      `SA stage falls back to inherit, got ${saStage?.model}`
    );

    // Item 6: subagent prompt does not ask subagent to call get_pipeline_state
    assert(
      pb.stages.every((s) => !s.instructions.includes("get_pipeline_state")),
      "subagent instructions must not ask subagent to call get_pipeline_state"
    );
    assert(
      pb.resumeHint.includes("get_pipeline_state"),
      "host resumeHint retains get_pipeline_state instructions"
    );
  }

  // --- Update Plan Item 2 & 7: 2-Wave playbook per slug + Cursor resume ---
  {
    const app = join(base, "wave2-app");
    await mkdir(join(app, ".docs", "specs"), { recursive: true });
    await writeFile(
      join(app, ".docs", "todo.md"),
      "# Todo\n- [ ] maze-generator: Procedural Maze\n- [ ] ghost-ai: Ghost Pursuit\n- [x] boot-shell: Boot Shell\n",
      "utf8"
    );
    // maze-generator already has a spec; ghost-ai does not
    await writeFile(
      join(app, ".docs", "specs", "maze-generator.spec.md"),
      "# Maze\n## Files to touch\n- src/maze.ts\n",
      "utf8"
    );

    const models = {
      ...defaultsOnlyTeamConfig().models,
      systemArchitect: "inherit",
      technologyArchitect: "inherit",
      uiUxDesigner: "inherit",
      softwareEngineer: "inherit",
      qaEngineer: "inherit",
    };
    const pbWave2 = buildCursorDelegationPlaybook({
      workflow: "full",
      userIdea: "Grid Pursuit",
      workspaceRoot: app,
      projectRoot: ".",
      appRoot: app,
      models,
      cursorModels: { softwareEngineer: "composer-2.5" },
      maxTokens: defaultsOnlyTeamConfig().maxTokens,
      projectType: "webgame",
    });
    assert(pbWave2.wave === 2, "wave 2 when open slugs exist in todo.md");
    const stageIds = pbWave2.stages.map((s) => s.id);
    // maze-generator spec exists -> no sa-spec:maze-generator, but has qa-tdd-red:maze-generator, se-implement:maze-generator, delivery-critic:maze-generator
    assert(
      !stageIds.includes("sa-spec:maze-generator"),
      "existing spec skipped"
    );
    assert(
      stageIds.includes("qa-tdd-red:maze-generator") &&
        stageIds.includes("se-implement:maze-generator") &&
        stageIds.includes("delivery-critic:maze-generator"),
      "per-slug TDD trio emitted for maze-generator"
    );
    // ghost-ai has no spec -> 3-handed spec stages emitted
    assert(
      stageIds.includes("sa-spec:ghost-ai") &&
        stageIds.includes("ux-spec:ghost-ai") &&
        stageIds.includes("ta-spec:ghost-ai"),
      "3-handed spec stages emitted for ghost-ai"
    );
    assert(
      stageIds[stageIds.length - 1] === "qa-tdd-verify",
      "qa-tdd-verify is last"
    );

    // Item 7: Resume filters out stages marked done in pipeline-state.json
    const { updatePipelineStage } = await import("../src/pipeline-state.ts");
    await updatePipelineStage(app, {
      stage: "qa-tdd-red:maze-generator",
      recordStatus: "done",
      recordRole: "qaEngineer",
    });
    await updatePipelineStage(app, {
      stage: "se-implement:maze-generator",
      recordStatus: "error",
      recordRole: "softwareEngineer",
    });
    const pbResume = buildCursorDelegationPlaybook({
      workflow: "resume",
      userIdea: "Grid Pursuit",
      workspaceRoot: app,
      projectRoot: ".",
      appRoot: app,
      models,
      cursorModels: { softwareEngineer: "composer-2.5" },
      maxTokens: defaultsOnlyTeamConfig().maxTokens,
      projectType: "webgame",
    });
    const resumeIds = pbResume.stages.map((s) => s.id);
    assert(
      !resumeIds.includes("qa-tdd-red:maze-generator"),
      "completed qa-tdd-red:maze-generator not re-emitted on resume"
    );
    assert(
      resumeIds.includes("se-implement:maze-generator"),
      "failed se-implement:maze-generator re-emitted on resume"
    );
  }

  // --- Update Plan Item 3, 4, 5: Schema contract, host.json probe, and stage-gate ---
  {
    const { writeZteamConfigToolShape, getPipelineStateToolShape } =
      await import("../src/zteam-config.ts");
    assert(
      "projectType" in writeZteamConfigToolShape &&
        "cursorModels" in writeZteamConfigToolShape,
      "write_zteam_config schema exposes projectType and cursorModels"
    );
    assert(
      "recordStage" in getPipelineStateToolShape &&
        "recordRole" in getPipelineStateToolShape &&
        "recordStatus" in getPipelineStateToolShape &&
        "recordMessage" in getPipelineStateToolShape &&
        "skillKey" in getPipelineStateToolShape &&
        "filesCount" in getPipelineStateToolShape &&
        "checkGate" in getPipelineStateToolShape,
      "get_pipeline_state schema exposes all telemetry & gate fields"
    );

    const { ensureHostProbeFile } = await import("../src/host-probe.ts");
    const { checkStageGate } = await import("../src/stage-gate.ts");
    const gateApp = join(base, "gate-app");
    await mkdir(join(gateApp, ".docs", "specs"), { recursive: true });
    await mkdir(join(gateApp, "tests"), { recursive: true });
    const { probe } = await ensureHostProbeFile(gateApp);
    assert(
      typeof probe.nodeVersion === "string" &&
        typeof probe.hasNodeSqlite === "boolean",
      "host.json probe written"
    );

    await writeFile(
      join(gateApp, ".docs", "specs", "maze.spec.md"),
      "# Maze\nCorridors must have at most 3 free cells in a line.\n",
      "utf8"
    );
    await writeFile(
      join(gateApp, "tests", "maze.test.ts"),
      `import Database from "better-sqlite3";\n// Test requires 13 free cells in a line\nexpect(freeCellsInLine).toBeGreaterThanOrEqual(13);\n`,
      "utf8"
    );
    const gateRes = await checkStageGate({
      appRoot: gateApp,
      stage: "qa-tdd-red:maze",
    });
    assert(!gateRes.ok, "qa-tdd-red gate fails on native addon + contradiction");
    assert(
      gateRes.reasons.some((r) => /better-sqlite3/i.test(r)),
      "gate flags better-sqlite3"
    );
    assert(
      gateRes.reasons.some((r) => /Contradictory/i.test(r)),
      "gate flags 13 vs max 3 contradiction"
    );
  }

  // --- Hybrid 9router / OmniRoute / OpenRouter + Path A / Path B routing ---
  {
    const { resolveLlmEndpoint, MCP_DOTENV_PATH } = await import(
      "../src/env-config.ts"
    );
    assert(
      MCP_DOTENV_PATH.endsWith(".env"),
      "MCP_DOTENV_PATH points to package .env"
    );

    // 1. Multi-model hybrid (SA/TA/SE = 9r-code-heavy, UX/QA = 9r-code-light, fallbacks = auto -> normalized to inherit)
    const multiDir = join(base, "hybrid-multi");
    await mkdir(multiDir, { recursive: true });
    await writeTeamConfig(multiDir, {
      provider: "hybrid",
      projectType: "webgame",
      models: {
        systemArchitect: "9r-code-heavy",
        technologyArchitect: "9r-code-heavy",
        uiUxDesigner: "9r-code-light",
        softwareEngineer: "9r-code-heavy",
        qaEngineer: "9r-code-light",
        fallback: "auto",
        systemArchitectFallback: "auto",
      },
    });
    const multiCfg = await loadTeamConfig(multiDir, multiDir);
    assert(multiCfg.provider === "hybrid", "provider hybrid saved");
    assert(
      multiCfg.models.fallback === "inherit" &&
        multiCfg.models.systemArchitectFallback === "inherit",
      "auto fallback normalized to inherit"
    );
    const rtMulti = resolveTeamRuntime(multiCfg);
    assert(
      rtMulti.ok && rtMulti.runtime === "ninerouter",
      "hybrid with heavy != light chooses Path B (ninerouter MCP role-agents)"
    );
    // missingNineRouterModels ignores 'inherit' fallbacks
    const missingMulti = missingNineRouterModels(
      multiCfg,
      new Set(["9r-code-heavy", "9r-code-light"])
    );
    assert(
      missingMulti.length === 0,
      `inherit fallbacks must not fail 9router /models check, got ${missingMulti.join(",")}`
    );

    // 2. Single custom model with explicit provider="hybrid" -> Path A (cursor Task + inherit + parentPickerModel)
    const singleDir = join(base, "hybrid-single");
    await mkdir(singleDir, { recursive: true });
    await writeTeamConfig(singleDir, {
      provider: "hybrid",
      projectType: "webgame",
      models: {
        systemArchitect: "9r-code-heavy",
        technologyArchitect: "9r-code-heavy",
        uiUxDesigner: "9r-code-heavy",
        softwareEngineer: "9r-code-heavy",
        qaEngineer: "9r-code-heavy",
        fallback: "inherit",
      },
    });
    const singleCfg = await loadTeamConfig(singleDir, singleDir);
    const rtSingle = resolveTeamRuntime(singleCfg);
    assert(
      rtSingle.ok &&
        rtSingle.runtime === "cursor" &&
        rtSingle.parentPickerModel === "9r-code-heavy",
      "hybrid with single custom 9r model chooses Path A (cursor Task + inherit + parentPickerModel)"
    );
    const pbSingle = buildCursorDelegationPlaybook({
      workflow: "docs",
      userIdea: "Grid Pursuit",
      workspaceRoot: singleDir,
      projectRoot: ".",
      appRoot: singleDir,
      models: singleCfg.models,
      maxTokens: singleCfg.maxTokens,
      projectType: singleCfg.projectType,
      provider: singleCfg.provider,
    });
    assert(
      pbSingle.stages.every(
        (s) =>
          s.model === "inherit" &&
          s.requestedModel === "9r-code-heavy" &&
          s.fallbackModel === "inherit"
      ),
      "Path A playbook coerces 9r-code-heavy to stage.model='inherit' and keeps stage.requestedModel='9r-code-heavy'"
    );
    assert(
      typeof pbSingle.parentPickerBanner === "string" &&
        pbSingle.parentPickerBanner.includes("9r-code-heavy"),
      "Path A playbook includes parentPickerBanner"
    );

    // 3. Multi-gateway .env resolver (OmniRoute & OpenRouter)
    const prevGate = process.env.ZTEAM_LLM_GATEWAY;
    const prevOmniKey = process.env.OMNIROUTE_KEY;
    const prevOmniBase = process.env.OMNIROUTE_BASE;
    const prevOrKey = process.env.OPENROUTER_API_KEY;
    try {
      process.env.ZTEAM_LLM_GATEWAY = "omniroute";
      process.env.OMNIROUTE_BASE = "https://omni.example.com/v1";
      process.env.OMNIROUTE_KEY = "sk-omni-test";
      const epOmni = resolveLlmEndpoint();
      assert(
        epOmni.gateway === "omniroute" &&
          epOmni.baseUrl === "https://omni.example.com/v1" &&
          epOmni.apiKey === "sk-omni-test",
        "OmniRoute gateway resolved from env"
      );

      process.env.ZTEAM_LLM_GATEWAY = "openrouter";
      process.env.OPENROUTER_API_KEY = "sk-or-test";
      const epOr = resolveLlmEndpoint();
      assert(
        epOr.gateway === "openrouter" &&
          epOr.baseUrl === "https://openrouter.ai/api/v1" &&
          epOr.apiKey === "sk-or-test",
        "OpenRouter gateway resolved from env"
      );
    } finally {
      if (prevGate === undefined) delete process.env.ZTEAM_LLM_GATEWAY;
      else process.env.ZTEAM_LLM_GATEWAY = prevGate;
      if (prevOmniKey === undefined) delete process.env.OMNIROUTE_KEY;
      else process.env.OMNIROUTE_KEY = prevOmniKey;
      if (prevOmniBase === undefined) delete process.env.OMNIROUTE_BASE;
      else process.env.OMNIROUTE_BASE = prevOmniBase;
      if (prevOrKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prevOrKey;
    }
  }

  // --- Gateway doctor: dead tunnel fallback, 401, missing model (no real network) ---
  {
    const { diagnoseLlmGateway } = await import("../src/gateway-doctor.ts");
    const { setRuntimeBaseUrlOverride } = await import("../src/env-config.ts");
    const prevBase = process.env.NINEROUTER_BASE;
    const prevKey = process.env.NINEROUTER_KEY;
    const prevGateway = process.env.ZTEAM_LLM_GATEWAY;
    delete process.env.ZTEAM_LLM_GATEWAY;
    process.env.NINEROUTER_KEY = "sk-test-key-abcd";

    /** @param {Record<string, { status?: number, json?: unknown, text?: string, error?: string }>} routes */
    function mockFetch(routes) {
      return async (url) => {
        const hit = routes[String(url)];
        if (!hit) throw new Error(`getaddrinfo ENOTFOUND ${url}`);
        if (hit.error) throw new Error(hit.error);
        const body =
          hit.text ?? (hit.json ? JSON.stringify(hit.json) : "");
        return {
          ok: (hit.status ?? 500) >= 200 && (hit.status ?? 500) < 300,
          status: hit.status ?? 500,
          text: async () => body,
        };
      };
    }

    try {
      process.env.NINEROUTER_BASE = "https://dead-tunnel.example/v1";
      const fallback = await diagnoseLlmGateway({
        requiredModelIds: ["9r-code-heavy", "9r-code-light"],
        timeoutMs: 500,
        fetchImpl: mockFetch({
          "https://dead-tunnel.example/v1/models": {
            status: 530,
            text: "Error 530 cloudflare",
          },
          "http://127.0.0.1:20128/v1/models": {
            status: 200,
            json: {
              data: [{ id: "9r-code-heavy" }, { id: "9r-code-light" }],
            },
          },
        }),
      });
      assert(
        fallback.ok && fallback.usedLocalFallback,
        "dead tunnel falls back to localhost when the same key is accepted"
      );
      assert(
        fallback.effectiveBaseUrl === "http://127.0.0.1:20128/v1",
        `effective base is local, got ${fallback.effectiveBaseUrl}`
      );
      assert(
        !JSON.stringify(fallback).includes("sk-test-key-abcd"),
        "doctor output must not contain the API key"
      );
      assert(
        fallback.keyHint.endsWith("abcd"),
        `key hint is last 4, got ${fallback.keyHint}`
      );

      const auth = await diagnoseLlmGateway({
        timeoutMs: 500,
        fetchImpl: mockFetch({
          "https://dead-tunnel.example/v1/models": {
            error: "getaddrinfo ENOTFOUND dead-tunnel.example",
          },
          "http://127.0.0.1:20128/v1/models": {
            status: 401,
            text: "unauthorized",
          },
        }),
      });
      assert(
        !auth.ok && auth.failureKind === "gateway_auth",
        `local 401 is gateway_auth, got ${auth.failureKind}`
      );

      process.env.NINEROUTER_BASE = "http://127.0.0.1:20128/v1";
      const missing = await diagnoseLlmGateway({
        requiredModelIds: ["9r-code-heavy"],
        timeoutMs: 500,
        fetchImpl: mockFetch({
          "http://127.0.0.1:20128/v1/models": {
            status: 200,
            json: { data: [{ id: "9r-code-light" }] },
          },
        }),
      });
      assert(
        !missing.ok && missing.failureKind === "invalid_model",
        `missing 9r-code-heavy is invalid_model, got ${missing.failureKind}`
      );
      assert(
        missing.sampleModelIds.includes("9r-code-light"),
        "sampleModelIds lists the 9r ids that exist"
      );
    } finally {
      setRuntimeBaseUrlOverride(null);
      if (prevBase === undefined) delete process.env.NINEROUTER_BASE;
      else process.env.NINEROUTER_BASE = prevBase;
      if (prevKey === undefined) delete process.env.NINEROUTER_KEY;
      else process.env.NINEROUTER_KEY = prevKey;
      if (prevGateway === undefined) delete process.env.ZTEAM_LLM_GATEWAY;
      else process.env.ZTEAM_LLM_GATEWAY = prevGateway;
    }
  }

  console.log("smoke:zteam-config OK");
} finally {
  if (prevWs === undefined) delete process.env.WORKSPACE_ROOT;
  else process.env.WORKSPACE_ROOT = prevWs;
  await rm(base, { recursive: true, force: true });
}
