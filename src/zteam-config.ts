/**
 * Team model config: `.zteam/config.json` (workspace default + app override).
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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

export function isCursorModelAlias(model: string): boolean {
  return CURSOR_MODEL_ALIASES.has(model.trim().toLowerCase());
}

export type TeamRuntimeOk = {
  ok: true;
  runtime: LlmRuntime;
};

export type TeamRuntimeErr = {
  ok: false;
  failureKind: "mixed_runtime";
  message: string;
  roles: Record<TeamRole, { model: string; runtime: LlmRuntime }>;
};

export type TeamRuntimeResolution = TeamRuntimeOk | TeamRuntimeErr;

/** Homogeneous runtime from primary models; mix → mixed_runtime. */
export function resolveTeamRuntime(
  cfg: Pick<ResolvedTeamConfig, "models">
): TeamRuntimeResolution {
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
  const runtimes = new Set(TEAM_ROLES.map((r) => roles[r].runtime));
  if (runtimes.size > 1) {
    const detail = TEAM_ROLES.map(
      (r) => `${r}=${roles[r].model}(${roles[r].runtime})`
    ).join(", ");
    return {
      ok: false,
      failureKind: "mixed_runtime",
      message: `All primary models must share one runtime (cursor aliases OR 9router ids). Got mixed: ${detail}`,
      roles,
    };
  }
  return {
    ok: true,
    runtime: [...runtimes][0] ?? "ninerouter",
  };
}

export type DelegationStage = {
  id: string;
  role: TeamRole;
  subagentType: CursorSubagentType;
  model: string;
  title: string;
  instructions: string;
  expectedOutputs: string[];
};

export type CursorDelegationPlaybook = {
  llmRuntime: "cursor";
  workflow: string;
  userIdea: string;
  workspaceRoot: string;
  projectRoot: string;
  appRoot: string;
  models: ResolvedTeamConfig["models"];
  maxTokens: ResolvedTeamConfig["maxTokens"];
  stages: DelegationStage[];
  resumeHint: string;
};

/** Stages for skill-driven Cursor Task path (no ChatOpenAI). */
export function buildCursorDelegationPlaybook(opts: {
  workflow: string;
  userIdea: string;
  workspaceRoot: string;
  projectRoot: string;
  appRoot: string;
  models: ResolvedTeamConfig["models"];
  maxTokens: ResolvedTeamConfig["maxTokens"];
}): CursorDelegationPlaybook {
  const wf = opts.workflow || "full";
  const idea = opts.userIdea.trim();
  const rootHint = `workspaceRoot=${opts.workspaceRoot} projectRoot=${opts.projectRoot} appRoot=${opts.appRoot}`;

  const stage = (
    id: string,
    role: TeamRole,
    title: string,
    instructions: string,
    expectedOutputs: string[]
  ): DelegationStage => ({
    id,
    role,
    subagentType: ROLE_TO_SUBAGENT[role],
    model: opts.models[role],
    title,
    instructions: `${instructions}\n\nConstraints: ${rootHint}. Idea: ${idea}`,
    expectedOutputs,
  });

  const stages: DelegationStage[] = [];
  const needsArch = ["full", "docs", "feature", ""].includes(wf);
  const needsImpl = ["full", "feature", "punch", "fix", "resume", ""].includes(
    wf
  );
  const needsQa = ["full", "feature", "punch", "fix", "resume", ""].includes(
    wf
  );
  const docsOnly = wf === "docs";

  if (needsArch || wf === "docs") {
    stages.push(
      stage(
        "sa-requirements",
        "systemArchitect",
        "System Architect — requirements",
        "Produce or update .docs/requirements.md (## sections with goals, functional/non-functional, normal+alt flows; technology-agnostic). Do not write implementation code or specs yet.",
        [".docs/requirements.md"]
      )
    );
    stages.push(
      stage(
        "ux-juice",
        "uiUxDesigner",
        "UI/UX — juice addendum",
        "Score requirements UX 1–10, write ## UX / Juice addendum (action/reaction feedback). Raise score to ≥7 vs before. Do not invent contradicting features or pick stacks.",
        [".docs/requirements.md"]
      )
    );
    stages.push(
      stage(
        "ta-stack",
        "technologyArchitect",
        "Technology Architect — stack / structure",
        "Produce or update .docs/technologies.md covering stack, folder layout, hosting, persistence, scalability, cost-benefit services, and standards from approved requirements. Do not write full feature implementations.",
        [".docs/technologies.md"]
      )
    );
    stages.push(
      stage(
        "ux-design-system",
        "uiUxDesigner",
        "UI/UX — look and feel",
        "From requirements.md + technologies.md write .docs/ui-ux.md: look-and-feel, hierarchy, color palette, visual/sound/sensory behavior, evidence-based emotion strategies. No invented statistics.",
        [".docs/ui-ux.md"]
      )
    );
    stages.push(
      stage(
        "sa-todo-and-specs",
        "systemArchitect",
        "System Architect — todo + three-handed specs",
        "Plan .docs/todo.md (testable chunks from pré-reqs). For each slug: SA writes detailed spec, UI/UX enriches usability/narrative, TA adds technical how-to on the same .docs/specs/{slug}.spec.md.",
        [".docs/todo.md", ".docs/specs/*.spec.md"]
      )
    );
  }

  if (needsImpl && !docsOnly) {
    stages.push(
      stage(
        "se-implement",
        "softwareEngineer",
        "Software Engineer — implement",
        "Implement pending [ ] todos that have specs. Write production code under appRoot. Follow technologies.md and specs. Do not write tests (QA does).",
        ["src/**", "package.json"]
      )
    );
  }

  if (needsQa && !docsOnly) {
    stages.push(
      stage(
        "qa-tests",
        "qaEngineer",
        "QA Engineer — tests",
        "Add/fix unit and integration tests for implemented features. Do not change production behavior except minor testability hooks if required.",
        ["**/*.{test,spec}.*", "tests/**"]
      )
    );
  }

  return {
    llmRuntime: "cursor",
    workflow: wf,
    userIdea: idea,
    workspaceRoot: opts.workspaceRoot,
    projectRoot: opts.projectRoot,
    appRoot: opts.appRoot,
    models: opts.models,
    maxTokens: opts.maxTokens,
    stages,
    resumeHint:
      "llmRuntime=cursor: run each delegationPlaybook.stages entry via Cursor Task (subagentType + model from stage). Do NOT call 9router. After stages, optionally call run_development_pipeline with the same roots for verify-only / resume if needed.",
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

const maxTokensSchema = z
  .object({
    systemArchitect: z.number().int().positive().optional(),
    technologyArchitect: z.number().int().positive().optional(),
    uiUxDesigner: z.number().int().positive().optional(),
    softwareEngineer: z.number().int().positive().optional(),
    qaEngineer: z.number().int().positive().optional(),
  })
  .passthrough();

export const zteamConfigFileSchema = z
  .object({
    version: z.number().int().positive().default(1),
    models: modelsSchema.optional(),
    maxTokens: maxTokensSchema.optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type ZteamConfigFile = z.infer<typeof zteamConfigFileSchema>;

export type ResolvedTeamConfig = {
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
  "System Architect — primary model (ver modelSuggestions.systemArchitect: 2 free + 2 paid)",
  "System Architect — fallback model (segundo agente SA se o primary esgotar; vazio = sem handoff)",
  "Technology Architect — primary (ver modelSuggestions.technologyArchitect)",
  "Technology Architect — fallback",
  "UI/UX Designer — primary (ver modelSuggestions.uiUxDesigner)",
  "UI/UX Designer — fallback",
  "Software Engineer — primary (ver modelSuggestions.softwareEngineer)",
  "Software Engineer — fallback (recomendado se usares SE free)",
  "QA Engineer — primary (ver modelSuggestions.qaEngineer)",
  "QA Engineer — fallback",
  "maxTokens por papel? (defaults / custom)",
  "Se não houver .gitignore no alvo: ignorar .zteam/config.json no git? (recomendado: sim)",
] as const;

/** Focused questions for `@zteam/models` (LLM ids only). */
export const MODEL_QUESTIONS = [
  "Para CADA papel (SA/TA/UX/SE/QA): escolhe primary + fallback. Família homogénea: aliases Cursor (inherit/auto/cursor/cursor-auto) OU ids 9router (modelSuggestions). Não misturar.",
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
  "Gravar neste projeto: workspace (raiz aberta), app (projectRoot), ou ambos?",
] as const;

/** Resolve per-role fallback model id (role-specific → legacy global for SE). */
export function resolveRoleFallbackModel(
  cfg: ResolvedTeamConfig,
  role: TeamRole
): string {
  const key = `${role}Fallback` as const;
  const perRole = (cfg.models as Record<string, string>)[key]?.trim() || "";
  if (perRole) return perRole;
  if (role === "softwareEngineer") {
    return (
      cfg.models.fallback?.trim() ||
      process.env.MODEL_FALLBACK?.trim() ||
      process.env.MODEL_SOFTWARE_ENGINEER_FALLBACK?.trim() ||
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
  if (envKey && process.env[envKey]?.trim()) return process.env[envKey]!.trim();
  return "";
}

/** Canonical command guide copied into each project's `.zteam/README.MD`. */
export const ZTEAM_README_MD = `# zteam — comandos e configuração

Fonte de verdade local do time neste projeto: **\`.zteam/config.json\`** (verdade absoluta dos modelos). Ver também a skill Cursor **\`zteam\`** (\`/zteam\`, \`@zteam\`).

## Dual runtime (modelos)

O valor de cada primary em \`models\` escolhe o runtime (**família homogénea** — não misturar):

| Valor no config | Runtime | O que acontece |
|-----------------|---------|----------------|
| \`inherit\` / \`auto\` / \`cursor\` / \`cursor-auto\` | **cursor** | Skill corre SA/TA/SE/QA via Cursor Task (Auto do chat pai). MCP **não** chama 9router. |
| Qualquer outro id (\`9RSA-…\`, \`cu/default\`, …) | **ninerouter** | MCP \`ChatOpenAI\` com o id **literal** → 9router. |

Mix (\`inherit\` + \`9RSE-…\`) → \`failureKind: mixed_runtime\` (fail cedo).

Precedência: ficheiro app → ficheiro workspace → (só se **não** houver ficheiro) env \`MODEL_*\` / defaults.

## Comandos

Use estes atalhos no chat Cursor (skill \`zteam\` / \`@zteam\`). O agent **sempre** passa \`workspaceRoot\` = pasta aberta no Cursor.

| Comando | O que faz | MCP |
|---------|-----------|-----|
| **\`@zteam/config\`** | Setup completo: \`.zteam/config.json\` (modelos, maxTokens, escopo workspace/app, gitignore). | \`get_zteam_config\` → perguntas → \`write_zteam_config\` |
| **\`@zteam/models\`** | Só LLMs por papel — perguntas guiadas → atualiza \`models\` em \`.zteam/config.json\` neste projeto. | \`get_zteam_config\` → \`modelQuestions\` → \`write_zteam_config\` |
| **\`@zteam/documentation\`** | Só documentação / arquitetura (requirements, technologies, todo, specs). Sem SE/QA. | \`run_development_pipeline\` com \`workflow: "docs"\` |
| **\`@zteam/tests\`** | Analisa o app/specs e cria ou reforça testes (QA + fix loop se falhar). | \`run_development_pipeline\` com foco em testes (\`workflow: "fix"\` ou \`"feature"\` / \`"resume"\` conforme o estado) |
| **\`@zteam\`** / **\`/zteam\`** | Pipeline completo ou o workflow que pedires (full, feature, punch, resume, …). | \`run_development_pipeline\` (ou Task playbook se runtime=cursor) |

### Exemplos

\`\`\`text
@zteam/models
→ mostra modelos atuais + defaults → pergunta SA/TA/SE/QA/fallback → grava .zteam/config.json

@zteam/config
→ pergunta modelos / escopo / maxTokens → grava .zteam/config.json (+ .gitignore para config)

@zteam/documentation samples/pacman — canvas TS, infinite lives
→ workflow=docs, projectRoot=samples/pacman

@zteam/tests samples/pacman
→ analisa specs/código e corre pipeline de testes

@zteam build a todo API in samples/todo-api
→ auto ou full/feature conforme contexto
\`\`\`

## Ficheiros

| Path | Papel |
|------|--------|
| \`.zteam/config.json\` | **Verdade absoluta** — modelos e maxTokens por papel |
| \`.zteam/README.MD\` | Este guia (comandos) |
| \`.zteam/skills/SKILL.md\` | Cópia local da skill Cursor zteam (sincronizada ao criar \`.zteam/\`) |
| \`.docs/*\` | Artefactos da pipeline (requirements, technologies, specs, progress, …) |

### Exemplo \`config.json\` (9router)

\`\`\`json
{
  "version": 1,
  "models": {
    "systemArchitect": "9RSA-system-architect-free",
    "systemArchitectFallback": "9RSA-system-architect",
    "technologyArchitect": "9RTA-technology-architect-free",
    "technologyArchitectFallback": "",
    "softwareEngineer": "9RSE-software-engineer-free",
    "softwareEngineerFallback": "9RSE-software-engineer",
    "qaEngineer": "9RQA-qa-free",
    "qaEngineerFallback": "",
    "fallback": ""
  },
  "maxTokens": {
    "systemArchitect": 1600,
    "technologyArchitect": 2500,
    "softwareEngineer": 8000,
    "qaEngineer": 2000
  }
}
\`\`\`

### Exemplo Cursor Auto (fora do 9router)

\`\`\`json
{
  "version": 1,
  "models": {
    "systemArchitect": "inherit",
    "systemArchitectFallback": "",
    "technologyArchitect": "inherit",
    "technologyArchitectFallback": "",
    "softwareEngineer": "inherit",
    "softwareEngineerFallback": "",
    "qaEngineer": "inherit",
    "qaEngineerFallback": "",
    "fallback": ""
  }
}
\`\`\`

Handoff (só runtime **ninerouter**): se o primary esgotar retries, o MCP promove o \`*Fallback\` do papel. Papéis ativos podem consultar-se nos gates (SE↔SA após VERIFY FAIL; TA↔SA em gaps de arquitetura).

No \`@zteam/config\` / \`@zteam/models\`, pergunta primary+fallback por papel e mostra \`modelSuggestions\` (2 free + 2 paid) **e** aliases Cursor (\`inherit\`).

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
 * Create `.zteam/` and materialize README + local skill copy.
 * Call this before any pipeline / LLM work (and whenever `.zteam/` is created).
 */
export async function ensureZteamBootstrap(targetDir: string): Promise<{
  dir: string;
  readme: Awaited<ReturnType<typeof ensureZteamReadme>>;
  skill: Awaited<ReturnType<typeof ensureZteamSkillCopy>>;
}> {
  const dir = join(resolve(targetDir), ".zteam");
  await mkdir(dir, { recursive: true });
  const readme = await ensureZteamReadme(targetDir);
  const skill = await ensureZteamSkillCopy(targetDir);
  return { dir, readme, skill };
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
  return {
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
    models: { ...DEFAULT_MODELS },
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

function mergeLayer(
  base: Omit<ResolvedTeamConfig, "sources" | "exists">,
  layer: ZteamConfigFile | null
): Omit<ResolvedTeamConfig, "sources" | "exists"> {
  if (!layer) return base;
  return {
    models: {
      systemArchitect:
        layer.models?.systemArchitect?.trim() || base.models.systemArchitect,
      technologyArchitect:
        layer.models?.technologyArchitect?.trim() ||
        base.models.technologyArchitect,
      uiUxDesigner:
        layer.models?.uiUxDesigner?.trim() || base.models.uiUxDesigner,
      softwareEngineer:
        layer.models?.softwareEngineer?.trim() || base.models.softwareEngineer,
      qaEngineer: layer.models?.qaEngineer?.trim() || base.models.qaEngineer,
      fallback:
        layer.models?.fallback !== undefined
          ? String(layer.models.fallback).trim()
          : base.models.fallback,
      systemArchitectFallback:
        layer.models?.systemArchitectFallback !== undefined
          ? String(layer.models.systemArchitectFallback).trim()
          : base.models.systemArchitectFallback,
      technologyArchitectFallback:
        layer.models?.technologyArchitectFallback !== undefined
          ? String(layer.models.technologyArchitectFallback).trim()
          : base.models.technologyArchitectFallback,
      uiUxDesignerFallback:
        layer.models?.uiUxDesignerFallback !== undefined
          ? String(layer.models.uiUxDesignerFallback).trim()
          : base.models.uiUxDesignerFallback,
      softwareEngineerFallback:
        layer.models?.softwareEngineerFallback !== undefined
          ? String(layer.models.softwareEngineerFallback).trim()
          : base.models.softwareEngineerFallback,
      qaEngineerFallback:
        layer.models?.qaEngineerFallback !== undefined
          ? String(layer.models.qaEngineerFallback).trim()
          : base.models.qaEngineerFallback,
    },
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

  // Same path when projectRoot is "." — only read once
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
  else if (workspaceFile) {
    /* already merged */
  }

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
  maxTokens?: Partial<ResolvedTeamConfig["maxTokens"]>;
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
  if (await pathExists(abs)) {
    try {
      const prev = await readConfigFile(abs);
      if (prev?.createdAt) createdAt = prev.createdAt;
    } catch {
      /* rewrite */
    }
  }

  const config: ZteamConfigFile = zteamConfigFileSchema.parse({
    version: 1,
    models: {
      systemArchitect: input.models.systemArchitect.trim(),
      technologyArchitect: input.models.technologyArchitect.trim(),
      uiUxDesigner: (
        input.models.uiUxDesigner ?? DEFAULT_MODELS.uiUxDesigner
      ).trim(),
      softwareEngineer: input.models.softwareEngineer.trim(),
      qaEngineer: input.models.qaEngineer.trim(),
      fallback: (input.models.fallback ?? "").trim(),
      systemArchitectFallback: (
        input.models.systemArchitectFallback ??
        ""
      ).trim(),
      technologyArchitectFallback: (
        input.models.technologyArchitectFallback ??
        ""
      ).trim(),
      uiUxDesignerFallback: (input.models.uiUxDesignerFallback ?? "").trim(),
      softwareEngineerFallback: (
        input.models.softwareEngineerFallback ??
        ""
      ).trim(),
      qaEngineerFallback: (input.models.qaEngineerFallback ?? "").trim(),
    },
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
