/**
 * Classified probe of the OpenAI-compatible gateway (9router / OmniRoute / OpenRouter)
 * before a ninerouter pipeline run.
 *
 * Never prints the API key (only the last 4 characters and the env var name).
 * Never reads the 9router SQLite catalog — a stored key there is not a Bearer token.
 *
 * When the configured base is a dead remote tunnel and the same key is accepted by
 * the local 9router (`http://127.0.0.1:20128/v1`), this run uses localhost in memory.
 * The `.env` file is not rewritten.
 */
import {
  resolveLlmEndpoint,
  setRuntimeBaseUrlOverride,
  type ResolvedLlmEndpoint,
} from "./env-config.js";

export const LOCAL_NINEROUTER_BASE = "http://127.0.0.1:20128/v1";

export type GatewayProbeClass =
  | "ok"
  | "auth"
  | "tunnel"
  | "dns"
  | "down"
  | "missing_models";

export type GatewayProbe = {
  baseUrl: string;
  classification: GatewayProbeClass;
  status?: number;
  ms: number;
  modelIds: string[];
  message: string;
};

export type GatewayFailureKind =
  | "gateway_auth"
  | "gateway_down"
  | "invalid_model"
  | "missing_env_credentials";

export type GatewayDoctorResult = {
  ok: boolean;
  failureKind?: GatewayFailureKind;
  classification: GatewayProbeClass | "unconfigured";
  configuredBaseUrl: string;
  effectiveBaseUrl: string;
  usedLocalFallback: boolean;
  /** Last 4 characters only. */
  keyHint: string;
  sourceEnvKey: string;
  probes: GatewayProbe[];
  missingModelIds: string[];
  /** Matching `9r*` ids, capped. */
  sampleModelIds: string[];
  resumeHint: string;
  message: string;
};

export type DiagnoseLlmGatewayOpts = {
  requiredModelIds?: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type FetchLike = typeof fetch;

function keyHintOf(apiKey: string): string {
  const k = apiKey.trim();
  if (!k) return "(empty)";
  return `…${k.slice(-4)}`;
}

function isLoopbackBase(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost";
  } catch {
    return false;
  }
}

function sameBase(a: string, b: string): boolean {
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

/** MCP-safe view: no key material, no full model catalog. */
export function summarizeGatewayDoctor(
  doctor: GatewayDoctorResult
): Record<string, unknown> {
  return {
    ok: doctor.ok,
    failureKind: doctor.failureKind ?? null,
    classification: doctor.classification,
    configuredBaseUrl: doctor.configuredBaseUrl,
    effectiveBaseUrl: doctor.effectiveBaseUrl,
    usedLocalFallback: doctor.usedLocalFallback,
    keyHint: doctor.keyHint,
    sourceEnvKey: doctor.sourceEnvKey,
    missingModelIds: doctor.missingModelIds,
    sampleModelIds: doctor.sampleModelIds,
    message: doctor.message,
    resumeHint: doctor.resumeHint,
    probes: doctor.probes.map((probe) => ({
      baseUrl: probe.baseUrl,
      classification: probe.classification,
      status: probe.status ?? null,
      ms: probe.ms,
      modelCount: probe.modelIds.length,
      message: probe.message,
    })),
  };
}

function sampleNineRouterIds(ids: string[]): string[] {
  return ids.filter((id) => /^9r/i.test(id)).slice(0, 24);
}

async function probeModels(
  baseUrl: string,
  ep: ResolvedLlmEndpoint,
  timeoutMs: number,
  fetchImpl: FetchLike
): Promise<GatewayProbe> {
  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/models`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ep.apiKey || "none"}`,
        ...ep.defaultHeaders,
      },
    });
    const ms = Date.now() - started;
    const text = await res.text().catch(() => "");
    const cloudflare =
      /error code 1016|Error 530|cloudflare/i.test(text) ||
      res.status === 530 ||
      res.status === 502 ||
      res.status === 503;

    if (res.status === 401 || res.status === 403) {
      return {
        baseUrl: base,
        classification: "auth",
        status: res.status,
        ms,
        modelIds: [],
        message: `HTTP ${res.status} Unauthorized`,
      };
    }
    if (cloudflare) {
      return {
        baseUrl: base,
        classification: "tunnel",
        status: res.status,
        ms,
        modelIds: [],
        message: `tunnel/Cloudflare HTTP ${res.status}`,
      };
    }
    if (!res.ok) {
      return {
        baseUrl: base,
        classification: "down",
        status: res.status,
        ms,
        modelIds: [],
        message: `HTTP ${res.status}`,
      };
    }
    let ids: string[] = [];
    try {
      const json = JSON.parse(text) as { data?: Array<{ id?: string }> };
      ids = (json.data ?? [])
        .map((m) => (m.id || "").trim())
        .filter(Boolean);
    } catch {
      return {
        baseUrl: base,
        classification: "down",
        status: res.status,
        ms,
        modelIds: [],
        message: "HTTP 200 but body is not a /models JSON list",
      };
    }
    return {
      baseUrl: base,
      classification: "ok",
      status: res.status,
      ms,
      modelIds: ids,
      message: `HTTP ${res.status} (${ids.length} models)`,
    };
  } catch (err) {
    const ms = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    const dns = /ENOTFOUND|getaddrinfo|EAI_AGAIN|não pôde ser resolvido|Name or service not known/i.test(
      msg
    );
    return {
      baseUrl: base,
      classification: dns ? "dns" : "down",
      ms,
      modelIds: [],
      message: dns ? `DNS: ${msg}` : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

function missingFrom(required: string[], ids: string[]): string[] {
  const have = new Set(ids);
  return required.filter((id) => id && !have.has(id));
}

function finish(
  partial: Omit<GatewayDoctorResult, "sampleModelIds"> & {
    sampleModelIds?: string[];
  },
  ids: string[]
): GatewayDoctorResult {
  const result: GatewayDoctorResult = {
    ...partial,
    sampleModelIds: partial.sampleModelIds ?? sampleNineRouterIds(ids),
  };
  if (result.ok && result.usedLocalFallback) {
    setRuntimeBaseUrlOverride(result.effectiveBaseUrl);
  } else if (result.ok) {
    setRuntimeBaseUrlOverride(null);
  }
  return result;
}

/**
 * Probe the configured gateway, then the local 9router when the configured
 * URL is a remote tunnel/DNS/connection failure.
 */
export async function diagnoseLlmGateway(
  opts?: DiagnoseLlmGatewayOpts
): Promise<GatewayDoctorResult> {
  // Probe the .env base, not a leftover localhost override from a previous run.
  setRuntimeBaseUrlOverride(null);
  const ep = resolveLlmEndpoint();
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const required = (opts?.requiredModelIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean);
  const configured = ep.baseUrl.replace(/\/$/, "");
  const hint = keyHintOf(ep.apiKey);
  const probes: GatewayProbe[] = [];

  const baseFields = {
    configuredBaseUrl: configured,
    keyHint: hint,
    sourceEnvKey: ep.sourceEnvKey,
    probes,
    usedLocalFallback: false,
  };

  if (!ep.configured) {
    return finish(
      {
        ...baseFields,
        ok: false,
        failureKind: "missing_env_credentials",
        classification: "unconfigured",
        effectiveBaseUrl: configured,
        missingModelIds: required,
        resumeHint: `Set ${ep.sourceEnvKey} and NINEROUTER_BASE=http://127.0.0.1:20128/v1 in the MCP package .env (copy the API key from the 9router UI, not from its SQLite file). Do not put secrets in ~/.cursor/mcp.json.`,
        message: `API key not configured (${ep.sourceEnvKey} empty, hint ${hint}).`,
      },
      []
    );
  }

  const primary = await probeModels(configured, ep, timeoutMs, fetchImpl);
  probes.push(primary);

  const applyModels = (
    probe: GatewayProbe,
    usedLocal: boolean
  ): GatewayDoctorResult | null => {
    if (probe.classification !== "ok") return null;
    const missing = missingFrom(required, probe.modelIds);
    if (missing.length > 0) {
      return finish(
        {
          ...baseFields,
          ok: false,
          failureKind: "invalid_model",
          classification: "missing_models",
          effectiveBaseUrl: probe.baseUrl,
          usedLocalFallback: usedLocal,
          missingModelIds: missing,
          sampleModelIds: sampleNineRouterIds(probe.modelIds),
          resumeHint: `Gateway at ${probe.baseUrl} is up but is missing: ${missing.join(", ")}. Create those combo ids in 9router (sample on gateway: ${sampleNineRouterIds(probe.modelIds).join(", ") || "none"}).`,
          message: `Missing models on ${probe.baseUrl}: ${missing.join(", ")}.`,
        },
        probe.modelIds
      );
    }
    const fallbackNote = usedLocal
      ? ` Configured base ${configured} is down; this run uses ${probe.baseUrl}. Update NINEROUTER_BASE in .env.`
      : "";
    return finish(
      {
        ...baseFields,
        ok: true,
        classification: "ok",
        effectiveBaseUrl: probe.baseUrl,
        usedLocalFallback: usedLocal,
        missingModelIds: [],
        resumeHint: usedLocal
          ? `Tunnel at ${configured} is dead. This run used ${LOCAL_NINEROUTER_BASE}. Set NINEROUTER_BASE=${LOCAL_NINEROUTER_BASE} in the MCP package .env.`
          : "",
        message: `${ep.gateway} ok at ${probe.baseUrl} (${probe.modelIds.length} models, key ${hint}).${fallbackNote}`,
      },
      probe.modelIds
    );
  };

  const primaryOk = applyModels(primary, false);
  if (primaryOk) return primaryOk;

  const remote = !isLoopbackBase(configured);
  const networkFail =
    primary.classification === "tunnel" ||
    primary.classification === "dns" ||
    primary.classification === "down";

  if (remote && networkFail && !sameBase(configured, LOCAL_NINEROUTER_BASE)) {
    const local = await probeModels(
      LOCAL_NINEROUTER_BASE,
      ep,
      timeoutMs,
      fetchImpl
    );
    probes.push(local);
    const localOk = applyModels(local, true);
    if (localOk?.ok) return localOk;
    if (local.classification === "auth") {
      return finish(
        {
          ...baseFields,
          ok: false,
          failureKind: "gateway_auth",
          classification: "auth",
          effectiveBaseUrl: LOCAL_NINEROUTER_BASE,
          missingModelIds: required,
          resumeHint: `9router is listening on ${LOCAL_NINEROUTER_BASE} but rejected the key (${ep.sourceEnvKey} ${hint}). Copy the API key from the 9router UI into NINEROUTER_KEY and set NINEROUTER_BASE=${LOCAL_NINEROUTER_BASE}. Do not use the key column from the 9router SQLite file. The configured tunnel ${configured} is down.`,
          message: `Local 9router HTTP ${local.status ?? "auth"} at ${LOCAL_NINEROUTER_BASE} (key ${hint}). Configured base ${configured} is ${primary.classification}.`,
        },
        []
      );
    }
    return finish(
      {
        ...baseFields,
        ok: false,
        failureKind: "gateway_down",
        classification: primary.classification,
        effectiveBaseUrl: configured,
        missingModelIds: required,
        resumeHint: `Open the 9router app (port 20128) or point NINEROUTER_BASE at an endpoint that answers GET /v1/models. Configured ${configured} is ${primary.classification} (${primary.message}). Local probe: ${local.classification} (${local.message}).`,
        message: `Gateway down — túnel/local 9router unreachable (${primary.message}; local ${local.message}).`,
      },
      []
    );
  }

  if (primary.classification === "auth") {
    return finish(
      {
        ...baseFields,
        ok: false,
        failureKind: "gateway_auth",
        classification: "auth",
        effectiveBaseUrl: configured,
        missingModelIds: required,
        resumeHint: `9router at ${configured} rejected the key (${ep.sourceEnvKey} ${hint}). Copy the API key from the 9router UI into NINEROUTER_KEY and set NINEROUTER_BASE=${LOCAL_NINEROUTER_BASE} when using the local app. Do not use the key column from the 9router SQLite file.`,
        message: `Gateway auth failed HTTP ${primary.status ?? 401} at ${configured} (key ${hint}).`,
      },
      []
    );
  }

  return finish(
    {
      ...baseFields,
      ok: false,
      failureKind: "gateway_down",
      classification: primary.classification,
      effectiveBaseUrl: configured,
      missingModelIds: required,
      resumeHint: `Open the 9router app (port 20128) or point NINEROUTER_BASE at an endpoint that answers GET /v1/models. Probe of ${configured}: ${primary.message}.`,
      message: `Gateway down — túnel/local 9router unreachable (${primary.message}).`,
    },
    []
  );
}
