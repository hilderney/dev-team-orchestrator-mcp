/**
 * Team model config: `.zteam/config.json` (workspace default + app override).
 */
import { existsSync, readFileSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  formatSkillPromptBlock,
  resolveSkillSync,
  stageToSkillPhase,
} from "./skill-resolve.js";
import {
  DASHBOARD_HTML_REL_PATH,
  ensureLiveDashboardFiles,
} from "./live-dashboard.js";
import type { CursorPlaybookStageRecord } from "./pipeline-state.js";

/** Orchestrator package root (this MCP server). */
export const ZTEAM_PACKAGE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Canonical skill shipped with the orchestrator. */
export const ZTEAM_SKILL_SOURCE = join(
  ZTEAM_PACKAGE_ROOT,
  ".cursor",
  "skills",
  "zteam",
  "SKILL.md"
);

export const DEFAULT_MODELS = {
  systemArchitect: "9RSA-system-architect-free",
  technologyArchitect: "9RTA-technology-architect-free",
  /** Defaults to SA free combo until a dedicated 9RUX tunnel exists. */
  uiUxDesigner: "9RSA-system-architect-free",
  softwareEngineer: "9RSE-software-engineer-free",
  qaEngineer: "9RQA-qa-free",
  /** @deprecated Prefer per-role *Fallback; kept as SE legacy alias. */
  fallback: "",
  systemArchitectFallback: "",
  technologyArchitectFallback: "",
  uiUxDesignerFallback: "",
  softwareEngineerFallback: "",
  qaEngineerFallback: "",
} as const;

export const DEFAULT_MAX_TOKENS = {
  systemArchitect: 1600,
  technologyArchitect: 2500,
  uiUxDesigner: 2000,
  softwareEngineer: 8000,
  qaEngineer: 2000,
} as const;

export type TeamRole =
  | "systemArchitect"
  | "technologyArchitect"
  | "uiUxDesigner"
  | "softwareEngineer"
  | "qaEngineer";

/** Cursor-native model aliases (Task subagents; never send to 9router). */
export const CURSOR_MODEL_ALIASES = new Set([
  "inherit",
  "auto",
  "cursor",
  "cursor-auto",
]);

export type LlmRuntime = "cursor" | "ninerouter";

/**
 * Provider strategy (Hybrid 9router / OmniRoute / OpenRouter + Cursor Task):
 * - `"cursor-task"`: Always Path A (Cursor Task subagents with `stage.model = "inherit"` or native Cursor allowlist slug; custom 9r/BYOK ids go into `stage.requestedModel` + picker banner).
 * - `"ninerouter-direct"`: Always Path B (MCP LangGraph `ChatOpenAI` against `.env` OpenAI-compatible gateway: 9router, OmniRoute, OpenRouter).
 * - `"hybrid"` (default):
 *   - All primaries are Cursor aliases (`inherit` / `auto`) → Path A (`cursor`).
 *   - All primaries are the SAME custom 9r/BYOK model id (e.g. all `9r-code-heavy`) AND `provider` is explicitly `"hybrid"` with `preferTaskWhenSingleCustomModel` OR `provider === "cursor-task"` → Path A (`cursor`, `stage.model = "inherit"`, `requestedModel = "9r-code-heavy"`, banner tells user to select `9r-code-heavy` in parent chat picker).
 *   - Primaries have >1 distinct custom model (e.g. `9r-code-heavy` + `9r-code-light`) → Path B (`ninerouter`, MCP role-agents via `.env` endpoint).
 */
export type TeamProviderMode = "cursor-task" | "ninerouter-direct" | "hybrid";

/** Official Cursor Task allowlist (BYOK / custom `9r-*` models are rejected by Cursor Task if passed as `model`). */
export const CURSOR_NATIVE_TASK_ALLOWLIST = new Set([
  "inherit",
  "claude-4.6-sonnet-medium-thinking",
  "claude-fable-5-1-thinking-high",
  "claude-opus-5-5-medium",
  "claude-sonnet-5-5-high",
  "composer-2.5",
  "composer-2.5-fast",
  "gemini-3.1-pro",
  "gemini-3.8-flash-high",
  "gemini-4-argon-medium",
]);

export function isCursorTaskAllowlistedModel(model: string): boolean {
  const m = (model || "").trim();
  if (!m) return false;
  return CURSOR_NATIVE_TASK_ALLOWLIST.has(m);
}

export type CursorSubagentType =
  | "system-architect"
  | "technology-architect"
  | "generalPurpose"
  | "software-engineer"
  | "qa-engineer";

export const ROLE_TO_SUBAGENT: Record<TeamRole, CursorSubagentType> = {
  systemArchitect: "system-architect",
  technologyArchitect: "technology-architect",
  uiUxDesigner: "generalPurpose",
  softwareEngineer: "software-engineer",
  qaEngineer: "qa-engineer",
};

export const TEAM_ROLES: TeamRole[] = [
  "systemArchitect",
  "technologyArchitect",
  "uiUxDesigner",
  "softwareEngineer",
  "qaEngineer",
];

export type CursorRoleModels = Partial<Record<TeamRole, string>>;

export function isCursorModelAlias(model: string): boolean {
  const m = model.trim().toLowerCase();
  return CURSOR_MODEL_ALIASES.has(m) || m.startsWith("cursor:");
}

export type TeamRuntimeOk = {
  ok: true;
  runtime: LlmRuntime;
  provider: TeamProviderMode;
  /** Set when Path A (`cursor-task` / `hybrid` single custom model) delegates a 9r/BYOK model via parent picker + `Task(model="inherit")`. */
  parentPickerModel?: string;
  reason?: string;
};

export type TeamRuntimeErr = {
  ok: false;
  failureKind: "mixed_runtime";
  message: string;
  roles: Record<TeamRole, { model: string; runtime: LlmRuntime }>;
  suggestedConfigSnippet?: string;
};

export type TeamRuntimeResolution = TeamRuntimeOk | TeamRuntimeErr;

/**
 * When a config layer omits a primary but peers in the same layer are a single
 * runtime family, inherit that family's representative model (avoids injecting
 * DEFAULT 9router UX into an all-`inherit` config → mixed_runtime).
 */
export function inferMissingPrimaryFromPeers(
  layerModels: Partial<Record<TeamRole, string>> | undefined,
  role: TeamRole
): string | undefined {
  if (!layerModels) return undefined;
  if (layerModels[role]?.trim()) return undefined;
  const peers = TEAM_ROLES.filter((r) => r !== role)
    .map((r) => layerModels[r]?.trim() || "")
    .filter(Boolean);
  if (peers.length === 0) return undefined;
  const allCursor = peers.every((m) => isCursorModelAlias(m));
  const allNine = peers.every((m) => !isCursorModelAlias(m));
  if (allCursor) {
    const counts = new Map<string, number>();
    for (const m of peers) counts.set(m, (counts.get(m) || 0) + 1);
    let best = peers[0];
    let bestN = 0;
    for (const [m, n] of counts) {
      if (n > bestN) {
        best = m;
        bestN = n;
      }
    }
    return best;
  }
  if (allNine) {
    return DEFAULT_MODELS[role];
  }
  return undefined;
}

/** Official template: every primary listed (incl. uiUxDesigner). */
export function officialConfigModelsTemplate(
  family: "cursor" | "ninerouter" = "ninerouter"
): ResolvedTeamConfig["models"] {
  if (family === "cursor") {
    return {
      systemArchitect: "inherit",
      technologyArchitect: "inherit",
      uiUxDesigner: "inherit",
      softwareEngineer: "inherit",
      qaEngineer: "inherit",
      fallback: "inherit",
      systemArchitectFallback: "inherit",
      technologyArchitectFallback: "inherit",
      uiUxDesignerFallback: "inherit",
      softwareEngineerFallback: "inherit",
      qaEngineerFallback: "inherit",
    };
  }
  return {
    ...DEFAULT_MODELS,
    fallback: "inherit",
    systemArchitectFallback: "inherit",
    technologyArchitectFallback: "inherit",
    uiUxDesignerFallback: "inherit",
    softwareEngineerFallback: "inherit",
    qaEngineerFallback: "inherit",
  };
}

/** Snippet for mixed_runtime / missing_role resumeHint. */
export function suggestedHomogeneousConfigSnippet(
  prefer: LlmRuntime = "cursor"
): string {
  const models = officialConfigModelsTemplate(
    prefer === "cursor" ? "cursor" : "ninerouter"
  );
  return JSON.stringify(
    { version: 1, provider: "hybrid", models },
    null,
    2
  );
}

/**
 * Resolve runtime (`cursor` Path A vs `ninerouter` Path B) from `provider` + primary `models`:
 * - Mix of cursor aliases (`inherit`) and custom 9r ids in primaries → `mixed_runtime` error (unless `provider === "cursor-task"`).
 * - `provider === "cursor-task"`: always returns `runtime: "cursor"` (Path A), with `stage.model = "inherit"` for any non-allowlisted `9r-*` id.
 * - `provider === "ninerouter-direct"`: when primaries are custom ids, forces `runtime: "ninerouter"` (Path B MCP ChatOpenAI).
 * - `provider === "hybrid"` (default):
 *   - All primaries are Cursor aliases (`inherit`/`auto`) → `runtime: "cursor"`.
 *   - All 5 primaries request the **exact same** custom id (e.g. all `9r-code-heavy`) AND `cfg.provider === "hybrid"` was explicitly configured → `runtime: "cursor"` (Path A: run parent chat on `9r-code-heavy` and spawn Tasks with `model: "inherit"`).
 *   - Primaries request **multiple distinct** custom ids (e.g. `SA=9r-code-heavy`, `QA=9r-code-light`) → `runtime: "ninerouter"` (Path B: MCP role-agents call OpenAI-compatible `.env` endpoint per role).
 */
export function resolveTeamRuntime(
  cfg: Pick<ResolvedTeamConfig, "models"> & {
    provider?: TeamProviderMode;
    explicitProvider?: boolean;
  }
): TeamRuntimeResolution {
  const provider: TeamProviderMode = cfg.provider || "hybrid";
  const roles = {} as Record<
    TeamRole,
    { model: string; runtime: LlmRuntime }
  >;
  for (const role of TEAM_ROLES) {
    const model = cfg.models[role]?.trim() || "";
    roles[role] = {
      model,
      runtime: isCursorModelAlias(model) ? "cursor" : "ninerouter",
    };
  }

  if (provider === "cursor-task") {
    const customIds = [
      ...new Set(
        TEAM_ROLES.map((r) => roles[r].model).filter(
          (m) => m && !isCursorModelAlias(m)
        )
      ),
    ];
    return {
      ok: true,
      runtime: "cursor",
      provider: "cursor-task",
      parentPickerModel: customIds[0],
      reason:
        customIds.length > 0
          ? `provider=cursor-task: select '${customIds[0]}' in Cursor parent chat picker; all Task subagents use model='inherit'`
          : "provider=cursor-task: all Task subagents use Cursor runtime",
    };
  }

  const runtimes = new Set(TEAM_ROLES.map((r) => roles[r].runtime));
  if (runtimes.size > 1) {
    const detail = TEAM_ROLES.map(
      (r) => `${r}=${roles[r].model}(${roles[r].runtime})`
    ).join(", ");
    const cursorCount = TEAM_ROLES.filter(
      (r) => roles[r].runtime === "cursor"
    ).length;
    const prefer: LlmRuntime =
      cursorCount >= TEAM_ROLES.length / 2 ? "cursor" : "ninerouter";
    return {
      ok: false,
      failureKind: "mixed_runtime",
      message: `All primary models must share one runtime (cursor aliases OR 9router/OpenAPI ids). Got mixed: ${detail}`,
      roles,
      suggestedConfigSnippet: suggestedHomogeneousConfigSnippet(prefer),
    };
  }

  const baseRuntime = [...runtimes][0] ?? "ninerouter";
  if (baseRuntime === "cursor") {
    return {
      ok: true,
      runtime: "cursor",
      provider,
      reason: "all primaries are Cursor aliases (inherit)",
    };
  }

  // All primaries are non-alias (e.g. 9r-code-heavy / 9r-code-light)
  const distinctCustomIds = [
    ...new Set(TEAM_ROLES.map((r) => roles[r].model).filter(Boolean)),
  ];

  // Hybrid Path A: when all 5 roles share the exact same custom model (e.g. all 9r-code-heavy)
  // and provider is not forced to "ninerouter-direct", prefer Path A (Task + inherit) if provider was explicitly set to "hybrid"
  if (
    provider === "hybrid" &&
    cfg.explicitProvider &&
    distinctCustomIds.length === 1
  ) {
    const singleModel = distinctCustomIds[0];
    return {
      ok: true,
      runtime: "cursor",
      provider: "hybrid",
      parentPickerModel: singleModel,
      reason: `hybrid single-model (${singleModel}): select '${singleModel}' in Cursor parent chat picker; Task subagents run with model='inherit'`,
    };
  }

  return {
    ok: true,
    runtime: "ninerouter",
    provider,
    reason:
      distinctCustomIds.length > 1
        ? `hybrid multi-model (${distinctCustomIds.join(", ")}): running MCP role-agents against .env OpenAI-compatible gateway`
        : "ninerouter-direct: running MCP role-agents against .env OpenAI-compatible gateway",
  };
}

export type DelegationStage = {
  id: string;
  role: TeamRole;
  subagentType: CursorSubagentType;
  /** Safe Cursor Task model slug (ALWAYS `"inherit"` or an official Cursor allowlisted slug; NEVER a raw `9r-*` BYOK id). */
  model: string;
  /** Original model requested in `.zteam/config.json` (e.g. `"9r-code-heavy"` when `model` was coerced to `"inherit"`). */
  requestedModel?: string;
  /** Fallback model for Cursor Task (always `"inherit"`, never `"auto"`). */
  fallbackModel?: string;
  title: string;
  instructions: string;
  expectedOutputs: string[];
  /** Optional slug when stage is scoped to a single todo item. */
  slug?: string;
  /** Resolved skill key when a role skill was injected into instructions. */
  skillKey?: string;
};

export type CursorDelegationPlaybook = {
  llmRuntime: "cursor";
  provider: TeamProviderMode;
  /** Banner when Path A delegates custom/BYOK models (e.g. `9r-code-heavy`) via parent chat picker + `Task(model="inherit")`. */
  parentPickerBanner?: string;
  workflow: string;
  wave: 1 | 2;
  userIdea: string;
  workspaceRoot: string;
  projectRoot: string;
  appRoot: string;
  models: ResolvedTeamConfig["models"];
  cursorModels?: CursorRoleModels;
  maxTokens: ResolvedTeamConfig["maxTokens"];
  stages: DelegationStage[];
  resumeHint: string;
};

/**
 * Parse open (`- [ ] slug: title`) and done (`- [x] slug: title`) slugs from `.docs/todo.md`.
 */
export function parseTodoSlugsSync(appRoot: string): {
  open: Array<{ slug: string; title: string }>;
  done: Array<{ slug: string; title: string }>;
} {
  const todoPath = join(resolve(appRoot), ".docs", "todo.md");
  const open: Array<{ slug: string; title: string }> = [];
  const done: Array<{ slug: string; title: string }> = [];
  if (!existsSync(todoPath)) return { open, done };
  try {
    const text = readFileSync(todoPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(
        /^\s*-\s*\[([ xX])\]\s+([a-z0-9-_]+)(?:\s*:\s*(.+))?$/i
      );
      if (!m) continue;
      const isDone = m[1].toLowerCase() === "x";
      const slug = m[2].trim();
      const title = (m[3] || slug).trim();
      if (isDone) done.push({ slug, title });
      else open.push({ slug, title });
    }
  } catch {
    /* ignore */
  }
  return { open, done };
}

function loadCompletedStageIdsSync(
  appRoot: string,
  explicitStages?: Record<string, CursorPlaybookStageRecord>
): Set<string> {
  const doneIds = new Set<string>();
  const map =
    explicitStages ??
    (() => {
      const statePath = join(resolve(appRoot), ".docs", "pipeline-state.json");
      if (!existsSync(statePath)) return undefined;
      try {
        const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
          stages?: Record<string, CursorPlaybookStageRecord>;
        };
        return parsed.stages;
      } catch {
        return undefined;
      }
    })();
  if (!map) return doneIds;
  for (const [id, rec] of Object.entries(map)) {
    if (rec?.status === "done") doneIds.add(id);
  }
  return doneIds;
}

/**
 * Stages for skill-driven Cursor Task path (no ChatOpenAI).
 *
 * Implements Update Plan Items 1, 2, 6, 7:
 * - Item 1: `stage.model` comes from `cursorModels[role]` when non-empty, else `models[role]` (default `"inherit"`).
 * - Item 2: Two-wave expansion:
 *   - Wave 1 (when `.docs/todo.md` has no slugs yet, or `workflow === "docs"`):
 *     `sa-requirements` → `ux-juice` → `fidelity-critic` → `ta-stack` → `architecture-critic` → `ux-design-system` → `sa-todo-plan` (+ `sa-todo-and-specs` alias for legacy/docs).
 *   - Wave 2 (when `.docs/todo.md` exists on disk with open `[ ]` slugs):
 *     For each open slug: three-handed spec stages (`sa-spec:{slug}`, `ux-spec:{slug}`, `ta-spec:{slug}`) if `.docs/specs/{slug}.spec.md` is missing, plus implementation trio (`qa-tdd-red:{slug}`, `se-implement:{slug}`, `delivery-critic:{slug}`), followed by `qa-tdd-verify`.
 *   - When `.docs/todo.md` does not exist yet on a `full` call, Wave 1 is emitted alongside the aggregate fallback stages (`qa-tdd-red`, `se-implement`, `delivery-critic`, `qa-tdd-verify`) so callers inspect the full pipeline topology, and calling `run_development_pipeline` again (or `workflow="resume"`) after `.docs/todo.md` is written expands Wave 2 per-slug.
 * - Item 6: Subagent prompt is lean — `userIdea` stays once at `playbook.userIdea` (stage only gets a short 280-char summary + input artefacts), and `get_pipeline_state` telemetry instructions live ONLY in `playbook.resumeHint` (for the host), never inside the subagent's prompt.
 * - Item 7: When `workflow === "resume"`, completed stages in `.docs/pipeline-state.json` (`status === "done"`) are filtered out so only `pending` or `error` stages are returned.
 */
export function buildCursorDelegationPlaybook(opts: {
  workflow: string;
  userIdea: string;
  workspaceRoot: string;
  projectRoot: string;
  appRoot: string;
  models: ResolvedTeamConfig["models"];
  cursorModels?: CursorRoleModels;
  maxTokens: ResolvedTeamConfig["maxTokens"];
  projectType?: string;
  provider?: TeamProviderMode;
  focusSlug?: string;
  completedStageRecords?: Record<string, CursorPlaybookStageRecord>;
}): CursorDelegationPlaybook {
  const wf = opts.workflow || "full";
  const provider: TeamProviderMode = opts.provider || "hybrid";
  const idea = opts.userIdea.trim();
  const shortIdea = idea.length > 260 ? `${idea.slice(0, 260)}…` : idea;
  const rootHint = `appRoot=${opts.appRoot}`;
  const projectType = (opts.projectType || "").trim();
  const isResume = wf === "resume";
  const doneStageIds = isResume
    ? loadCompletedStageIdsSync(opts.appRoot, opts.completedStageRecords)
    : new Set<string>();

  const coercedCustomModels = new Set<string>();

  /**
   * Cursor Task allowlist guard:
   * - Never pass `"auto"` or custom BYOK/9router ids (`9r-code-heavy`, `9r-code-light`, etc.) into `stage.model`
   *   because Cursor's Task tool explicitly rejects non-allowlisted BYOK models.
   * - Native Cursor allowlisted slugs (`composer-2.5`, `composer-2.5-fast`, `claude-sonnet-5-5-high`, etc.) or `"inherit"` are allowed.
   * - Any custom/BYOK id is coerced to `"inherit"` and preserved in `stage.requestedModel`.
   */
  const resolveTaskModel = (
    role: TeamRole
  ): { model: string; requestedModel: string; fallbackModel: string } => {
    const cm = opts.cursorModels?.[role]?.trim();
    const primary = opts.models[role]?.trim() || "inherit";
    const desired = cm || primary;
    const lower = desired.toLowerCase();

    if (lower === "inherit" || lower === "auto" || lower === "cursor" || lower === "cursor-auto") {
      return {
        model: "inherit",
        requestedModel: primary,
        fallbackModel: "inherit",
      };
    }

    if (isCursorTaskAllowlistedModel(desired)) {
      return {
        model: desired,
        requestedModel: desired,
        fallbackModel: "inherit",
      };
    }

    // Legacy `cursor:...` prefix used in smoke tests
    if (lower.startsWith("cursor:")) {
      return {
        model: desired,
        requestedModel: desired,
        fallbackModel: "inherit",
      };
    }

    // Custom / BYOK / 9router model id (e.g. `9r-code-heavy`) -> coerce Task model to `inherit`
    coercedCustomModels.add(desired);
    return {
      model: "inherit",
      requestedModel: desired,
      fallbackModel: "inherit",
    };
  };

  const stage = (
    id: string,
    role: TeamRole,
    title: string,
    instructions: string,
    expectedOutputs: string[],
    slug?: string
  ): DelegationStage => {
    let instr = `${instructions}\n\nContext: ${rootHint}${slug ? ` · slug=${slug}` : ""}. Goal summary: ${shortIdea} (read full constraints in .docs/requirements.md and .docs/host.json when present).`;
    let skillKey: string | undefined;
    const phase = stageToSkillPhase(id);
    if (phase) {
      const skill = resolveSkillSync({
        role,
        phase,
        projectType,
        appRoot: opts.appRoot,
        workspaceRoot: opts.workspaceRoot,
      });
      if (skill) {
        skillKey = skill.key;
        instr = `${instr}\n\n${formatSkillPromptBlock(skill)}`;
      }
    }
    const resolvedModel = resolveTaskModel(role);
    return {
      id,
      role,
      subagentType: ROLE_TO_SUBAGENT[role],
      model: resolvedModel.model,
      requestedModel: resolvedModel.requestedModel,
      fallbackModel: resolvedModel.fallbackModel,
      title,
      instructions: instr,
      expectedOutputs,
      ...(slug ? { slug } : {}),
      skillKey,
    };
  };

  const stages: DelegationStage[] = [];
  const needsArch = ["full", "docs", "feature", ""].includes(wf);
  const needsImpl = ["full", "feature", "punch", "fix", "resume", ""].includes(
    wf
  );
  const needsQa = [
    "full",
    "feature",
    "punch",
    "fix",
    "resume",
    "tests",
    "",
  ].includes(wf);
  const docsOnly = wf === "docs";
  const testsOnly = wf === "tests";
  const analyzeOnly = wf === "analyze";

  if (analyzeOnly) {
    stages.push(
      stage(
        "analyze",
        "systemArchitect",
        "Analyze (read-only)",
        "Write .docs/reviews/<scope>-review.md covering gaps/risks for the given scope. Do not implement code or mark todos [x]. If a single role was requested, stay in that lens.",
        [".docs/reviews/*.md"]
      )
    );
    const pickerList = [...coercedCustomModels];
    const parentPickerBanner =
      pickerList.length > 0
        ? `Run this Cursor chat with model '${pickerList[0]}' selected in the picker — Task subagents use model="inherit" (Cursor blocks custom/BYOK slugs in Task.model).`
        : undefined;
    return {
      llmRuntime: "cursor",
      provider,
      ...(parentPickerBanner ? { parentPickerBanner } : {}),
      workflow: wf,
      wave: 1,
      userIdea: idea,
      workspaceRoot: opts.workspaceRoot,
      projectRoot: opts.projectRoot,
      appRoot: opts.appRoot,
      models: opts.models,
      cursorModels: opts.cursorModels,
      maxTokens: opts.maxTokens,
      stages,
      resumeHint:
        (parentPickerBanner ? `${parentPickerBanner} ` : "") +
        "llmRuntime=cursor: run each delegationPlaybook.stages entry via Cursor Task. Do NOT call 9router.",
    };
  }

  const todoSlugs = parseTodoSlugsSync(opts.appRoot);
  const focus = (opts.focusSlug || "").trim();
  const openSlugs = focus
    ? todoSlugs.open.filter((item) => item.slug === focus)
    : todoSlugs.open;
  const hasOpenTodoOnDisk = openSlugs.length > 0;
  const wave: 1 | 2 = hasOpenTodoOnDisk ? 2 : 1;

  if ((needsArch && !hasOpenTodoOnDisk) || wf === "docs") {
    stages.push(
      stage(
        "sa-requirements",
        "systemArchitect",
        "System Architect — requirements",
        "Produce or update .docs/requirements.md (## sections with goals, functional/non-functional, normal+alt flows; preserve all numbered rules from userIdea). Do not write implementation code.",
        [".docs/requirements.md"]
      )
    );
    stages.push(
      stage(
        "ux-juice",
        "uiUxDesigner",
        "UI/UX — juice addendum",
        "Score requirements UX 1–10, write ## UX / Juice addendum (action/reaction feedback) in .docs/requirements.md. Raise score to ≥7. Do not invent contradicting features.",
        [".docs/requirements.md"]
      )
    );
    stages.push(
      stage(
        "fidelity-critic",
        "systemArchitect",
        "Fidelity Critic — requirements vs userIdea",
        "Read .docs/requirements.md and compare against every constraint in playbook.userIdea. Write verdict (PASS or FAIL + missing items) to .docs/reviews/fidelity-review.md.",
        [".docs/reviews/fidelity-review.md"]
      )
    );
    stages.push(
      stage(
        "ta-stack",
        "technologyArchitect",
        "Technology Architect — stack / structure",
        "Read .docs/requirements.md and .docs/host.json. Produce .docs/technologies.md covering the 9-Layer System Design + AI Stack. Respect .docs/host.json (prefer node:sqlite over better-sqlite3 when nativeCompileLikelyOk=false).",
        [".docs/technologies.md"]
      )
    );
    stages.push(
      stage(
        "architecture-critic",
        "technologyArchitect",
        "Architecture Critic — requirements ↔ stack coverage",
        "Read .docs/requirements.md, .docs/technologies.md, and .docs/host.json. Verify persistence, auth/leaderboard, and host compatibility. Write verdict to .docs/reviews/architecture-review.md.",
        [".docs/reviews/architecture-review.md"]
      )
    );
    stages.push(
      stage(
        "ux-design-system",
        "uiUxDesigner",
        "UI/UX — look and feel",
        "From .docs/requirements.md + .docs/technologies.md write .docs/ui-ux.md: look-and-feel, hierarchy, color palette, visual/sound/sensory behavior.",
        [".docs/ui-ux.md"]
      )
    );
    stages.push(
      stage(
        "sa-todo-and-specs",
        "systemArchitect",
        "System Architect — todo plan",
        "Plan .docs/todo.md with testable `- [ ] slug: title` chunks in dependency order. Once .docs/todo.md is saved, Wave 2 expands three-handed specs (SA → UX → TA) and TDD per slug.",
        [".docs/todo.md"]
      )
    );
  }

  // Wave 2: per-slug three-handed specs + per-slug TDD (qa-tdd-red:{slug} -> se-implement:{slug} -> delivery-critic:{slug})
  if (hasOpenTodoOnDisk && (needsArch || needsImpl) && !testsOnly) {
    for (const item of openSlugs) {
      const s = item.slug;
      const specRel = `.docs/specs/${s}.spec.md`;
      const specAbs = join(resolve(opts.appRoot), specRel);
      const specExists = existsSync(specAbs);

      if (!specExists || docsOnly) {
        stages.push(
          stage(
            `sa-spec:${s}`,
            "systemArchitect",
            `SA Spec — ${s} (${item.title})`,
            `Write ${specRel} for todo '${s}: ${item.title}' with >=3 use cases, acceptance criteria, and explicit ## Files to touch.`,
            [specRel],
            s
          )
        );
        if (needsUiFlow(projectType)) {
          stages.push(
            stage(
              `ux-spec:${s}`,
              "uiUxDesigner",
              `UX Flow & States — ${s}`,
              `Enrich ${specRel} with ## Flow & states (screen transitions, overlay exclusivity, busy states).`,
              [specRel],
              s
            )
          );
        }
        stages.push(
          stage(
            `ta-spec:${s}`,
            "technologyArchitect",
            `TA Technical How-To — ${s}`,
            `Enrich ${specRel} with ## Technical design / how-to aligned with .docs/technologies.md and .docs/host.json.`,
            [specRel],
            s
          )
        );
      }

      if (needsImpl && !docsOnly) {
        stages.push(
          stage(
            `qa-tdd-red:${s}`,
            "qaEngineer",
            `QA TDD Red — ${s}`,
            `Read ${specRel} and .docs/host.json. Write failing tests for slug '${s}' ONLY. Positive test cases MUST NOT violate another rule of the spec. Never import better-sqlite3 if host.json prefers node:sqlite. Do NOT implement product code or mark [x].`,
            [`tests/**/${s}*.test.*`],
            s
          )
        );
        stages.push(
          stage(
            `se-implement:${s}`,
            "softwareEngineer",
            `SE Implement (TDD Green) — ${s}`,
            `Read ${specRel} and make the red tests for slug '${s}' pass. Touch only files scoped for '${s}'. Do not weaken tests or mark [x].`,
            ["src/**"],
            s
          )
        );
        stages.push(
          stage(
            `delivery-critic:${s}`,
            "softwareEngineer",
            `Delivery Critic — ${s}`,
            `Verify all ## Files to touch in ${specRel} exist on disk and tests for '${s}' pass.`,
            [".docs/todo.md", "src/**"],
            s
          )
        );
      }
    }
  } else if (needsImpl && !docsOnly && !testsOnly) {
    // Fallback aggregate stages when .docs/todo.md is not on disk yet
    stages.push(
      stage(
        "qa-tdd-red",
        "qaEngineer",
        "QA — TDD red (tests first)",
        "BEFORE implementation: write failing automated tests from each pending spec (use cases, ACs, Flow & states). Ensure positive fixtures never violate another spec rule and respect .docs/host.json (prefer node:sqlite). Do NOT implement product code or mark [x].",
        ["**/*.{test,spec}.*", "tests/**"]
      )
    );
    stages.push(
      stage(
        "se-implement",
        "softwareEngineer",
        "Software Engineer — implement (TDD green)",
        "Implement pending [ ] todos that have specs AND existing red tests. Make tests pass. Follow .docs/technologies.md and specs. Do not delete or weaken tests. Do not mark todos [x].",
        ["src/**", "package.json"]
      )
    );
    stages.push(
      stage(
        "delivery-critic",
        "softwareEngineer",
        "Delivery critic — spot-check",
        "After SE green and BEFORE QA verify: spot-check completed specs vs Files to touch on disk and use-case coverage. Reopen incomplete slugs (do not mark [x]).",
        [".docs/todo.md", "src/**"]
      )
    );
  }

  if (testsOnly) {
    const targetId = focus ? `qa-tdd-red:${focus}` : "qa-tdd-red";
    stages.push(
      stage(
        targetId,
        "qaEngineer",
        focus ? `QA — TDD red (${focus})` : "QA — TDD red (tests only)",
        "Write failing tests for the focused slug/requirement only. Ensure positive test cases satisfy all spec invariants. No product implementation.",
        ["**/*.{test,spec}.*", "tests/**"],
        focus || undefined
      )
    );
  }

  if (needsQa && !docsOnly) {
    stages.push(
      stage(
        "qa-tdd-verify",
        "qaEngineer",
        "QA — TDD verify",
        "Run the full test suite; confirm all specs and screen-flow ACs pass (exit code 0). Only mark todos [x] when the suite passes.",
        ["**/*.{test,spec}.*", "tests/**", ".docs/todo.md"]
      )
    );
  }

  const filteredStages = isResume
    ? stages.filter((s) => !doneStageIds.has(s.id))
    : stages;

  const pickerList = [...coercedCustomModels];
  const parentPickerBanner =
    pickerList.length > 0
      ? `Run this Cursor chat with model '${pickerList[0]}' selected in the picker — Task subagents use model="inherit" (Cursor blocks custom/BYOK slugs in Task.model; requested: ${pickerList.join(", ")}).`
      : undefined;

  return {
    llmRuntime: "cursor",
    provider,
    ...(parentPickerBanner ? { parentPickerBanner } : {}),
    workflow: wf,
    wave,
    userIdea: idea,
    workspaceRoot: opts.workspaceRoot,
    projectRoot: opts.projectRoot,
    appRoot: opts.appRoot,
    models: opts.models,
    cursorModels: opts.cursorModels,
    maxTokens: opts.maxTokens,
    stages: filteredStages,
    resumeHint:
      (parentPickerBanner ? `${parentPickerBanner} ` : "") +
      "HOST INSTRUCTIONS (llmRuntime=cursor): Run each delegationPlaybook.stages entry via Cursor Task using `subagent_type: stage.subagentType` and `model: stage.model` (NEVER pass raw 9r-* BYOK ids in Task.model — always use stage.model which is 'inherit' or an allowlisted Cursor slug). Do NOT call 9router. Before each Task call `get_pipeline_state({ workspaceRoot, projectRoot, recordStage: stage.id, recordRole: stage.role, recordStatus: 'start', skillKey: stage.skillKey })`; after each Task call `get_pipeline_state({ ..., recordStatus: 'done', checkGate: true })` (if `gate.ok === false`, fix before advancing). When `.docs/todo.md` is created after `sa-todo-and-specs`, call `run_development_pipeline` with `workflow: 'resume'` to expand Wave 2 per-slug stages. At the end of the pipeline, call `get_pipeline_state({ ..., recordStage: 'pipeline', recordStatus: 'done', recordMessage: 'Pipeline completed' })` so `.zteam/dashboard/index.html` shows Completed.",
  };
}

export type RoleModelSuggestion = {
  id: string;
  tier: "free" | "paid";
  label: string;
};

/**
 * Curated 9router suggestions per role: 2 free + 2 paid.
 * Ids may vary by operator tunnel — user can paste any valid combo id.
 */
export const ROLE_MODEL_SUGGESTIONS: Record<TeamRole, RoleModelSuggestion[]> = {
  systemArchitect: [
    {
      id: "9RSA-system-architect-free",
      tier: "free",
      label: "SA free (padrão)",
    },
    {
      id: "9RSA-system-architect-fast-free",
      tier: "free",
      label: "SA free rápido / curto",
    },
    {
      id: "9RSA-system-architect",
      tier: "paid",
      label: "SA pago (qualidade)",
    },
    {
      id: "9RSA-system-architect-pro",
      tier: "paid",
      label: "SA pago pro / longo contexto",
    },
  ],
  technologyArchitect: [
    {
      id: "9RTA-technology-architect-free",
      tier: "free",
      label: "TA free (padrão)",
    },
    {
      id: "9RTA-technology-architect-fast-free",
      tier: "free",
      label: "TA free rápido",
    },
    {
      id: "9RTA-technology-architect",
      tier: "paid",
      label: "TA pago",
    },
    {
      id: "9RTA-technology-architect-pro",
      tier: "paid",
      label: "TA pago pro",
    },
  ],
  uiUxDesigner: [
    {
      id: "9RSA-system-architect-free",
      tier: "free",
      label: "UX via SA free (padrão seguro)",
    },
    {
      id: "9RUX-ui-ux-free",
      tier: "free",
      label: "UX free dedicado (se existir no túnel)",
    },
    {
      id: "9RSA-system-architect",
      tier: "paid",
      label: "UX via SA pago",
    },
    {
      id: "9RUX-ui-ux",
      tier: "paid",
      label: "UX pago dedicado (se existir)",
    },
  ],
  softwareEngineer: [
    {
      id: "9RSE-software-engineer-free",
      tier: "free",
      label: "SE free (padrão)",
    },
    {
      id: "9RSE-software-engineer-fast-free",
      tier: "free",
      label: "SE free rápido",
    },
    {
      id: "9RSE-software-engineer",
      tier: "paid",
      label: "SE pago (código)",
    },
    {
      id: "9RSE-software-engineer-pro",
      tier: "paid",
      label: "SE pago pro / lotes",
    },
  ],
  qaEngineer: [
    { id: "9RQA-qa-free", tier: "free", label: "QA free (padrão)" },
    { id: "9RQA-qa-fast-free", tier: "free", label: "QA free rápido" },
    { id: "9RQA-qa", tier: "paid", label: "QA pago" },
    { id: "9RQA-qa-pro", tier: "paid", label: "QA pago pro" },
  ],
};

/** Short duty lines for cross-role consult prompts. */
export { ROLE_PROMPT_DUTIES as ROLE_DUTIES } from "./role-prompts.js";

const modelsSchema = z
  .object({
    systemArchitect: z.string().min(1).optional(),
    technologyArchitect: z.string().min(1).optional(),
    uiUxDesigner: z.string().min(1).optional(),
    softwareEngineer: z.string().min(1).optional(),
    qaEngineer: z.string().min(1).optional(),
    fallback: z.string().optional(),
    systemArchitectFallback: z.string().optional(),
    technologyArchitectFallback: z.string().optional(),
    uiUxDesignerFallback: z.string().optional(),
    softwareEngineerFallback: z.string().optional(),
    qaEngineerFallback: z.string().optional(),
  })
  .passthrough();

export const cursorModelsSchema = z
  .object({
    systemArchitect: z.string().optional(),
    technologyArchitect: z.string().optional(),
    uiUxDesigner: z.string().optional(),
    softwareEngineer: z.string().optional(),
    qaEngineer: z.string().optional(),
  })
  .passthrough();

const maxTokensSchema = z
  .object({
    systemArchitect: z.number().int().positive().optional(),
    technologyArchitect: z.number().int().positive().optional(),
    uiUxDesigner: z.number().int().positive().optional(),
    softwareEngineer: z.number().int().positive().optional(),
    qaEngineer: z.number().int().positive().optional(),
  })
  .passthrough();

export const providerModeSchema = z.enum([
  "cursor-task",
  "ninerouter-direct",
  "hybrid",
]);

export const zteamConfigFileSchema = z
  .object({
    version: z.number().int().positive().default(1),
    /** Strategy: "cursor-task" (Path A: Task + inherit), "ninerouter-direct" (Path B: MCP ChatOpenAI via .env), or "hybrid" (default auto A/B). */
    provider: providerModeSchema.optional(),
    /** webgame | godotgame | crud | webapp | mobile | cli-dos | backend | frontend | fullstack | library | desktop | ai-rag | other */
    projectType: z.string().min(1).optional(),
    models: modelsSchema.optional(),
    /** Optional Cursor Task model slugs per role (e.g. "composer-2.5", "composer-2.5-fast") when models.* are "inherit". */
    cursorModels: cursorModelsSchema.optional(),
    maxTokens: maxTokensSchema.optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export const PROJECT_TYPES_NEEDING_UI_FLOW = new Set([
  "webgame",
  "godotgame",
  "webapp",
  "mobile",
  "frontend",
  "fullstack",
  "desktop",
  "crud",
]);

export function needsUiFlow(projectType?: string | null): boolean {
  const t = (projectType || "").trim().toLowerCase();
  if (!t) return true; // unknown → prefer UI rigor
  if (t === "backend" || t === "library" || t === "cli-dos") return false;
  return PROJECT_TYPES_NEEDING_UI_FLOW.has(t) || t === "other";
}

export type ZteamConfigFile = z.infer<typeof zteamConfigFileSchema>;

export type ResolvedTeamConfig = {
  /** Strategy: "cursor-task" | "ninerouter-direct" | "hybrid" (default "hybrid"). */
  provider: TeamProviderMode;
  /** True when `provider` was explicitly set in `.zteam/config.json`. */
  explicitProvider?: boolean;
  /** From .zteam/config.json — drives skill resolution (webgame, crud, …). */
  projectType: string;
  models: {
    systemArchitect: string;
    technologyArchitect: string;
    uiUxDesigner: string;
    softwareEngineer: string;
    qaEngineer: string;
    /** Legacy global fallback (SE alias if softwareEngineerFallback empty). */
    fallback: string;
    systemArchitectFallback: string;
    technologyArchitectFallback: string;
    uiUxDesignerFallback: string;
    softwareEngineerFallback: string;
    qaEngineerFallback: string;
  };
  /** Optional Cursor Task model slugs per role (used by buildCursorDelegationPlaybook; never sent to 9router). */
  cursorModels: CursorRoleModels;
  maxTokens: {
    systemArchitect: number;
    technologyArchitect: number;
    uiUxDesigner: number;
    softwareEngineer: number;
    qaEngineer: number;
  };
  sources: {
    workspaceConfig: string | null;
    appConfig: string | null;
  };
  exists: {
    workspace: boolean;
    app: boolean;
  };
};

export type WorkspaceDiagnosis = {
  active: string;
  source: "arg" | "env" | "cwd";
  mcpJsonHint: string;
  /** Set when process.env.WORKSPACE_ROOT is present (MCP ignores it). */
  stickyEnvWarning: string | null;
  stickyEnvValue: string | null;
};

export const SETUP_QUESTIONS = [
  "Escopo: gravar no workspace, neste app (projectRoot), ou ambos?",
  "Tipo de projeto (projectType): webgame | webapp | crud | backend | fullstack | ai-rag | cli-dos | library?",
  "System Architect — primary model (ver modelSuggestions.systemArchitect: 2 free + 2 paid, ou 'inherit' para Cursor)",
  "System Architect — fallback model (segundo agente SA se o primary esgotar; vazio = sem handoff)",
  "Technology Architect — primary (ver modelSuggestions.technologyArchitect)",
  "Technology Architect — fallback",
  "UI/UX Designer — primary (ver modelSuggestions.uiUxDesigner)",
  "UI/UX Designer — fallback",
  "Software Engineer — primary (ver modelSuggestions.softwareEngineer)",
  "Software Engineer — fallback (recomendado se usares SE free)",
  "QA Engineer — primary (ver modelSuggestions.qaEngineer)",
  "QA Engineer — fallback",
  "Se runtime Cursor ('inherit'): queres definir cursorModels por papel (ex. softwareEngineer: 'composer-2.5')?",
  "maxTokens por papel? (defaults / custom)",
  "Se não houver .gitignore no alvo: ignorar .zteam/config.json no git? (recomendado: sim)",
] as const;

/** Focused questions for `@zteam/models` (LLM ids only). */
export const MODEL_QUESTIONS = [
  "Para CADA papel (SA/TA/UX/SE/QA): escolhe primary + fallback. Família homogénea: aliases Cursor (inherit/auto/cursor/cursor-auto) OU ids 9router (modelSuggestions). Não misturar. Se Cursor, podes opcionalmente indicar cursorModels por papel (ex. composer-2.5).",
  "System Architect — primary",
  "System Architect — fallback (vazio ok; só ninerouter)",
  "Technology Architect — primary",
  "Technology Architect — fallback",
  "UI/UX Designer — primary",
  "UI/UX Designer — fallback",
  "Software Engineer — primary",
  "Software Engineer — fallback",
  "QA Engineer — primary",
  "QA Engineer — fallback",
  "cursorModels opcionais por papel (ex. softwareEngineer='composer-2.5')?",
  "Gravar neste projeto: workspace (raiz aberta), app (projectRoot), ou ambos?",
] as const;

/** Resolve per-role fallback model id (role-specific → legacy global for SE). Ignores Cursor aliases (`inherit`/`auto`) when resolving 9router fallback. */
export function resolveRoleFallbackModel(
  cfg: ResolvedTeamConfig,
  role: TeamRole
): string {
  const cleanNineFallback = (v: string | undefined): string => {
    const t = (v || "").trim();
    if (!t || isCursorModelAlias(t)) return "";
    return t;
  };
  const key = `${role}Fallback` as const;
  const perRole = cleanNineFallback((cfg.models as Record<string, string>)[key]);
  if (perRole) return perRole;
  if (role === "softwareEngineer") {
    return (
      cleanNineFallback(cfg.models.fallback) ||
      cleanNineFallback(process.env.MODEL_FALLBACK) ||
      cleanNineFallback(process.env.MODEL_SOFTWARE_ENGINEER_FALLBACK) ||
      ""
    );
  }
  const envKey =
    role === "systemArchitect"
      ? "MODEL_SYSTEM_ARCHITECT_FALLBACK"
      : role === "technologyArchitect"
        ? "MODEL_TECHNOLOGY_ARCHITECT_FALLBACK"
        : role === "uiUxDesigner"
          ? "MODEL_UI_UX_DESIGNER_FALLBACK"
          : role === "qaEngineer"
            ? "MODEL_QA_ENGINEER_FALLBACK"
            : role === "softwareEngineer"
              ? "MODEL_SOFTWARE_ENGINEER_FALLBACK"
              : "";
  if (envKey) return cleanNineFallback(process.env[envKey]);
  return "";
}

/** Canonical command guide copied into each project's `.zteam/README.MD`. */
export const ZTEAM_README_MD = `# zteam — comandos e configuração

Fonte de verdade local do time neste projeto: **\`.zteam/config.json\`** (verdade absoluta dos modelos). Ver também a skill Cursor **\`zteam\`** (\`/zteam\`, \`@zteam\`).

## Dual runtime (modelos)

O valor de cada primary em \`models\` escolhe o runtime (**família homogénea** — não misturar):

| Valor no config | Runtime | O que acontece |
|-----------------|---------|----------------|
| \`inherit\` / \`auto\` / \`cursor\` / \`cursor-auto\` | **cursor** | Skill corre SA/TA/UX/SE/QA via Cursor Task. Use \`cursorModels\` opcional para fixar slugs do Cursor (ex. \`composer-2.5\`). MCP **não** chama 9router. |
| Qualquer outro id (\`9RSA-…\`, \`cu/default\`, …) | **ninerouter** | MCP \`ChatOpenAI\` com o id **literal** → 9router. |

Mix (\`inherit\` + \`9RSE-…\`) → \`failureKind: mixed_runtime\` (fail cedo).

Precedência: ficheiro app → ficheiro workspace → (só se **não** houver ficheiro) env \`MODEL_*\` / defaults.

## Comandos

Use estes atalhos no chat Cursor (skill \`zteam\` / \`@zteam\`). O agent **sempre** passa \`workspaceRoot\` = pasta aberta no Cursor.

| Comando | O que faz | MCP |
|---------|-----------|-----|
| **\`@zteam/config\`** | Setup completo: \`.zteam/config.json\` (projectType, modelos, cursorModels, maxTokens, escopo workspace/app, gitignore). | \`get_zteam_config\` → perguntas → \`write_zteam_config\` |
| **\`@zteam/models\`** | Só LLMs por papel — perguntas guiadas → atualiza \`models\` / \`cursorModels\` em \`.zteam/config.json\` neste projeto. | \`get_zteam_config\` → \`modelQuestions\` → \`write_zteam_config\` |
| **\`@zteam/documentation\`** | Só documentação / arquitetura (requirements, technologies, todo, specs). Sem SE/QA. | \`run_development_pipeline\` com \`workflow: "docs"\` |
| **\`@zteam/tests\`** | Só testes (TDD red → verify) para um requisito. | \`run_development_pipeline\` com \`workflow: "tests"\` + \`slug\` |
| **\`@zteam\`** / **\`/zteam\`** | Pipeline completo ou o workflow que pedires (\`full\` \\| \`docs\` \\| \`feature\` \\| \`punch\` \\| \`fix\` \\| \`resume\` \\| \`tests\` \\| \`analyze\`). | \`run_development_pipeline\` (ou Task playbook em 2 ondas se runtime=cursor) |
| **\`ensure_zteam_setup\`** | Stubs skill + \`.docs\` (+ template config opcional), sem LLM. | MCP \`ensure_zteam_setup\` |
| **LangGraph Studio** | Topologia do pipeline (nós/edges). \`node .zteam/langgraph/dev.mjs\` | Agent Server no pacote MCP |

### Exemplos

\`\`\`text
@zteam/models
→ mostra modelos atuais + defaults → pergunta SA/TA/SE/QA/fallback (+ cursorModels) → grava .zteam/config.json

@zteam/config
→ pergunta projectType / modelos / escopo / maxTokens → grava .zteam/config.json (+ .gitignore para config)

@zteam/documentation samples/pacman — canvas TS, infinite lives
→ workflow=docs, projectRoot=samples/pacman

@zteam/tests samples/pacman
→ analisa specs/código e corre pipeline de testes

@zteam build a todo API in samples/todo-api
→ auto ou full/feature conforme contexto

node .zteam/langgraph/dev.mjs
→ sobe Agent Server no pacote MCP; abre Studio (topologia SA/TA/SE/QA), não traces ao vivo
\`\`\`

## Ficheiros

| Path | Papel |
|------|--------|
| \`.zteam/config.json\` | **Verdade absoluta** — projectType, modelos, cursorModels e maxTokens por papel |
| \`.zteam/dashboard/index.html\` | **Live Canvas Dashboard** (9Router style) — abre direto no browser (\`file://\`), faz polling de \`.docs/zteam-live.js\` |
| \`.zteam/README.MD\` | Este guia (comandos) |
| \`.zteam/skills/SKILL.md\` | Cópia local da skill Cursor zteam (sincronizada ao criar \`.zteam/\`) |
| \`.zteam/langgraph/\` | Launcher LangGraph Studio (topologia; ver README nessa pasta) |
| \`.docs/host.json\` | Sonda automática do ambiente (Node, \`node:sqlite\`, compilação nativa) |
| \`.docs/*\` | Artefactos da pipeline (requirements, technologies, specs, progress, …) |
| \`.docs/langgraph.mmd\` | Dump Mermaid offline do grafo (copiado do pacote MCP) |

## LangGraph Studio (topologia)

Cada bootstrap de \`.zteam/\` materializa \`.zteam/langgraph/\` com um launcher que aponta para o pacote MCP (onde o grafo e as deps vivem).

\`\`\`text
node .zteam/langgraph/dev.mjs
→ https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
\`\`\`

Isto mostra a **topologia** do fluxo (workflowRouter → SA → TA → SE → QA → …). Não espelha runs MCP ao vivo (sem LangSmith tracing). Dump estático: \`.docs/langgraph.mmd\` ou, no pacote MCP, \`npm run graph\` / \`npm run studio\`.

### Exemplo \`config.json\` (9router)

\`\`\`json
{
  "version": 1,
  "projectType": "webgame",
  "models": {
    "systemArchitect": "9RSA-system-architect-free",
    "systemArchitectFallback": "9RSA-system-architect",
    "technologyArchitect": "9RTA-technology-architect-free",
    "technologyArchitectFallback": "",
    "uiUxDesigner": "9RUX-ui-ux-designer-free",
    "uiUxDesignerFallback": "",
    "softwareEngineer": "9RSE-software-engineer-free",
    "softwareEngineerFallback": "9RSE-software-engineer",
    "qaEngineer": "9RQA-qa-free",
    "qaEngineerFallback": "",
    "fallback": ""
  },
  "maxTokens": {
    "systemArchitect": 1600,
    "technologyArchitect": 2500,
    "uiUxDesigner": 2000,
    "softwareEngineer": 8000,
    "qaEngineer": 2000
  }
}
\`\`\`

### Exemplo Cursor (com \`cursorModels\` por papel, fora do 9router)

\`\`\`json
{
  "version": 1,
  "projectType": "webgame",
  "models": {
    "systemArchitect": "inherit",
    "systemArchitectFallback": "",
    "technologyArchitect": "inherit",
    "technologyArchitectFallback": "",
    "uiUxDesigner": "inherit",
    "uiUxDesignerFallback": "",
    "softwareEngineer": "inherit",
    "softwareEngineerFallback": "",
    "qaEngineer": "inherit",
    "qaEngineerFallback": "",
    "fallback": ""
  },
  "cursorModels": {
    "softwareEngineer": "composer-2.5",
    "qaEngineer": "composer-2.5"
  }
}
\`\`\`

Handoff (só runtime **ninerouter**): se o primary esgotar retries, o MCP promove o \`*Fallback\` do papel. Papéis ativos podem consultar-se nos gates (SE↔SA após VERIFY FAIL; TA↔SA em gaps de arquitetura).

No \`@zteam/config\` / \`@zteam/models\`, pergunta primary+fallback por papel e mostra \`modelSuggestions\` (2 free + 2 paid) **e** aliases Cursor (\`inherit\` + \`cursorModels\`).

## Workspace (pasta raiz)

A pasta raiz **não** fica sticky no \`mcp.json\`. Em cada chamada o agent passa:

- **\`workspaceRoot\`** — path absoluto da pasta aberta no Cursor (**obrigatório** no MCP; sem arg → \`failureKind=needs_workspace_root\`; o MCP **ignora** \`WORKSPACE_ROOT\` no env)
- **\`projectRoot\`** — pasta relativa da app (ex. \`samples/my-app\` ou \`.\` se a app for a raiz do workspace)

Evita o footgun de pipelines a escrever noutro repo (ex. \`pacman-z2\` / \`mypokecards\`).

## Precedência de modelos

\`\`\`text
{appRoot}/.zteam/config.json   (SoT se existir)
  → {workspaceRoot}/.zteam/config.json
    → (só sem ficheiro) env MODEL_* / MAX_TOKENS_*
      → defaults 9RSA / 9RTA / 9RSE / 9RQA
\`\`\`

Credenciais (\`NINEROUTER_*\`) ficam só no env do MCP — nunca neste JSON.

## Playbook operador (greenfield / resume)

1. Garantir \`.zteam/config.json\` (\`@zteam/models\` ou \`@zteam/config\`) — escolher família cursor **ou** 9router.
2. Após patch no orchestrator: **reiniciar MCP** \`user-zteam\` (sem hot-reload).
3. Evitar re-rodar \`full\`/\`docs\` após requirements bons — o bootstrap **preserva** \`.docs/requirements.md\` com seções \`##\` (use \`ZTEAM_FORCE_BOOTSTRAP=1\` só para recomeçar de propósito).
4. Antes de \`resume\`: cada \`[ ]\` no todo precisa de \`.docs/specs/{slug}.spec.md\`. Órfãos → \`workflow=feature\`.
5. Modelos free no 9router: default \`ZTEAM_SE_BATCH=1\`. Se \`IN 0 · OUT 0\` / empty SE → configure \`models.fallback\` no config.
6. Healthcheck falhou: aguardar ~20s ou reiniciar MCP / verificar túnel Cloudflare; não spamar retries com \`(cached)\`.

| Env | Default | Nota |
|-----|---------|------|
| \`ZTEAM_FORCE_BOOTSTRAP\` | off | Força stub novo de requirements |
| \`ZTEAM_SE_BATCH\` | \`1\` (\`punch\`→3) | Lotes SE |
| \`MODEL_FALLBACK\` | — | Fallback após empty LLM (só sem config file) |
`;

export async function ensureZteamReadme(
  targetDir: string
): Promise<{ path: string; status: "written" | "unchanged" }> {
  const dir = join(resolve(targetDir), ".zteam");
  await mkdir(dir, { recursive: true });
  const abs = join(dir, "README.MD");
  let prev = "";
  try {
    prev = await readFile(abs, "utf8");
  } catch {
    /* missing */
  }
  if (prev === ZTEAM_README_MD) {
    return { path: abs, status: "unchanged" };
  }
  await writeFile(abs, ZTEAM_README_MD, "utf8");
  return { path: abs, status: "written" };
}

/**
 * Copy orchestrator `.cursor/skills/zteam/SKILL.md` → `{target}/.zteam/skills/SKILL.md`.
 * Refreshes whenever content differs (keeps local skill in sync with the MCP package).
 */
export async function ensureZteamSkillCopy(
  targetDir: string
): Promise<{
  path: string;
  source: string;
  status: "copied" | "unchanged" | "missing_source";
}> {
  const skillsDir = join(resolve(targetDir), ".zteam", "skills");
  await mkdir(skillsDir, { recursive: true });
  const dest = join(skillsDir, "SKILL.md");
  const source = ZTEAM_SKILL_SOURCE;

  if (!(await pathExists(source))) {
    return { path: dest, source, status: "missing_source" };
  }

  const srcText = await readFile(source, "utf8");
  let prev = "";
  try {
    prev = await readFile(dest, "utf8");
  } catch {
    /* missing */
  }
  if (prev === srcText) {
    return { path: dest, source, status: "unchanged" };
  }
  await writeFile(dest, srcText, "utf8");
  return { path: dest, source, status: "copied" };
}

/**
 * Create `.zteam/` and materialize README + local skill copy + LangGraph Studio launcher + Live Canvas Dashboard.
 * Call this before any pipeline / LLM work (and whenever `.zteam/` is created).
 */
export async function ensureZteamBootstrap(targetDir: string): Promise<{
  dir: string;
  readme: Awaited<ReturnType<typeof ensureZteamReadme>>;
  skill: Awaited<ReturnType<typeof ensureZteamSkillCopy>>;
  langgraph: Awaited<ReturnType<typeof ensureZteamLanggraphStudio>>;
  dashboard: Awaited<ReturnType<typeof ensureLiveDashboardFiles>>;
}> {
  const dir = join(resolve(targetDir), ".zteam");
  await mkdir(dir, { recursive: true });
  const readme = await ensureZteamReadme(targetDir);
  const skill = await ensureZteamSkillCopy(targetDir);
  const langgraph = await ensureZteamLanggraphStudio(targetDir);
  const dashboard = await ensureLiveDashboardFiles(targetDir);
  return { dir, readme, skill, langgraph, dashboard };
}

/** Template for client `.zteam/langgraph/dev.mjs` (runs CLI against MCP package). */
export function buildLanggraphDevMjs(): string {
  return `#!/usr/bin/env node
/**
 * Launch LangGraph Studio Agent Server for the zteam pipeline graph.
 * Topology only — does not mirror live MCP pipeline runs.
 */
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const metaPath = join(here, "package-root.json");

async function main() {
  let packageRoot;
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    packageRoot = meta.packageRoot;
  } catch (err) {
    console.error(
      "[zteam/langgraph] missing or invalid package-root.json:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }
  if (typeof packageRoot !== "string" || !packageRoot.trim()) {
    console.error("[zteam/langgraph] packageRoot is empty in package-root.json");
    process.exit(1);
  }
  const configPath = join(packageRoot, "langgraph.json");
  try {
    await access(configPath);
  } catch {
    console.error(
      "[zteam/langgraph] langgraph.json not found at:",
      configPath,
      "\\nRe-run ensure_zteam_setup / get_zteam_config after fixing the MCP package path."
    );
    process.exit(1);
  }

  console.error("[zteam/langgraph] starting Studio Agent Server…");
  console.error(
    "[zteam/langgraph] Studio UI: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024"
  );
  console.error("[zteam/langgraph] cwd:", packageRoot);

  const child = spawn(
    "npx",
    ["@langchain/langgraph-cli", "dev", "-c", "langgraph.json"],
    {
      cwd: packageRoot,
      stdio: "inherit",
      shell: true,
      env: process.env,
    }
  );
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error("[zteam/langgraph] failed:", err);
  process.exit(1);
});
`;
}

/** Template for client `.zteam/langgraph/README.md`. */
export function buildLanggraphStudioReadme(): string {
  return `# LangGraph Studio (zteam)

Topologia do pipeline zteam (nós/edges: workflowRouter → SA → TA → SE → QA → …).

**Não** espelha runs MCP ao vivo — só a estrutura do grafo.

## Abrir

\`\`\`bash
node .zteam/langgraph/dev.mjs
\`\`\`

Depois abre:

https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024

O launcher corre o Agent Server no **pacote MCP** (onde \`langgraph.json\` e as deps vivem). O path está em \`package-root.json\` (atualizado em cada bootstrap).

## Offline

Dump Mermaid: \`.docs/langgraph.mmd\` (copiado do pacote MCP quando disponível).

No pacote MCP: \`npm run studio\` ou \`npm run graph\`.
`;
}

/**
 * Materialize `.zteam/langgraph/` launcher pointing at this MCP package.
 * Also copies `.docs/langgraph.mmd` when present in the package.
 */
export async function ensureZteamLanggraphStudio(targetDir: string): Promise<{
  dir: string;
  packageRootPath: string;
  devPath: string;
  readmePath: string;
  mermaid: { path: string; status: "copied" | "unchanged" | "missing_source" };
  status: "written" | "unchanged";
}> {
  const root = resolve(targetDir);
  const dir = join(root, ".zteam", "langgraph");
  await mkdir(dir, { recursive: true });

  const packageRootJson = `${JSON.stringify(
    { packageRoot: resolve(ZTEAM_PACKAGE_ROOT) },
    null,
    2
  )}\n`;
  const packageRootPath = join(dir, "package-root.json");
  const devPath = join(dir, "dev.mjs");
  const readmePath = join(dir, "README.md");
  const devBody = buildLanggraphDevMjs();
  const readmeBody = buildLanggraphStudioReadme();

  let status: "written" | "unchanged" = "unchanged";
  for (const [abs, next] of [
    [packageRootPath, packageRootJson],
    [devPath, devBody],
    [readmePath, readmeBody],
  ] as const) {
    let prev = "";
    try {
      prev = await readFile(abs, "utf8");
    } catch {
      /* missing */
    }
    if (prev !== next) {
      await writeFile(abs, next, "utf8");
      status = "written";
    }
  }

  const mermaid = await ensureLanggraphMermaidCopy(root);
  return {
    dir,
    packageRootPath,
    devPath,
    readmePath,
    mermaid,
    status,
  };
}

/** Copy package `.docs/langgraph.mmd` → `{target}/.docs/langgraph.mmd` when source exists. */
export async function ensureLanggraphMermaidCopy(targetDir: string): Promise<{
  path: string;
  status: "copied" | "unchanged" | "missing_source";
}> {
  const docsDir = join(resolve(targetDir), ".docs");
  await mkdir(docsDir, { recursive: true });
  const dest = join(docsDir, "langgraph.mmd");
  const source = join(ZTEAM_PACKAGE_ROOT, ".docs", "langgraph.mmd");
  if (!(await pathExists(source))) {
    return { path: dest, status: "missing_source" };
  }
  const srcText = await readFile(source, "utf8");
  let prev = "";
  try {
    prev = await readFile(dest, "utf8");
  } catch {
    /* missing */
  }
  if (prev === srcText) {
    return { path: dest, status: "unchanged" };
  }
  await writeFile(dest, srcText, "utf8");
  return { path: dest, status: "copied" };
}

/**
 * Bootstrap workspace and (if different) app roots. No LLM.
 */
export async function ensureZteamBootstrapRoots(
  workspaceRoot: string,
  appRoot?: string
): Promise<{
  workspace: Awaited<ReturnType<typeof ensureZteamBootstrap>>;
  app: Awaited<ReturnType<typeof ensureZteamBootstrap>> | null;
}> {
  const workspace = await ensureZteamBootstrap(workspaceRoot);
  const same =
    !appRoot || resolve(appRoot) === resolve(workspaceRoot);
  const app = same ? null : await ensureZteamBootstrap(appRoot!);
  return { workspace, app };
}

const DOCS_STUB_DIRS = [".docs", ".docs/specs", ".docs/reviews"] as const;

/** Create `.docs/` tree stubs only — never writes product code. */
export async function ensureDocsDirs(appRoot: string): Promise<{
  created: string[];
  existed: string[];
}> {
  const root = resolve(appRoot);
  const created: string[] = [];
  const existed: string[] = [];
  for (const rel of DOCS_STUB_DIRS) {
    const abs = join(root, rel);
    if (await pathExists(abs)) {
      existed.push(rel);
    } else {
      await mkdir(abs, { recursive: true });
      created.push(rel);
    }
  }
  return { created, existed };
}

export type EnsureZteamSetupOpts = {
  workspaceRoot: string;
  appRoot: string;
  skill?: boolean;
  docsDirs?: boolean;
  /** Write official config template if no config exists yet */
  configTemplate?: boolean;
  /** cursor | ninerouter template family */
  configFamily?: "cursor" | "ninerouter";
};

/**
 * Isolated setup capability (no LLM, no pipeline): skill, .docs dirs, optional config template.
 * Allowlist: `.zteam/**`, `.docs/**` stubs — never `src/**`.
 */
export async function ensureZteamSetup(opts: EnsureZteamSetupOpts): Promise<{
  ok: true;
  capability: "setup";
  pathsTouched: string[];
  skill: Awaited<ReturnType<typeof ensureZteamBootstrapRoots>> | null;
  docs: Awaited<ReturnType<typeof ensureDocsDirs>> | null;
  config: { path: string; written: boolean } | null;
  nextHint: string;
}> {
  const pathsTouched: string[] = [];
  const doSkill = opts.skill !== false;
  const doDocs = opts.docsDirs !== false;
  const doConfig = opts.configTemplate === true;

  let skillResult: Awaited<ReturnType<typeof ensureZteamBootstrapRoots>> | null =
    null;
  if (doSkill) {
    skillResult = await ensureZteamBootstrapRoots(
      opts.workspaceRoot,
      opts.appRoot
    );
    pathsTouched.push(
      skillResult.workspace.dir,
      skillResult.workspace.skill.path,
      skillResult.workspace.readme.path,
      skillResult.workspace.langgraph.dir,
      skillResult.workspace.langgraph.devPath,
      skillResult.workspace.langgraph.packageRootPath,
      skillResult.workspace.langgraph.readmePath,
      skillResult.workspace.dashboard.htmlPath
    );
    if (skillResult.workspace.langgraph.mermaid.status !== "missing_source") {
      pathsTouched.push(skillResult.workspace.langgraph.mermaid.path);
    }
    if (skillResult.app) {
      pathsTouched.push(
        skillResult.app.dir,
        skillResult.app.skill.path,
        skillResult.app.readme.path,
        skillResult.app.langgraph.dir,
        skillResult.app.langgraph.devPath,
        skillResult.app.langgraph.packageRootPath,
        skillResult.app.langgraph.readmePath,
        skillResult.app.dashboard.htmlPath
      );
      if (skillResult.app.langgraph.mermaid.status !== "missing_source") {
        pathsTouched.push(skillResult.app.langgraph.mermaid.path);
      }
    }
  }

  let docsResult: Awaited<ReturnType<typeof ensureDocsDirs>> | null = null;
  if (doDocs) {
    docsResult = await ensureDocsDirs(opts.appRoot);
    pathsTouched.push(...docsResult.created.map((d) => join(opts.appRoot, d)));
  }

  let configResult: { path: string; written: boolean } | null = null;
  if (doConfig) {
    const cfg = await loadTeamConfig(opts.workspaceRoot, opts.appRoot);
    const target =
      resolve(opts.appRoot) !== resolve(opts.workspaceRoot)
        ? opts.appRoot
        : opts.workspaceRoot;
    const abs = join(resolve(target), ".zteam", "config.json");
    if (hasAnyTeamConfig(cfg)) {
      configResult = { path: abs, written: false };
    } else {
      const family = opts.configFamily ?? "ninerouter";
      const { path } = await writeTeamConfig(target, {
        models: officialConfigModelsTemplate(family),
      });
      configResult = { path, written: true };
      pathsTouched.push(path);
    }
  }

  return {
    ok: true,
    capability: "setup",
    pathsTouched: [...new Set(pathsTouched)],
    skill: skillResult,
    docs: docsResult,
    config: configResult,
    nextHint:
      "Setup done. Use get_zteam_config / write_zteam_config for models, then run_development_pipeline when ready.",
  };
}

const MCP_JSON_HINT =
  "MCP requires workspaceRoot arg (absolute Cursor open folder); remove sticky WORKSPACE_ROOT from ~/.cursor/mcp.json and restart MCP";

export function stickyWorkspaceEnv(): string | null {
  const v = process.env.WORKSPACE_ROOT?.trim();
  return v || null;
}

function parseMaxTokensEnv(envValue: string | undefined, fallback: number): number {
  const n = Number.parseInt(envValue ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function envDefaultsTeamConfig(): Omit<
  ResolvedTeamConfig,
  "sources" | "exists"
> {
  const envProv = (process.env.ZTEAM_PROVIDER || "").trim();
  const provider: TeamProviderMode =
    envProv === "cursor-task" ||
    envProv === "ninerouter-direct" ||
    envProv === "hybrid"
      ? envProv
      : "hybrid";
  return {
    provider,
    explicitProvider: Boolean(envProv),
    projectType: process.env.ZTEAM_PROJECT_TYPE?.trim() || "",
    models: {
      systemArchitect:
        process.env.MODEL_SYSTEM_ARCHITECT?.trim() ||
        DEFAULT_MODELS.systemArchitect,
      technologyArchitect:
        process.env.MODEL_TECHNOLOGY_ARCHITECT?.trim() ||
        DEFAULT_MODELS.technologyArchitect,
      uiUxDesigner:
        process.env.MODEL_UI_UX_DESIGNER?.trim() ||
        DEFAULT_MODELS.uiUxDesigner,
      softwareEngineer:
        process.env.MODEL_SOFTWARE_ENGINEER?.trim() ||
        DEFAULT_MODELS.softwareEngineer,
      qaEngineer:
        process.env.MODEL_QA_ENGINEER?.trim() || DEFAULT_MODELS.qaEngineer,
      fallback:
        process.env.MODEL_FALLBACK?.trim() ||
        process.env.MODEL_SOFTWARE_ENGINEER_FALLBACK?.trim() ||
        DEFAULT_MODELS.fallback,
      systemArchitectFallback:
        process.env.MODEL_SYSTEM_ARCHITECT_FALLBACK?.trim() ||
        DEFAULT_MODELS.systemArchitectFallback,
      technologyArchitectFallback:
        process.env.MODEL_TECHNOLOGY_ARCHITECT_FALLBACK?.trim() ||
        DEFAULT_MODELS.technologyArchitectFallback,
      uiUxDesignerFallback:
        process.env.MODEL_UI_UX_DESIGNER_FALLBACK?.trim() ||
        DEFAULT_MODELS.uiUxDesignerFallback,
      softwareEngineerFallback:
        process.env.MODEL_SOFTWARE_ENGINEER_FALLBACK?.trim() ||
        DEFAULT_MODELS.softwareEngineerFallback,
      qaEngineerFallback:
        process.env.MODEL_QA_ENGINEER_FALLBACK?.trim() ||
        DEFAULT_MODELS.qaEngineerFallback,
    },
    cursorModels: {},
    maxTokens: {
      systemArchitect: parseMaxTokensEnv(
        process.env.MAX_TOKENS_SYSTEM_ARCHITECT,
        DEFAULT_MAX_TOKENS.systemArchitect
      ),
      technologyArchitect: parseMaxTokensEnv(
        process.env.MAX_TOKENS_TECHNOLOGY_ARCHITECT,
        DEFAULT_MAX_TOKENS.technologyArchitect
      ),
      uiUxDesigner: parseMaxTokensEnv(
        process.env.MAX_TOKENS_UI_UX_DESIGNER,
        DEFAULT_MAX_TOKENS.uiUxDesigner
      ),
      softwareEngineer: parseMaxTokensEnv(
        process.env.MAX_TOKENS_SOFTWARE_ENGINEER,
        DEFAULT_MAX_TOKENS.softwareEngineer
      ),
      qaEngineer: parseMaxTokensEnv(
        process.env.MAX_TOKENS_QA_ENGINEER,
        DEFAULT_MAX_TOKENS.qaEngineer
      ),
    },
  };
}

/** Hardcoded defaults only — used when a config file is present (config is SoT; ignore MODEL_*). */
export function defaultsOnlyTeamConfig(): Omit<
  ResolvedTeamConfig,
  "sources" | "exists"
> {
  return {
    provider: "hybrid",
    explicitProvider: false,
    projectType: "",
    models: { ...DEFAULT_MODELS },
    cursorModels: {},
    maxTokens: { ...DEFAULT_MAX_TOKENS },
  };
}

export function resolveConfigPaths(
  workspaceRoot: string,
  appRoot: string
): { workspaceConfig: string; appConfig: string } {
  return {
    workspaceConfig: join(resolve(workspaceRoot), ".zteam", "config.json"),
    appConfig: join(resolve(appRoot), ".zteam", "config.json"),
  };
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

async function readConfigFile(abs: string): Promise<ZteamConfigFile | null> {
  if (!(await pathExists(abs))) return null;
  // Strip UTF-8 BOM (Windows editors) so resume/full don't fail JSON.parse
  const raw = (await readFile(abs, "utf8")).replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw) as unknown;
  return zteamConfigFileSchema.parse(parsed);
}

function mergeCursorModels(
  base: CursorRoleModels,
  layer?: CursorRoleModels
): CursorRoleModels {
  if (!layer) return { ...base };
  const next: CursorRoleModels = { ...base };
  for (const role of TEAM_ROLES) {
    const val = layer[role]?.trim();
    if (val) next[role] = val;
  }
  return next;
}

function mergeLayer(
  base: Omit<ResolvedTeamConfig, "sources" | "exists">,
  layer: ZteamConfigFile | null
): Omit<ResolvedTeamConfig, "sources" | "exists"> {
  if (!layer) return base;
  const lm = layer.models;
  return {
    provider: layer.provider ?? base.provider ?? "hybrid",
    explicitProvider: Boolean(layer.provider || base.explicitProvider),
    projectType:
      (layer.projectType || "").trim() || base.projectType || "",
    models: {
      systemArchitect:
        lm?.systemArchitect?.trim() ||
        inferMissingPrimaryFromPeers(lm, "systemArchitect") ||
        base.models.systemArchitect,
      technologyArchitect:
        lm?.technologyArchitect?.trim() ||
        inferMissingPrimaryFromPeers(lm, "technologyArchitect") ||
        base.models.technologyArchitect,
      uiUxDesigner:
        lm?.uiUxDesigner?.trim() ||
        inferMissingPrimaryFromPeers(lm, "uiUxDesigner") ||
        base.models.uiUxDesigner,
      softwareEngineer:
        lm?.softwareEngineer?.trim() ||
        inferMissingPrimaryFromPeers(lm, "softwareEngineer") ||
        base.models.softwareEngineer,
      qaEngineer:
        lm?.qaEngineer?.trim() ||
        inferMissingPrimaryFromPeers(lm, "qaEngineer") ||
        base.models.qaEngineer,
      fallback: lm?.fallback !== undefined ? String(lm.fallback).trim() : base.models.fallback,
      systemArchitectFallback:
        lm?.systemArchitectFallback !== undefined
          ? String(lm.systemArchitectFallback).trim()
          : base.models.systemArchitectFallback,
      technologyArchitectFallback:
        lm?.technologyArchitectFallback !== undefined
          ? String(lm.technologyArchitectFallback).trim()
          : base.models.technologyArchitectFallback,
      uiUxDesignerFallback:
        lm?.uiUxDesignerFallback !== undefined
          ? String(lm.uiUxDesignerFallback).trim()
          : base.models.uiUxDesignerFallback,
      softwareEngineerFallback:
        lm?.softwareEngineerFallback !== undefined
          ? String(lm.softwareEngineerFallback).trim()
          : base.models.softwareEngineerFallback,
      qaEngineerFallback:
        lm?.qaEngineerFallback !== undefined
          ? String(lm.qaEngineerFallback).trim()
          : base.models.qaEngineerFallback,
    },
    cursorModels: mergeCursorModels(base.cursorModels, layer.cursorModels),
    maxTokens: {
      systemArchitect:
        layer.maxTokens?.systemArchitect ?? base.maxTokens.systemArchitect,
      technologyArchitect:
        layer.maxTokens?.technologyArchitect ??
        base.maxTokens.technologyArchitect,
      uiUxDesigner:
        layer.maxTokens?.uiUxDesigner ?? base.maxTokens.uiUxDesigner,
      softwareEngineer:
        layer.maxTokens?.softwareEngineer ?? base.maxTokens.softwareEngineer,
      qaEngineer: layer.maxTokens?.qaEngineer ?? base.maxTokens.qaEngineer,
    },
  };
}

export async function loadTeamConfig(
  workspaceRoot: string,
  appRoot: string
): Promise<ResolvedTeamConfig> {
  const paths = resolveConfigPaths(workspaceRoot, appRoot);
  const workspaceFile = await readConfigFile(paths.workspaceConfig);
  const appFile =
    resolve(workspaceRoot) === resolve(appRoot)
      ? null
      : await readConfigFile(paths.appConfig);

  const samePath =
    resolve(paths.workspaceConfig) === resolve(paths.appConfig);
  const workspaceExists = await pathExists(paths.workspaceConfig);
  const appExists = samePath
    ? workspaceExists
    : await pathExists(paths.appConfig);

  let merged =
    workspaceFile || appFile
      ? defaultsOnlyTeamConfig()
      : envDefaultsTeamConfig();
  merged = mergeLayer(merged, workspaceFile);
  if (!samePath) merged = mergeLayer(merged, appFile);

  return {
    ...merged,
    sources: {
      workspaceConfig: workspaceExists ? paths.workspaceConfig : null,
      appConfig: appExists && !samePath ? paths.appConfig : samePath && workspaceExists ? paths.workspaceConfig : null,
    },
    exists: {
      workspace: workspaceExists,
      app: appExists,
    },
  };
}

export function hasAnyTeamConfig(cfg: ResolvedTeamConfig): boolean {
  return cfg.exists.workspace || cfg.exists.app;
}

/** True when operator already set MODEL_* in env (resume without interactive config). */
export function hasExplicitEnvModels(): boolean {
  return Boolean(
    process.env.MODEL_SYSTEM_ARCHITECT?.trim() ||
      process.env.MODEL_TECHNOLOGY_ARCHITECT?.trim() ||
      process.env.MODEL_UI_UX_DESIGNER?.trim() ||
      process.env.MODEL_SOFTWARE_ENGINEER?.trim() ||
      process.env.MODEL_QA_ENGINEER?.trim()
  );
}

/** Config gate open: file present OR explicit env models (A7). */
export function configGateSatisfied(cfg: ResolvedTeamConfig): boolean {
  return hasAnyTeamConfig(cfg) || hasExplicitEnvModels();
}

export function diagnoseWorkspace(
  active: string,
  source: "arg" | "env" | "cwd"
): WorkspaceDiagnosis {
  const sticky = stickyWorkspaceEnv();
  return {
    active: resolve(active),
    source,
    mcpJsonHint: MCP_JSON_HINT,
    stickyEnvValue: sticky,
    stickyEnvWarning: sticky
      ? `WORKSPACE_ROOT env is set (${sticky}) but MCP ignores it — pass workspaceRoot arg; remove sticky from ~/.cursor/mcp.json and restart MCP`
      : null,
  };
}

/** MCP fail-closed when workspaceRoot arg is missing / empty. */
export function needsWorkspaceRootPayload(): Record<string, unknown> {
  const sticky = stickyWorkspaceEnv();
  return {
    ok: false,
    failureKind: "needs_workspace_root",
    stickyEnvPresent: Boolean(sticky),
    stickyEnvValue: sticky,
    workspace: {
      mcpJsonHint: MCP_JSON_HINT,
      stickyEnvWarning: sticky
        ? `WORKSPACE_ROOT env is set (${sticky}) but MCP ignores it — pass workspaceRoot arg; remove sticky from ~/.cursor/mcp.json and restart MCP`
        : null,
      stickyEnvValue: sticky,
    },
    resumeHint:
      "Pass workspaceRoot = absolute path of the Cursor-open folder on every MCP call. Remove sticky WORKSPACE_ROOT from ~/.cursor/mcp.json and restart the zteam MCP server.",
  };
}

export type WriteTeamConfigInput = {
  provider?: TeamProviderMode;
  models: {
    systemArchitect: string;
    technologyArchitect: string;
    uiUxDesigner?: string;
    softwareEngineer: string;
    qaEngineer: string;
    fallback?: string;
    systemArchitectFallback?: string;
    technologyArchitectFallback?: string;
    uiUxDesignerFallback?: string;
    softwareEngineerFallback?: string;
    qaEngineerFallback?: string;
  };
  cursorModels?: CursorRoleModels;
  maxTokens?: Partial<ResolvedTeamConfig["maxTokens"]>;
  /** Optional; preserved from existing file when omitted. */
  projectType?: string;
};

export async function writeTeamConfig(
  targetDir: string,
  input: WriteTeamConfigInput
): Promise<{ path: string; config: ZteamConfigFile }> {
  const now = new Date().toISOString();
  const dir = join(resolve(targetDir), ".zteam");
  await mkdir(dir, { recursive: true });
  const abs = join(dir, "config.json");

  let createdAt = now;
  let prevProjectType = "";
  let prevProvider: TeamProviderMode | undefined;
  let prevCursorModels: CursorRoleModels = {};
  if (await pathExists(abs)) {
    try {
      const prev = await readConfigFile(abs);
      if (prev?.createdAt) createdAt = prev.createdAt;
      if (prev?.projectType) prevProjectType = prev.projectType.trim();
      if (prev?.provider) prevProvider = prev.provider;
      if (prev?.cursorModels) prevCursorModels = prev.cursorModels;
    } catch {
      /* rewrite */
    }
  }

  const projectType =
    (input.projectType || "").trim() || prevProjectType || undefined;
  const provider = input.provider || prevProvider || undefined;
  const cursorModels = mergeCursorModels(prevCursorModels, input.cursorModels);
  const hasCursorModels = Object.keys(cursorModels).length > 0;

  // Normalize "auto" fallback to "inherit" so Cursor Task fallback never uses "auto"
  const normFb = (v: string | undefined): string => {
    const t = (v ?? "").trim();
    return t.toLowerCase() === "auto" ? "inherit" : t;
  };

  const config: ZteamConfigFile = zteamConfigFileSchema.parse({
    version: 1,
    ...(provider ? { provider } : {}),
    ...(projectType ? { projectType } : {}),
    models: {
      systemArchitect: input.models.systemArchitect.trim(),
      technologyArchitect: input.models.technologyArchitect.trim(),
      uiUxDesigner: (
        input.models.uiUxDesigner?.trim() ||
        inferMissingPrimaryFromPeers(
          {
            systemArchitect: input.models.systemArchitect,
            technologyArchitect: input.models.technologyArchitect,
            softwareEngineer: input.models.softwareEngineer,
            qaEngineer: input.models.qaEngineer,
          },
          "uiUxDesigner"
        ) ||
        DEFAULT_MODELS.uiUxDesigner
      ).trim(),
      softwareEngineer: input.models.softwareEngineer.trim(),
      qaEngineer: input.models.qaEngineer.trim(),
      fallback: normFb(input.models.fallback),
      systemArchitectFallback: normFb(input.models.systemArchitectFallback),
      technologyArchitectFallback: normFb(
        input.models.technologyArchitectFallback
      ),
      uiUxDesignerFallback: normFb(input.models.uiUxDesignerFallback),
      softwareEngineerFallback: normFb(input.models.softwareEngineerFallback),
      qaEngineerFallback: normFb(input.models.qaEngineerFallback),
    },
    ...(hasCursorModels ? { cursorModels } : {}),
    maxTokens: {
      systemArchitect:
        input.maxTokens?.systemArchitect ?? DEFAULT_MAX_TOKENS.systemArchitect,
      technologyArchitect:
        input.maxTokens?.technologyArchitect ??
        DEFAULT_MAX_TOKENS.technologyArchitect,
      uiUxDesigner:
        input.maxTokens?.uiUxDesigner ?? DEFAULT_MAX_TOKENS.uiUxDesigner,
      softwareEngineer:
        input.maxTokens?.softwareEngineer ?? DEFAULT_MAX_TOKENS.softwareEngineer,
      qaEngineer:
        input.maxTokens?.qaEngineer ?? DEFAULT_MAX_TOKENS.qaEngineer,
    },
    createdAt,
    updatedAt: now,
  });

  // Reject empty required models after parse
  for (const key of [
    "systemArchitect",
    "technologyArchitect",
    "uiUxDesigner",
    "softwareEngineer",
    "qaEngineer",
  ] as const) {
    if (!config.models?.[key]?.trim()) {
      throw new Error(`models.${key} must be a non-empty string`);
    }
  }

  await writeFile(abs, JSON.stringify(config, null, 2) + "\n", "utf8");
  await ensureZteamBootstrap(targetDir);
  return { path: abs, config };
}

export type GitignoreStatus = "added" | "already" | "no_gitignore" | "created";

export async function ensureGitignoreIgnoresZteam(
  dir: string,
  opts?: { createIfMissing?: boolean }
): Promise<{ status: GitignoreStatus; path: string }> {
  const ignoreLine = ".zteam/config.json";
  const abs = join(resolve(dir), ".gitignore");
  const exists = await pathExists(abs);
  if (!exists) {
    if (opts?.createIfMissing) {
      await writeFile(abs, `${ignoreLine}\n`, "utf8");
      return { status: "created", path: abs };
    }
    return { status: "no_gitignore", path: abs };
  }
  const text = await readFile(abs, "utf8");
  const lines = text.split(/\r?\n/);
  const ignored = lines.some((l) => {
    const t = l.trim();
    return (
      t === ignoreLine ||
      t === ".zteam/" ||
      t === ".zteam" ||
      t === "**/.zteam/" ||
      t === "**/.zteam/config.json"
    );
  });
  if (ignored) return { status: "already", path: abs };
  const next = text.endsWith("\n") || text.length === 0 ? text : text + "\n";
  await writeFile(abs, `${next}${ignoreLine}\n`, "utf8");
  return { status: "added", path: abs };
}

export function needsConfigPayload(opts: {
  workspaceRoot: string;
  appRoot: string;
  workspace: WorkspaceDiagnosis;
}): Record<string, unknown> {
  const paths = resolveConfigPaths(opts.workspaceRoot, opts.appRoot);
  const defaults = envDefaultsTeamConfig();
  const envModels = hasExplicitEnvModels();
  return {
    ok: false,
    failureKind: "needsConfig",
    needsConfig: true,
    envModelsPresent: envModels,
    questions: [...SETUP_QUESTIONS],
    modelQuestions: [...MODEL_QUESTIONS],
    modelSuggestions: ROLE_MODEL_SUGGESTIONS,
    suggestedDefaults: defaults,
    suggestedPaths: {
      workspace: paths.workspaceConfig,
      app: paths.appConfig,
    },
    workspace: opts.workspace,
    resumeHint: envModels
      ? "MODEL_* env already set — re-run with skipConfigGate=true or write .zteam/config.json"
      : "Answer setup questions, call write_zteam_config, then re-run pipeline",
  };
}

/**
 * Single source of truth for MCP tool Zod schemas (`write_zteam_config` & `get_pipeline_state`)
 * so published MCP descriptors and contract tests never drift (Item 4 of Update Plan).
 */
export const PROJECT_TYPE_VALUES = [
  "webgame",
  "godotgame",
  "crud",
  "webapp",
  "mobile",
  "cli-dos",
  "backend",
  "frontend",
  "fullstack",
  "library",
  "desktop",
  "ai-rag",
  "api",
  "other",
] as const;

export const writeZteamConfigToolShape = {
  workspaceRoot: z
    .string()
    .optional()
    .describe(
      "Absolute path of the Cursor-open workspace folder (REQUIRED on every MCP call; env WORKSPACE_ROOT is ignored)"
    ),
  projectRoot: z.string().optional().default("."),
  scope: z.enum(["workspace", "app", "both"]),
  provider: providerModeSchema
    .optional()
    .describe(
      "Execution strategy: 'hybrid' (default: Path A Task+inherit when 1 custom model or inherit; Path B MCP ChatOpenAI via .env when multi-model like heavy+light), 'cursor-task' (force Path A), or 'ninerouter-direct' (force Path B)"
    ),
  projectType: z
    .string()
    .optional()
    .describe(
      "Project archetype driving role skills: webgame | webapp | crud | backend | fullstack | ai-rag | godotgame | cli-dos | library | desktop | api | other"
    ),
  models: z.object({
    systemArchitect: z.string().min(1),
    technologyArchitect: z.string().min(1),
    uiUxDesigner: z
      .string()
      .min(1)
      .optional()
      .describe(
        "UI/UX primary; if omitted, inherits peer family (cursor alias or 9router default)"
      ),
    softwareEngineer: z.string().min(1),
    qaEngineer: z.string().min(1),
    fallback: z.string().optional().default(""),
    systemArchitectFallback: z.string().optional().default(""),
    technologyArchitectFallback: z.string().optional().default(""),
    uiUxDesignerFallback: z.string().optional().default(""),
    softwareEngineerFallback: z.string().optional().default(""),
    qaEngineerFallback: z.string().optional().default(""),
  }),
  cursorModels: cursorModelsSchema
    .optional()
    .describe(
      "Optional Cursor Task model slugs per role (e.g. { softwareEngineer: 'composer-2.5' }) when models.* are 'inherit'"
    ),
  maxTokens: z
    .object({
      systemArchitect: z.number().int().positive().optional(),
      technologyArchitect: z.number().int().positive().optional(),
      uiUxDesigner: z.number().int().positive().optional(),
      softwareEngineer: z.number().int().positive().optional(),
      qaEngineer: z.number().int().positive().optional(),
    })
    .optional(),
  gitignoreIgnore: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true and no .gitignore, create one with .zteam/config.json; if .gitignore exists, append .zteam/config.json"
    ),
};

export const getPipelineStateToolShape = {
  workspaceRoot: z
    .string()
    .optional()
    .describe(
      "Absolute path of the Cursor-open workspace folder (REQUIRED on every MCP call; env WORKSPACE_ROOT is ignored)"
    ),
  projectRoot: z
    .string()
    .optional()
    .default(".")
    .describe("Relative project folder under workspaceRoot"),
  recordStage: z
    .string()
    .optional()
    .describe(
      "Optional stage id to push into `.docs/pipeline-state.json` and `.zteam/dashboard/index.html` (e.g. sa-requirements, qa-tdd-red:maze, se-implement:maze, pipeline)"
    ),
  recordRole: z
    .string()
    .optional()
    .describe(
      "Optional role id (systemArchitect | uiUxDesigner | technologyArchitect | qaEngineer | softwareEngineer)"
    ),
  recordStatus: z
    .enum(["start", "done", "error", "warn", "info"])
    .optional()
    .describe(
      "Animation direction & stage checkpoint status: start (Orchestrator -> Agent) or done/error (Agent -> Orchestrator)"
    ),
  recordMessage: z
    .string()
    .optional()
    .describe("Short summary of what the subagent is doing or delivered"),
  skillKey: z.string().optional().describe("Active role skill key if any"),
  filesCount: z
    .number()
    .optional()
    .describe("Number of files written in this step"),
  checkGate: z
    .boolean()
    .optional()
    .describe(
      "When true (or automatically when recordStatus='done'), runs mechanical stage gate checks (requirements, host.json native addons, QA-red contradictions)"
    ),
  testExitCode: z
    .number()
    .optional()
    .describe("Optional exit code from `npm test` for stage gate verification"),
  testOutput: z
    .string()
    .optional()
    .describe("Optional stdout/stderr snippet from `npm test` for stage gate verification"),
};
