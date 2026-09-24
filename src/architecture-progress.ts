/**
 * Architecture Progress Pack — observability for docs/architecture phase.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getMetrics } from "./metrics.js";
import { updatePipelineStage } from "./pipeline-state.js";

export const ARCHITECTURE_PROGRESS_PATH = ".docs/architecture-progress.json";
export const MAX_ARCH_EVENTS = 40;

export type ArchitecturePhase =
  | "requirements"
  | "fidelity"
  | "technology"
  | "specs"
  | "done";

export type ArchitectureProgress = {
  version: 1;
  traceId?: string;
  phase: ArchitecturePhase;
  preReqs: {
    total: number;
    completed: number;
    current: string;
    titles: string[];
  };
  fidelity: { ok: boolean; warnings: string[] };
  technology: { summary: string; headingsPresent: string[] };
  specs: { count: number; slugs: string[] };
  events: Array<{ at: string; stage: string; message: string }>;
  updatedAt: string;
};

export type ArchEmit = (stage: string, message: string) => void;

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

export function emptyArchitectureProgress(
  partial?: Partial<ArchitectureProgress>
): ArchitectureProgress {
  return {
    version: 1,
    traceId: partial?.traceId ?? getMetrics().traceId,
    phase: partial?.phase ?? "requirements",
    preReqs: partial?.preReqs ?? {
      total: 0,
      completed: 0,
      current: "",
      titles: [],
    },
    fidelity: partial?.fidelity ?? { ok: true, warnings: [] },
    technology: partial?.technology ?? { summary: "", headingsPresent: [] },
    specs: partial?.specs ?? { count: 0, slugs: [] },
    events: partial?.events ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export async function readArchitectureProgress(
  appRoot: string
): Promise<ArchitectureProgress | null> {
  const abs = join(appRoot, ARCHITECTURE_PROGRESS_PATH);
  if (!(await pathExists(abs))) return null;
  try {
    return JSON.parse(await readFile(abs, "utf8")) as ArchitectureProgress;
  } catch {
    return null;
  }
}

export async function writeArchitectureProgress(
  appRoot: string,
  state: ArchitectureProgress
): Promise<void> {
  const abs = join(appRoot, ARCHITECTURE_PROGRESS_PATH);
  await mkdir(dirname(abs), { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() };
  await writeFile(abs, JSON.stringify(next, null, 2) + "\n", "utf8");
}

function pushEvent(
  state: ArchitectureProgress,
  stage: string,
  message: string
): ArchitectureProgress {
  const events = [
    ...state.events,
    { at: new Date().toISOString(), stage, message },
  ];
  while (events.length > MAX_ARCH_EVENTS) events.shift();
  return { ...state, events };
}

export type ArchitectureProgressPatch = {
  version?: 1;
  traceId?: string;
  phase?: ArchitecturePhase;
  preReqs?: Partial<ArchitectureProgress["preReqs"]>;
  fidelity?: Partial<ArchitectureProgress["fidelity"]>;
  technology?: Partial<ArchitectureProgress["technology"]>;
  specs?: Partial<ArchitectureProgress["specs"]>;
  events?: ArchitectureProgress["events"];
  updatedAt?: string;
};

function mergePatch(
  prev: ArchitectureProgress,
  patch?: ArchitectureProgressPatch
): ArchitectureProgress {
  if (!patch) return prev;
  const nextPre = patch.preReqs
    ? {
        ...prev.preReqs,
        ...patch.preReqs,
        titles:
          patch.preReqs.titles && patch.preReqs.titles.length > 0
            ? patch.preReqs.titles
            : prev.preReqs.titles,
      }
    : prev.preReqs;
  return {
    ...prev,
    ...patch,
    version: 1,
    phase: patch.phase ?? prev.phase,
    traceId: patch.traceId ?? prev.traceId ?? getMetrics().traceId,
    preReqs: nextPre,
    fidelity: { ...prev.fidelity, ...(patch.fidelity || {}) },
    technology: { ...prev.technology, ...(patch.technology || {}) },
    specs: { ...prev.specs, ...(patch.specs || {}) },
    events: patch.events ?? prev.events,
    updatedAt: new Date().toISOString(),
  };
}

/** Merge phase/fields into architecture-progress.json (no MCP emit). */
export async function setArchitecturePhase(
  appRoot: string,
  phase: ArchitecturePhase,
  patch?: ArchitectureProgressPatch
): Promise<ArchitectureProgress> {
  const prev =
    (await readArchitectureProgress(appRoot)) || emptyArchitectureProgress();
  const next = mergePatch(prev, { ...patch, phase });
  await writeArchitectureProgress(appRoot, next);
  try {
    await updatePipelineStage(appRoot, {
      stage: `architecture:${phase}`,
      workflow: undefined,
    });
  } catch {
    /* best-effort */
  }
  return next;
}

/**
 * Human-facing architecture notify: emit + persist event + optional patch.
 */
export async function archNotify(
  emit: ArchEmit,
  appRoot: string,
  stage: string,
  message: string,
  patch?: ArchitectureProgressPatch
): Promise<ArchitectureProgress> {
  const prefixed = message.startsWith("Architecture:")
    ? message
    : `Architecture: ${message}`;
  emit(stage, prefixed);

  const prev =
    (await readArchitectureProgress(appRoot)) || emptyArchitectureProgress();
  let next = mergePatch(prev, patch);
  next = pushEvent(next, stage, prefixed);
  if (patch?.phase) next.phase = patch.phase;
  await writeArchitectureProgress(appRoot, next);
  try {
    await updatePipelineStage(appRoot, {
      stage,
      workflow: undefined,
    });
  } catch {
    /* best-effort */
  }
  return next;
}

/** First ## heading title (e.g. "## 1. Foo" → "1. Foo"). */
export function extractSectionTitle(markdown: string): string {
  const m = (markdown || "").match(/^##\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

/** Tech summary truncated + H2 headings present in body. */
export function summarizeTech(
  summary: string,
  techBody: string
): { summary: string; headingsPresent: string[] } {
  const s = (summary || "").replace(/\s+/g, " ").trim();
  const truncated = s.length > 200 ? `${s.slice(0, 197)}…` : s;
  const headings: string[] = [];
  const re = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(techBody || "")) !== null) {
    headings.push(match[1].trim());
  }
  return { summary: truncated, headingsPresent: headings };
}

/** Slugs from todo checklist lines `- [ ] slug: Title`. */
export function listSpecSlugsFromTodo(todoMd: string): string[] {
  const slugs: string[] = [];
  const re = /^-\s*\[[ xX]\]\s*([a-z0-9][a-z0-9_-]*)\s*:/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(todoMd || "")) !== null) {
    slugs.push(match[1]);
  }
  return slugs;
}

export function formatSlugList(slugs: string[], max = 12): string {
  if (slugs.length === 0) return "(none)";
  const shown = slugs.slice(0, max);
  const more = slugs.length > max ? ` (+${slugs.length - max})` : "";
  return `${shown.join(", ")}${more}`;
}

/** Compact snapshot for pipeline-result.json. */
export function architectureSnapshot(
  state: ArchitectureProgress | null
): Record<string, unknown> | null {
  if (!state) return null;
  return {
    phase: state.phase,
    preReqTotal: state.preReqs.total,
    preReqCompleted: state.preReqs.completed,
    fidelityOk: state.fidelity.ok,
    fidelityWarnings: state.fidelity.warnings,
    techSummary: state.technology.summary,
    specCount: state.specs.count,
    specSlugs: state.specs.slugs.slice(0, 20),
  };
}
