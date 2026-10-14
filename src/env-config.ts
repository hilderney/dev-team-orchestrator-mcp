/**
 * Explicit `.env` loader & multi-provider OpenAI-compatible credentials resolver
 * (9router, OmniRoute, OpenRouter, or custom OpenAI-compatible gateway).
 *
 * Why explicit path:
 * When Cursor spawns `npx tsx C:\...\src\orchestrator.ts`, `process.cwd()` is NOT
 * guaranteed to be the MCP package root. Loading `.env` via `import.meta.url`
 * ensures `dev-team-orchestrator/.env` is always read, and secrets never need
 * to be embedded inside `~/.cursor/mcp.json`.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
export const MCP_DOTENV_PATH = join(MCP_PACKAGE_ROOT, ".env");

let dotenvLoaded = false;

/**
 * Load `dev-team-orchestrator/.env` (and optional `workspaceRoot/.env` fallback)
 * without throwing if `.env` is absent.
 */
export function ensurePackageEnvLoaded(extraEnvDir?: string): {
  packageEnvPath: string;
  packageEnvExists: boolean;
} {
  const pkgExists = existsSync(MCP_DOTENV_PATH);
  if (!dotenvLoaded && pkgExists) {
    loadDotenv({ path: MCP_DOTENV_PATH, override: false });
    dotenvLoaded = true;
  }
  if (extraEnvDir) {
    const wsEnv = join(resolve(extraEnvDir), ".env");
    if (existsSync(wsEnv) && resolve(wsEnv) !== resolve(MCP_DOTENV_PATH)) {
      loadDotenv({ path: wsEnv, override: false });
    }
  }
  return {
    packageEnvPath: MCP_DOTENV_PATH,
    packageEnvExists: pkgExists,
  };
}

// Immediately load package .env on module import
ensurePackageEnvLoaded();

export type OpenAiCompatGateway =
  | "ninerouter"
  | "omniroute"
  | "openrouter"
  | "openai-compat";

export type ResolvedLlmEndpoint = {
  gateway: OpenAiCompatGateway;
  baseUrl: string;
  apiKey: string;
  configured: boolean;
  sourceEnvKey: string;
  defaultHeaders: Record<string, string>;
};

const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";
const NINEROUTER_DEFAULT_BASE = "http://localhost:20128/v1";

/**
 * Resolve OpenAI-compatible base URL & API key from `.env` / `process.env`.
 * Supports:
 * 1) `NINEROUTER_BASE` + `NINEROUTER_KEY` (9Router / Cursor OpenAPI override)
 * 2) `OMNIROUTE_BASE` + `OMNIROUTE_KEY` (OmniRoute gateway)
 * 3) `OPENROUTER_API_KEY` (+ optional `OPENROUTER_BASE`, defaults to `https://openrouter.ai/api/v1`)
 * 4) `OPENAI_BASE_URL` + `OPENAI_API_KEY`
 *
 * Lazy: NEVER throws at import/boot time so Path A (`cursor-task` with `inherit`)
 * works even before `.env` is configured.
 */
export function resolveLlmEndpoint(
  preferredGateway?: string
): ResolvedLlmEndpoint {
  ensurePackageEnvLoaded();
  const pref = (
    preferredGateway ||
    process.env.ZTEAM_LLM_GATEWAY ||
    ""
  )
    .trim()
    .toLowerCase();

  const nineKey = (process.env.NINEROUTER_KEY || "").trim();
  const nineBase = (process.env.NINEROUTER_BASE || "").trim();

  const omniKey = (
    process.env.OMNIROUTE_KEY ||
    process.env.OMNIROUTER_KEY ||
    ""
  ).trim();
  const omniBase = (
    process.env.OMNIROUTE_BASE ||
    process.env.OMNIROUTER_BASE ||
    ""
  ).trim();

  const openRouterKey = (
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_KEY ||
    ""
  ).trim();
  const openRouterBase = (
    process.env.OPENROUTER_BASE || OPENROUTER_DEFAULT_BASE
  ).trim();

  const openAiKey = (process.env.OPENAI_API_KEY || "").trim();
  const openAiBase = (process.env.OPENAI_BASE_URL || "").trim();

  // Explicit gateway preference
  if (pref === "omniroute" || pref === "omnirouter") {
    return {
      gateway: "omniroute",
      baseUrl: (omniBase || nineBase || NINEROUTER_DEFAULT_BASE).replace(
        /\/$/,
        ""
      ),
      apiKey: omniKey || nineKey,
      configured: Boolean(omniKey || nineKey),
      sourceEnvKey: omniKey ? "OMNIROUTE_KEY" : "NINEROUTER_KEY",
      defaultHeaders: {},
    };
  }

  if (pref === "openrouter") {
    return {
      gateway: "openrouter",
      baseUrl: openRouterBase.replace(/\/$/, ""),
      apiKey: openRouterKey || nineKey,
      configured: Boolean(openRouterKey || nineKey),
      sourceEnvKey: openRouterKey ? "OPENROUTER_API_KEY" : "NINEROUTER_KEY",
      defaultHeaders: {
        "HTTP-Referer":
          process.env.OPENROUTER_SITE_URL || "https://github.com/zteam-mcp",
        "X-Title": process.env.OPENROUTER_APP_NAME || "zTeam Orchestrator MCP",
      },
    };
  }

  // Auto-detect by available credentials: NINEROUTER -> OMNIROUTE -> OPENROUTER -> OPENAI
  if (nineKey || nineBase) {
    return {
      gateway: "ninerouter",
      baseUrl: (nineBase || NINEROUTER_DEFAULT_BASE).replace(/\/$/, ""),
      apiKey: nineKey,
      configured: Boolean(nineKey),
      sourceEnvKey: "NINEROUTER_KEY",
      defaultHeaders: {},
    };
  }

  if (omniKey || omniBase) {
    return {
      gateway: "omniroute",
      baseUrl: (omniBase || NINEROUTER_DEFAULT_BASE).replace(/\/$/, ""),
      apiKey: omniKey,
      configured: Boolean(omniKey),
      sourceEnvKey: "OMNIROUTE_KEY",
      defaultHeaders: {},
    };
  }

  if (openRouterKey) {
    return {
      gateway: "openrouter",
      baseUrl: openRouterBase.replace(/\/$/, ""),
      apiKey: openRouterKey,
      configured: true,
      sourceEnvKey: "OPENROUTER_API_KEY",
      defaultHeaders: {
        "HTTP-Referer":
          process.env.OPENROUTER_SITE_URL || "https://github.com/zteam-mcp",
        "X-Title": process.env.OPENROUTER_APP_NAME || "zTeam Orchestrator MCP",
      },
    };
  }

  if (openAiKey) {
    return {
      gateway: "openai-compat",
      baseUrl: (openAiBase || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: openAiKey,
      configured: true,
      sourceEnvKey: "OPENAI_API_KEY",
      defaultHeaders: {},
    };
  }

  return {
    gateway: "ninerouter",
    baseUrl: NINEROUTER_DEFAULT_BASE,
    apiKey: "",
    configured: false,
    sourceEnvKey: "NINEROUTER_KEY",
    defaultHeaders: {},
  };
}
