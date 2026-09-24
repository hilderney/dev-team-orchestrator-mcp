/**
 * Implementation Progress Pack — observability for scaffold / SE / QA phase.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getMetrics } from "./metrics.js";
import { updatePipelineStage } from "./pipeline-state.js";
import { formatSlugList } from "./architecture-progress.js";

export const IMPLEMENTATION_PROGRESS_PATH =
  ".docs/implementation-progress.json";
export const MAX_IMPL_EVENTS = 40;

export type ImplementationPhase =
  | "scaffold"
  | "implement"
  | "qa"
  | "fix"
  | "bootstrap"
  | "done";

export type ImplementationProgress = {
  version: 1;
  traceId?: string;
  phase: ImplementationPhase;
  specs: {
    total: number;
    completed: number;
    current: string;
    batch: string[];
    pending: string[];
  };
  qa: {
    current: string;
    passed: string[];
    failed: string[];
    lastErrorClass: string | null;
    fixRound: number;
    bootstrapRound: number;
  };
  lastWrite: { count: number; files: string[] };
  scaffold: { applied: boolean; files: string[] };
  events: Array<{ at: string; stage: string; message: string }>;
  updatedAt: string;
};

export type ImplEmit = (stage: string, message: string) => void;

export type ImplementationProgressPatch = {
  version?: 1;
  traceId?: string;
  phase?: ImplementationPhase;
  specs?: Partial<ImplementationProgress["specs"]>;
  qa?: Partial<ImplementationProgress["qa"]>;
  lastWrite?: Partial<ImplementationProgress["lastWrite"]>;
  scaffold?: Partial<ImplementationProgress["scaffold"]>;
  events?: ImplementationProgress["events"];
  updatedAt?: string;
};

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

export function emptyImplementationProgress(
  partial?: Partial<ImplementationProgress>
): ImplementationProgress {
  return {
    version: 1,
    traceId: partial?.traceId ?? getMetrics().traceId,
    phase: partial?.phase ?? "scaffold",
    specs: partial?.specs ?? {
      total: 0,
      completed: 0,
      current: "",
      batch: [],
      pending: [],
    },
    qa: partial?.qa ?? {
      current: "",
      passed: [],
      failed: [],
      lastErrorClass: null,
      fixRound: 0,
      bootstrapRound: 0,
    },
    lastWrite: partial?.lastWrite ?? { count: 0, files: [] },
    scaffold: partial?.scaffold ?? { applied: false, files: [] },
    events: partial?.events ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export async function readImplementationProgress(
  appRoot: string
): Promise<ImplementationProgress | null> {
  const abs = join(appRoot, IMPLEMENTATION_PROGRESS_PATH);
  if (!(await pathExists(abs))) return null;
  try {
    return JSON.parse(await readFile(abs, "utf8")) as ImplementationProgress;
  } catch {
    return null;
  }
}

export async function writeImplementationProgress(
  appRoot: string,
  state: ImplementationProgress
): Promise<void> {
  const abs = join(appRoot, IMPLEMENTATION_PROGRESS_PATH);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(
    abs,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) +
      "\n",
    "utf8"
  );
}

function pushEvent(
  state: ImplementationProgress,
  stage: string,
  message: string
): ImplementationProgress {
  const events = [
    ...state.events,
    { at: new Date().toISOString(), stage, message },
  ];
  while (events.length > MAX_IMPL_EVENTS) events.shift();
  return { ...state, events };
}

function mergePatch(
  prev: ImplementationProgress,
  patch?: ImplementationProgressPatch
): ImplementationProgress {
  if (!patch) return prev;
  const nextSpecs = patch.specs
    ? {
        ...prev.specs,
        ...patch.specs,
        batch:
          patch.specs.batch && patch.specs.batch.length > 0
            ? patch.specs.batch
            : patch.specs.batch === undefined
              ? prev.specs.batch
              : patch.specs.batch,
        pending:
          patch.specs.pending !== undefined
            ? patch.specs.pending
            : prev.specs.pending,
      }
    : prev.specs;
  const nextQa = patch.qa
    ? {
        ...prev.qa,
        ...patch.qa,
        passed:
          patch.qa.passed !== undefined ? patch.qa.passed : prev.qa.passed,
        failed:
          patch.qa.failed !== undefined ? patch.qa.failed : prev.qa.failed,
      }
    : prev.qa;
  return {
    ...prev,
    ...patch,
    version: 1,
    phase: patch.phase ?? prev.phase,
    traceId: patch.traceId ?? prev.traceId ?? getMetrics().traceId,
    specs: nextSpecs,
    qa: nextQa,
    lastWrite: { ...prev.lastWrite, ...(patch.lastWrite || {}) },
    scaffold: { ...prev.scaffold, ...(patch.scaffold || {}) },
    events: patch.events ?? prev.events,
    updatedAt: new Date().toISOString(),
  };
}

export async function setImplementationPhase(
  appRoot: string,
  phase: ImplementationPhase,
  patch?: ImplementationProgressPatch
): Promise<ImplementationProgress> {
  const prev =
    (await readImplementationProgress(appRoot)) ||
    emptyImplementationProgress();
  const next = mergePatch(prev, { ...patch, phase });
  await writeImplementationProgress(appRoot, next);
  try {
    await updatePipelineStage(appRoot, {
      stage: `implementation:${phase}`,
      workflow: undefined,
    });
  } catch {
    /* best-effort */
  }
  return next;
}

export async function implNotify(
  emit: ImplEmit,
  appRoot: string,
  stage: string,
  message: string,
  patch?: ImplementationProgressPatch
): Promise<ImplementationProgress> {
  const prefixed = message.startsWith("Implementation:")
    ? message
    : `Implementation: ${message}`;
  emit(stage, prefixed);

  const prev =
    (await readImplementationProgress(appRoot)) ||
    emptyImplementationProgress();
  let next = mergePatch(prev, patch);
  next = pushEvent(next, stage, prefixed);
  if (patch?.phase) next.phase = patch.phase;
  await writeImplementationProgress(appRoot, next);
  try {
    await updatePipelineStage(appRoot, { stage, workflow: undefined });
  } catch {
    /* best-effort */
  }
  return next;
}

export function formatFileList(files: string[], max = 8): string {
  if (files.length === 0) return "(none)";
  const shown = files.slice(0, max);
  const more = files.length > max ? ` (+${files.length - max})` : "";
  return `${shown.join(", ")}${more}`;
}

export { formatSlugList };

export function implementationSnapshot(
  state: ImplementationProgress | null
): Record<string, unknown> | null {
  if (!state) return null;
  return {
    phase: state.phase,
    specTotal: state.specs.total,
    specCompleted: state.specs.completed,
    currentSpec: state.specs.current,
    qaPassed: state.qa.passed.length,
    qaFailed: state.qa.failed,
    lastErrorClass: state.qa.lastErrorClass,
    fixRound: state.qa.fixRound,
    bootstrapRound: state.qa.bootstrapRound,
    lastWriteCount: state.lastWrite.count,
    scaffoldApplied: state.scaffold.applied,
  };
}
