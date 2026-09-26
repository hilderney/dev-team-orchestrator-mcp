/**
 * Smoke: zteam config merge, needsConfig, gitignore, workspaceRoot override.
 * No live LLM.
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";

import "dotenv/config";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    const miss = missingNineRouterModels(
      { models: { systemArchitect: "no-such-model", qaEngineer: "" } },
      new Set(["ok"])
    );
    assert(miss.includes("systemArchitect=no-such-model"), "missing detect");
  }

  console.log("smoke:zteam-config OK");
} finally {
  if (prevWs === undefined) delete process.env.WORKSPACE_ROOT;
  else process.env.WORKSPACE_ROOT = prevWs;
  await rm(base, { recursive: true, force: true });
}
