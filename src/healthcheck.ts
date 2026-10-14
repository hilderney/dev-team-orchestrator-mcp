/**
 * 9router / OmniRoute / OpenRouter healthcheck (P1-4).
 * Classification (401 vs tunnel vs local fallback) lives in gateway-doctor.
 */
import { getRuntimeBaseUrlOverride, resolveLlmEndpoint } from "./env-config.js";
import { diagnoseLlmGateway } from "./gateway-doctor.js";

export type HealthcheckResult = {
  ok: boolean;
  ms: number;
  status?: number;
  gateway?: string;
  baseUrl?: string;
  failureKind?: string;
  message: string;
};

let cached: { at: number; result: HealthcheckResult } | null = null;

/** Success stays warm longer; failures expire quickly so retries are useful. */
export const SUCCESS_CACHE_MS = 3 * 60_000;
export const FAIL_CACHE_MS = 20_000;

const TUNNEL_HINT =
  "configure NINEROUTER_BASE / OMNIROUTE_BASE / OPENROUTER_API_KEY in dev-team-orchestrator/.env (do not put secrets in ~/.cursor/mcp.json)";

export function clearHealthcheckCache(): void {
  cached = null;
}

function cacheTtlMs(result: HealthcheckResult): number {
  return result.ok ? SUCCESS_CACHE_MS : FAIL_CACHE_MS;
}

export async function healthcheckNineRouter(
  baseUrl?: string,
  opts?: { timeoutMs?: number; force?: boolean; gateway?: string }
): Promise<HealthcheckResult> {
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const now = Date.now();
  if (!opts?.force && cached && now - cached.at < cacheTtlMs(cached.result)) {
    return { ...cached.result, message: `${cached.result.message} (cached)` };
  }

  const ep = resolveLlmEndpoint(opts?.gateway);
  const doctor = await diagnoseLlmGateway({ timeoutMs });
  const ms = doctor.probes.reduce((sum, probe) => sum + probe.ms, 0);
  const result: HealthcheckResult = {
    ok: doctor.ok,
    ms,
    status: doctor.probes.at(-1)?.status,
    gateway: ep.gateway,
    baseUrl: doctor.effectiveBaseUrl,
    failureKind: doctor.failureKind,
    message: doctor.ok
      ? doctor.message
      : `${doctor.message} — ${TUNNEL_HINT}`,
  };
  cached = { at: now, result };
  return result;
}

export function shouldHealthcheckForWorkflow(workflow: string): boolean {
  return ["full", "docs", "feature", ""].includes(workflow);
}

/** Fetch model ids from OpenAI-compat GET /models (for early invalid_model). */
export async function listNineRouterModelIds(
  baseUrl?: string,
  opts?: { timeoutMs?: number; gateway?: string }
): Promise<{ ok: boolean; ids: Set<string>; message: string }> {
  const ep = resolveLlmEndpoint(opts?.gateway);
  const base = (
    baseUrl ||
    getRuntimeBaseUrlOverride() ||
    process.env.NINEROUTER_BASE ||
    process.env.OMNIROUTE_BASE ||
    process.env.OPENROUTER_BASE ||
    process.env.OPENAI_BASE_URL ||
    (process.env.OPENROUTER_API_KEY ? ep.baseUrl : "")
  ).replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      ids: new Set(),
      message: `NINEROUTER_BASE not set — ${TUNNEL_HINT}`,
    };
  }
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/models`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ep.apiKey || "none"}`,
        ...ep.defaultHeaders,
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        ids: new Set(),
        message: `GET /models HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as {
      data?: Array<{ id?: string }>;
    };
    const ids = new Set(
      (json.data ?? [])
        .map((m) => (m.id || "").trim())
        .filter(Boolean)
    );
    return { ok: true, ids, message: `${ids.size} models` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, ids: new Set(), message: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Primary (+ non-empty non-alias fallbacks) must exist in 9router/OmniRoute/OpenRouter `/models`.
 * Note: `inherit` / `auto` / `cursor` in `*Fallback` are ignored here because they are
 * Cursor Task fallbacks (Path A), not OpenAI-compatible model IDs.
 */
export function missingNineRouterModels(
  cfg: {
    models: Record<string, string>;
  },
  available: Set<string>
): string[] {
  const primaryKeys = [
    "systemArchitect",
    "technologyArchitect",
    "uiUxDesigner",
    "softwareEngineer",
    "qaEngineer",
  ];
  const fallbackKeys = [
    "systemArchitectFallback",
    "technologyArchitectFallback",
    "uiUxDesignerFallback",
    "softwareEngineerFallback",
    "qaEngineerFallback",
    "fallback",
  ];
  const cursorAliases = new Set(["inherit", "auto", "cursor", "cursor-auto"]);
  const missing: string[] = [];
  for (const key of primaryKeys) {
    const id = (cfg.models[key] || "").trim();
    if (!id || cursorAliases.has(id.toLowerCase())) continue;
    if (!available.has(id)) missing.push(`${key}=${id}`);
  }
  for (const key of fallbackKeys) {
    const id = (cfg.models[key] || "").trim();
    if (!id || cursorAliases.has(id.toLowerCase())) continue;
    if (!available.has(id)) missing.push(`${key}=${id}`);
  }
  return missing;
}
