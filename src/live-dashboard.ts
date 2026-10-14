/**
 * zTeam Live Canvas Dashboard (9Router-style observability).
 *
 * Works with ZERO server (direct `file://` open in browser) by writing
 * `.docs/zteam-live.js` (`window.__ZTEAM_LIVE__ = {...}`) and `.docs/zteam-live.json`,
 * while `.zteam/dashboard/index.html` polls `.docs/zteam-live.js` every ~1s via dynamic <script> tag
 * and animates Bézier particle pulses between the Orchestrator hub and each subagent/node.
 *
 * Also auto-scans `.docs/todo.md`, `.docs/specs/*.spec.md`, `src/**`, and `tests/**`
 * on every emit so KPI cards (Specs Progress, Files Touched, Chars In/Out, Pipeline Status)
 * stay 100% accurate even when subagents write files directly on disk.
 */
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const LIVE_FEED_JSON_PATH = ".docs/zteam-live.json";
export const LIVE_FEED_JS_PATH = ".docs/zteam-live.js";
export const DASHBOARD_HTML_REL_PATH = ".zteam/dashboard/index.html";
export const MAX_LIVE_EVENTS = 80;

export type LiveNodeId =
  | "orchestrator"
  | "systemArchitect"
  | "uiUxDesigner"
  | "technologyArchitect"
  | "qaTddRed"
  | "softwareEngineer"
  | "qaVerify"
  | "critics";

export type LiveNodeStatus = "idle" | "active" | "done" | "error" | "warn";

export type LivePulseEvent = {
  id: string;
  seq: number;
  at: string;
  from: LiveNodeId;
  to: LiveNodeId;
  stage: string;
  role?: string;
  model?: string;
  skillKey?: string;
  status: "start" | "done" | "error" | "warn" | "consult" | "info";
  message: string;
  charsIn?: number;
  charsOut?: number;
  filesCount?: number;
};

export type LiveDashboardState = {
  version: 1;
  projectTitle: string;
  appRoot: string;
  workflow: string;
  projectType: string;
  activeStage: string;
  activeNode: LiveNodeId;
  pipelineStatus?: "idle" | "running" | "completed" | "error";
  seq: number;
  kpis: {
    totalEvents: number;
    specsDone: number;
    specsTotal: number;
    charsIn: number;
    charsOut: number;
    filesWritten: number;
    retriesAndFixes: number;
  };
  nodes: Record<
    LiveNodeId,
    {
      id: LiveNodeId;
      label: string;
      sublabel: string;
      status: LiveNodeStatus;
      model: string;
      calls: number;
      lastStage: string;
      lastMessage: string;
      updatedAt: string;
    }
  >;
  events: LivePulseEvent[];
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

/**
 * Scan disk artefacts under `appRoot` so KPI numbers never drift when Cursor Task subagents
 * write `.docs/todo.md`, `.docs/specs/*.spec.md`, `src/**`, or `tests/**` directly.
 */
export async function scanAppDiskMetrics(appRoot: string): Promise<{
  specsDone: number;
  specsTotal: number;
  filesCount: number;
  artefactChars: number;
}> {
  const root = resolve(appRoot);
  let specsDone = 0;
  let specsTotal = 0;
  let filesCount = 0;
  let artefactChars = 0;

  // 1. Parse .docs/todo.md checkboxes
  const todoPath = join(root, ".docs", "todo.md");
  if (await pathExists(todoPath)) {
    try {
      const todoRaw = await readFile(todoPath, "utf8");
      artefactChars += todoRaw.length;
      const lines = todoRaw.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*-\s*\[([ xX])\]\s+([a-z0-9-_]+)\b/i);
        if (m) {
          specsTotal++;
          if (m[1].toLowerCase() === "x") specsDone++;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 2. Count .docs/specs/*.spec.md
  const specsDir = join(root, ".docs", "specs");
  let specFilesCount = 0;
  if (await pathExists(specsDir)) {
    try {
      const entries = await readdir(specsDir);
      for (const name of entries) {
        if (name.endsWith(".spec.md")) {
          specFilesCount++;
          filesCount++;
          try {
            const st = await stat(join(specsDir, name));
            artefactChars += st.size;
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (specsTotal === 0 && specFilesCount > 0) {
    specsTotal = specFilesCount;
  }

  // 3. Count core .docs markdown files
  for (const docName of [
    "requirements.md",
    "technologies.md",
    "ui-ux.md",
    "todo.md",
    "user-report.md",
  ]) {
    const p = join(root, ".docs", docName);
    if (await pathExists(p)) {
      filesCount++;
      if (docName !== "todo.md") {
        try {
          const st = await stat(p);
          artefactChars += st.size;
        } catch {
          /* ignore */
        }
      }
    }
  }

  // 4. Count files in src/ and tests/
  async function walkDir(dir: string, depth = 0): Promise<void> {
    if (depth > 4 || !(await pathExists(dir))) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (
          e.name === "node_modules" ||
          e.name === ".git" ||
          e.name === "dist" ||
          e.name === ".zteam" ||
          e.name === ".docs"
        ) {
          continue;
        }
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walkDir(full, depth + 1);
        } else if (/\.(ts|tsx|js|jsx|mjs|css|html|json)$/i.test(e.name)) {
          filesCount++;
          try {
            const st = await stat(full);
            artefactChars += st.size;
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  await walkDir(join(root, "src"));
  await walkDir(join(root, "tests"));
  await walkDir(join(root, "test"));

  return { specsDone, specsTotal, filesCount, artefactChars };
}

export function stageToLiveNodeId(stage: string, role?: string): LiveNodeId {
  const s = (stage || "").trim();
  const r = (role || "").trim();
  if (/^(pipeline|done|complete|finished|finalize)$/i.test(s)) {
    return "orchestrator";
  }
  if (/qaTddRed|qa-tdd-red|tdd-red/i.test(s)) return "qaTddRed";
  if (/qaEngineer|qa-tdd-verify|tdd-verify/i.test(s)) return "qaVerify";
  if (
    /fidelityCritic|fidelity-critic|deliveryCritic|archCritic|architecture-critic|delivery-critic|scaffold|bootstrapFix/i.test(
      s
    )
  ) {
    return "critics";
  }
  if (/uiUx|ux-/i.test(s) || r === "uiUxDesigner") return "uiUxDesigner";
  if (/technologyArchitect|ta-/i.test(s) || r === "technologyArchitect") {
    return "technologyArchitect";
  }
  if (/softwareEngineer|se-/i.test(s) || r === "softwareEngineer") {
    return "softwareEngineer";
  }
  if (
    /systemArchitect|sa-|bootstrapReadme|cleanReadme/i.test(s) ||
    r === "systemArchitect"
  ) {
    return "systemArchitect";
  }
  if (r === "qaEngineer") return "qaVerify";
  return "orchestrator";
}

function defaultNodes(): LiveDashboardState["nodes"] {
  const now = new Date().toISOString();
  return {
    orchestrator: {
      id: "orchestrator",
      label: "zTeam Orchestrator",
      sublabel: "LangGraph / MCP Hub",
      status: "idle",
      model: "router",
      calls: 0,
      lastStage: "idle",
      lastMessage: "Ready",
      updatedAt: now,
    },
    systemArchitect: {
      id: "systemArchitect",
      label: "System Architect",
      sublabel: "Reqs · Todo · Specs · Report",
      status: "idle",
      model: "SA",
      calls: 0,
      lastStage: "",
      lastMessage: "",
      updatedAt: now,
    },
    uiUxDesigner: {
      id: "uiUxDesigner",
      label: "UI/UX Designer",
      sublabel: "Juice ≥7 · UI-UX · Flow & States",
      status: "idle",
      model: "UX",
      calls: 0,
      lastStage: "",
      lastMessage: "",
      updatedAt: now,
    },
    technologyArchitect: {
      id: "technologyArchitect",
      label: "Tech Architect",
      sublabel: "9-Layer Stack · Spec Tech",
      status: "idle",
      model: "TA",
      calls: 0,
      lastStage: "",
      lastMessage: "",
      updatedAt: now,
    },
    qaTddRed: {
      id: "qaTddRed",
      label: "QA TDD Red",
      sublabel: "Failing Tests First",
      status: "idle",
      model: "QA",
      calls: 0,
      lastStage: "",
      lastMessage: "",
      updatedAt: now,
    },
    softwareEngineer: {
      id: "softwareEngineer",
      label: "Software Engineer",
      sublabel: "TDD Green · Clean Code · Fix",
      status: "idle",
      model: "SE",
      calls: 0,
      lastStage: "",
      lastMessage: "",
      updatedAt: now,
    },
    qaVerify: {
      id: "qaVerify",
      label: "QA TDD Verify",
      sublabel: "Suite · Gaps · Mark [x]",
      status: "idle",
      model: "QA",
      calls: 0,
      lastStage: "",
      lastMessage: "",
      updatedAt: now,
    },
    critics: {
      id: "critics",
      label: "Critics & Gates",
      sublabel: "Fidelity · Arch · Delivery · Scaffold",
      status: "idle",
      model: "deterministic",
      calls: 0,
      lastStage: "",
      lastMessage: "",
      updatedAt: now,
    },
  };
}

export function emptyLiveDashboardState(
  appRoot: string,
  partial?: Partial<LiveDashboardState>
): LiveDashboardState {
  const now = new Date().toISOString();
  const folderName =
    resolve(appRoot)
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || "project";
  return {
    version: 1,
    projectTitle: partial?.projectTitle || folderName,
    appRoot: resolve(appRoot),
    workflow: partial?.workflow || "full",
    projectType: partial?.projectType || "core",
    activeStage: partial?.activeStage || "idle",
    activeNode: partial?.activeNode || "orchestrator",
    pipelineStatus: partial?.pipelineStatus || "idle",
    seq: partial?.seq ?? 0,
    kpis: partial?.kpis ?? {
      totalEvents: 0,
      specsDone: 0,
      specsTotal: 0,
      charsIn: 0,
      charsOut: 0,
      filesWritten: 0,
      retriesAndFixes: 0,
    },
    nodes: partial?.nodes ?? defaultNodes(),
    events: partial?.events ?? [],
    updatedAt: now,
  };
}

export async function readLiveDashboardState(
  appRoot: string
): Promise<LiveDashboardState | null> {
  const abs = join(resolve(appRoot), LIVE_FEED_JSON_PATH);
  if (!(await pathExists(abs))) return null;
  try {
    return JSON.parse(await readFile(abs, "utf8")) as LiveDashboardState;
  } catch {
    return null;
  }
}

export async function writeLiveDashboardState(
  appRoot: string,
  state: LiveDashboardState
): Promise<void> {
  const root = resolve(appRoot);
  const jsonAbs = join(root, LIVE_FEED_JSON_PATH);
  const jsAbs = join(root, LIVE_FEED_JS_PATH);
  await mkdir(dirname(jsonAbs), { recursive: true });
  const next: LiveDashboardState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  const jsonText = JSON.stringify(next, null, 2) + "\n";
  const jsText = `// Auto-generated by zTeam Orchestrator — polled by .zteam/dashboard/index.html\nwindow.__ZTEAM_LIVE__ = ${JSON.stringify(next)};\n`;
  await Promise.all([
    writeFile(jsonAbs, jsonText, "utf8"),
    writeFile(jsAbs, jsText, "utf8"),
  ]);
}

export type EmitLiveEventInput = {
  appRoot: string;
  stage: string;
  message: string;
  status?: LivePulseEvent["status"];
  role?: string;
  model?: string;
  skillKey?: string;
  from?: LiveNodeId;
  to?: LiveNodeId;
  workflow?: string;
  projectType?: string;
  charsIn?: number;
  charsOut?: number;
  filesCount?: number;
  specsDone?: number;
  specsTotal?: number;
};

/**
 * Append a live event + update node state & KPIs in `.docs/zteam-live.{json,js}`.
 * Auto-reconciles orphan `start` events when switching stages and scans disk for real
 * specs/files counts so KPIs never stay stuck at `0 / 0`.
 */
export async function emitLiveEvent(
  input: EmitLiveEventInput
): Promise<LiveDashboardState | null> {
  if (!input.appRoot) return null;
  try {
    const prev =
      (await readLiveDashboardState(input.appRoot)) ||
      emptyLiveDashboardState(input.appRoot, {
        workflow: input.workflow,
        projectType: input.projectType,
      });

    const disk = await scanAppDiskMetrics(input.appRoot);
    let seq = prev.seq || 0;
    const now = new Date().toISOString();
    const targetNode = stageToLiveNodeId(input.stage, input.role);
    const status = input.status || "info";
    const isPipelineTerminal =
      (/^(pipeline|done|complete|finished|finalize)$/i.test(input.stage) &&
        (status === "done" || status === "error")) ||
      (input.stage === "qa-tdd-verify" && status === "done");

    const syntheticEvents: LivePulseEvent[] = [];
    const nodes = { ...defaultNodes(), ...(prev.nodes || {}) };

    // Auto-close any previously active stage that never received an explicit `done`
    if (
      (status === "start" || isPipelineTerminal) &&
      prev.activeStage &&
      prev.activeStage !== "idle" &&
      prev.activeStage !== "done" &&
      prev.activeStage !== input.stage
    ) {
      const prevNodeId = prev.activeNode || stageToLiveNodeId(prev.activeStage);
      if (
        prevNodeId !== "orchestrator" &&
        nodes[prevNodeId]?.status === "active"
      ) {
        nodes[prevNodeId] = {
          ...nodes[prevNodeId],
          status: "done",
          updatedAt: now,
        };
        // Check if the last event for prev.activeStage was a "start" without a matching "done"
        const prevStageEvents = (prev.events || []).filter(
          (e) => e.stage === prev.activeStage
        );
        if (prevStageEvents[0]?.status === "start") {
          seq += 1;
          syntheticEvents.push({
            id: `ev-${seq}`,
            seq,
            at: now,
            from: prevNodeId,
            to: "orchestrator",
            stage: prev.activeStage,
            role: prevStageEvents[0].role,
            skillKey: prevStageEvents[0].skillKey,
            status: "done",
            message: `Completed ${prev.activeStage}`,
          });
        }
      }
    }

    seq += 1;
    const from: LiveNodeId =
      input.from ||
      (status === "done" || status === "error" ? targetNode : "orchestrator");
    const to: LiveNodeId =
      input.to ||
      (status === "done" || status === "error" ? "orchestrator" : targetNode);

    const ev: LivePulseEvent = {
      id: `ev-${seq}`,
      seq,
      at: now,
      from,
      to,
      stage: input.stage,
      role: input.role,
      model: input.model,
      skillKey: input.skillKey,
      status,
      message: input.message.slice(0, 260),
      charsIn: input.charsIn,
      charsOut: input.charsOut,
      filesCount: input.filesCount,
    };

    const nodeEntry = { ...(nodes[targetNode] || defaultNodes()[targetNode]) };
    nodeEntry.lastStage = input.stage;
    nodeEntry.lastMessage = input.message.slice(0, 140);
    nodeEntry.updatedAt = now;
    if (input.model) nodeEntry.model = input.model;
    if (status === "start") {
      nodeEntry.status = "active";
      nodeEntry.calls = (nodeEntry.calls || 0) + 1;
    } else if (status === "done") {
      nodeEntry.status = "done";
    } else if (status === "error") {
      nodeEntry.status = "error";
    } else if (status === "warn") {
      nodeEntry.status = "warn";
    } else if (nodeEntry.status === "idle") {
      nodeEntry.status = "active";
      nodeEntry.calls = (nodeEntry.calls || 0) + 1;
    }

    // Mark previously active sibling nodes as done when switching active stage
    if (status === "start" || status === "info" || isPipelineTerminal) {
      for (const k of Object.keys(nodes) as LiveNodeId[]) {
        if (
          k !== targetNode &&
          k !== "orchestrator" &&
          nodes[k].status === "active"
        ) {
          nodes[k] = { ...nodes[k], status: "done" };
        }
      }
    }
    nodes[targetNode] = nodeEntry;
    nodes.orchestrator = {
      ...nodes.orchestrator,
      status:
        status === "error"
          ? "error"
          : isPipelineTerminal
            ? "done"
            : "active",
      lastStage: isPipelineTerminal && status === "done" ? "done" : input.stage,
      lastMessage: input.message.slice(0, 140),
      updatedAt: now,
    };

    const isRetryOrFix =
      /retry|fix|reopen|FAIL|handoff/i.test(input.stage) ||
      /retry|fix|reopen|FAIL|handoff/i.test(input.message);

    const accumCharsOut = (prev.kpis?.charsOut || 0) + (input.charsOut || 0);
    const effectiveCharsOut = Math.max(accumCharsOut, disk.artefactChars);
    const accumFiles = (prev.kpis?.filesWritten || 0) + (input.filesCount || 0);
    const effectiveFiles = Math.max(accumFiles, disk.filesCount);

    const kpis = {
      totalEvents:
        (prev.kpis?.totalEvents || 0) + 1 + syntheticEvents.length,
      specsDone:
        input.specsDone ??
        (disk.specsTotal > 0 ? disk.specsDone : prev.kpis?.specsDone ?? 0),
      specsTotal:
        input.specsTotal ??
        (disk.specsTotal > 0 ? disk.specsTotal : prev.kpis?.specsTotal ?? 0),
      charsIn: (prev.kpis?.charsIn || 0) + (input.charsIn || 0),
      charsOut: effectiveCharsOut,
      filesWritten: effectiveFiles,
      retriesAndFixes:
        (prev.kpis?.retriesAndFixes || 0) + (isRetryOrFix ? 1 : 0),
    };

    const pipelineStatus: LiveDashboardState["pipelineStatus"] =
      status === "error"
        ? "error"
        : isPipelineTerminal
          ? "completed"
          : "running";

    const activeNode: LiveNodeId =
      status === "done" || isPipelineTerminal ? "orchestrator" : targetNode;
    const activeStage =
      isPipelineTerminal && status === "done"
        ? "completed"
        : status === "done"
          ? `${input.stage} (done)`
          : input.stage;

    const events = [ev, ...syntheticEvents, ...(prev.events || [])].slice(
      0,
      MAX_LIVE_EVENTS
    );
    const next: LiveDashboardState = {
      ...prev,
      workflow: input.workflow || prev.workflow || "full",
      projectType: input.projectType || prev.projectType || "core",
      activeStage,
      activeNode,
      pipelineStatus,
      seq,
      kpis,
      nodes,
      events,
      updatedAt: now,
    };

    await writeLiveDashboardState(input.appRoot, next);
    return next;
  } catch {
    return null;
  }
}

/**
 * Compact 1-line status banner for the Cursor chat so the chat stays clean
 * while the full animation & detailed logs run in `.zteam/dashboard/index.html`.
 */
export function formatCompactChatLine(opts: {
  workflow: string;
  stage: string;
  role?: string;
  skillKey?: string;
  message: string;
  specsDone?: number;
  specsTotal?: number;
}): string {
  const wf = opts.workflow || "full";
  const specBadge =
    opts.specsTotal && opts.specsTotal > 0
      ? ` [${opts.specsDone ?? 0}/${opts.specsTotal}]`
      : "";
  const roleBadge = opts.role ? ` · ${opts.role}` : "";
  const skillBadge = opts.skillKey ? ` (${opts.skillKey})` : "";
  return `⚡ [zTeam · ${wf}${specBadge}] ${opts.stage}${roleBadge}${skillBadge} — ${opts.message}`;
}

/**
 * Self-contained 9Router-inspired HTML Canvas Dashboard.
 * Reads `../../.docs/zteam-live.js` every 1000ms (works on `file://` and `http://`).
 */
export function buildLiveDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>zTeam Live Orchestrator — 9Router Canvas View</title>
<style>
  :root {
    --bg: #0b0c10;
    --panel: #12141c;
    --panel-border: #212534;
    --text: #e6e9f2;
    --muted: #7e869c;
    --accent: #f97316;
    --green: #22c55e;
    --blue: #38bdf8;
    --red: #ef4444;
    --amber: #f59e0b;
    --purple: #a855f7;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid var(--panel-border);
    background: #0e1017;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand-badge {
    background: rgba(249, 115, 22, 0.15);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 8px;
    font-size: 13px;
    letter-spacing: 0.4px;
  }
  .brand-title {
    font-size: 15px;
    font-weight: 600;
  }
  .brand-sub {
    color: var(--muted);
    font-size: 12px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pill {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    color: var(--muted);
    padding: 5px 11px;
    border-radius: 8px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .pill:hover, .pill.active {
    color: var(--text);
    border-color: var(--accent);
  }
  .pill.completed {
    color: var(--green);
    border-color: var(--green);
    background: rgba(34, 197, 94, 0.1);
  }
  .pill.error {
    color: var(--red);
    border-color: var(--red);
    background: rgba(239, 68, 68, 0.1);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green);
    display: inline-block;
    margin-right: 6px;
    box-shadow: 0 0 8px var(--green);
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
    padding: 14px 20px;
  }
  .kpi-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .kpi-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .kpi-val {
    font-size: 24px;
    font-weight: 700;
  }
  .kpi-sub {
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
  }
  .val-orange { color: #fb923c; }
  .val-blue { color: var(--blue); }
  .val-green { color: var(--green); }
  .val-amber { color: var(--amber); }

  .workspace {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 410px;
    gap: 14px;
    padding: 0 20px 18px 20px;
    min-height: 0;
  }
  .canvas-card {
    position: relative;
    background: radial-gradient(circle at center, #141824 0%, #0d0f16 100%);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    overflow: hidden;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
  }
  canvas:active { cursor: grabbing; }
  .canvas-hud {
    position: absolute;
    left: 14px;
    bottom: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hud-btn {
    width: 30px;
    height: 30px;
    background: rgba(18, 20, 28, 0.9);
    border: 1px solid var(--panel-border);
    color: var(--text);
    border-radius: 7px;
    cursor: pointer;
    font-size: 15px;
  }
  .hud-btn:hover { border-color: var(--accent); }
  .canvas-legend {
    position: absolute;
    top: 12px;
    left: 14px;
    display: flex;
    gap: 12px;
    background: rgba(14, 16, 23, 0.82);
    border: 1px solid var(--panel-border);
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 11px;
    color: var(--muted);
  }
  .leg-dot {
    width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px;
  }

  .log-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .log-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--panel-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--muted);
  }
  .log-cols {
    display: grid;
    grid-template-columns: 1fr 105px 52px;
    padding: 8px 16px;
    border-bottom: 1px solid #1a1e2b;
    font-size: 11px;
    color: var(--muted);
  }
  .log-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .log-row {
    display: grid;
    grid-template-columns: 1fr 105px 52px;
    align-items: center;
    padding: 8px 16px;
    border-bottom: 1px solid rgba(33, 37, 52, 0.45);
    font-size: 12px;
    gap: 6px;
  }
  .log-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }
  .log-stage {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .log-msg {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }
  .log-io {
    font-family: monospace;
    font-size: 11px;
    text-align: right;
  }
  .io-in { color: #fb923c; }
  .io-out { color: var(--green); }
  .log-when {
    font-size: 11px;
    color: var(--muted);
    text-align: right;
  }
</style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="brand-badge">9R · zTeam</span>
      <div>
        <div class="brand-title" id="projTitle">zTeam Live Orchestrator</div>
        <div class="brand-sub" id="projMeta">workflow: full · projectType: core</div>
      </div>
    </div>
    <div class="controls">
      <button class="pill" id="btnSimulate" title="Fire a demo pulse across all agents">⚡ Simulate Pulse</button>
      <span class="pill active" id="statusPill"><span class="status-dot" id="liveDot"></span><span id="liveStatus">Polling .docs/zteam-live.js</span></span>
    </div>
  </header>

  <section class="kpis">
    <div class="kpi-card">
      <div class="kpi-label">Total Events</div>
      <div class="kpi-val" id="kpiEvents">0</div>
      <div class="kpi-sub" id="kpiActiveStage">Stage: idle</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Payload Chars In</div>
      <div class="kpi-val val-orange" id="kpiCharsIn">0</div>
      <div class="kpi-sub">Prompt context sent</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Specs Progress</div>
      <div class="kpi-val val-blue" id="kpiSpecs">0 / 0</div>
      <div class="kpi-sub" id="kpiFiles">0 files touched</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Output / Disk Chars</div>
      <div class="kpi-val val-green" id="kpiCharsOut">0</div>
      <div class="kpi-sub">Generated artefacts</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Retries / Fixes</div>
      <div class="kpi-val val-amber" id="kpiRetries">0</div>
      <div class="kpi-sub">Self-heal &amp; TDD loops</div>
    </div>
  </section>

  <main class="workspace">
    <div class="canvas-card">
      <div class="canvas-legend">
        <span><i class="leg-dot" style="background:#f97316"></i>Orchestrator Hub</span>
        <span><i class="leg-dot" style="background:#38bdf8"></i>Active Call</span>
        <span><i class="leg-dot" style="background:#22c55e"></i>Done</span>
        <span><i class="leg-dot" style="background:#ef4444"></i>Error / Fix</span>
      </div>
      <canvas id="graphCanvas"></canvas>
      <div class="canvas-hud">
        <button class="hud-btn" id="zoomIn">+</button>
        <button class="hud-btn" id="zoomOut">−</button>
        <button class="hud-btn" id="zoomReset">⟲</button>
      </div>
    </div>

    <aside class="log-card">
      <div class="log-header">
        <span>Recent Agent Activity</span>
        <span id="lastUpdateLabel">live</span>
      </div>
      <div class="log-cols">
        <span>Stage / Subagent</span>
        <span style="text-align:right">In / Out</span>
        <span style="text-align:right">When</span>
      </div>
      <div class="log-list" id="logList"></div>
    </aside>
  </main>

<script>
(function() {
  const canvas = document.getElementById("graphCanvas");
  const ctx = canvas.getContext("2d");

  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  // Radial positions around the center hub (normalized offsets)
  const NODE_LAYOUT = {
    orchestrator:        { rx: 0,     ry: 0,     color: "#f97316", icon: "9R" },
    systemArchitect:     { rx: -0.34, ry: -0.28, color: "#38bdf8", icon: "SA" },
    uiUxDesigner:        { rx: 0,     ry: -0.36, color: "#a855f7", icon: "UX" },
    technologyArchitect: { rx: 0.34,  ry: -0.28, color: "#fb923c", icon: "TA" },
    qaTddRed:            { rx: 0.36,  ry: 0.06,  color: "#f43f5e", icon: "RED" },
    softwareEngineer:    { rx: 0.24,  ry: 0.34,  color: "#22c55e", icon: "SE" },
    qaVerify:            { rx: -0.24, ry: 0.34,  color: "#10b981", icon: "QA" },
    critics:             { rx: -0.36, ry: 0.06,  color: "#eab308", icon: "CRT" }
  };

  let state = {
    projectTitle: "zTeam Live Orchestrator",
    workflow: "full",
    projectType: "core",
    activeStage: "idle",
    activeNode: "orchestrator",
    pipelineStatus: "idle",
    seq: 0,
    kpis: { totalEvents: 0, specsDone: 0, specsTotal: 0, charsIn: 0, charsOut: 0, filesWritten: 0, retriesAndFixes: 0 },
    nodes: {
      orchestrator: { id: "orchestrator", label: "zTeam Orchestrator", sublabel: "LangGraph / MCP Hub", status: "active", model: "router", calls: 0, lastMessage: "Waiting for pipeline..." },
      systemArchitect: { id: "systemArchitect", label: "System Architect", sublabel: "Reqs · Todo · Specs", status: "idle", model: "SA", calls: 0, lastMessage: "" },
      uiUxDesigner: { id: "uiUxDesigner", label: "UI/UX Designer", sublabel: "Juice · Flow & States", status: "idle", model: "UX", calls: 0, lastMessage: "" },
      technologyArchitect: { id: "technologyArchitect", label: "Tech Architect", sublabel: "9-Layer Stack", status: "idle", model: "TA", calls: 0, lastMessage: "" },
      qaTddRed: { id: "qaTddRed", label: "QA TDD Red", sublabel: "Failing Tests First", status: "idle", model: "QA", calls: 0, lastMessage: "" },
      softwareEngineer: { id: "softwareEngineer", label: "Software Engineer", sublabel: "TDD Green · Code", status: "idle", model: "SE", calls: 0, lastMessage: "" },
      qaVerify: { id: "qaVerify", label: "QA TDD Verify", sublabel: "Suite · Mark [x]", status: "idle", model: "QA", calls: 0, lastMessage: "" },
      critics: { id: "critics", label: "Critics & Gates", sublabel: "Fidelity · Arch · DoD", status: "idle", model: "gate", calls: 0, lastMessage: "" }
    },
    events: []
  };

  let lastSeenSeq = 0;
  const particles = [];

  function spawnPulse(fromId, toId, color) {
    if (!NODE_LAYOUT[fromId] || !NODE_LAYOUT[toId]) return;
    for (let i = 0; i < 3; i++) {
      particles.push({
        from: fromId,
        to: toId,
        t: -i * 0.14,
        speed: 0.012 + i * 0.002,
        color: color || "#f97316"
      });
    }
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
  });
  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
  });
  window.addEventListener("mouseup", () => { isDragging = false; });

  document.getElementById("zoomIn").onclick = () => { zoom = Math.min(1.8, zoom + 0.15); };
  document.getElementById("zoomOut").onclick = () => { zoom = Math.max(0.6, zoom - 0.15); };
  document.getElementById("zoomReset").onclick = () => { zoom = 1; panX = 0; panY = 0; };

  document.getElementById("btnSimulate").onclick = () => {
    const order = ["systemArchitect", "uiUxDesigner", "technologyArchitect", "critics", "qaTddRed", "softwareEngineer", "qaVerify"];
    order.forEach((id, idx) => {
      setTimeout(() => {
        state.activeNode = id;
        state.activeStage = "sim:" + id;
        state.nodes[id].status = "active";
        state.nodes[id].calls = (state.nodes[id].calls || 0) + 1;
        spawnPulse("orchestrator", id, NODE_LAYOUT[id].color);
        setTimeout(() => {
          spawnPulse(id, "orchestrator", "#22c55e");
          state.nodes[id].status = "done";
          if (idx === order.length - 1) {
            state.activeNode = "orchestrator";
            state.activeStage = "completed";
            state.pipelineStatus = "completed";
          }
        }, 650);
      }, idx * 450);
    });
  };

  function getCoords(id, w, h) {
    const lay = NODE_LAYOUT[id] || { rx: 0, ry: 0 };
    const cx = w / 2 + panX;
    const cy = h / 2 + panY;
    const radiusX = Math.min(w, 900) * zoom;
    const radiusY = Math.min(h, 620) * zoom;
    return {
      x: cx + lay.rx * radiusX,
      y: cy + lay.ry * radiusY
    };
  }

  function drawGrid(w, h) {
    ctx.strokeStyle = "rgba(255,255,255,0.025)";
    ctx.lineWidth = 1;
    const step = 36 * zoom;
    for (let x = (panX % step); x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = (panY % step); y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }

  function quadPoint(p0, p1, p2, t) {
    const inv = 1 - t;
    return {
      x: inv * inv * p0.x + 2 * inv * t * p1.x + t * t * p2.x,
      y: inv * inv * p0.y + 2 * inv * t * p1.y + t * t * p2.y
    };
  }

  function draw() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);
    drawGrid(w, h);

    const hub = getCoords("orchestrator", w, h);

    // Keep continuous subtle pulse ONLY while an agent is actively running
    if (
      state.pipelineStatus !== "completed" &&
      state.activeNode &&
      state.activeNode !== "orchestrator" &&
      state.nodes?.[state.activeNode]?.status === "active" &&
      Math.random() < 0.06
    ) {
      spawnPulse("orchestrator", state.activeNode, NODE_LAYOUT[state.activeNode]?.color);
    }

    // Draw curved edges from orchestrator to every role node
    Object.keys(NODE_LAYOUT).forEach((id) => {
      if (id === "orchestrator") return;
      const target = getCoords(id, w, h);
      const nodeState = state.nodes?.[id] || {};
      const isActive =
        state.pipelineStatus !== "completed" &&
        (state.activeNode === id || nodeState.status === "active");
      const isDone = nodeState.status === "done";
      const ctrl = {
        x: (hub.x + target.x) / 2,
        y: (hub.y + target.y) / 2 - 28 * zoom
      };

      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, target.x, target.y);
      ctx.lineWidth = isActive ? 2.4 : 1.3;
      ctx.strokeStyle = isActive
        ? NODE_LAYOUT[id].color
        : isDone
          ? "rgba(34, 197, 94, 0.38)"
          : "rgba(126, 134, 156, 0.22)";
      ctx.stroke();
    });

    // Update & draw moving particles along Bézier curves
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += p.speed;
      if (p.t > 1) {
        particles.splice(i, 1);
        continue;
      }
      if (p.t < 0) continue;
      const a = getCoords(p.from, w, h);
      const b = getCoords(p.to, w, h);
      const ctrl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 28 * zoom };
      const pt = quadPoint(a, ctrl, b, p.t);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.2 * zoom, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Draw nodes (9Router pill cards)
    Object.keys(NODE_LAYOUT).forEach((id) => {
      const pos = getCoords(id, w, h);
      const lay = NODE_LAYOUT[id];
      const n = state.nodes?.[id] || { label: id, sublabel: "", status: "idle", calls: 0 };
      const isHub = id === "orchestrator";
      const isCompleted = state.pipelineStatus === "completed";
      const isActive = !isCompleted && (state.activeNode === id || n.status === "active");
      const cardW = (isHub ? 190 : 176) * zoom;
      const cardH = (isHub ? 58 : 54) * zoom;
      const x = pos.x - cardW / 2;
      const y = pos.y - cardH / 2;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, cardH, 10 * zoom);
      ctx.fillStyle = isHub ? "#191516" : "#131621";
      if (isActive || (isHub && isCompleted)) {
        ctx.shadowColor = isHub && isCompleted ? "#22c55e" : lay.color;
        ctx.shadowBlur = 18;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.lineWidth = isActive ? 2 : 1.2;
      ctx.strokeStyle = isHub
        ? (isCompleted ? "#22c55e" : "#f97316")
        : n.status === "error"
          ? "#ef4444"
          : isActive
            ? lay.color
            : n.status === "done"
              ? "rgba(34,197,94,0.65)"
              : "#262b3d";
      ctx.stroke();

      // Icon badge
      const badgeSize = 26 * zoom;
      ctx.beginPath();
      ctx.roundRect(x + 10 * zoom, pos.y - badgeSize / 2, badgeSize, badgeSize, 6 * zoom);
      ctx.fillStyle = lay.color + "26";
      ctx.fill();
      ctx.fillStyle = lay.color;
      ctx.font = "bold " + Math.round(10 * zoom) + "px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lay.icon, x + 10 * zoom + badgeSize / 2, pos.y);

      // Texts
      ctx.textAlign = "left";
      ctx.fillStyle = "#e6e9f2";
      ctx.font = "600 " + Math.round(12 * zoom) + "px Inter, sans-serif";
      ctx.fillText(n.label || id, x + 44 * zoom, pos.y - 7 * zoom);

      ctx.fillStyle = "#7e869c";
      ctx.font = Math.round(10 * zoom) + "px Inter, sans-serif";
      const sub = (n.model && n.model !== "SA" && n.model !== "TA" && n.model !== "UX" && n.model !== "SE" && n.model !== "QA")
        ? n.model.slice(0, 22)
        : (n.sublabel || "");
      ctx.fillText(sub, x + 44 * zoom, pos.y + 9 * zoom);

      // Call counter pill
      if (n.calls > 0) {
        ctx.fillStyle = lay.color;
        ctx.font = "bold " + Math.round(10 * zoom) + "px monospace";
        ctx.textAlign = "right";
        ctx.fillText("×" + n.calls, x + cardW - 10 * zoom, y + 14 * zoom);
      }
      ctx.restore();
    });

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  function fmtNum(n) {
    return Number(n || 0).toLocaleString();
  }

  function relTime(iso) {
    if (!iso) return "now";
    const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (diff < 60) return diff + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    return Math.floor(diff / 3600) + "h ago";
  }

  function applyIncomingState(next) {
    if (!next || typeof next !== "object") return;
    if (next.seq && next.seq > lastSeenSeq) {
      const newEvents = (next.events || []).filter((e) => e.seq > lastSeenSeq).reverse();
      newEvents.forEach((ev) => {
        const col = ev.status === "error" ? "#ef4444" : ev.status === "done" ? "#22c55e" : (NODE_LAYOUT[ev.to]?.color || "#38bdf8");
        spawnPulse(ev.from || "orchestrator", ev.to || "systemArchitect", col);
      });
      lastSeenSeq = next.seq;
    }
    state = next;

    document.getElementById("projTitle").textContent = (state.projectTitle || "zTeam") + " — Live Orchestrator";
    document.getElementById("projMeta").textContent =
      "workflow: " + (state.workflow || "full") + " · projectType: " + (state.projectType || "core") + " · updated " + relTime(state.updatedAt);

    const statusPill = document.getElementById("statusPill");
    const liveStatus = document.getElementById("liveStatus");
    const liveDot = document.getElementById("liveDot");
    if (state.pipelineStatus === "completed") {
      statusPill.className = "pill completed";
      liveStatus.textContent = "Pipeline Completed ✓";
      liveDot.style.background = "#22c55e";
    } else if (state.pipelineStatus === "error") {
      statusPill.className = "pill error";
      liveStatus.textContent = "Pipeline Error ✗";
      liveDot.style.background = "#ef4444";
    } else {
      statusPill.className = "pill active";
      liveStatus.textContent = "Polling .docs/zteam-live.js";
      liveDot.style.background = "#22c55e";
    }

    const k = state.kpis || {};
    document.getElementById("kpiEvents").textContent = fmtNum(k.totalEvents);
    document.getElementById("kpiActiveStage").textContent = "Stage: " + (state.activeStage || "idle");
    document.getElementById("kpiCharsIn").textContent = fmtNum(k.charsIn);
    document.getElementById("kpiSpecs").textContent = (k.specsDone || 0) + " / " + (k.specsTotal || 0);
    document.getElementById("kpiFiles").textContent = fmtNum(k.filesWritten) + " files touched";
    document.getElementById("kpiCharsOut").textContent = fmtNum(k.charsOut);
    document.getElementById("kpiRetries").textContent = fmtNum(k.retriesAndFixes);

    const listEl = document.getElementById("logList");
    const evs = state.events || [];
    listEl.innerHTML = evs.map((ev) => {
      const dotColor = ev.status === "error" ? "#ef4444" : ev.status === "done" ? "#22c55e" : "#38bdf8";
      const ioText = (ev.charsIn || ev.charsOut)
        ? '<span class="io-in">' + fmtNum(ev.charsIn || 0) + '↑</span> <span class="io-out">' + fmtNum(ev.charsOut || 0) + '↓</span>'
        : (ev.filesCount ? '<span class="io-out">' + ev.filesCount + ' files</span>' : '<span style="color:#7e869c">' + (ev.status || "info") + '</span>');
      return '<div class="log-row">' +
        '<div>' +
          '<div class="log-stage"><span class="leg-dot" style="background:' + dotColor + '"></span>' + (ev.stage || "stage") + (ev.skillKey ? ' · ' + ev.skillKey : '') + '</div>' +
          '<div class="log-msg">' + (ev.message || "").replace(/</g, "&lt;") + '</div>' +
        '</div>' +
        '<div class="log-io">' + ioText + '</div>' +
        '<div class="log-when">' + relTime(ev.at) + '</div>' +
      '</div>';
    }).join("");
  }

  // Zero-server JSONP polling: reload ../../.docs/zteam-live.js every 1000ms
  function pollLiveJs() {
    const old = document.getElementById("__zteam_live_script");
    if (old) old.remove();
    const s = document.createElement("script");
    s.id = "__zteam_live_script";
    s.src = "../../.docs/zteam-live.js?t=" + Date.now();
    s.onload = () => {
      if (window.__ZTEAM_LIVE__) {
        applyIncomingState(window.__ZTEAM_LIVE__);
      }
    };
    document.body.appendChild(s);
  }
  pollLiveJs();
  setInterval(pollLiveJs, 1000);
})();
</script>
</body>
</html>
`;
}

/**
 * Ensure `.zteam/dashboard/index.html` and an initial `.docs/zteam-live.{json,js}` exist in targetDir.
 */
export async function ensureLiveDashboardFiles(
  targetDir: string,
  opts?: { workflow?: string; projectType?: string }
): Promise<{
  htmlPath: string;
  liveJsPath: string;
  status: "written" | "unchanged";
}> {
  const root = resolve(targetDir);
  const htmlPath = join(root, DASHBOARD_HTML_REL_PATH);
  await mkdir(dirname(htmlPath), { recursive: true });
  const htmlBody = buildLiveDashboardHtml();
  let status: "written" | "unchanged" = "unchanged";
  let prev = "";
  try {
    prev = await readFile(htmlPath, "utf8");
  } catch {
    /* missing */
  }
  if (prev !== htmlBody) {
    await writeFile(htmlPath, htmlBody, "utf8");
    status = "written";
  }

  const existingState = await readLiveDashboardState(root);
  if (!existingState) {
    const disk = await scanAppDiskMetrics(root);
    const initial = emptyLiveDashboardState(root, {
      workflow: opts?.workflow,
      projectType: opts?.projectType,
    });
    initial.kpis.specsDone = disk.specsDone;
    initial.kpis.specsTotal = disk.specsTotal;
    initial.kpis.filesWritten = disk.filesCount;
    initial.kpis.charsOut = disk.artefactChars;
    await writeLiveDashboardState(root, initial);
  }
  return {
    htmlPath,
    liveJsPath: join(root, LIVE_FEED_JS_PATH),
    status,
  };
}
