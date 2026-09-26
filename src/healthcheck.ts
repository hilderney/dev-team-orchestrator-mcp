/**
 * 9router / tunnel healthcheck (P1-4).
 */

export type HealthcheckResult = {
  ok: boolean;
  ms: number;
  status?: number;
  message: string;
};

let cached: { at: number; result: HealthcheckResult } | null = null;

/** Success stays warm longer; failures expire quickly so retries are useful. */
export const SUCCESS_CACHE_MS = 3 * 60_000;
export const FAIL_CACHE_MS = 20_000;

const TUNNEL_HINT =
  "reinicie MCP / verifique túnel 9router (Cloudflare 1016)";

export function clearHealthcheckCache(): void {
  cached = null;
}

function cacheTtlMs(result: HealthcheckResult): number {
  return result.ok ? SUCCESS_CACHE_MS : FAIL_CACHE_MS;
}

export async function healthcheckNineRouter(
  baseUrl?: string,
  opts?: { timeoutMs?: number; force?: boolean }
): Promise<HealthcheckResult> {
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const now = Date.now();
  if (!opts?.force && cached && now - cached.at < cacheTtlMs(cached.result)) {
    return { ...cached.result, message: `${cached.result.message} (cached)` };
  }

  const base = (baseUrl || process.env.NINEROUTER_BASE || "").replace(/\/$/, "");
  if (!base) {
    const result: HealthcheckResult = {
      ok: false,
      ms: 0,
      message: `NINEROUTER_BASE not set — ${TUNNEL_HINT}`,
    };
    return result;
  }

  // Cheap GET — models list or root; OpenAI-compat often has /models
  const url = `${base}/models`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.NINEROUTER_KEY || "none"}`,
      },
    });
    const ms = Date.now() - started;
    const text = await res.text().catch(() => "");
    const cloudflareDown =
      /error code 1016|Error 530|cloudflare/i.test(text) ||
      res.status === 530 ||
      res.status === 502;

    if (cloudflareDown) {
      const result: HealthcheckResult = {
        ok: false,
        ms,
        status: res.status,
        message: `9router tunnel/DNS down (Cloudflare ${res.status}/1016) in ${ms}ms — ${TUNNEL_HINT}`,
      };
      cached = { at: now, result };
      return result;
    }

    if (!res.ok && res.status >= 500) {
      const result: HealthcheckResult = {
        ok: false,
        ms,
        status: res.status,
        message: `9router unhealthy HTTP ${res.status} in ${ms}ms — ${TUNNEL_HINT}`,
      };
      cached = { at: now, result };
      return result;
    }

    const result: HealthcheckResult = {
      ok: true,
      ms,
      status: res.status,
      message: `9router ok HTTP ${res.status} in ${ms}ms`,
    };
    cached = { at: now, result };
    return result;
  } catch (err) {
    const ms = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    const result: HealthcheckResult = {
      ok: false,
      ms,
      message: `9router healthcheck failed in ${ms}ms: ${msg} — ${TUNNEL_HINT}`,
    };
    cached = { at: now, result };
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export function shouldHealthcheckForWorkflow(workflow: string): boolean {
  return ["full", "docs", "feature", ""].includes(workflow);
}

/** Fetch model ids from OpenAI-compat GET /models (for early invalid_model). */
export async function listNineRouterModelIds(
  baseUrl?: string,
  opts?: { timeoutMs?: number }
): Promise<{ ok: boolean; ids: Set<string>; message: string }> {
  const base = (baseUrl || process.env.NINEROUTER_BASE || "").replace(/\/$/, "");
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
        Authorization: `Bearer ${process.env.NINEROUTER_KEY || "none"}`,
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

/** Primary (+ non-empty fallbacks) must exist in 9router /models. */
export function missingNineRouterModels(
  cfg: {
    models: Record<string, string>;
  },
  available: Set<string>
): string[] {
  const keys = [
    "systemArchitect",
    "technologyArchitect",
    "uiUxDesigner",
    "softwareEngineer",
    "qaEngineer",
    "systemArchitectFallback",
    "technologyArchitectFallback",
    "uiUxDesignerFallback",
    "softwareEngineerFallback",
    "qaEngineerFallback",
    "fallback",
  ];
  const missing: string[] = [];
  for (const key of keys) {
    const id = (cfg.models[key] || "").trim();
    if (!id) continue;
    if (!available.has(id)) missing.push(`${key}=${id}`);
  }
  return missing;
}
