/**
 * Human-in-the-loop pause / approve gates (Fase F / ADR).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PipelineState } from "./pipeline-state.js";
import { readPipelineState, writePipelineState } from "./pipeline-state.js";

export type HitlDecision = "resume" | "abort" | "redirect";

export type HitlPausePackage = {
  pausedAt: string;
  reason: string;
  stage: string;
  appRoot: string;
  traceId?: string;
  errorClass?: string | null;
  pendingSpecs: string[];
  diagnosticPath: string;
};

const DIAG_PATH = ".docs/hitl-pause.json";

export async function pausePipelineForHuman(
  appRoot: string,
  reason: string,
  opts?: { webhookUrl?: string; notify?: (msg: string) => void }
): Promise<HitlPausePackage> {
  const state = await readPipelineState(appRoot);
  const pack: HitlPausePackage = {
    pausedAt: new Date().toISOString(),
    reason,
    stage: state?.stage || "unknown",
    appRoot,
    traceId: state?.traceId,
    errorClass: state?.errorClass,
    pendingSpecs: state?.pendingSpecs ?? [],
    diagnosticPath: DIAG_PATH,
  };

  const abs = join(appRoot, DIAG_PATH);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(pack, null, 2) + "\n", "utf8");

  if (state) {
    const next: PipelineState = {
      ...state,
      gates: {
        ...state.gates,
        paused: true,
        pauseReason: reason,
      },
      updatedAt: new Date().toISOString(),
    };
    await writePipelineState(appRoot, next);
  }

  opts?.notify?.(`pipeline pausado — aguardando decisão: ${reason}`);

  const webhook =
    opts?.webhookUrl || process.env.ZTEAM_HITL_WEBHOOK?.trim() || "";
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pack),
      });
    } catch {
      /* best-effort */
    }
  }

  return pack;
}

export async function applyHitlDecision(
  appRoot: string,
  decision: HitlDecision,
  redirectHint?: string
): Promise<{ ok: boolean; message: string }> {
  const state = await readPipelineState(appRoot);
  if (!state) {
    return { ok: false, message: "no pipeline-state.json" };
  }
  if (decision === "abort") {
    await writePipelineState(appRoot, {
      ...state,
      gates: { ...state.gates, paused: false, pauseReason: "aborted" },
      errorClass: "hitl_abort",
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, message: "aborted by human" };
  }
  if (decision === "redirect") {
    await writePipelineState(appRoot, {
      ...state,
      gates: {
        ...state.gates,
        paused: false,
        pauseReason: redirectHint || "redirect",
      },
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      message: `redirect: ${redirectHint || "see pauseReason"}`,
    };
  }
  await writePipelineState(appRoot, {
    ...state,
    gates: { ...state.gates, paused: false, pauseReason: undefined },
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, message: "resumed" };
}

export function hitlEnabled(): boolean {
  return process.env.ZTEAM_HITL === "1";
}
