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
const CACHE_MS = 3 * 60_000;

export function clearHealthcheckCache(): void {
  cached = null;
}

export async function healthcheckNineRouter(
  baseUrl?: string,
  opts?: { timeoutMs?: number; force?: boolean }
): Promise<HealthcheckResult> {
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const now = Date.now();
  if (!opts?.force && cached && now - cached.at < CACHE_MS) {
    return { ...cached.result, message: `${cached.result.message} (cached)` };
  }

  const base = (baseUrl || process.env.NINEROUTER_BASE || "").replace(/\/$/, "");
  if (!base) {
    const result: HealthcheckResult = {
      ok: false,
      ms: 0,
      message: "NINEROUTER_BASE not set",
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
        message: `9router tunnel/DNS down (Cloudflare ${res.status}/1016) in ${ms}ms`,
      };
      cached = { at: now, result };
      return result;
    }

    if (!res.ok && res.status >= 500) {
      const result: HealthcheckResult = {
        ok: false,
        ms,
        status: res.status,
        message: `9router unhealthy HTTP ${res.status} in ${ms}ms`,
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
      message: `9router healthcheck failed in ${ms}ms: ${msg}`,
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
