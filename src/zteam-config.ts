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
  softwareEngineer: "9RSE-software-engineer-free",
  qaEngineer: "9RQA-qa-free",
  fallback: "",
} as const;

export const DEFAULT_MAX_TOKENS = {
  systemArchitect: 1600,
  technologyArchitect: 2500,
  softwareEngineer: 8000,
  qaEngineer: 2000,
} as const;

export type TeamRole =
  | "systemArchitect"
  | "technologyArchitect"
  | "softwareEngineer"
  | "qaEngineer";

const modelsSchema = z
  .object({
    systemArchitect: z.string().min(1).optional(),
    technologyArchitect: z.string().min(1).optional(),
    softwareEngineer: z.string().min(1).optional(),
    qaEngineer: z.string().min(1).optional(),
    fallback: z.string().optional(),
  })
  .passthrough();

const maxTokensSchema = z
  .object({
    systemArchitect: z.number().int().positive().optional(),
    technologyArchitect: z.number().int().positive().optional(),
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
    softwareEngineer: string;
    qaEngineer: string;
    fallback: string;
  };
  maxTokens: {
    systemArchitect: number;
    technologyArchitect: number;
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
};

export const SETUP_QUESTIONS = [
  "Escopo: gravar no workspace, neste app (projectRoot), ou ambos?",
  "System Architect — model id (default sugerido abaixo)",
  "Technology Architect — model id",
  "Software Engineer — model id",
  "QA Engineer — model id",
  "Fallback opcional — model id ou vazio",
  "maxTokens por papel? (defaults / custom)",
  "Se não houver .gitignore no alvo: ignorar .zteam/config.json no git? (recomendado: sim)",
] as const;

/** Canonical command guide copied into each project's `.zteam/README.MD`. */
export const ZTEAM_README_MD = `# zteam — comandos e configuração

Fonte de verdade local do time 9router neste projeto. Ver também a skill Cursor **\`zteam\`** (\`/zteam\`, \`@zteam\`).

## Comandos

Use estes atalhos no chat Cursor (skill \`zteam\` / \`@zteam\`). O agent **sempre** passa \`workspaceRoot\` = pasta aberta no Cursor.

| Comando | O que faz | MCP |
|---------|-----------|-----|
| **\`@zteam/config\`** | Cria/atualiza \`.zteam/config.json\` (modelos, maxTokens, escopo workspace/app). Fonte de verdade dos modelos 9router. | \`get_zteam_config\` → perguntas → \`write_zteam_config\` |
| **\`@zteam/documentation\`** | Só documentação / arquitetura (requirements, technologies, todo, specs). Sem SE/QA. | \`run_development_pipeline\` com \`workflow: "docs"\` |
| **\`@zteam/tests\`** | Analisa o app/specs e cria ou reforça testes (QA + fix loop se falhar). | \`run_development_pipeline\` com foco em testes (\`workflow: "fix"\` ou \`"feature"\` / \`"resume"\` conforme o estado) |
| **\`@zteam\`** / **\`/zteam\`** | Pipeline completo ou o workflow que pedires (full, feature, punch, resume, …). | \`run_development_pipeline\` |

### Exemplos

\`\`\`text
@zteam/config
→ pergunta modelos / escopo → grava .zteam/config.json (+ .gitignore para config)

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
| \`.zteam/config.json\` | Modelos e maxTokens por papel (app override → workspace → env) |
| \`.zteam/README.MD\` | Este guia (comandos) |
| \`.zteam/skills/SKILL.md\` | Cópia local da skill Cursor zteam (sincronizada ao criar \`.zteam/\`) |
| \`.docs/*\` | Artefactos da pipeline (requirements, technologies, specs, progress, …) |

### Exemplo \`config.json\`

\`\`\`json
{
  "version": 1,
  "models": {
    "systemArchitect": "9RSA-system-architect-free",
    "technologyArchitect": "9RTA-technology-architect-free",
    "softwareEngineer": "9RSE-software-engineer-free",
    "qaEngineer": "9RQA-qa-free",
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

## Workspace (pasta raiz)

A pasta raiz **não** fica sticky no \`mcp.json\`. Em cada chamada o agent passa:

- **\`workspaceRoot\`** — path absoluto da pasta aberta no Cursor
- **\`projectRoot\`** — pasta relativa da app (ex. \`samples/my-app\` ou \`.\` se a app for a raiz do workspace)

Evita o footgun de pipelines a escrever noutro repo (ex. \`pacman-z2\`).

## Precedência de modelos

\`\`\`text
{appRoot}/.zteam/config.json
  → {workspaceRoot}/.zteam/config.json
    → env MODEL_* / MAX_TOKENS_*
      → defaults 9RSA / 9RTA / 9RSE / 9RQA
\`\`\`

Credenciais (\`NINEROUTER_*\`) ficam só no env do MCP — nunca neste JSON.
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
  "Prefer passing workspaceRoot (Cursor open folder); avoid sticky WORKSPACE_ROOT in ~/.cursor/mcp.json";

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
      softwareEngineer:
        process.env.MODEL_SOFTWARE_ENGINEER?.trim() ||
        DEFAULT_MODELS.softwareEngineer,
      qaEngineer:
        process.env.MODEL_QA_ENGINEER?.trim() || DEFAULT_MODELS.qaEngineer,
      fallback:
        process.env.MODEL_FALLBACK?.trim() ||
        process.env.MODEL_SOFTWARE_ENGINEER_FALLBACK?.trim() ||
        DEFAULT_MODELS.fallback,
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
  const raw = await readFile(abs, "utf8");
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
      softwareEngineer:
        layer.models?.softwareEngineer?.trim() || base.models.softwareEngineer,
      qaEngineer: layer.models?.qaEngineer?.trim() || base.models.qaEngineer,
      fallback:
        layer.models?.fallback !== undefined
          ? String(layer.models.fallback).trim()
          : base.models.fallback,
    },
    maxTokens: {
      systemArchitect:
        layer.maxTokens?.systemArchitect ?? base.maxTokens.systemArchitect,
      technologyArchitect:
        layer.maxTokens?.technologyArchitect ??
        base.maxTokens.technologyArchitect,
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

  let merged = envDefaultsTeamConfig();
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

export function diagnoseWorkspace(
  active: string,
  source: "arg" | "env" | "cwd"
): WorkspaceDiagnosis {
  return {
    active: resolve(active),
    source,
    mcpJsonHint: MCP_JSON_HINT,
  };
}

export type WriteTeamConfigInput = {
  models: {
    systemArchitect: string;
    technologyArchitect: string;
    softwareEngineer: string;
    qaEngineer: string;
    fallback?: string;
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
      softwareEngineer: input.models.softwareEngineer.trim(),
      qaEngineer: input.models.qaEngineer.trim(),
      fallback: (input.models.fallback ?? "").trim(),
    },
    maxTokens: {
      systemArchitect:
        input.maxTokens?.systemArchitect ?? DEFAULT_MAX_TOKENS.systemArchitect,
      technologyArchitect:
        input.maxTokens?.technologyArchitect ??
        DEFAULT_MAX_TOKENS.technologyArchitect,
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
  return {
    ok: false,
    failureKind: "needsConfig",
    needsConfig: true,
    questions: [...SETUP_QUESTIONS],
    suggestedDefaults: defaults,
    suggestedPaths: {
      workspace: paths.workspaceConfig,
      app: paths.appConfig,
    },
    workspace: opts.workspace,
    resumeHint:
      "Answer setup questions, call write_zteam_config, then re-run pipeline",
  };
}
