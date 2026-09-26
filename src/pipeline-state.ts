/**
 * Disk-based pipeline state / FSM checkpoint (Fase E).
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const PIPELINE_STATE_PATH = ".docs/pipeline-state.json";

export type PipelineState = {
  version: 1;
  workflow: string;
  appRoot: string;
  stage: string;
  pendingSpecs: string[];
  completedSpecs: string[];
  pendingQaSpecs: string[];
  filesWritten: string[];
  traceId?: string;
  errorClass?: string | null;
  gates: {
    approveReq: "pending" | "auto" | "approved" | "rejected";
    approveTech: "pending" | "auto" | "approved" | "rejected";
    paused?: boolean;
    pauseReason?: string;
  };
  budgets: {
    bootstrapFixRounds: number;
    featureFixRounds: number;
    maxBootstrapFix: number;
    maxFeatureFix: number;
  };
  updatedAt: string;
};

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

export function defaultPipelineState(
  partial: Partial<PipelineState> & { appRoot: string; workflow: string }
): PipelineState {
  return {
    version: 1,
    workflow: partial.workflow,
    appRoot: partial.appRoot,
    stage: partial.stage || "start",
    pendingSpecs: partial.pendingSpecs ?? [],
    completedSpecs: partial.completedSpecs ?? [],
    pendingQaSpecs: partial.pendingQaSpecs ?? [],
    filesWritten: partial.filesWritten ?? [],
    traceId: partial.traceId,
    errorClass: partial.errorClass ?? null,
    gates: partial.gates ?? {
      approveReq: "auto",
      approveTech: "auto",
      paused: false,
    },
    budgets: partial.budgets ?? {
      bootstrapFixRounds: 0,
      featureFixRounds: 0,
      maxBootstrapFix: 1,
      maxFeatureFix: Number.parseInt(process.env.MAX_QA_FIX_ROUNDS ?? "3", 10) || 3,
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function writePipelineState(
  appRoot: string,
  state: PipelineState
): Promise<void> {
  const abs = join(appRoot, PIPELINE_STATE_PATH);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(
    abs,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) +
      "\n",
    "utf8"
  );
}

export async function readPipelineState(
  appRoot: string
): Promise<PipelineState | null> {
  const abs = join(appRoot, PIPELINE_STATE_PATH);
  if (!(await pathExists(abs))) return null;
  try {
    return JSON.parse(await readFile(abs, "utf8")) as PipelineState;
  } catch {
    return null;
  }
}

export async function updatePipelineStage(
  appRoot: string,
  patch: Partial<PipelineState> & { stage: string; workflow?: string }
): Promise<PipelineState> {
  const prev =
    (await readPipelineState(appRoot)) ||
    defaultPipelineState({
      appRoot,
      workflow: patch.workflow || "full",
      stage: patch.stage,
    });
  const next: PipelineState = {
    ...prev,
    ...patch,
    appRoot,
    gates: { ...prev.gates, ...(patch.gates || {}) },
    budgets: { ...prev.budgets, ...(patch.budgets || {}) },
    updatedAt: new Date().toISOString(),
  };
  await writePipelineState(appRoot, next);
  return next;
}

/** Stage wall-clock budget (ms). */
export function stageBudgetMs(stage: string): number {
  const env = process.env[`ZTEAM_BUDGET_${stage.toUpperCase()}_MS`];
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const defaults: Record<string, number> = {
    softwareEngineer: 10 * 60_000,
    softwareEngineerFix: 5 * 60_000,
    qaEngineer: 5 * 60_000,
    systemArchitectTodoPlan: 8 * 60_000,
    systemArchitectSpecItem: 6 * 60_000,
    uiUxSpecEnrich: 5 * 60_000,
    technologyArchitectSpecEnrich: 6 * 60_000,
    systemArchitectSpecs: 8 * 60_000,
  };
  return defaults[stage] ?? 15 * 60_000;
}

export class CircuitBreakerError extends Error {
  readonly name = "CircuitBreakerError";
  constructor(
    public readonly stage: string,
    public readonly reason: string
  ) {
    super(`[${stage}] circuit breaker: ${reason}`);
  }
}
