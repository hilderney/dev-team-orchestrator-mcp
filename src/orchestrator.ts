import "dotenv/config";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  WORKFLOW_CATALOG,
  classifyWorkflow,
  isWorkflowId,
  resolveExplicitWorkflow,
  stripWorkflowTag,
  workflowCatalogText,
  type WorkflowId,
} from "./workflows/index.js";
import {
  buildSmoke,
  ensureAppScaffold,
  ensureVitestTestScript,
  npmInstall,
  runBootstrapGate,
  runCanonicalTests,
  runQaSmokeTests,
} from "./bootstrap.js";
import { classifyTestFailure, type TestFailureClass } from "./test-failure.js";
import {
  clearMetrics,
  createMetrics,
  getMetrics,
  metricsSnapshot,
  recordDeliveryVerifyFail,
  recordLlmEmpty,
  recordNoFileSections,
  recordRetry,
  recordSpecsMarkedWithoutFiles,
  recordStageTiming,
  recordToolCallMalformed,
  setBatchSize,
  setErrorClass,
} from "./metrics.js";
import {
  MAX_DELIVERY_FIX_ROUNDS,
  assertFilesToTouchClean,
  findArchitectureCoverageGaps,
  findPhantomDoneSlugs,
  formatVerifyFeedback,
  loadSpecBody,
  unmarkTodoSlugs,
  verifyDelivery,
} from "./verify-delivery.js";
import {
  healthcheckNineRouter,
  listNineRouterModelIds,
  missingNineRouterModels,
  shouldHealthcheckForWorkflow,
} from "./healthcheck.js";
import {
  coercePathForContent,
  extractWriteFileToolCalls,
  repairFileContract,
  stripAgentNotesFromCode,
  toolCallsToFileSections,
  writeFileToolDefinition,
  isCodeOrTestPath,
} from "./file-contract.js";
import {
  CircuitBreakerError,
  readPipelineState,
  stageBudgetMs,
  updatePipelineStage,
} from "./pipeline-state.js";
import { applyHitlDecision, hitlEnabled, pausePipelineForHuman } from "./hitl.js";
import {
  assertExpectedWorkspace,
  assertPathInsideWorkspace,
  sandboxConfig,
} from "./sandbox.js";
import { getRunContext, withRunContext } from "./run-context.js";
import {
  ROLE_PROMPT_DUTIES,
  consultAdvisorPrompt,
  qaEngineerPrompt,
  softwareEngineerFixPrompt,
  softwareEngineerImplementPrompt,
  validateSeImplementSelfCheck,
  validateQaSelfCheck,
  stripSeQaTrailMarkers,
  parseTechDebtSection,
  appendTechDebtMarkdown,
  TECH_DEBT_PATH,
  systemArchitectProjectSummaryPrompt,
  systemArchitectTechDebtReviewPrompt,
  parseProjectSummaryResponse,
  validateProjectSummarySelfCheck,
  parseTechDebtReviewResponse,
  validateTechDebtReviewSelfCheck,
  buildUserReportMarkdown,
  PROJECT_SUMMARY_PATH,
  TECH_DEBT_PLAN_PATH,
  USER_REPORT_PATH,
  parseUiUxRequirementsResponse,
  validateUiUxRequirementsResponse,
  upsertRequirementsUxAddendum,
  uiUxRequirementsPrompt,
  uiUxDesignSystemPrompt,
  parseUiUxDesignSystemResponse,
  validateUiUxDesignSystemResponse,
  UI_UX_DOC_PATH,
  splitSelfCheck,
  systemArchitectBootstrapPrompt,
  systemArchitectReqItemPrompt,
  systemArchitectTodoPlanPrompt,
  systemArchitectSpecItemPrompt,
  uiUxSpecEnrichPrompt,
  technologyArchitectSpecEnrichPrompt,
  parseTodoPlanResponse,
  parseSingleSpecResponse,
  SA_TODO_PLAN_SELF_CHECK_KEYS,
  SA_SPEC_ITEM_SELF_CHECK_KEYS,
  UX_SPEC_ENRICH_SELF_CHECK_KEYS,
  TA_SPEC_ENRICH_SELF_CHECK_KEYS,
  assertSpecUseCasesMinimum,
  technologyArchitectPrompt,
  validateKeyedSelfCheck,
  validateSaRequirementsSelfCheck,
  TA_SELF_CHECK_KEYS,
} from "./role-prompts.js";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODELS,
  diagnoseWorkspace,
  ensureGitignoreIgnoresZteam,
  ensureZteamBootstrapRoots,
  configGateSatisfied,
  envDefaultsTeamConfig,
  loadTeamConfig,
  needsConfigPayload,
  needsWorkspaceRootPayload,
  MODEL_QUESTIONS,
  SETUP_QUESTIONS,
  ROLE_MODEL_SUGGESTIONS,
  resolveRoleFallbackModel,
  writeTeamConfig,
  resolveTeamRuntime,
  buildCursorDelegationPlaybook,
  type ResolvedTeamConfig,
  type TeamRole,
} from "./zteam-config.js";
import { pickSpecBatch, resolveSeMaxBatch } from "./spec-batch.js";
import {
  archNotify,
  architectureSnapshot,
  extractSectionTitle,
  formatSlugList,
  listSpecSlugsFromTodo,
  readArchitectureProgress,
  setArchitecturePhase,
  summarizeTech,
} from "./architecture-progress.js";
import {
  formatFileList,
  implNotify,
  implementationSnapshot,
  readImplementationProgress,
  setImplementationPhase,
} from "./implementation-progress.js";

/** Package root (this MCP server repo), resolved from this file. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** @deprecated Prefer resolveAppRoot(projectRoot); kept for CLI logging. */
export const PROJECT_ROOT = PACKAGE_ROOT;

const REQUIREMENTS_PATH = ".docs/requirements.md";
const TECHNOLOGIES_PATH = ".docs/technologies.md";
const UI_UX_PATH = UI_UX_DOC_PATH;
const TODO_PATH = ".docs/todo.md";
const SPECS_DIR = ".docs/specs";
const README_PATH = "README.md";
const PIPELINE_RESULT_PATH = ".docs/pipeline-result.json";
const DEFAULT_GRAPH_RECURSION_LIMIT = 120;
const SPEC_SPLIT_CHARS = 4000;
const SE_INVOKE_ATTEMPTS = 6;

export type WorkspaceResolveResult = {
  root: string;
  source: "arg" | "env" | "cwd";
};

/**
 * Resolve workspace root: MCP/CLI arg (absolute) > ALS run context > env WORKSPACE_ROOT > cwd.
 * Prefer passing the Cursor-open folder as `workspaceRoot` on every tool call.
 * CLI may use env; MCP tools must use {@link requireMcpWorkspaceRoot} (no env fallback).
 */
export function resolveWorkspaceRoot(
  override?: string | null
): WorkspaceResolveResult {
  const fromCtx = getRunContext()?.workspaceRoot;
  const raw = (override ?? fromCtx)?.trim();
  if (raw) {
    if (!isAbsolute(raw)) {
      throw new Error(
        `workspaceRoot must be an absolute path (Cursor open folder), got: ${raw}`
      );
    }
    return {
      root: resolve(raw),
      source: "arg",
    };
  }
  const fromEnv = process.env.WORKSPACE_ROOT?.trim();
  if (fromEnv) {
    return { root: resolve(fromEnv), source: "env" };
  }
  return { root: process.cwd(), source: "cwd" };
}

/**
 * MCP-only: require absolute workspaceRoot arg. Never reads WORKSPACE_ROOT env
 * (avoids sticky wrong-repo from mcp.json).
 */
export function requireMcpWorkspaceRoot(
  override?: string | null
): WorkspaceResolveResult {
  const raw = (override ?? "").trim();
  if (!raw) {
    const err = new Error(
      "workspaceRoot is required (absolute Cursor open folder). MCP does not use sticky WORKSPACE_ROOT env."
    );
    (err as Error & { failureKind?: string }).failureKind =
      "needs_workspace_root";
    throw err;
  }
  if (!isAbsolute(raw)) {
    throw new Error(
      `workspaceRoot must be an absolute path (Cursor open folder), got: ${raw}`
    );
  }
  return { root: resolve(raw), source: "arg" };
}

function mcpNeedsWorkspaceRootResult() {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(needsWorkspaceRootPayload(), null, 2),
      },
    ],
    isError: true as const,
  };
}

/** Resolve MCP workspace or return needs_workspace_root error payload. */
function mcpResolveWorkspace(override?: string | null):
  | { ok: true; ws: WorkspaceResolveResult }
  | { ok: false; result: ReturnType<typeof mcpNeedsWorkspaceRootResult> } {
  try {
    return { ok: true, ws: requireMcpWorkspaceRoot(override) };
  } catch (err) {
    const kind = (err as Error & { failureKind?: string }).failureKind;
    if (kind === "needs_workspace_root") {
      return { ok: false, result: mcpNeedsWorkspaceRootResult() };
    }
    throw err;
  }
}

function getWorkspaceRoot(): string {
  return resolveWorkspaceRoot().root;
}

/** Absolute path to the app project root (workspace + relative projectRoot). */
export function resolveAppRoot(
  projectRoot = ".",
  workspaceRootOverride?: string | null
): string {
  const workspace = resolveWorkspaceRoot(workspaceRootOverride).root;
  return resolve(workspace, projectRoot || ".");
}

/** LangGraph recursionLimit: env GRAPH_RECURSION_LIMIT or estimate from pending specs. */
export function resolveGraphRecursionLimit(pendingSpecsEstimate = 0): number {
  const fromEnv = Number.parseInt(process.env.GRAPH_RECURSION_LIMIT ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  if (pendingSpecsEstimate > 0) {
    return Math.max(100, 10 + 8 * pendingSpecsEstimate);
  }
  return DEFAULT_GRAPH_RECURSION_LIMIT;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorText(err: unknown): string {
  if (err == null) return String(err);
  if (err instanceof Error) {
    return err.message || err.name || "Error";
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  try {
    return String(err);
  } catch {
    return "unknown error";
  }
}

/** Fail early if writing would overwrite this MCP package (agents-review U2). */
export function assertSafeAppRoot(
  appRoot: string,
  projectRoot = "."
): void {
  const app = resolve(appRoot);
  const pkg = resolve(PACKAGE_ROOT);
  const rel = (projectRoot || ".").trim() || ".";
  if (app === pkg && (rel === "." || rel === "./")) {
    throw new Error(
      [
        "Refusing to write into the orchestrator package root.",
        "Pass workspaceRoot (absolute Cursor open folder) and/or a dedicated projectRoot",
        '(e.g. "samples/my-app"), not projectRoot="." against the MCP package cwd.',
      ].join(" ")
    );
  }
}

const workspaceRootArg = z
  .string()
  .min(1)
  .describe(
    "REQUIRED. Absolute path of the Cursor-open workspace folder. MCP never falls back to sticky WORKSPACE_ROOT in mcp.json."
  );

function parseMaxTokens(envValue: string | undefined, fallback: number): number {
  const n = Number.parseInt(envValue ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseMaxQaFixRounds(): number {
  return parseMaxTokens(process.env.MAX_QA_FIX_ROUNDS, 3);
}

/** Strip a single outer ```markdown / ``` fence if the model wrapped the whole doc. */
function stripOuterMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/i);
  return match ? match[1].trimEnd() : trimmed;
}

/** Strip language fences and prose skip lines from a FILE body. */
export function sanitizeFileBody(content: string): string {
  let text = content.trim();
  // Whole-body fence (any language), optional trailing prose after closing ```
  const whole = text.match(
    /^```(?:[\w.+-]*)\r?\n([\s\S]*?)\r?\n```(?:\s*[\s\S]*)?$/
  );
  if (whole) {
    text = whole[1];
  } else {
    text = stripOuterMarkdownFence(text);
  }
  const lines = text.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    if (/^[→\-]\s*skipped/i.test(t)) return false;
    if (/^->\s*skipped/i.test(t)) return false;
    if (/^skipped:\s*/i.test(t)) return false;
    return true;
  });
  text = lines.join("\n").replace(/\s+$/, "");
  return stripAgentNotesFromCode(text);
}

/**
 * Normalize LLM FILE paths: reject .. / absolute; strip duplicated projectRoot prefix.
 * Returns path relative to appRoot using forward slashes.
 */
export function sanitizeFilePath(
  appRoot: string,
  projectRoot: string,
  rawPath: string
): string {
  let p = (rawPath || "").trim().replace(/\\/g, "/");
  if (!p) {
    throw new Error("FILE path is empty");
  }
  if (isAbsolute(p) || /^[a-zA-Z]:\//.test(p)) {
    throw new Error(`FILE path must be relative (got absolute: ${rawPath})`);
  }
  if (p.split("/").some((seg) => seg === "..")) {
    throw new Error(`FILE path must not contain '..' (got: ${rawPath})`);
  }

  const proj = (projectRoot || ".").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const projBase = basename(proj === "." ? "" : proj);
  // Strip duplicated projectRoot prefix once (e.g. samples/pacman/src/x → src/x)
  if (proj && proj !== "." && (p === proj || p.startsWith(proj + "/"))) {
    p = p.slice(proj.length).replace(/^\//, "");
  } else if (projBase && (p === projBase || p.startsWith(projBase + "/"))) {
    p = p.slice(projBase.length).replace(/^\//, "");
  }

  p = p.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!p) {
    throw new Error(`FILE path empty after stripping projectRoot (${rawPath})`);
  }

  const abs = resolve(appRoot, ...p.split("/"));
  const app = resolve(appRoot);
  const rel = relative(app, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`FILE path escapes appRoot: ${rawPath}`);
  }
  return rel.split(sep).join("/");
}

export type WriteParsedResult = {
  count: number;
  filesWritten: string[];
};

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

async function writeDoc(appRoot: string, relPath: string, content: string): Promise<void> {
  const abs = join(appRoot, relPath);
  const workspace = getWorkspaceRoot();
  assertPathInsideWorkspace(workspace, appRoot);
  assertPathInsideWorkspace(workspace, abs);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

/** Attach failureKind / resumeHint for classified pipeline aborts. */
function classifiedError(
  message: string,
  failureKind: string,
  resumeHint?: string
): Error {
  const err = new Error(message);
  (err as Error & { failureKind?: string; resumeHint?: string }).failureKind =
    failureKind;
  if (resumeHint) {
    (err as Error & { resumeHint?: string }).resumeHint = resumeHint;
  }
  setErrorClass(failureKind);
  return err;
}

async function readDoc(appRoot: string, relPath: string): Promise<string> {
  try {
    return await readFile(join(appRoot, relPath), "utf8");
  } catch {
    return `[Document missing: ${relPath} was not found under ${appRoot}. Proceed with available context only.]`;
  }
}

const HEARTBEAT_MS = parseMaxTokens(process.env.PROGRESS_HEARTBEAT_MS, 30_000);
const PARTIAL_PREVIEW_MIN_CHARS = 80;
const PARTIAL_PREVIEW_MAX_CHARS = 240;

type ProgressKind =
  | "notify"
  | "heartbeat"
  | "stage"
  | "partial"
  | "retry"
  | "error"
  | "warn";

type ProgressSink = (line: string) => void | Promise<void>;

type McpProgressSend = (notification: {
  method: string;
  params: Record<string, unknown>;
}) => Promise<void>;

function progressKindToLevel(
  kind: ProgressKind
): "debug" | "info" | "warning" | "error" {
  if (kind === "heartbeat" || kind === "partial") return "debug";
  if (kind === "retry" || kind === "warn") return "warning";
  if (kind === "error") return "error";
  return "info";
}

/** Live progress for one pipeline run (MCP + CLI). */
export class ProgressSession {
  readonly lines: string[] = [];
  private cursor = 0;
  private progressStep = 0;
  private partialPreviewSent = false;
  private closed = false;
  pendingSpecs: string[] = [];
  pendingQaSpecs: string[] = [];
  pendingPreReqs: string[] = [];
  preReqIndex = 0;
  preReqTotal = 0;
  specIndex = 0;
  specTotal = 0;
  qaIndex = 0;
  qaTotal = 0;
  onStatus?: ProgressSink;
  sendNotification?: McpProgressSend;
  progressToken?: string | number;
  traceId?: string;
  /** When false (MCP stdio default), never write progress to console — avoids JSON-RPC corruption. */
  consoleEnabled = false;

  /** Stop progress notifications (P1-2). Safe to call multiple times. */
  close(): void {
    this.closed = true;
    this.progressToken = undefined;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  setPending(opts: {
    pendingSpecs?: string[];
    pendingQaSpecs?: string[];
    pendingPreReqs?: string[];
    preReqIndex?: number;
    preReqTotal?: number;
    specIndex?: number;
    specTotal?: number;
    qaIndex?: number;
    qaTotal?: number;
  }): void {
    if (opts.pendingSpecs) this.pendingSpecs = [...opts.pendingSpecs];
    if (opts.pendingQaSpecs) this.pendingQaSpecs = [...opts.pendingQaSpecs];
    if (opts.pendingPreReqs) this.pendingPreReqs = [...opts.pendingPreReqs];
    if (opts.preReqIndex !== undefined) this.preReqIndex = opts.preReqIndex;
    if (opts.preReqTotal !== undefined) this.preReqTotal = opts.preReqTotal;
    if (opts.specIndex !== undefined) this.specIndex = opts.specIndex;
    if (opts.specTotal !== undefined) this.specTotal = opts.specTotal;
    if (opts.qaIndex !== undefined) this.qaIndex = opts.qaIndex;
    if (opts.qaTotal !== undefined) this.qaTotal = opts.qaTotal;
  }

  remainingHint(): string {
    const parts: string[] = [];
    if (this.pendingPreReqs.length > 0 || this.preReqTotal > 0) {
      const current = this.pendingPreReqs[0] || "";
      const i = this.preReqIndex || 1;
      const n = this.preReqTotal || this.pendingPreReqs.length;
      const title = current.slice(0, 50) || "(pré-req)";
      const left = this.pendingPreReqs.length;
      parts.push(
        left > 0
          ? `pré-req ${i}/${n}: ${title}; faltam ${left}`
          : `pré-reqs ${n}/${n} concluídos`
      );
    }
    if (this.pendingSpecs.length > 0 || this.specTotal > 0) {
      const current = this.pendingSpecs[0] || "";
      const i = this.specIndex || 1;
      const n = this.specTotal || this.pendingSpecs.length;
      const left = this.pendingSpecs.length;
      if (left > 0) {
        parts.push(`spec ${i}/${n}: ${current}; faltam ${left}`);
      } else if (n > 0) {
        parts.push(`specs ${n}/${n} concluídos`);
      }
    }
    if (this.pendingQaSpecs.length > 0 || this.qaTotal > 0) {
      const current = this.pendingQaSpecs[0] || "";
      const i = this.qaIndex || 1;
      const n = this.qaTotal || this.pendingQaSpecs.length;
      const left = this.pendingQaSpecs.length;
      if (left > 0) {
        parts.push(`QA ${i}/${n}: ${current}; faltam ${left}`);
      } else if (n > 0) {
        parts.push(`QA ${n}/${n} concluídos`);
      }
    }
    return parts.length > 0 ? parts.join("; ") : "sem pendências listadas";
  }

  emit(stage: string, kind: ProgressKind, message: string): string {
    const tid = this.traceId ? ` trace=${this.traceId.slice(0, 8)}` : "";
    const line = `[${stage}] ${kind}: ${message}${tid}`;
    this.lines.push(line);
    const level = progressKindToLevel(kind);
    // MCP stdio: never print to stdout/stderr (breaks JSON-RPC). CLI sets consoleEnabled.
    if (this.consoleEnabled) {
      if (level === "error") console.error(line);
      else if (level === "warning") console.warn(line);
      else console.info(line);
    }
    void this.forward(line, level, kind);
    return line;
  }

  /** Lines emitted since last takeDelta (for state.notifications). */
  takeDelta(): string[] {
    const out = this.lines.slice(this.cursor);
    this.cursor = this.lines.length;
    return out;
  }

  resetPartialPreview(): void {
    this.partialPreviewSent = false;
  }

  maybeEmitPartial(stage: string, partial: string): void {
    if (this.partialPreviewSent) return;
    if (partial.trim().length < PARTIAL_PREVIEW_MIN_CHARS) return;
    this.partialPreviewSent = true;
    this.emit(stage, "partial", interestingPartialPreview(partial));
  }

  private async forward(
    line: string,
    level: "debug" | "info" | "warning" | "error",
    kind: ProgressKind
  ): Promise<void> {
    try {
      await this.onStatus?.(line);
    } catch {
      /* ignore sink errors */
    }
    if (this.closed || !this.sendNotification) return;
    try {
      await this.sendNotification({
        method: "notifications/message",
        params: {
          level,
          logger: "zteam",
          data: line,
        },
      });
    } catch {
      /* client may not support logging */
    }
    // Never send huge TAP / test dumps as progress; skip heartbeat spam volume
    if (this.progressToken === undefined) return;
    if (kind === "heartbeat" && line.length > 400) return;
    if (line.length > 2000) return;
    this.progressStep += 1;
    try {
      await this.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: this.progressToken,
          progress: this.progressStep,
          message: line.slice(0, 500),
        },
      });
    } catch {
      /* client may not have requested progress */
    }
  }
}

let activeProgress: ProgressSession | null = null;

function getProgress(): ProgressSession {
  if (!activeProgress) {
    activeProgress = new ProgressSession();
  }
  return activeProgress;
}

export function createProgressSession(opts?: {
  onStatus?: ProgressSink;
  sendNotification?: McpProgressSend;
  progressToken?: string | number;
  /** Default false (MCP-safe). Set true for CLI `run-pipeline`. */
  consoleEnabled?: boolean;
}): ProgressSession {
  const session = new ProgressSession();
  if (opts?.onStatus) session.onStatus = opts.onStatus;
  if (opts?.sendNotification) session.sendNotification = opts.sendNotification;
  if (opts?.progressToken !== undefined) {
    session.progressToken = opts.progressToken;
  }
  if (opts?.consoleEnabled !== undefined) {
    session.consoleEnabled = opts.consoleEnabled;
  }
  return session;
}

export async function withProgressSession<T>(
  session: ProgressSession,
  fn: () => Promise<T>
): Promise<T> {
  const prev = activeProgress;
  activeProgress = session;
  try {
    return await fn();
  } finally {
    activeProgress = prev;
  }
}

function interestingPartialPreview(text: string): string {
  const fileMatch = text.match(/===FILE:\s*([^\r\n=]+?)===/i);
  if (fileMatch) {
    return `recebido ===FILE: ${fileMatch[1].trim()}=== (+${text.length} chars)`;
  }
  const section = text.match(/===(SUMMARY|REQUIREMENTS|TECH|TODO|SPEC:[^=]+)===/i);
  if (section) {
    return `recebido ===${section[1]}=== (+${text.length} chars)`;
  }
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= PARTIAL_PREVIEW_MAX_CHARS) return oneLine;
  return `${oneLine.slice(0, PARTIAL_PREVIEW_MAX_CHARS)}…`;
}

function chunkToText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const content = (chunk as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

function notify(stage: string, message: string): void {
  getProgress().emit(stage, "notify", message);
}

/**
 * Run work with a 30s silence heartbeat; optional partial text for preview.
 */
async function withHeartbeat<T>(
  stage: string,
  waitingFor: string,
  fn: (reportPartial: (text: string) => void) => Promise<T>
): Promise<T> {
  const progress = getProgress();
  progress.resetPartialPreview();
  const started = Date.now();
  let partial = "";

  const tick = (): void => {
    const secs = Math.round((Date.now() - started) / 1000);
    progress.emit(
      stage,
      "heartbeat",
      `ainda aguardando ${waitingFor} (${secs}s); ${progress.remainingHint()}`
    );
    if (partial.trim()) {
      progress.maybeEmitPartial(stage, partial);
    }
  };

  const timer = setInterval(tick, HEARTBEAT_MS);
  const lateWarn = setTimeout(() => {
    progress.emit(
      stage,
      "warn",
      `heartbeat atrasado >2x intervalo aguardando ${waitingFor}; ${progress.remainingHint()}`
    );
  }, HEARTBEAT_MS * 2);
  try {
    return await fn((text) => {
      partial = text;
    });
  } finally {
    clearInterval(timer);
    clearTimeout(lateWarn);
  }
}

/** Parse ===SUMMARY=== / ===REQUIREMENTS=== sections; null if either is missing. */
function parseSummaryAndRequirements(
  raw: string
): { summary: string; requirements: string } | null {
  const text = stripOuterMarkdownFence(raw);
  const summaryMatch = text.match(
    /===SUMMARY===\s*([\s\S]*?)\s*===REQUIREMENTS===/i
  );
  const requirementsMatch = text.match(/===REQUIREMENTS===\s*([\s\S]*)$/i);
  if (!summaryMatch || !requirementsMatch) return null;
  const summary = summaryMatch[1].trim();
  const requirements = requirementsMatch[1].trim();
  if (!summary || !requirements) return null;
  return { summary, requirements };
}

const MAX_RESUME_WORDS = 512;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/** Truncate resume to at most maxWords (keeps leading content). */
export function clampResumeWords(
  text: string,
  maxWords = MAX_RESUME_WORDS
): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

/**
 * Parse bootstrap LLM output: ===RESUME=== + ===PRE_REQUIREMENTS=== (numbered lines).
 */
export function parseResumeAndPreRequirements(
  raw: string
): { resume: string; preRequirements: string[] } | null {
  const text = stripOuterMarkdownFence(raw);
  const resumeMatch = text.match(
    /===RESUME===\s*([\s\S]*?)\s*===PRE_REQUIREMENTS===/i
  );
  const preMatch = text.match(/===PRE_REQUIREMENTS===\s*([\s\S]*)$/i);
  if (!resumeMatch || !preMatch) return null;
  const resume = clampResumeWords(resumeMatch[1].trim());
  const preRequirements = parseNumberedList(preMatch[1]);
  if (!resume || preRequirements.length === 0) return null;
  return { resume, preRequirements };
}

/** Extract `1. item` / `1) item` lines from a block. */
export function parseNumberedList(block: string): string[] {
  const items: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.trim().match(/^\d+[.)]\s*(.+)$/);
    if (m?.[1]?.trim()) items.push(m[1].trim());
  }
  return items;
}

export function buildBootstrapReadme(
  resume: string,
  preRequirements: string[]
): string {
  const list = preRequirements
    .map((item, i) => `${i + 1}. ${item}`)
    .join("\n");
  return [
    `# Project`,
    "",
    "## Resume",
    "",
    clampResumeWords(resume),
    "",
    "## Pré Requirements",
    "",
    list,
    "",
  ].join("\n");
}

export function buildCleanReadme(resume: string): string {
  return [
    `# Project`,
    "",
    "## Resume",
    "",
    clampResumeWords(resume),
    "",
    "## Documentation",
    "",
    `- [Requirements](${REQUIREMENTS_PATH}) — functional and non-functional requirements`,
    "",
    "Prefer these documents over chat state when implementing or testing.",
    "",
  ].join("\n");
}

function assertParsedResumeAndPreRequirements(
  text: string,
  stage: string
): void {
  assertUsableLlmText(text, stage);
  if (!parseResumeAndPreRequirements(text)) {
    throw new LlmContentError(
      stage,
      "parse_failed",
      "expected ===RESUME=== and ===PRE_REQUIREMENTS=== with numbered items"
    );
  }
}

/** Parse ===FILE: path=== sections from an LLM response. */
export function parseFileSections(raw: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const re = /===FILE:\s*([^\r\n=]+?)===\s*\r?\n([\s\S]*?)(?=\r?\n===FILE:|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const path = match[1].trim();
    const content = match[2].replace(/\s+$/, "");
    if (path) files.push({ path, content });
  }
  return files;
}

async function writeParsedFiles(
  appRoot: string,
  raw: string,
  projectRoot = "."
): Promise<WriteParsedResult> {
  const files = parseFileSections(raw);
  const filesWritten: string[] = [];
  const workspace = getWorkspaceRoot();
  assertPathInsideWorkspace(workspace, appRoot);

  for (const file of files) {
    let rel = sanitizeFilePath(appRoot, projectRoot, file.path);
    let body = sanitizeFileBody(file.content);
    if (!body.trim()) {
      throw new Error(`===FILE: ${file.path}=== has empty body after sanitize`);
    }
    if (isCodeOrTestPath(rel)) {
      body = stripAgentNotesFromCode(body);
      const coerced = coercePathForContent(rel, body);
      if (coerced !== rel) {
        notify(
          "writeParsedFiles",
          `coerced ${rel} → ${coerced} (JSX requires tsx/jsx)`
        );
        rel = coerced;
      }
    }
    await writeDoc(appRoot, rel, body);
    filesWritten.push(rel);
  }
  return { count: filesWritten.length, filesWritten };
}

type TodoItem = { slug: string; title: string; done: boolean };

/** Parse checklist lines: `- [ ] slug: Title` or `- [x] slug: Title`. */
function parseTodoChecklist(todoMd: string): TodoItem[] {
  const items: TodoItem[] = [];
  const re = /^-\s*\[([ xX])\]\s*([a-z0-9][a-z0-9_-]*)\s*:\s*(.+)$/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(todoMd)) !== null) {
    items.push({
      done: match[1].toLowerCase() === "x",
      slug: match[2].toLowerCase(),
      title: match[3].trim(),
    });
  }
  return items;
}

async function markTodoDone(appRoot: string, slug: string): Promise<string> {
  const todo = await readDoc(appRoot, TODO_PATH);
  if (todo.startsWith("[Document missing:")) {
    return todo;
  }
  const updated = todo.replace(
    new RegExp(`^(-\\s*\\[)[ ](\\]\\s*${slug}\\s*:)`, "gim"),
    "$1x$2"
  );
  await writeDoc(appRoot, TODO_PATH, updated);
  return updated;
}

async function listSpecSlugs(appRoot: string): Promise<string[]> {
  const dir = join(appRoot, SPECS_DIR);
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.toLowerCase().endsWith(".spec.md"))
      .map((n) => n.replace(/\.spec\.md$/i, ""))
      .sort();
  } catch {
    return [];
  }
}

function specPath(slug: string): string {
  return `${SPECS_DIR}/${slug}.spec.md`;
}

/** Parse ===TODO=== + ===SPEC: slug=== sections from SA specs response. */
function parseTodoAndSpecs(
  raw: string
): { todo: string; specs: { slug: string; content: string }[] } | null {
  const text = stripOuterMarkdownFence(raw);
  const todoMatch = text.match(/===TODO===\s*([\s\S]*?)(?=\s*===SPEC:|$)/i);
  if (!todoMatch) return null;
  const todo = todoMatch[1].trim();
  const specs: { slug: string; content: string }[] = [];
  const re = /===SPEC:\s*([a-z0-9][a-z0-9_-]*)\s*===\s*\r?\n([\s\S]*?)(?=\r?\n===SPEC:|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    specs.push({ slug: match[1].toLowerCase(), content: match[2].trim() });
  }
  if (!todo || specs.length === 0) return null;
  return { todo, specs };
}

/** Parse ===SUMMARY=== / ===TECH=== from technology architect. */
function parseTechSummaryAndBody(
  raw: string
): { summary: string; tech: string } | null {
  const text = stripOuterMarkdownFence(raw);
  const summaryMatch = text.match(/===SUMMARY===\s*([\s\S]*?)\s*===TECH===/i);
  const techMatch = text.match(/===TECH===\s*([\s\S]*)$/i);
  if (!summaryMatch || !techMatch) return null;
  const summary = summaryMatch[1].trim();
  const tech = techMatch[1].trim();
  if (!summary || !tech) return null;
  return { summary, tech };
}

function upsertReadmeSection(
  readme: string,
  heading: string,
  body: string
): string {
  const section = `## ${heading}\n\n${body.trim()}\n`;
  const re = new RegExp(`## ${heading}\\s*\\n[\\s\\S]*?(?=\\n## |$)`, "i");
  if (re.test(readme)) {
    return readme.replace(re, section.trimEnd() + "\n\n");
  }
  return `${readme.trimEnd()}\n\n${section}`;
}

/** Ensure package.json has scripts.test (vitest) before npm test (P0-2). */
export async function ensureTestScript(
  appRoot: string,
  stage = "qaEngineer"
): Promise<{ injected: boolean; command: string }> {
  const result = await ensureVitestTestScript(appRoot);
  if (result.injected) {
    notify(stage, `Injected scripts.test="vitest run" (was missing)`);
  }
  return result;
}

async function runTscSmoke(
  appRoot: string,
  stage: string
): Promise<{ ok: boolean; log: string }> {
  if (!(await pathExists(join(appRoot, "tsconfig.json")))) {
    return { ok: true, log: "no tsconfig; smoke skipped" };
  }
  return withHeartbeat(stage, "tsc --noEmit smoke", async () => {
    return new Promise((resolvePromise) => {
      const child = spawn("npx", ["tsc", "--noEmit"], {
        cwd: appRoot,
        shell: true,
        env: process.env,
      });
      let log = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        log += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        log += chunk.toString();
      });
      child.on("error", (err) => {
        resolvePromise({ ok: false, log: log + errorText(err) });
      });
      child.on("close", (code) => {
        resolvePromise({
          ok: code === 0,
          log: log.trim() || `(exit ${code})`,
        });
      });
    });
  });
}

async function runProjectTests(
  appRoot: string,
  stage = "qaEngineer"
): Promise<{ ok: boolean; log: string; errorClass?: TestFailureClass }> {
  const gate = await runBootstrapGate(appRoot, {
    notify: (msg) => notify(stage, msg),
  });
  if (!gate.ok) {
    setErrorClass("bootstrap");
    return {
      ok: false,
      log: gate.message,
      errorClass: "bootstrap",
    };
  }

  const smoke = await runQaSmokeTests(appRoot);
  if (!smoke.skipped && !smoke.ok) {
    const cls = classifyTestFailure(smoke.log);
    setErrorClass(cls);
    return {
      ok: false,
      log: `QA smoke failed:\n${smoke.log}`,
      errorClass: cls,
    };
  }

  return withHeartbeat(stage, "npx vitest run", async () => {
    const result = await runCanonicalTests(appRoot);
    const errorClass = result.ok
      ? undefined
      : classifyTestFailure(result.log);
    if (errorClass) setErrorClass(errorClass);
    return {
      ok: result.ok,
      log: result.log,
      errorClass,
    };
  });
}

type LlmContentKind =
  | "empty"
  | "no_file_sections"
  | "empty_file_body"
  | "parse_failed";

/** Invalid / empty model output — retryable (unlike hard logic errors). */
class LlmContentError extends Error {
  readonly name = "LlmContentError";
  constructor(
    public readonly stage: string,
    public readonly kind: LlmContentKind,
    detail?: string
  ) {
    super(
      detail ? `[${stage}] ${kind}: ${detail}` : `[${stage}] ${kind}`
    );
  }
}

/** All invoke attempts failed; docs stages may fall back using lastContent. */
class LlmRetriesExhaustedError extends Error {
  readonly name = "LlmRetriesExhaustedError";
  constructor(
    public readonly stage: string,
    public readonly kind: string,
    public readonly lastContent: string,
    cause: unknown
  ) {
    super(`[${stage}] retries exhausted (${kind}): ${errorText(cause)}`);
  }
}

function assertUsableLlmText(text: string, stage: string): void {
  if (!text.trim()) {
    throw new LlmContentError(stage, "empty", "empty LLM response");
  }
}

function assertHasFileSections(text: string, stage: string): void {
  assertUsableLlmText(text, stage);
  let files = parseFileSections(text);
  if (files.length === 0) {
    const repaired = repairFileContract(text);
    files = parseFileSections(repaired);
  }
  if (files.length === 0) {
    recordNoFileSections();
    throw new LlmContentError(
      stage,
      "no_file_sections",
      "no ===FILE:=== sections in response"
    );
  }
  for (const file of files) {
    if (!sanitizeFileBody(file.content).trim()) {
      throw new LlmContentError(
        stage,
        "empty_file_body",
        `===FILE: ${file.path}=== has empty body`
      );
    }
  }
}

/** QA may return SUMMARY-only (run tests) or FILE sections (write tests). */
function assertQaResponse(text: string, stage: string): void {
  assertUsableLlmText(text, stage);
  const sc = validateQaSelfCheck(text);
  if (!sc.ok) {
    throw new LlmContentError(stage, "parse_failed", sc.message);
  }
  const payload = stripSeQaTrailMarkers(text);
  const files = parseFileSections(payload);
  if (files.length > 0) {
    for (const file of files) {
      if (!sanitizeFileBody(file.content).trim()) {
        throw new LlmContentError(
          stage,
          "empty_file_body",
          `===FILE: ${file.path}=== has empty body`
        );
      }
    }
    return;
  }
  if (!/===SUMMARY===/i.test(text)) {
    throw new LlmContentError(
      stage,
      "no_file_sections",
      "expected ===FILE:=== and/or ===SUMMARY=== plus ===SELF_CHECK==="
    );
  }
}

function assertParsedSummaryAndRequirements(text: string, stage: string): void {
  assertUsableLlmText(text, stage);
  if (!parseSummaryAndRequirements(text)) {
    throw new LlmContentError(
      stage,
      "parse_failed",
      "expected ===SUMMARY=== and ===REQUIREMENTS==="
    );
  }
}

function assertParsedTechSummaryAndBody(text: string, stage: string): void {
  assertUsableLlmText(text, stage);
  if (!parseTechSummaryAndBody(text)) {
    throw new LlmContentError(
      stage,
      "parse_failed",
      "expected ===SUMMARY=== and ===TECH==="
    );
  }
}

function assertParsedTodoAndSpecs(text: string, stage: string): void {
  assertUsableLlmText(text, stage);
  const parsed = parseTodoAndSpecs(text);
  if (!parsed) {
    throw new LlmContentError(
      stage,
      "parse_failed",
      "expected ===TODO=== and at least one ===SPEC: slug==="
    );
  }
  const todoSlugs = parseTodoChecklist(parsed.todo).map((t) => t.slug);
  if (todoSlugs.length === 0) {
    throw new LlmContentError(
      stage,
      "parse_failed",
      "===TODO=== has no valid checklist lines (- [ ] slug: Title)"
    );
  }
  const specSlugs = new Set(parsed.specs.map((s) => s.slug));
  const missing = todoSlugs.filter((s) => !specSlugs.has(s));
  if (missing.length > 0) {
    throw new LlmContentError(
      stage,
      "parse_failed",
      `todo slugs missing ===SPEC=== blocks: ${missing.join(", ")}`
    );
  }
}

/** True for transient network / HTTP failures (9router handles model failover). */
function isRetryableNetworkError(err: unknown): boolean {
  const msg = errorText(err);
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;

  if (status !== undefined) {
    if (status === 429 || status >= 500) return true;
  }
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  if (/Upstream request failed/i.test(msg)) return true;
  if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) {
    return true;
  }
  return false;
}

/** Network/HTTP or invalid LLM content (empty, bad markers, empty FILE bodies). */
function isRetryableError(err: unknown): boolean {
  if (err instanceof LlmContentError) return true;
  if (isRetryableNetworkError(err)) return true;
  const msg = errorText(err);
  if (
    /empty LLM response|no ===FILE:===|empty_file_body|parse_failed|\bempty\b/i.test(
      msg
    )
  ) {
    return true;
  }
  return false;
}

function contentKindOf(err: unknown): string {
  if (err instanceof LlmContentError) return err.kind;
  if (err instanceof LlmRetriesExhaustedError) return err.kind;
  return "error";
}

// ============================================================
// 1. 9Router OpenAI-compatible provider
// ============================================================
const NINEROUTER_BASE = process.env.NINEROUTER_BASE ?? "http://localhost:20128/v1";
const NINEROUTER_KEY = process.env.NINEROUTER_KEY;

if (!NINEROUTER_KEY) {
  throw new Error("NINEROUTER_KEY não definida no .env");
}

const MAX_QA_FIX_ROUNDS = parseMaxQaFixRounds();
const MAX_BOOTSTRAP_FIX_ROUNDS = parseMaxTokens(
  process.env.MAX_BOOTSTRAP_FIX_ROUNDS,
  1
);
const MAX_FIDELITY_FIX_ROUNDS = parseMaxTokens(
  process.env.MAX_FIDELITY_FIX_ROUNDS,
  1
);
const LLM_LATENCY_FALLBACK_MS = parseMaxTokens(
  process.env.ZTEAM_LLM_FALLBACK_MS,
  90_000
);
const USE_WRITE_FILE_TOOL = process.env.ZTEAM_WRITE_FILE_TOOL !== "0";

function activeTeamConfig(): ResolvedTeamConfig {
  const fromCtx = getRunContext()?.teamConfig;
  if (fromCtx) return fromCtx;
  const env = envDefaultsTeamConfig();
  return {
    ...env,
    sources: { workspaceConfig: null, appConfig: null },
    exists: { workspace: false, app: false },
  };
}

function roleLlm(role: TeamRole): { model: string; maxTokens: number } {
  const cfg = activeTeamConfig();
  return {
    model: cfg.models[role],
    maxTokens: cfg.maxTokens[role],
  };
}

function makeLLM(model: string, maxTokens: number): ChatOpenAI {
  const traceId = getMetrics().traceId;
  return new ChatOpenAI({
    model,
    configuration: {
      baseURL: NINEROUTER_BASE,
      apiKey: NINEROUTER_KEY,
      defaultHeaders: {
        "X-Request-Id": traceId,
        "X-Zteam-Trace-Id": traceId,
      },
    },
    temperature: 0.2,
    maxTokens,
  });
}

async function streamLlmContent(
  llm: ChatOpenAI,
  messages: BaseMessage[],
  stage: string
): Promise<string> {
  return withHeartbeat(stage, "resposta do LLM", async (reportPartial) => {
    let content = "";
    const started = Date.now();
    try {
      const stream = await llm.stream(messages);
      for await (const chunk of stream) {
        content += chunkToText(chunk);
        reportPartial(content);
      }
      if (!content.trim()) {
        const res = await llm.invoke(messages);
        content = String(res.content ?? "");
        reportPartial(content);
      }
    } catch (streamErr) {
      getProgress().emit(
        stage,
        "retry",
        `stream falhou (${errorText(streamErr)}); tentando invoke`
      );
      recordRetry("stream_fail");
      try {
        const res = await llm.invoke(messages);
        content = String(res?.content ?? "");
        reportPartial(content);
      } catch (invokeErr) {
        throw new Error(
          `[${stage}] stream and invoke failed: ${errorText(streamErr)} | ${errorText(invokeErr)}`
        );
      }
    }
    const elapsed = Date.now() - started;
    if (elapsed > LLM_LATENCY_FALLBACK_MS) {
      getProgress().emit(
        stage,
        "warn",
        `LLM latency ${elapsed}ms > ${LLM_LATENCY_FALLBACK_MS}ms — consider MODEL_*_FALLBACK`
      );
    }
    return content;
  });
}

async function invokeWithRetry(
  llm: ChatOpenAI,
  messages: BaseMessage[],
  opts: {
    stage: string;
    attempts?: number;
    validate?: (content: string) => void;
    /** Stronger re-prompt for SE/fix FILE-only contract */
    fileOnlyReprompt?: boolean;
    useWriteFileTool?: boolean;
    modelName?: string;
    maxTokens?: number;
  }
): Promise<{ content: unknown }> {
  const attempts = opts.attempts ?? 3;
  let lastError: unknown;
  let lastContent = "";
  const baseMessages = messages;
  const progress = getProgress();
  const activeLlm = llm;

  for (let i = 1; i <= attempts; i++) {
    const attemptMessages =
      i === 1 || !(lastError instanceof LlmContentError)
        ? baseMessages
        : [
            ...baseMessages,
            new HumanMessage(
              opts.fileOnlyReprompt &&
                (lastError.kind === "no_file_sections" ||
                  lastError.kind === "empty" ||
                  lastError.kind === "empty_file_body")
                ? [
                    `Invalid (${lastError.kind}). emit ONLY FILE sections.`,
                    "Format: ===FILE: relative/path===",
                    "<contents>",
                    "No essays. No markdown fences. No project-folder prefix.",
                    "Or call write_file(path, content) once per file.",
                  ].join(" ")
                : [
                    `Your previous reply was invalid (${lastError.kind}).`,
                    "Reply again using EXACTLY the required section markers.",
                    "Do not leave sections empty. No outer code fence.",
                  ].join(" ")
            ),
          ];

    try {
      let content = "";
      if (opts.useWriteFileTool && USE_WRITE_FILE_TOOL) {
        try {
          const bound = activeLlm.bindTools([writeFileToolDefinition()]);
          const res = await withHeartbeat(
            opts.stage,
            "tool write_file",
            async (reportPartial) => {
              const msg = await bound.invoke(attemptMessages);
              reportPartial(String(msg.content ?? ""));
              return msg;
            }
          );
          const extracted = extractWriteFileToolCalls(res);
          if (extracted.malformed > 0) recordToolCallMalformed();
          if (extracted.files.length > 0) {
            content = toolCallsToFileSections(extracted.files);
          } else {
            content = String((res as { content?: unknown }).content ?? "");
          }
        } catch (toolErr) {
          progress.emit(
            opts.stage,
            "retry",
            `tool calling falhou (${errorText(toolErr)}); texto FILE`
          );
          recordRetry("tool_fallback");
          content = await streamLlmContent(
            activeLlm,
            attemptMessages,
            opts.stage
          );
        }
      } else {
        content = await streamLlmContent(
          activeLlm,
          attemptMessages,
          opts.stage
        );
      }

      if (opts.fileOnlyReprompt || opts.useWriteFileTool) {
        const repaired = repairFileContract(content);
        if (repaired !== content && parseFileSections(repaired).length > 0) {
          content = repaired;
          progress.emit(opts.stage, "notify", "format repair applied (no LLM)");
        }
      }

      lastContent = content;
      opts.validate?.(content);
      return { content };
    } catch (err) {
      lastError = err;
      if (err instanceof LlmContentError) {
        recordRetry(err.kind);
      }
      const retryable = isRetryableError(err);
      if (i >= attempts || !retryable) {
        if (retryable && err instanceof LlmContentError) {
          throw new LlmRetriesExhaustedError(
            opts.stage,
            err.kind,
            lastContent,
            err
          );
        }
        throw err;
      }
      const overload = isRetryableNetworkError(err);
      const delayMs = overload
        ? Math.min(30_000, 2000 * 2 ** (i - 1))
        : 1000 * 2 ** (i - 1);
      progress.emit(
        opts.stage,
        "retry",
        `${i}/${attempts}: ${errorText(err)} (waiting ${delayMs}ms)`
      );
      await sleep(delayMs);
    }
  }

  throw new LlmRetriesExhaustedError(
    opts.stage,
    contentKindOf(lastError),
    lastContent,
    lastError
  );
}

/**
 * Run primary role model to exhaustion, then hand off to per-role fallback agent.
 */
async function invokeRoleLlm(
  role: TeamRole,
  messages: BaseMessage[],
  opts: {
    stage: string;
    attempts?: number;
    validate?: (content: string) => void;
    fileOnlyReprompt?: boolean;
    useWriteFileTool?: boolean;
  }
): Promise<{ content: unknown; modelUsed: string; handedOff: boolean }> {
  const primary = roleLlm(role);
  const progress = getProgress();
  const llm = makeLLM(primary.model, primary.maxTokens);
  try {
    const res = await invokeWithRetry(llm, messages, {
      ...opts,
      modelName: primary.model,
      maxTokens: primary.maxTokens,
    });
    return { content: res.content, modelUsed: primary.model, handedOff: false };
  } catch (err) {
    const handoffWorthy =
      err instanceof LlmRetriesExhaustedError ||
      err instanceof LlmContentError ||
      isRetryableNetworkError(err);
    const fb = resolveRoleFallbackModel(activeTeamConfig(), role);
    if (!handoffWorthy || !fb || fb === primary.model) {
      throw err;
    }
    progress.emit(
      opts.stage,
      "notify",
      `handoff ${role}: primary ${primary.model} → fallback agent ${fb}`
    );
    recordRetry("model_handoff");
    const llm2 = makeLLM(fb, primary.maxTokens);
    const res = await invokeWithRetry(llm2, messages, {
      ...opts,
      modelName: fb,
      maxTokens: primary.maxTokens,
    });
    return { content: res.content, modelUsed: fb, handedOff: true };
  }
}

/**
 * Gate consult: asker role poses a question to advisor role (responsibilities-scoped).
 * Failures are swallowed — returns empty string.
 */
async function consultTeammate(opts: {
  asker: TeamRole;
  advisor: TeamRole;
  question: string;
  context: string;
  stage?: string;
}): Promise<string> {
  if (opts.asker === opts.advisor) return "";
  const stage =
    opts.stage || `consult:${opts.asker}->${opts.advisor}`;
  try {
    const advisor = roleLlm(opts.advisor);
    const maxTok = Math.min(advisor.maxTokens, 1200);
    const llm = makeLLM(advisor.model, maxTok);
    const res = await invokeWithRetry(
      llm,
      [
        new SystemMessage(
          consultAdvisorPrompt(opts.advisor, opts.asker)
        ),
        new HumanMessage(
          [
            `## Question from ${opts.asker}`,
            opts.question,
            "",
            "## Context",
            opts.context.slice(0, 8000),
          ].join("\n")
        ),
      ],
      { stage, attempts: 2 }
    );
    const text = String(res.content ?? "").trim();
    if (text) {
      getProgress().emit(
        stage,
        "notify",
        `consult ok (${opts.asker}←${opts.advisor}, ${text.length} chars)`
      );
    }
    return text;
  } catch (err) {
    getProgress().emit(
      stage,
      "warning",
      `consult failed: ${errorText(err)}`
    );
    return "";
  }
}

async function timedStage<T>(
  name: string,
  fn: () => Promise<T>,
  meta?: {
    pendingSpecs?: string[];
    pendingQaSpecs?: string[];
    detail?: string;
    appRoot?: string;
    workflow?: string;
  }
): Promise<T> {
  const progress = getProgress();
  if (meta?.pendingSpecs || meta?.pendingQaSpecs) {
    progress.setPending({
      pendingSpecs: meta.pendingSpecs,
      pendingQaSpecs: meta.pendingQaSpecs,
    });
  }
  const started = Date.now();
  const budget = stageBudgetMs(name);
  const detail = meta?.detail ? `; ${meta.detail}` : "";
  progress.emit(
    name,
    "stage",
    `start${detail}; ${progress.remainingHint()}`
  );

  if (meta?.appRoot) {
    try {
      await updatePipelineStage(meta.appRoot, {
        stage: name,
        workflow: meta.workflow,
        pendingSpecs: meta.pendingSpecs,
        pendingQaSpecs: meta.pendingQaSpecs,
        traceId: getMetrics().traceId,
      });
    } catch {
      /* best-effort checkpoint */
    }
  }

  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        budgetTimer = setTimeout(() => {
          reject(
            new CircuitBreakerError(
              name,
              `wall-clock budget ${budget}ms exceeded`
            )
          );
        }, budget);
      }),
    ]);
    const ms = Date.now() - started;
    recordStageTiming(name, ms, true);
    progress.emit(name, "stage", `done in ${ms}ms`);
    if (result && typeof result === "object") {
      return {
        ...(result as Record<string, unknown>),
        notifications: progress.takeDelta(),
      } as T;
    }
    return result;
  } catch (err) {
    const ms = Date.now() - started;
    recordStageTiming(name, ms, false);
    progress.emit(
      name,
      "stage",
      `failed after ${ms}ms: ${errorText(err)}`
    );
    throw err;
  } finally {
    if (budgetTimer) clearTimeout(budgetTimer);
  }
}

// ============================================================
// 2. State + nodes
// ============================================================
const OrchestratorState = Annotation.Root({
  userIdea: Annotation<string>(),
  projectRoot: Annotation<string>(),
  /** Named route: full | docs | feature | punch | fix */
  workflow: Annotation<string>(),
  /** @deprecated Prefer workflow === "docs"; kept for compatibility */
  docsOnly: Annotation<boolean>(),
  workflowReason: Annotation<string>(),
  notifications: Annotation<string[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  /** Project resume (≤512 words) from bootstrap */
  resume: Annotation<string>(),
  pendingPreReqs: Annotation<string[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  completedPreReqs: Annotation<string[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  currentPreReq: Annotation<string>(),
  preReqTotal: Annotation<number>(),
  requirements: Annotation<string>(),
  techDesign: Annotation<string>(),
  todo: Annotation<string>(),
  pendingSpecs: Annotation<string[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  /** Slugs still needing SA → UX → TA draft pipeline (shrinks after TA enrich). */
  pendingSpecDrafts: Annotation<string[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  currentSpecSlug: Annotation<string>(),
  completedSpecs: Annotation<string[]>({
    reducer: (left, right) => [...new Set([...(left ?? []), ...(right ?? [])])],
    default: () => [],
  }),
  pendingQaSpecs: Annotation<string[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  currentSpec: Annotation<string>(),
  qaFailureLog: Annotation<string>(),
  qaFixRound: Annotation<number>(),
  bootstrapFixRound: Annotation<number>(),
  /** SE deliver→verify→redo rounds (mirrors qaFixRound). */
  deliveryFixRound: Annotation<number>(),
  /** Structured VERIFY FAIL feedback injected into next SE prompt. */
  deliveryVerifyFeedback: Annotation<string>(),
  fidelityFixRound: Annotation<number>(),
  architectureGaps: Annotation<string[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  qaFailureClass: Annotation<string>(),
  testsPassed: Annotation<boolean>(),
  traceId: Annotation<string>(),
  code: Annotation<string>(),
  tests: Annotation<string>(),
  /** Absolute app root resolved for this run */
  appRoot: Annotation<string>(),
  filesWritten: Annotation<string[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  fidelityWarnings: Annotation<string[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  failureKind: Annotation<string>(),
  resumeHint: Annotation<string>(),
  /** SA post-dev summary for the human owner */
  projectSummary: Annotation<string>(),
  /** SA disposition of QA tech debt */
  techDebtDisposition: Annotation<string>(),
  /** Plan-mode action plan for the user to decide */
  techDebtActionPlan: Annotation<string>(),
  /** Combined markdown report presented to the user */
  userReport: Annotation<string>(),
  /** After summary: whether SA should review tech-debt.md */
  pendingTechDebtReview: Annotation<boolean>(),
});

type OrchestratorStateType = typeof OrchestratorState.State;

function appRootOf(state: OrchestratorStateType): string {
  const workspace = getWorkspaceRoot();
  const appRoot = state.appRoot?.trim()
    ? resolve(state.appRoot)
    : resolveAppRoot(state.projectRoot || ".");
  assertSafeAppRoot(appRoot, state.projectRoot || ".");
  assertExpectedWorkspace(workspace);
  assertPathInsideWorkspace(workspace, appRoot);
  return appRoot;
}

/**
 * Whether bootstrap should overwrite requirements.md with the stub.
 * Preserves real ## sections unless ZTEAM_FORCE_BOOTSTRAP=1.
 */
export function shouldWriteRequirementsStub(
  existing: string | null | undefined,
  force =
    process.env.ZTEAM_FORCE_BOOTSTRAP === "1" ||
    process.env.ZTEAM_FORCE_BOOTSTRAP === "true"
): boolean {
  if (force) return true;
  if (!existing || !String(existing).trim()) return true;
  if (String(existing).startsWith("[Document missing:")) return true;
  const text = String(existing);
  const hasSections = /^##\s+/m.test(text);
  if (hasSections && text.trim().length >= 80) return false;
  return true;
}

/** Heuristic fidelity checks: userIdea claims vs requirements text. */
export function findFidelityViolations(
  userIdea: string,
  requirements: string
): string[] {
  const idea = userIdea.toLowerCase();
  const req = requirements.toLowerCase();
  const violations: string[] = [];

  const infiniteLives =
    /\b(vidas?\s+infinit|infinite\s+lives?|unlimited\s+lives?|death\s*counter|contador\s+de\s+mortes)\b/i.test(
      idea
    );
  if (infiniteLives) {
    if (/\b(3\s+lives|três\s+vidas|3\s+vidas|lives?\s*[:=]?\s*3)\b/i.test(req)) {
      violations.push("requirements mention finite/3 lives but userIdea asks infinite lives");
    }
    if (/\bgame\s*over\b/i.test(req) && !/\binfinite|unlimited|death\s*count/i.test(req)) {
      violations.push("requirements emphasize game-over without aligning to infinite lives / death counter");
    }
  }

  if (/\btypescript\b/i.test(idea) && /\b(plain\s+js|javascript\s+only|es2020\s+js)\b/i.test(req)) {
    violations.push("userIdea asks TypeScript but requirements drift to plain JS");
  }
  if (
    /\b(hooks?\s+de\s+som|sound\s+hooks?|no\s+audio|sem\s+som|document(?:ed)?\s+hooks)\b/i.test(
      idea
    ) &&
    /\b(sprite\s+sheet|web\s+audio\s+api|full\s+soundtrack)\b/i.test(req) &&
    !/\bhook/i.test(req)
  ) {
    violations.push("userIdea wants sound hooks only; requirements invent fuller audio");
  }

  // Named API in idea must appear in requirements (TCGdex vs pokemontcg drift)
  const apiTokens =
    userIdea.match(
      /\b(TCGdex|pokemontcg(?:\.io)?|PokeAPI|Stripe|OpenAI)[a-zA-Z0-9.-]*/gi
    ) || [];
  for (const token of apiTokens) {
    if (!req.includes(token.toLowerCase())) {
      violations.push(
        `userIdea names API/product '${token}' but requirements omit it`
      );
    }
  }

  // Stub / empty requirements — stub line alone fails; stub + real ## sections is OK
  // (bootstrap writes the italic placeholder; SA appends sections without removing it)
  const hasSections = /^##\s+/m.test(requirements);
  if (
    !requirements.trim() ||
    requirements.trim().length < 80 ||
    (/Sections are filled one pré-requirement/i.test(requirements) &&
      !hasSections)
  ) {
    violations.push("requirements empty or still bootstrap stub");
  }

  return violations;
}

async function splitOversizedSpec(
  appRoot: string,
  slug: string,
  specBody: string
): Promise<{ pending: string[]; message: string }> {
  const a = `${slug}-a`;
  const b = `${slug}-b`;
  const mid = Math.floor(specBody.length / 2);
  const splitAt = specBody.lastIndexOf("\n## ", mid > 0 ? mid : specBody.length);
  const cut = splitAt > 80 ? splitAt : mid;
  const partA = specBody.slice(0, cut).trim() || `# ${a}\n\nPartial implementation of ${slug} (part A).\n`;
  const partB =
    specBody.slice(cut).trim() ||
    `# ${b}\n\nPartial implementation of ${slug} (part B).\n`;

  await writeDoc(
    appRoot,
    specPath(a),
    [`# ${a}`, "", `Split from oversized spec \`${slug}\`.`, "", partA].join("\n") +
      "\n"
  );
  await writeDoc(
    appRoot,
    specPath(b),
    [`# ${b}`, "", `Split from oversized spec \`${slug}\`.`, "", partB].join("\n") +
      "\n"
  );

  let todo = await readDoc(appRoot, TODO_PATH);
  if (!todo.startsWith("[Document missing:")) {
    todo = todo.replace(
      new RegExp(`^(-\\s*\\[)[ xX](\\]\\s*${slug}\\s*:.*)`, "gim"),
      "$1x$2 (superseded by split)"
    );
  } else {
    todo = "";
  }
  const extra = [
    `- [ ] ${a}: ${slug} part A (auto-split)`,
    `- [ ] ${b}: ${slug} part B (auto-split)`,
    "",
  ].join("\n");
  await writeDoc(appRoot, TODO_PATH, (todo.trimEnd() + "\n" + extra).trimEnd() + "\n");

  return {
    pending: [a, b],
    message: `Auto-split oversized spec '${slug}' → '${a}' + '${b}'`,
  };
}

async function writePipelineResult(
  appRoot: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const arch = await readArchitectureProgress(appRoot);
    const impl = await readImplementationProgress(appRoot);
    const merged = {
      ...payload,
      ...metricsSnapshot(),
      sandbox: sandboxConfig().enabled,
      architecture: architectureSnapshot(arch),
      implementation: implementationSnapshot(impl),
    };
    await writeDoc(
      appRoot,
      PIPELINE_RESULT_PATH,
      JSON.stringify(merged, null, 2) + "\n"
    );
  } catch {
    /* best-effort */
  }
}

async function orchestratorBootstrapReadmeNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("orchestratorBootstrapReadme", async () => {
    const appRoot = appRootOf(state);
    await mkdir(appRoot, { recursive: true });

    const sa = roleLlm("systemArchitect");
    const messages = [
      new SystemMessage(systemArchitectBootstrapPrompt(MAX_RESUME_WORDS)),
      new HumanMessage(
        [
          `Project root (relative): ${state.projectRoot || "."}`,
          "",
          "## User idea",
          state.userIdea,
        ].join("\n")
      ),
    ];

    let resume: string;
    let preRequirements: string[];
    try {
      const res = await invokeRoleLlm("systemArchitect", messages, {
        stage: "orchestratorBootstrapReadme",
        validate: (c) =>
          assertParsedResumeAndPreRequirements(c, "orchestratorBootstrapReadme"),
      });
      const parsed = parseResumeAndPreRequirements(String(res.content ?? ""));
      if (!parsed) {
        throw new LlmContentError(
          "orchestratorBootstrapReadme",
          "parse_failed",
          "parse null after validate"
        );
      }
      resume = parsed.resume;
      preRequirements = parsed.preRequirements;
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      const kind = contentKindOf(err);
      throw classifiedError(
        `[orchestratorBootstrapReadme] llm_empty after retries (${kind}): ${errorText(err)}`,
        "llm_empty",
        `workflow=full — charter failed (empty LLM); retry after model/tunnel healthy`
      );
    }

    await writeDoc(
      appRoot,
      README_PATH,
      buildBootstrapReadme(resume, preRequirements)
    );
    const existingReqs = await readDoc(appRoot, REQUIREMENTS_PATH);
    const reqBody = existingReqs.startsWith("[Document missing:")
      ? ""
      : existingReqs;
    if (shouldWriteRequirementsStub(reqBody)) {
      await writeDoc(
        appRoot,
        REQUIREMENTS_PATH,
        "# Requirements\n\n_Sections are filled one pré-requirement at a time._\n"
      );
    } else {
      notify(
        "orchestratorBootstrapReadme",
        "preserved existing requirements.md (has ## sections; set ZTEAM_FORCE_BOOTSTRAP=1 to wipe)"
      );
    }

    const preview = preRequirements
      .slice(0, 5)
      .map((p, i) => `${i + 1}. ${p.slice(0, 80)}`)
      .join(" | ");
    const more =
      preRequirements.length > 5
        ? ` (+${preRequirements.length - 5})`
        : "";
    getProgress().setPending({
      pendingPreReqs: preRequirements,
      preReqIndex: 1,
      preReqTotal: preRequirements.length,
    });
    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "orchestratorBootstrapReadme",
      `charter pronto — ${preRequirements.length} pré-reqs: ${preview}${more}`,
      {
        phase: "requirements",
        traceId: getMetrics().traceId,
        preReqs: {
          total: preRequirements.length,
          completed: 0,
          current: preRequirements[0] ?? "",
          titles: [],
        },
      }
    );

    return {
      resume,
      pendingPreReqs: preRequirements,
      completedPreReqs: [],
      preReqTotal: preRequirements.length,
      currentPreReq: preRequirements[0] ?? "",
      requirements: "",
    };
  });
}

async function systemArchitectReqItemNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  const pending = [...(state.pendingPreReqs ?? [])];
  const item = pending[0] ?? state.currentPreReq ?? "";
  const index =
    (state.preReqTotal ?? pending.length) - pending.length + 1;
  const total = state.preReqTotal ?? pending.length;

  return timedStage(
    "systemArchitectReqItem",
    async () => {
      const appRoot = appRootOf(state);
      if (!item.trim()) {
        notify("systemArchitectReqItem", "No pending pré-req; skipping");
        return {};
      }

      getProgress().setPending({
        pendingPreReqs: pending,
        preReqIndex: index,
        preReqTotal: total,
      });
      await archNotify(
        (s, m) => notify(s, m),
        appRoot,
        "systemArchitectReqItem",
        `pré-req ${index}/${total} em andamento: ${item.slice(0, 120)}`,
        {
          phase: "requirements",
          preReqs: {
            total,
            completed: Math.max(0, index - 1),
            current: item,
            titles: [],
          },
        }
      );

      const existingReqs = await readDoc(appRoot, REQUIREMENTS_PATH);
      const resume =
        state.resume ||
        "See README Resume — expand only the current pré-requirement.";

      const sa = roleLlm("systemArchitect");
      const messages = [
        new SystemMessage(systemArchitectReqItemPrompt(String(index))),
        new HumanMessage(
          [
            "## Original user idea (source of truth)",
            state.userIdea,
            "",
            "## Resume",
            resume,
            "",
            `## Current pré-requirement (${index}/${total})`,
            item,
            "",
            "## Existing .docs/requirements.md (do not repeat; append only)",
            existingReqs,
          ].join("\n")
        ),
      ];

      let section: string;
      try {
        const res = await invokeRoleLlm("systemArchitect", messages, {
          stage: "systemArchitectReqItem",
          validate: (c) => {
            assertUsableLlmText(c, "systemArchitectReqItem");
            const { body, check } = splitSelfCheck(
              stripOuterMarkdownFence(c)
            );
            const sc = validateSaRequirementsSelfCheck(check);
            if (!sc.ok) {
              throw new LlmContentError(
                "systemArchitectReqItem",
                "parse_failed",
                sc.message
              );
            }
            if (!/^##\s+/m.test(body.trim())) {
              throw new LlmContentError(
                "systemArchitectReqItem",
                "parse_failed",
                "expected a ## heading section before ===SELF_CHECK==="
              );
            }
          },
        });
        const split = splitSelfCheck(
          stripOuterMarkdownFence(String(res.content ?? ""))
        );
        section = split.body.trim();
      } catch (err) {
        if (
          !(err instanceof LlmRetriesExhaustedError) &&
          !(err instanceof LlmContentError)
        ) {
          throw err;
        }
        recordLlmEmpty();
        throw classifiedError(
          `[systemArchitectReqItem] llm_empty after retries (${contentKindOf(err)})`,
          "llm_empty",
          `workflow=resume — pré-req ${index} failed empty LLM`
        );
      }

      if (!section.startsWith("##")) {
        section = `## ${index}. ${item.slice(0, 80)}\n\n${section}`;
      }

      const base = (await readDoc(appRoot, REQUIREMENTS_PATH)).trimEnd();
      const next =
        (base.startsWith("[Document missing:")
          ? "# Requirements"
          : base) +
        "\n\n" +
        section +
        "\n";
      await writeDoc(appRoot, REQUIREMENTS_PATH, next);

      const sectionTitle = extractSectionTitle(section);
      await archNotify(
        (s, m) => notify(s, m),
        appRoot,
        "systemArchitectReqItem",
        `pré-req ${index}/${total} escrito: ${sectionTitle || item.slice(0, 80)}`,
        {
          phase: "requirements",
          preReqs: {
            total,
            completed: Math.max(0, index - 1),
            current: item,
          },
        }
      );

      return {
        currentPreReq: item,
        requirements: next,
      };
    },
    {
      detail: `pré-req ${index}/${total}: ${item.slice(0, 60)}`,
    }
  );
}

async function orchestratorAfterPreReqNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("orchestratorAfterPreReq", async () => {
    const appRoot = appRootOf(state);
    const pending = [...(state.pendingPreReqs ?? [])];
    const doneItem = pending[0] ?? state.currentPreReq ?? "";
    const remaining = pending.slice(1);
    const total = state.preReqTotal ?? pending.length;
    const completedCount = (state.completedPreReqs ?? []).length + 1;

    const reqs = await readDoc(appRoot, REQUIREMENTS_PATH);
    const allHeadings = [...reqs.matchAll(/^##\s+(.+)$/gm)].map((m) =>
      m[1].trim()
    );
    const title = allHeadings[allHeadings.length - 1] || doneItem.slice(0, 100);

    getProgress().setPending({
      pendingPreReqs: remaining,
      preReqIndex: remaining.length > 0 ? completedCount + 1 : total,
      preReqTotal: total,
    });

    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "orchestratorAfterPreReq",
      `pré-req ${completedCount}/${total} feito: ${title.slice(0, 100)}${
        remaining.length ? ` — faltam ${remaining.length}` : " — todos feitos"
      }`,
      {
        phase: "requirements",
        preReqs: {
          total,
          completed: completedCount,
          current: remaining[0] ?? "",
          titles: allHeadings,
        },
      }
    );

    return {
      pendingPreReqs: remaining,
      completedPreReqs: doneItem ? [doneItem] : [],
      currentPreReq: remaining[0] ?? "",
    };
  });
}

async function orchestratorCleanReadmeNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("orchestratorCleanReadme", async () => {
    const appRoot = appRootOf(state);
    const resume =
      state.resume?.trim() ||
      clampResumeWords(`This project implements: ${state.userIdea}`);
    let reqs = await readDoc(appRoot, REQUIREMENTS_PATH);
    // Strip bootstrap placeholder so fidelityCritic does not hard-fail after SA filled sections
    if (
      !reqs.startsWith("[Document missing:") &&
      /Sections are filled one pré-requirement/i.test(reqs)
    ) {
      reqs = reqs
        .replace(/\n*_Sections are filled one pré-requirement at a time\._\n*/gi, "\n")
        .replace(/\n{3,}/g, "\n\n");
      await writeDoc(appRoot, REQUIREMENTS_PATH, reqs.trimEnd() + "\n");
    }

    await writeDoc(appRoot, README_PATH, buildCleanReadme(resume));

    const n = (state.completedPreReqs ?? []).length || state.preReqTotal || 0;
    getProgress().setPending({
      pendingPreReqs: [],
      preReqIndex: n,
      preReqTotal: n,
    });
    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "orchestratorCleanReadme",
      `requirements phase DONE (${n} pré-reqs) → UI/UX juice`,
      {
        phase: "requirements",
        preReqs: {
          total: state.preReqTotal ?? n,
          completed: n,
          current: "",
          titles: [],
        },
      }
    );

    return {
      resume,
      requirements: reqs.startsWith("[Document missing:") ? "" : reqs,
      pendingPreReqs: [],
    };
  });
}

async function uiUxRequirementsNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("uiUxRequirements", async () => {
    const appRoot = appRootOf(state);
    const [readme, requirementsFromDisk] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
    ]);
    const requirements = requirementsFromDisk.startsWith("[Document missing:")
      ? ""
      : requirementsFromDisk;

    const messages = [
      new SystemMessage(uiUxRequirementsPrompt()),
      new HumanMessage(
        [
          "## Original user idea (source of truth)",
          state.userIdea,
          "",
          "## README.md",
          readme,
          "",
          "## .docs/requirements.md",
          requirements || "(empty — still score and propose juice guidance)",
        ].join("\n")
      ),
    ];

    let parsed;
    try {
      const res = await invokeRoleLlm("uiUxDesigner", messages, {
        stage: "uiUxRequirements",
        validate: (c) => {
          assertUsableLlmText(c, "uiUxRequirements");
          const p = parseUiUxRequirementsResponse(c);
          const v = validateUiUxRequirementsResponse(p);
          if (!v.ok) {
            throw new LlmContentError(
              "uiUxRequirements",
              "parse_failed",
              v.message
            );
          }
        },
      });
      parsed = parseUiUxRequirementsResponse(String(res.content ?? ""));
      const v = validateUiUxRequirementsResponse(parsed);
      if (!parsed || !v.ok) {
        throw new LlmContentError(
          "uiUxRequirements",
          "parse_failed",
          v.message
        );
      }
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[uiUxRequirements] llm_empty after retries (${contentKindOf(err)}): ${errorText(err)}`,
        "llm_empty",
        "workflow=docs — UX juice addendum failed; re-run after SA requirements"
      );
    }

    const nextReqs = upsertRequirementsUxAddendum(
      requirements || "# Requirements\n",
      parsed!.addendum
    );
    await writeDoc(appRoot, REQUIREMENTS_PATH, nextReqs.endsWith("\n") ? nextReqs : nextReqs + "\n");

    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "uiUxRequirements",
      `UX juice ${parsed!.scoreBefore}→${parsed!.scoreAfter}/10 (addendum written)`,
      {
        phase: "requirements",
      }
    );

    return {
      requirements: nextReqs,
    };
  });
}

async function technologyArchitectNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("technologyArchitect", async () => {
    const appRoot = appRootOf(state);
    const [readmeFromDisk, requirementsFromDisk] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
    ]);

    const ta = roleLlm("technologyArchitect");
    void ta;
    const messages = [
      new SystemMessage(technologyArchitectPrompt()),
      new HumanMessage(
        [
          "## README.md",
          readmeFromDisk,
          "",
          "## .docs/requirements.md",
          requirementsFromDisk,
          (state.architectureGaps ?? []).length > 0
            ? [
                "",
                "## Architecture critic gaps (must address on this redo)",
                ...(state.architectureGaps ?? []).map((g) => `- ${g}`),
                state.currentPreReq
                  ? `\n## SA consult / guidance\n${state.currentPreReq}`
                  : "",
              ].join("\n")
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      ),
    ];

    let raw: string;
    try {
      const res = await invokeRoleLlm("technologyArchitect", messages, {
        stage: "technologyArchitect",
        validate: (c) => {
          const { body, check } = splitSelfCheck(c);
          const sc = validateKeyedSelfCheck(check, TA_SELF_CHECK_KEYS);
          if (!sc.ok) {
            throw new LlmContentError(
              "technologyArchitect",
              "parse_failed",
              sc.message
            );
          }
          assertParsedTechSummaryAndBody(body, "technologyArchitect");
        },
      });
      raw = splitSelfCheck(String(res.content ?? "")).body;
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[technologyArchitect] llm_empty after retries (${contentKindOf(err)}): ${errorText(err)}`,
        "llm_empty",
        `workflow=docs or resume — TA failed empty LLM; do not use TBD stub`
      );
    }

    const parsed = parseTechSummaryAndBody(raw);
    const techDesign = parsed
      ? stripOuterMarkdownFence(parsed.tech)
      : stripOuterMarkdownFence(raw);
    const rawSummary = parsed?.summary?.trim() ?? "";
    const techSummary =
      rawSummary.length >= 40 && !/^[,`'"]+$/.test(rawSummary)
        ? rawSummary
        : "Technology decisions (stack, folder layout, standards) are documented below.";

    await writeDoc(appRoot, TECHNOLOGIES_PATH, techDesign);

    let readme = await readDoc(appRoot, README_PATH);
    readme = upsertReadmeSection(
      readme,
      "Technology",
      [
        techSummary,
        "",
        `- [Technology decisions](${TECHNOLOGIES_PATH}) — stack, folder architecture, standards`,
      ].join("\n")
    );
    // Keep Documentation list in sync
    if (
      !readme.includes(`- [Technology decisions](${TECHNOLOGIES_PATH})`)
    ) {
      readme = readme.replace(
        `- [Requirements](${REQUIREMENTS_PATH}) — business vision, functional/NFR, high-level architecture`,
        [
          `- [Requirements](${REQUIREMENTS_PATH}) — business vision, functional/NFR, high-level architecture`,
          `- [Technology decisions](${TECHNOLOGIES_PATH}) — stack, folder architecture, standards`,
        ].join("\n")
      );
    }
    await writeDoc(appRoot, README_PATH, readme);

    const techInfo = summarizeTech(techSummary, techDesign);
    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "technologyArchitect",
      `tech: ${techInfo.summary}${
        techInfo.headingsPresent.length
          ? ` | headings: ${techInfo.headingsPresent.join(", ")}`
          : ""
      }`,
      {
        phase: "technology",
        technology: techInfo,
      }
    );

    return { techDesign };
  });
}

async function uiUxDesignSystemNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("uiUxDesignSystem", async () => {
    const appRoot = appRootOf(state);
    const [readme, requirements, technologies] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
    ]);

    const messages = [
      new SystemMessage(uiUxDesignSystemPrompt()),
      new HumanMessage(
        [
          "## Original user idea",
          state.userIdea,
          "",
          "## README.md",
          readme,
          "",
          "## .docs/requirements.md",
          requirements,
          "",
          "## .docs/technologies.md",
          technologies,
        ].join("\n")
      ),
    ];

    let designMd: string;
    try {
      const res = await invokeRoleLlm("uiUxDesigner", messages, {
        stage: "uiUxDesignSystem",
        validate: (c) => {
          assertUsableLlmText(c, "uiUxDesignSystem");
          const p = parseUiUxDesignSystemResponse(c);
          const v = validateUiUxDesignSystemResponse(p);
          if (!v.ok) {
            throw new LlmContentError(
              "uiUxDesignSystem",
              "parse_failed",
              v.message
            );
          }
        },
      });
      const parsed = parseUiUxDesignSystemResponse(String(res.content ?? ""));
      const v = validateUiUxDesignSystemResponse(parsed);
      if (!parsed || !v.ok) {
        throw new LlmContentError(
          "uiUxDesignSystem",
          "parse_failed",
          v.message
        );
      }
      designMd = parsed.design;
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[uiUxDesignSystem] llm_empty after retries (${contentKindOf(err)}): ${errorText(err)}`,
        "llm_empty",
        "workflow=docs — UI/UX look-and-feel doc failed after technologies"
      );
    }

    await writeDoc(
      appRoot,
      UI_UX_PATH,
      designMd.endsWith("\n") ? designMd : designMd + "\n"
    );

    let readmeNext = await readDoc(appRoot, README_PATH);
    const uxLink = `- [UI/UX look and feel](${UI_UX_PATH}) — style, palette, sensory behavior, emotion strategies`;
    if (!readmeNext.includes(`[UI/UX look and feel](${UI_UX_PATH})`)) {
      if (readmeNext.includes(`[Technology decisions](${TECHNOLOGIES_PATH})`)) {
        readmeNext = readmeNext.replace(
          `- [Technology decisions](${TECHNOLOGIES_PATH}) — stack, folder architecture, standards`,
          [
            `- [Technology decisions](${TECHNOLOGIES_PATH}) — stack, folder architecture, standards`,
            uxLink,
          ].join("\n")
        );
      } else if (readmeNext.includes("## Documentation")) {
        readmeNext = upsertReadmeSection(
          readmeNext,
          "Documentation",
          [
            `- [Requirements](${REQUIREMENTS_PATH}) — functional and non-functional requirements`,
            `- [Technology decisions](${TECHNOLOGIES_PATH}) — stack, folder architecture, standards`,
            uxLink,
          ].join("\n")
        );
      } else {
        readmeNext = `${readmeNext.trimEnd()}\n\n## Documentation\n\n${uxLink}\n`;
      }
      await writeDoc(appRoot, README_PATH, readmeNext);
    }

    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "uiUxDesignSystem",
      `wrote ${UI_UX_PATH} (look-and-feel + evidence-based emotion strategies)`,
      { phase: "technology" }
    );

    return {};
  });
}

async function systemArchitectTodoPlanNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("systemArchitectTodoPlan", async () => {
    const appRoot = appRootOf(state);
    const [readme, requirements, technologies, uiUx] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
      readDoc(appRoot, UI_UX_PATH),
    ]);

    const messages = [
      new SystemMessage(systemArchitectTodoPlanPrompt()),
      new HumanMessage(
        [
          "## Original user idea",
          state.userIdea,
          "",
          "## README.md",
          readme,
          "",
          "## .docs/requirements.md",
          requirements,
          "",
          "## .docs/technologies.md",
          technologies,
          "",
          "## .docs/ui-ux.md",
          uiUx.startsWith("[Document missing:")
            ? "(optional context)"
            : uiUx,
        ].join("\n")
      ),
    ];

    let todoMd: string;
    let planNotes: string;
    try {
      const res = await invokeRoleLlm("systemArchitect", messages, {
        stage: "systemArchitectTodoPlan",
        validate: (c) => {
          assertUsableLlmText(c, "systemArchitectTodoPlan");
          const p = parseTodoPlanResponse(c);
          const sc = validateKeyedSelfCheck(
            p?.check ?? null,
            SA_TODO_PLAN_SELF_CHECK_KEYS
          );
          if (!p || !sc.ok) {
            throw new LlmContentError(
              "systemArchitectTodoPlan",
              "parse_failed",
              sc.message || "expected ===PLAN=== + ===TODO=== + SELF_CHECK"
            );
          }
        },
      });
      const parsed = parseTodoPlanResponse(String(res.content ?? ""));
      const sc = validateKeyedSelfCheck(
        parsed?.check ?? null,
        SA_TODO_PLAN_SELF_CHECK_KEYS
      );
      if (!parsed || !sc.ok) {
        throw new LlmContentError(
          "systemArchitectTodoPlan",
          "parse_failed",
          sc.message
        );
      }
      todoMd = parsed.todo;
      planNotes = parsed.plan;
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[systemArchitectTodoPlan] llm_empty after retries (${contentKindOf(err)}): ${errorText(err)}`,
        "llm_empty",
        "workflow=feature — todo plan failed"
      );
    }

    const withPlan =
      planNotes.trim().length > 0
        ? `# Todo\n\n## Plan notes\n\n${planNotes.trim()}\n\n## Checklist\n\n${todoMd.trim()}\n`
        : todoMd.endsWith("\n")
          ? todoMd
          : todoMd + "\n";
    await writeDoc(appRoot, TODO_PATH, withPlan.endsWith("\n") ? withPlan : withPlan + "\n");

    const pending = parseTodoChecklist(withPlan)
      .filter((t) => !t.done)
      .map((t) => t.slug);
    if (pending.length === 0) {
      throw classifiedError(
        "[systemArchitectTodoPlan] todo checklist empty",
        "spec_incomplete",
        "workflow=feature — SA must emit at least one - [ ] slug: title"
      );
    }

    let readmeUpdated = await readDoc(appRoot, README_PATH);
    readmeUpdated = upsertReadmeSection(
      readmeUpdated,
      "Implementation plan",
      [
        "Tasks and specs for spec-driven development (SA → UI/UX → TA per slug):",
        "",
        `- [Todo](${TODO_PATH}) — deliverable checklist`,
        `- Specs in [\`${SPECS_DIR}/\`](${SPECS_DIR}/) — one \`.spec.md\` per todo item`,
      ].join("\n")
    );
    await writeDoc(appRoot, README_PATH, readmeUpdated);

    getProgress().setPending({
      pendingSpecs: pending,
      pendingQaSpecs: [...pending],
      pendingPreReqs: [],
    });

    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "systemArchitectTodoPlan",
      `todo planned: ${pending.length} specs — ${formatSlugList(pending)}`,
      {
        phase: "specs",
        specs: { count: pending.length, slugs: pending },
      }
    );

    return {
      todo: withPlan,
      pendingSpecs: pending,
      pendingSpecDrafts: pending,
      pendingQaSpecs: [...pending],
      currentSpecSlug: pending[0] || "",
      completedSpecs: [],
    };
  });
}

async function systemArchitectSpecItemNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("systemArchitectSpecItem", async () => {
    const appRoot = appRootOf(state);
    const drafts = [...(state.pendingSpecDrafts ?? [])];
    const slug = drafts[0] || state.currentSpecSlug || "";
    if (!slug) {
      notify("systemArchitectSpecItem", "No pending spec drafts; skipping");
      return { pendingSpecDrafts: [] };
    }

    const [requirements, todo, technologies] = await Promise.all([
      readDoc(appRoot, REQUIREMENTS_PATH),
      readDoc(appRoot, TODO_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
    ]);
    const todoItem = parseTodoChecklist(todo).find((t) => t.slug === slug);

    const messages = [
      new SystemMessage(systemArchitectSpecItemPrompt(slug)),
      new HumanMessage(
        [
          `## Current todo item: ${slug}`,
          todoItem ? `${todoItem.slug}: ${todoItem.title}` : slug,
          "",
          "## .docs/todo.md",
          todo,
          "",
          "## .docs/requirements.md",
          requirements,
          "",
          "## .docs/technologies.md (context only — TA will deepen tech later)",
          technologies.startsWith("[Document missing:")
            ? "(missing)"
            : technologies.slice(0, 4000),
        ].join("\n")
      ),
    ];

    let content: string;
    try {
      const res = await invokeRoleLlm("systemArchitect", messages, {
        stage: "systemArchitectSpecItem",
        validate: (c) => {
          assertUsableLlmText(c, "systemArchitectSpecItem");
          const p = parseSingleSpecResponse(c, slug);
          const sc = validateKeyedSelfCheck(
            p?.check ?? null,
            SA_SPEC_ITEM_SELF_CHECK_KEYS
          );
          if (!p || !sc.ok) {
            throw new LlmContentError(
              "systemArchitectSpecItem",
              "parse_failed",
              sc.message || `expected ===SPEC: ${slug}=== + SELF_CHECK`
            );
          }
          try {
            assertFilesToTouchClean(p.content, slug);
            assertSpecUseCasesMinimum(p.content, "systemArchitectSpecItem");
          } catch (err) {
            throw new LlmContentError(
              "systemArchitectSpecItem",
              "parse_failed",
              errorText(err)
            );
          }
        },
      });
      const parsed = parseSingleSpecResponse(String(res.content ?? ""), slug);
      const sc = validateKeyedSelfCheck(
        parsed?.check ?? null,
        SA_SPEC_ITEM_SELF_CHECK_KEYS
      );
      if (!parsed || !sc.ok) {
        throw new LlmContentError(
          "systemArchitectSpecItem",
          "parse_failed",
          sc.message
        );
      }
      content = parsed.content;
      try {
        assertFilesToTouchClean(content, slug);
        assertSpecUseCasesMinimum(content, "systemArchitectSpecItem");
      } catch (err) {
        throw new LlmContentError(
          "systemArchitectSpecItem",
          "parse_failed",
          errorText(err)
        );
      }
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[systemArchitectSpecItem] ${slug} failed (${contentKindOf(err)}): ${errorText(err)}`,
        "llm_empty",
        `workflow=feature — regenerate spec ${slug}`
      );
    }

    await writeDoc(appRoot, specPath(slug), content.endsWith("\n") ? content : content + "\n");
    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "systemArchitectSpecItem",
      `SA draft spec: ${slug}`,
      { phase: "specs", specs: { current: slug } }
    );
    return { currentSpecSlug: slug };
  });
}

async function uiUxSpecEnrichNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("uiUxSpecEnrich", async () => {
    const appRoot = appRootOf(state);
    const slug =
      state.currentSpecSlug ||
      (state.pendingSpecDrafts ?? [])[0] ||
      "";
    if (!slug) {
      notify("uiUxSpecEnrich", "No current spec; skipping");
      return {};
    }

    const [specBody, requirements, uiUx] = await Promise.all([
      readDoc(appRoot, specPath(slug)),
      readDoc(appRoot, REQUIREMENTS_PATH),
      readDoc(appRoot, UI_UX_PATH),
    ]);

    const messages = [
      new SystemMessage(uiUxSpecEnrichPrompt(slug)),
      new HumanMessage(
        [
          `## Current spec (${slug})`,
          specBody,
          "",
          "## .docs/ui-ux.md",
          uiUx.startsWith("[Document missing:")
            ? "(missing — apply general juice/usability)"
            : uiUx,
          "",
          "## .docs/requirements.md",
          requirements.slice(0, 6000),
        ].join("\n")
      ),
    ];

    let content: string;
    try {
      const res = await invokeRoleLlm("uiUxDesigner", messages, {
        stage: "uiUxSpecEnrich",
        validate: (c) => {
          assertUsableLlmText(c, "uiUxSpecEnrich");
          const p = parseSingleSpecResponse(c, slug);
          const sc = validateKeyedSelfCheck(
            p?.check ?? null,
            UX_SPEC_ENRICH_SELF_CHECK_KEYS
          );
          if (!p || !sc.ok) {
            throw new LlmContentError(
              "uiUxSpecEnrich",
              "parse_failed",
              sc.message || `expected ===SPEC: ${slug}=== + SELF_CHECK`
            );
          }
          try {
            assertSpecUseCasesMinimum(p.content, "uiUxSpecEnrich");
          } catch (err) {
            throw new LlmContentError(
              "uiUxSpecEnrich",
              "parse_failed",
              errorText(err)
            );
          }
        },
      });
      const parsed = parseSingleSpecResponse(String(res.content ?? ""), slug);
      const sc = validateKeyedSelfCheck(
        parsed?.check ?? null,
        UX_SPEC_ENRICH_SELF_CHECK_KEYS
      );
      if (!parsed || !sc.ok) {
        throw new LlmContentError(
          "uiUxSpecEnrich",
          "parse_failed",
          sc.message
        );
      }
      content = parsed.content;
      try {
        assertSpecUseCasesMinimum(content, "uiUxSpecEnrich");
      } catch (err) {
        throw new LlmContentError(
          "uiUxSpecEnrich",
          "parse_failed",
          errorText(err)
        );
      }
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[uiUxSpecEnrich] ${slug} failed (${contentKindOf(err)}): ${errorText(err)}`,
        "llm_empty",
        `workflow=feature — UX enrich ${slug}`
      );
    }

    await writeDoc(appRoot, specPath(slug), content.endsWith("\n") ? content : content + "\n");
    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "uiUxSpecEnrich",
      `UX enriched spec: ${slug}`,
      { phase: "specs", specs: { current: slug } }
    );
    return { currentSpecSlug: slug };
  });
}

async function technologyArchitectSpecEnrichNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("technologyArchitectSpecEnrich", async () => {
    const appRoot = appRootOf(state);
    const slug =
      state.currentSpecSlug ||
      (state.pendingSpecDrafts ?? [])[0] ||
      "";
    if (!slug) {
      notify("technologyArchitectSpecEnrich", "No current spec; skipping");
      return { pendingSpecDrafts: [] };
    }

    const [specBody, technologies, uiUx] = await Promise.all([
      readDoc(appRoot, specPath(slug)),
      readDoc(appRoot, TECHNOLOGIES_PATH),
      readDoc(appRoot, UI_UX_PATH),
    ]);

    const messages = [
      new SystemMessage(technologyArchitectSpecEnrichPrompt(slug)),
      new HumanMessage(
        [
          `## Current spec (${slug})`,
          specBody,
          "",
          "## .docs/technologies.md",
          technologies,
          "",
          "## .docs/ui-ux.md",
          uiUx.startsWith("[Document missing:") ? "(missing)" : uiUx,
        ].join("\n")
      ),
    ];

    let content: string;
    try {
      const res = await invokeRoleLlm("technologyArchitect", messages, {
        stage: "technologyArchitectSpecEnrich",
        validate: (c) => {
          assertUsableLlmText(c, "technologyArchitectSpecEnrich");
          const p = parseSingleSpecResponse(c, slug);
          const sc = validateKeyedSelfCheck(
            p?.check ?? null,
            TA_SPEC_ENRICH_SELF_CHECK_KEYS
          );
          if (!p || !sc.ok) {
            throw new LlmContentError(
              "technologyArchitectSpecEnrich",
              "parse_failed",
              sc.message || `expected ===SPEC: ${slug}=== + SELF_CHECK`
            );
          }
          try {
            assertFilesToTouchClean(p.content, slug);
            assertSpecUseCasesMinimum(
              p.content,
              "technologyArchitectSpecEnrich"
            );
          } catch (err) {
            throw new LlmContentError(
              "technologyArchitectSpecEnrich",
              "parse_failed",
              errorText(err)
            );
          }
        },
      });
      const parsed = parseSingleSpecResponse(String(res.content ?? ""), slug);
      const sc = validateKeyedSelfCheck(
        parsed?.check ?? null,
        TA_SPEC_ENRICH_SELF_CHECK_KEYS
      );
      if (!parsed || !sc.ok) {
        throw new LlmContentError(
          "technologyArchitectSpecEnrich",
          "parse_failed",
          sc.message
        );
      }
      content = parsed.content;
      assertFilesToTouchClean(content, slug);
      assertSpecUseCasesMinimum(content, "technologyArchitectSpecEnrich");
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[technologyArchitectSpecEnrich] ${slug} failed (${contentKindOf(err)}): ${errorText(err)}`,
        err instanceof LlmContentError &&
          (/Files to touch/i.test(errorText(err)) ||
            /Use cases/i.test(errorText(err)))
          ? "spec_incomplete"
          : "llm_empty",
        `workflow=feature — TA enrich ${slug}`
      );
    }

    await writeDoc(appRoot, specPath(slug), content.endsWith("\n") ? content : content + "\n");

    const remaining = (state.pendingSpecDrafts ?? []).filter((s) => s !== slug);
    const next = remaining[0] || "";

    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "technologyArchitectSpecEnrich",
      `TA finalized spec: ${slug} (${remaining.length} drafts left)`,
      {
        phase: remaining.length > 0 ? "specs" : "specs",
        specs: {
          current: next,
          count: (state.pendingSpecs ?? []).length,
          slugs: state.pendingSpecs ?? [],
        },
      }
    );

    return {
      currentSpecSlug: next,
      pendingSpecDrafts: remaining,
      completedSpecs: [slug],
    };
  });
}

async function scaffoldPrepareNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage(
    "scaffoldPrepare",
    async () => {
      const appRoot = appRootOf(state);
      const scaffold = await ensureAppScaffold(appRoot);
      if (scaffold.applied || scaffold.augmented) {
        const install = await npmInstall(appRoot);
        if (!install.ok) {
          await implNotify(
            (s, m) => notify(s, m),
            appRoot,
            "scaffoldPrepare",
            `scaffold npm install FAILED`,
            {
              phase: "scaffold",
              scaffold: {
                applied: scaffold.applied,
                files: scaffold.files,
              },
            }
          );
          throw classifiedError(
            `[scaffoldPrepare] npm install failed: ${install.log.slice(0, 500)}`,
            "bootstrap",
            `workflow=resume — fix bootstrap then resume`
          );
        }
        const build = await buildSmoke(appRoot);
        if (!build.ok) {
          notify(
            "scaffoldPrepare",
            `build smoke warning: ${build.log.slice(0, 300)}`
          );
        }
        // Do NOT mark project-setup [x] here — SE + verifyDelivery own DoD
        await ensureTestScript(appRoot, "scaffoldPrepare");
        await implNotify(
          (s, m) => notify(s, m),
          appRoot,
          "scaffoldPrepare",
          scaffold.applied
            ? `scaffold applied (${scaffold.files.length} files) + npm install OK`
            : `scaffold augmented (${scaffold.files.length} missing files) + npm install OK`,
          {
            phase: "scaffold",
            scaffold: { applied: scaffold.applied, files: scaffold.files },
            lastWrite: {
              count: scaffold.files.length,
              files: scaffold.files,
            },
          }
        );
        return {
          appRoot,
          filesWritten: scaffold.files,
          completedSpecs: [],
        };
      }
      await implNotify(
        (s, m) => notify(s, m),
        appRoot,
        "scaffoldPrepare",
        "scaffold skipped — package.json + shell files already present",
        {
          phase: "scaffold",
          scaffold: { applied: false, files: [] },
        }
      );
      return { appRoot };
    },
    {
      appRoot: resolveAppRoot(state.projectRoot || "."),
      workflow: state.workflow,
      detail: "scaffold greenfield",
    }
  );
}

async function bootstrapFixNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage(
    "bootstrapFix",
    async () => {
      const appRoot = appRootOf(state);
      const round = (state.bootstrapFixRound ?? 0) + 1;
      if (round > MAX_BOOTSTRAP_FIX_ROUNDS) {
        const err = new Error(
          `[bootstrapFix] bootstrap still failing after ${MAX_BOOTSTRAP_FIX_ROUNDS} round(s):\n${state.qaFailureLog || ""}`
        );
        (err as Error & { failureKind?: string }).failureKind = "bootstrap";
        throw err;
      }
      notify("bootstrapFix", `Attempting bootstrap repair round ${round}`);
      await implNotify(
        (s, m) => notify(s, m),
        appRoot,
        "bootstrapFix",
        `bootstrap repair round ${round}/${MAX_BOOTSTRAP_FIX_ROUNDS}`,
        {
          phase: "bootstrap",
          qa: { bootstrapRound: round, lastErrorClass: "bootstrap" },
        }
      );
      const scaffold = await ensureAppScaffold(appRoot);
      if (scaffold.applied || scaffold.augmented) {
        notify(
          "bootstrapFix",
          scaffold.applied ? "scaffold applied" : "scaffold augmented"
        );
      }
      await ensureTestScript(appRoot, "bootstrapFix");
      const install = await npmInstall(appRoot);
      if (!install.ok) {
        const err = new Error(
          `[bootstrapFix] npm install failed: ${install.log.slice(0, 800)}`
        );
        (err as Error & { failureKind?: string }).failureKind = "bootstrap";
        throw err;
      }
      return {
        appRoot,
        bootstrapFixRound: round,
        qaFailureClass: "",
        qaFailureLog: "",
        testsPassed: false,
      };
    },
    {
      appRoot: resolveAppRoot(state.projectRoot || "."),
      workflow: state.workflow,
    }
  );
}

async function softwareEngineerNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  const pending = [...(state.pendingSpecs ?? [])];
  return timedStage(
    "softwareEngineer",
    async () => {
    const appRoot = appRootOf(state);
    const projectRoot = state.projectRoot || ".";
    if (pending.length === 0) {
      notify("softwareEngineer", "No pending specs; nothing to implement");
      return { appRoot };
    }

    let workPending = pending;
    // project-setup: if scaffold already satisfies DoD on disk, mark done without LLM
    if (workPending[0] === "project-setup") {
      const setupBody = await loadSpecBody(appRoot, "project-setup");
      const smoke = await runTscSmoke(appRoot, "softwareEngineer");
      const preVerify = await verifyDelivery({
        stage: "softwareEngineer",
        slugs: ["project-setup"],
        filesWritten: [],
        userIdea: state.userIdea || "",
        appRoot,
        specBodies: { "project-setup": setupBody },
        tscOk: smoke.ok,
        tscLog: smoke.log,
      });
      if (preVerify.ok) {
        await markTodoDone(appRoot, "project-setup");
        notify(
          "softwareEngineer",
          "project-setup already satisfies DoD on disk — marked [x]"
        );
        workPending = workPending.slice(1);
        if (workPending.length === 0) {
          return {
            appRoot,
            pendingSpecs: [],
            completedSpecs: ["project-setup"],
          };
        }
      }
    }

    const batch = await pickSpecBatch(
      appRoot,
      workPending,
      resolveSeMaxBatch(state.workflow)
    );
    setBatchSize(batch.length);
    const slug = batch[0];
    const alreadyDone = (state.completedSpecs ?? []).length;
    const specTotal = alreadyDone + workPending.length;
    const specIndex = alreadyDone + 1;
    getProgress().setPending({
      pendingSpecs: workPending,
      pendingQaSpecs: state.pendingQaSpecs ?? [],
      specIndex,
      specTotal,
    });
    await implNotify(
      (s, m) => notify(s, m),
      appRoot,
      "softwareEngineer",
      `spec ${specIndex}/${specTotal} em andamento: ${batch.join(", ")}`,
      {
        phase: "implement",
        specs: {
          total: specTotal,
          completed: alreadyDone,
          current: slug,
          batch,
          pending: workPending,
        },
      }
    );
    const [readme, requirements, technologies, todo, uiUx] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
      readDoc(appRoot, TODO_PATH),
      readDoc(appRoot, UI_UX_PATH),
    ]);
    const specBodies = await Promise.all(
      batch.map(
        async (s) =>
          `## Spec: ${s}\n${await readDoc(appRoot, specPath(s))}`
      )
    );
    const specBody = await readDoc(appRoot, specPath(slug));

    const verifyFeedback = (state.deliveryVerifyFeedback || "").trim();
    let rawContent = "";
    try {
      const res = await invokeRoleLlm(
        "softwareEngineer",
        [
          new SystemMessage(softwareEngineerImplementPrompt()),
          new HumanMessage(
            [
              `## Current spec batch (${batch.join(", ")})`,
              ...specBodies,
              "",
              verifyFeedback
                ? ["## Previous VERIFY FAIL — fix these gaps", verifyFeedback, ""].join(
                    "\n"
                  )
                : "",
              "## README.md",
              readme,
              "",
              "## .docs/todo.md",
              todo,
              "",
              "## .docs/requirements.md",
              requirements,
              "",
              "## .docs/technologies.md",
              technologies,
              "",
              "## .docs/ui-ux.md",
              uiUx.startsWith("[Document missing:")
                ? "(follow usability/emotion notes inside the spec)"
                : uiUx,
            ]
              .filter(Boolean)
              .join("\n")
          ),
        ],
        {
          stage: "softwareEngineer",
          attempts: SE_INVOKE_ATTEMPTS,
          fileOnlyReprompt: true,
          useWriteFileTool: true,
          validate: (c) => {
            const seCheck = validateSeImplementSelfCheck(c);
            if (!seCheck.ok) {
              throw new LlmContentError(
                "softwareEngineer",
                "parse_failed",
                seCheck.message
              );
            }
            assertHasFileSections(stripSeQaTrailMarkers(c), "softwareEngineer");
          },
        }
      );
      rawContent = String(res.content ?? "");
    } catch (err) {
      const kind = contentKindOf(err);
      if (kind === "empty" || kind === "no_file_sections") {
        recordLlmEmpty();
      }
      const oversized =
        !specBody.startsWith("[Document missing:") &&
        specBody.length > SPEC_SPLIT_CHARS;
      if (
        oversized &&
        (kind === "no_file_sections" ||
          kind === "empty" ||
          err instanceof LlmRetriesExhaustedError)
      ) {
        const split = await splitOversizedSpec(appRoot, slug, specBody);
        notify("softwareEngineer", split.message);
        const remaining = [...split.pending, ...workPending.slice(batch.length)];
        return {
          appRoot,
          currentSpec: slug,
          pendingSpecs: remaining,
          failureKind: "spec_split",
          resumeHint: `workflow=resume after implementing split specs ${split.pending.join(",")}`,
        };
      }
      if (err instanceof LlmRetriesExhaustedError || err instanceof LlmContentError) {
        throw classifiedError(
          `[softwareEngineer] llm_empty (${kind}): ${errorText(err)}`,
          "llm_empty",
          `workflow=resume projectRoot=${projectRoot} (empty LLM on ${batch.join(",")})`
        );
      }
      throw err;
    }

    const contentForWrite = stripSeQaTrailMarkers(rawContent);
    const written = await writeParsedFiles(appRoot, contentForWrite, projectRoot);
    const smoke = await runTscSmoke(appRoot, "softwareEngineer");

    const specBodiesMap: Record<string, string> = {};
    for (const s of batch) {
      specBodiesMap[s] = await loadSpecBody(appRoot, s);
    }

    const verified = await verifyDelivery({
      stage: "softwareEngineer",
      slugs: batch,
      filesWritten: written.filesWritten,
      userIdea: state.userIdea || "",
      appRoot,
      specBodies: specBodiesMap,
      tscOk: smoke.ok,
      tscLog: smoke.log,
    });

    if (!verified.ok) {
      recordDeliveryVerifyFail();
      if (verified.failureKind === "spec_incomplete") {
        recordSpecsMarkedWithoutFiles(verified.reopenSlugs.length || batch.length);
      }
      if (verified.failureKind === "llm_empty") {
        recordLlmEmpty();
      }
      const feedback = formatVerifyFeedback(verified);
      const round = (state.deliveryFixRound ?? 0) + 1;
      const failKind = verified.failureKind || "spec_incomplete";

      const saAdvice = await consultTeammate({
        asker: "softwareEngineer",
        advisor: "systemArchitect",
        question: `VERIFY FAIL for specs [${batch.join(", ")}]. Clarify Files to touch and what files the SE must emit next. Reasons: ${verified.reasons.slice(0, 5).join("; ")}`,
        context: [
          feedback,
          "",
          ...batch.map((s) => `### ${s}\n${specBodiesMap[s] || ""}`),
        ].join("\n"),
      });
      const feedbackWithConsult = saAdvice
        ? `${feedback}\n\n## Consult System Architect\n${saAdvice}`
        : feedback;

      await implNotify(
        (s, m) => notify(s, m),
        appRoot,
        "softwareEngineer",
        `VERIFY FAIL (${failKind}) round ${round}/${MAX_DELIVERY_FIX_ROUNDS}: ${verified.reasons.slice(0, 2).join("; ")}`,
        {
          phase: "implement",
          specs: { current: slug, batch },
          lastWrite: {
            count: written.count,
            files: written.filesWritten,
          },
        }
      );

      if (round >= MAX_DELIVERY_FIX_ROUNDS) {
        throw classifiedError(
          `[softwareEngineer] delivery verify exhausted (${failKind}): ${feedbackWithConsult}`,
          failKind,
          `workflow=resume projectRoot=${projectRoot} reopen=${verified.reopenSlugs.join(",")}`
        );
      }

      // A4: redo — keep pending, do NOT markTodoDone
      return {
        appRoot,
        code: rawContent,
        filesWritten: written.filesWritten,
        currentSpec: slug,
        pendingSpecs: workPending,
        completedSpecs: [],
        deliveryFixRound: round,
        deliveryVerifyFeedback: feedbackWithConsult,
        failureKind: failKind,
        resumeHint: `delivery redo ${round}/${MAX_DELIVERY_FIX_ROUNDS}`,
      };
    }

    for (const s of batch) {
      await markTodoDone(appRoot, s);
    }

    const remaining = workPending.slice(batch.length);
    const completedNow = alreadyDone + batch.length;
    getProgress().setPending({
      pendingSpecs: remaining,
      specIndex: remaining.length > 0 ? completedNow + 1 : specTotal,
      specTotal,
    });
    await implNotify(
      (s, m) => notify(s, m),
      appRoot,
      "softwareEngineer",
      remaining.length > 0
        ? `spec(s) ${batch.join(",")} done — wrote ${written.count} files: ${formatFileList(written.filesWritten)}; faltam ${remaining.length}`
        : `spec(s) ${batch.join(",")} done — wrote ${written.count} files: ${formatFileList(written.filesWritten)}; all implementation tasks done`,
      {
        phase: "implement",
        specs: {
          total: specTotal,
          completed: completedNow,
          current: slug,
          batch,
          pending: remaining,
        },
        lastWrite: {
          count: written.count,
          files: written.filesWritten,
        },
      }
    );

    return {
      appRoot,
      code: rawContent,
      filesWritten: written.filesWritten,
      currentSpec: slug,
      pendingSpecs: remaining,
      completedSpecs: batch,
      deliveryFixRound: 0,
      deliveryVerifyFeedback: "",
      failureKind: "",
      resumeHint: "",
    };
  },
    {
      pendingSpecs: pending,
      pendingQaSpecs: state.pendingQaSpecs ?? [],
      detail:
        pending.length > 0
          ? `implementando '${pending[0]}'`
          : "sem specs pendentes",
      appRoot: resolveAppRoot(state.projectRoot || "."),
      workflow: state.workflow,
    }
  );
}

async function softwareEngineerFixNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  const slug = state.currentSpec || (state.pendingQaSpecs ?? [])[0] || "";
  return timedStage(
    "softwareEngineerFix",
    async () => {
    const appRoot = appRootOf(state);
    const projectRoot = state.projectRoot || ".";
    const [readme, technologies, specBody] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
      slug ? readDoc(appRoot, specPath(slug)) : Promise.resolve("(no current spec)"),
    ]);

    const se = roleLlm("softwareEngineer");
    void se;
    const res = await invokeRoleLlm(
      "softwareEngineer",
      [
        new SystemMessage(softwareEngineerFixPrompt()),
        new HumanMessage(
          [
            `## Spec under fix: ${slug || "(unknown)"}`,
            specBody,
            "",
            "## Test failure log",
            state.qaFailureLog ?? "(no log)",
            "",
            "## README.md",
            readme,
            "",
            "## .docs/technologies.md",
            technologies,
          ].join("\n")
        ),
      ],
      {
        stage: "softwareEngineerFix",
        attempts: SE_INVOKE_ATTEMPTS,
        fileOnlyReprompt: true,
        useWriteFileTool: true,
        validate: (c) => {
          const seCheck = validateSeImplementSelfCheck(c);
          if (!seCheck.ok) {
            throw new LlmContentError(
              "softwareEngineerFix",
              "parse_failed",
              seCheck.message
            );
          }
          assertHasFileSections(stripSeQaTrailMarkers(c), "softwareEngineerFix");
        },
      }
    );

    const rawContent = String(res.content ?? "");
    const written = await writeParsedFiles(
      appRoot,
      stripSeQaTrailMarkers(rawContent),
      projectRoot
    );
    const round = (state.qaFixRound ?? 0) + 1;

    await implNotify(
      (s, m) => notify(s, m),
      appRoot,
      "softwareEngineerFix",
      `fix round ${round}/${MAX_QA_FIX_ROUNDS} for '${slug}' — wrote ${written.count} files: ${formatFileList(written.filesWritten)}`,
      {
        phase: "fix",
        specs: { current: slug },
        qa: { current: slug, fixRound: round },
        lastWrite: {
          count: written.count,
          files: written.filesWritten,
        },
      }
    );

    return {
      appRoot,
      code: rawContent,
      filesWritten: written.filesWritten,
      qaFixRound: round,
    };
  },
    {
      pendingQaSpecs: state.pendingQaSpecs ?? [],
      detail: `corrigindo '${slug || "(unknown)"}'`,
    }
  );
}

async function qaEngineerNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  let pendingQa = [...(state.pendingQaSpecs ?? [])];
  return timedStage(
    "qaEngineer",
    async () => {
    const appRoot = appRootOf(state);
    if (pendingQa.length === 0) {
      pendingQa = await listSpecSlugs(appRoot);
    }

    const slug = pendingQa[0] ?? state.currentSpec ?? "";
    const prevImpl = await readImplementationProgress(appRoot);
    const passedBefore = prevImpl?.qa.passed ?? [];
    const qaTotalAll = Math.max(
      pendingQa.length + passedBefore.length,
      pendingQa.length,
      prevImpl?.specs.total ?? 0
    );
    const qaIndex = passedBefore.length + 1;
    getProgress().setPending({
      pendingQaSpecs: pendingQa,
      qaIndex,
      qaTotal: qaTotalAll || pendingQa.length,
    });
    await implNotify(
      (s, m) => notify(s, m),
      appRoot,
      "qaEngineer",
      `QA ${qaIndex}/${qaTotalAll || pendingQa.length}: ${slug}`,
      {
        phase: "qa",
        qa: { current: slug },
        specs: { current: slug },
      }
    );

    const [readme, todo, technologies, requirements, specBody] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, TODO_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
      slug ? readDoc(appRoot, specPath(slug)) : Promise.resolve(""),
    ]);

    const res = await invokeRoleLlm(
      "qaEngineer",
      [
        new SystemMessage(qaEngineerPrompt()),
        new HumanMessage(
          [
            `## Current spec: ${slug}`,
            specBody,
            "",
            "## README.md",
            readme,
            "",
            "## .docs/todo.md",
            todo,
            "",
            "## .docs/requirements.md",
            requirements,
            "",
            "## .docs/technologies.md",
            technologies,
          ].join("\n")
        ),
      ],
      {
        stage: "qaEngineer",
        validate: (c) => assertQaResponse(c, "qaEngineer"),
      }
    );

    const testsRaw = String(res.content ?? "");
    const tests = stripSeQaTrailMarkers(testsRaw);
    const projectRoot = state.projectRoot || ".";
    let written: WriteParsedResult = { count: 0, filesWritten: [] };
    if (parseFileSections(tests).length > 0) {
      written = await writeParsedFiles(appRoot, tests, projectRoot);
    } else {
      notify("qaEngineer", `SUMMARY-only for '${slug}' — running existing tests`);
    }

    const debtBody = parseTechDebtSection(testsRaw);
    if (debtBody) {
      const existingDebt = await readDoc(appRoot, TECH_DEBT_PATH);
      const nextDebt = appendTechDebtMarkdown(existingDebt, slug || "unknown", debtBody);
      await writeDoc(appRoot, TECH_DEBT_PATH, nextDebt);
      notify(
        "qaEngineer",
        `appended tech debt for '${slug}' → ${TECH_DEBT_PATH}`
      );
    }

    const result = await runProjectTests(appRoot, "qaEngineer");

    if (!result.ok) {
      const failureClass =
        result.errorClass || classifyTestFailure(result.log);
      setErrorClass(failureClass);

      if (failureClass === "bootstrap") {
        await implNotify(
          (s, m) => notify(s, m),
          appRoot,
          "qaEngineer",
          `QA FAIL (bootstrap) ${slug} → bootstrapFix`,
          {
            phase: "qa",
            qa: {
              current: slug,
              lastErrorClass: "bootstrap",
              failed: [slug],
            },
          }
        );
        return {
          appRoot,
          tests,
          filesWritten: written.filesWritten,
          currentSpec: slug,
          qaFailureLog: result.log.slice(0, 4000),
          qaFailureClass: "bootstrap",
          testsPassed: false,
        };
      }

      const round = state.qaFixRound ?? 0;
      if (round >= MAX_QA_FIX_ROUNDS) {
        if (hitlEnabled()) {
          await pausePipelineForHuman(
            appRoot,
            `QA exhausted after ${MAX_QA_FIX_ROUNDS} feature fix rounds`,
            { notify: (m) => notify("qaEngineer", m) }
          );
        }
        await implNotify(
          (s, m) => notify(s, m),
          appRoot,
          "qaEngineer",
          `QA FAIL (${failureClass}) ${slug} — fix rounds exhausted`,
          {
            phase: "qa",
            qa: {
              current: slug,
              lastErrorClass: failureClass,
              failed: [slug],
              fixRound: round,
            },
          }
        );
        const err = new Error(
          `[qaEngineer] tests still failing after ${MAX_QA_FIX_ROUNDS} fix rounds:\n${result.log}`
        );
        (err as Error & { failureKind?: string }).failureKind = failureClass;
        throw err;
      }
      await implNotify(
        (s, m) => notify(s, m),
        appRoot,
        "qaEngineer",
        `QA FAIL (${failureClass}) ${slug} → SE-fix round ${round + 1}/${MAX_QA_FIX_ROUNDS}`,
        {
          phase: "qa",
          qa: {
            current: slug,
            lastErrorClass: failureClass,
            failed: [slug],
            fixRound: round,
          },
        }
      );
      return {
        appRoot,
        tests,
        filesWritten: written.filesWritten,
        currentSpec: slug,
        qaFailureLog: result.log.slice(0, 4000),
        qaFailureClass: failureClass,
        testsPassed: false,
      };
    }

    const remaining = pendingQa.filter((s) => s !== slug);
    const passed = [...passedBefore.filter((p) => p !== slug), slug];
    getProgress().setPending({
      pendingQaSpecs: remaining,
      qaIndex: remaining.length > 0 ? passed.length + 1 : qaTotalAll,
      qaTotal: qaTotalAll || pendingQa.length,
    });
    await implNotify(
      (s, m) => notify(s, m),
      appRoot,
      "qaEngineer",
      remaining.length > 0
        ? `QA PASS ${slug}; ${remaining.length} spec(s) left`
        : `QA PASS ${slug}; all tests passed`,
      {
        phase: remaining.length > 0 ? "qa" : "done",
        qa: {
          current: remaining[0] ?? "",
          passed,
          failed: [],
          lastErrorClass: null,
          fixRound: 0,
        },
        lastWrite:
          written.count > 0
            ? { count: written.count, files: written.filesWritten }
            : undefined,
      }
    );

    return {
      appRoot,
      tests,
      filesWritten: written.filesWritten,
      currentSpec: slug,
      pendingQaSpecs: remaining,
      qaFailureLog: "",
      qaFixRound: 0,
      testsPassed: remaining.length === 0,
    };
  },
    {
      pendingQaSpecs: pendingQa,
      detail:
        pendingQa.length > 0
          ? `testando '${pendingQa[0] ?? state.currentSpec ?? "?"}'`
          : "listando specs",
    }
  );
}

async function systemArchitectProjectSummaryNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("systemArchitectProjectSummary", async () => {
    const appRoot = appRootOf(state);
    const [readme, requirements] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
    ]);

    let summary = "";
    try {
      const res = await invokeRoleLlm(
        "systemArchitect",
        [
          new SystemMessage(systemArchitectProjectSummaryPrompt()),
          new HumanMessage(
            [
              "## README.md",
              readme,
              "",
              "## .docs/requirements.md",
              requirements,
              "",
              "## Original user idea (context only)",
              state.userIdea || "(none)",
            ].join("\n")
          ),
        ],
        {
          stage: "systemArchitectProjectSummary",
          validate: (c) => {
            assertUsableLlmText(c, "systemArchitectProjectSummary");
            const parsed = parseProjectSummaryResponse(c);
            const sc = validateProjectSummarySelfCheck(parsed?.check ?? null);
            if (!parsed || !sc.ok) {
              throw new LlmContentError(
                "systemArchitectProjectSummary",
                "parse_failed",
                sc.message || "expected ===SUMMARY=== + ===SELF_CHECK==="
              );
            }
          },
        }
      );
      const parsed = parseProjectSummaryResponse(String(res.content ?? ""));
      const sc = validateProjectSummarySelfCheck(parsed?.check ?? null);
      if (!parsed || !sc.ok) {
        throw new LlmContentError(
          "systemArchitectProjectSummary",
          "parse_failed",
          sc.message || "expected ===SUMMARY==="
        );
      }
      summary = parsed.summary;
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[systemArchitectProjectSummary] failed (${contentKindOf(err)}): ${errorText(err)}`,
        "llm_empty",
        "workflow=resume — regenerate project summary"
      );
    }

    await writeDoc(
      appRoot,
      PROJECT_SUMMARY_PATH,
      summary.endsWith("\n") ? summary : summary + "\n"
    );
    const userReport = buildUserReportMarkdown(summary, null);
    await writeDoc(appRoot, USER_REPORT_PATH, userReport);

    notify(
      "systemArchitectProjectSummary",
      `USER REPORT — project summary ready (${PROJECT_SUMMARY_PATH})`
    );
    // Emit the summary body so MCP/CLI surfaces it to the human
    for (const line of summary.split(/\r?\n/).slice(0, 40)) {
      if (line.trim()) notify("systemArchitectProjectSummary", line.slice(0, 240));
    }

    const needsDebtReview = await hasTechDebtDoc(appRoot);
    if (needsDebtReview) {
      notify(
        "systemArchitectProjectSummary",
        `tech debt found → SA review (${TECH_DEBT_PATH})`
      );
    }

    return {
      appRoot,
      projectSummary: summary,
      userReport,
      pendingTechDebtReview: needsDebtReview,
    };
  });
}

async function hasTechDebtDoc(appRoot: string): Promise<boolean> {
  const debt = await readDoc(appRoot, TECH_DEBT_PATH);
  if (debt.startsWith("[Document missing:")) return false;
  const stripped = debt
    .replace(/^#\s*Technical debt[^\n]*\n*/i, "")
    .replace(/Issues found in specs[^\n]*\n*/i, "")
    .trim();
  return stripped.length > 40;
}

async function systemArchitectTechDebtReviewNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("systemArchitectTechDebtReview", async () => {
    const appRoot = appRootOf(state);
    const projectRoot = state.projectRoot || ".";
    const [readme, requirements, techDebt, summaryExisting] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
      readDoc(appRoot, TECH_DEBT_PATH),
      readDoc(appRoot, PROJECT_SUMMARY_PATH),
    ]);

    let disposition = "";
    let actionPlan = "";
    let writtenCount = 0;
    try {
      const res = await invokeRoleLlm(
        "systemArchitect",
        [
          new SystemMessage(systemArchitectTechDebtReviewPrompt()),
          new HumanMessage(
            [
              "## .docs/tech-debt.md",
              techDebt,
              "",
              "## .docs/requirements.md",
              requirements,
              "",
              "## README.md",
              readme,
              "",
              "## Project summary (if any)",
              summaryExisting.startsWith("[Document missing:")
                ? state.projectSummary || "(none)"
                : summaryExisting,
              "",
              "## Original user idea (spirit context)",
              state.userIdea || "(none)",
            ].join("\n")
          ),
        ],
        {
          stage: "systemArchitectTechDebtReview",
          fileOnlyReprompt: false,
          useWriteFileTool: true,
          validate: (c) => {
            assertUsableLlmText(c, "systemArchitectTechDebtReview");
            const parsed = parseTechDebtReviewResponse(c);
            const sc = validateTechDebtReviewSelfCheck(parsed?.check ?? null);
            if (!parsed || !sc.ok) {
              throw new LlmContentError(
                "systemArchitectTechDebtReview",
                "parse_failed",
                sc.message ||
                  "expected ===DISPOSITION=== + ===ACTION_PLAN=== + ===SELF_CHECK==="
              );
            }
          },
        }
      );
      const raw = String(res.content ?? "");
      const parsed = parseTechDebtReviewResponse(raw);
      const sc = validateTechDebtReviewSelfCheck(parsed?.check ?? null);
      if (!parsed || !sc.ok) {
        throw new LlmContentError(
          "systemArchitectTechDebtReview",
          "parse_failed",
          sc.message || "expected DISPOSITION + ACTION_PLAN"
        );
      }
      disposition = parsed.disposition;
      actionPlan = parsed.actionPlan;

      if (parseFileSections(parsed.payloadForFiles).length > 0) {
        const written = await writeParsedFiles(
          appRoot,
          parsed.payloadForFiles,
          projectRoot
        );
        writtenCount = written.count;
      }
    } catch (err) {
      if (
        !(err instanceof LlmRetriesExhaustedError) &&
        !(err instanceof LlmContentError)
      ) {
        throw err;
      }
      recordLlmEmpty();
      throw classifiedError(
        `[systemArchitectTechDebtReview] failed (${contentKindOf(err)}): ${errorText(err)}`,
        "llm_empty",
        "workflow=resume — regenerate tech-debt review"
      );
    }

    const debtUpdated = [
      techDebt.startsWith("[Document missing:")
        ? "# Technical debt (from QA)\n\n"
        : techDebt.trimEnd() + "\n\n",
      "## SA disposition (post-development)\n\n",
      disposition.trim(),
      "\n",
    ].join("");
    await writeDoc(appRoot, TECH_DEBT_PATH, debtUpdated);

    await writeDoc(
      appRoot,
      TECH_DEBT_PLAN_PATH,
      actionPlan.endsWith("\n") ? actionPlan : actionPlan + "\n"
    );

    const summary =
      (state.projectSummary || "").trim() ||
      (summaryExisting.startsWith("[Document missing:")
        ? ""
        : summaryExisting);
    const userReport = buildUserReportMarkdown(summary || "(summary pending)", actionPlan);
    await writeDoc(appRoot, USER_REPORT_PATH, userReport);

    notify(
      "systemArchitectTechDebtReview",
      `USER REPORT — tech-debt plan ready (${TECH_DEBT_PLAN_PATH}); docs updated: ${writtenCount}`
    );
    for (const line of actionPlan.split(/\r?\n/).slice(0, 30)) {
      if (line.trim())
        notify("systemArchitectTechDebtReview", line.slice(0, 240));
    }

    return {
      appRoot,
      techDebtDisposition: disposition,
      techDebtActionPlan: actionPlan,
      userReport,
      projectSummary: summary || state.projectSummary || "",
      pendingTechDebtReview: false,
    };
  });
}

async function orchestratorFinalizeNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("orchestratorFinalize", async () => {
    const appRoot = appRootOf(state);
    let readme = await readDoc(appRoot, README_PATH);

    // B4: pre-finalize checklist vs userIdea (docs + full)
    if (!(state.workflow === "docs" || state.docsOnly)) {
      const techDoc = await readDoc(appRoot, TECHNOLOGIES_PATH);
      const techText = techDoc.startsWith("[Document missing:") ? "" : techDoc;
      const gaps = findArchitectureCoverageGaps(
        state.userIdea || "",
        techText,
        await listSpecSlugs(appRoot)
      );
      const helloOnly =
        /hello\s*world/i.test(readme) &&
        /\b(search|collection|favorite|api)\b/i.test(state.userIdea || "") &&
        !(await pathExists(join(appRoot, "src")));
      if (gaps.length > 0 && helloOnly) {
        throw classifiedError(
          `[orchestratorFinalize] fidelity: generic Hello app vs userIdea gaps: ${gaps.join("; ")}`,
          "fidelity",
          "workflow=resume — implement missing features"
        );
      }
    }

    const statusLines =
      state.workflow === "docs" || state.docsOnly
        ? [
            `Pipeline mode: **docs** (workflow=${state.workflow || "docs"}).`,
            "Implementation and QA were skipped.",
          ]
        : [
            `Pipeline mode: **${state.workflow || "full"}**.`,
            state.testsPassed
              ? "All automated tests passed."
              : "Pipeline finished (see notifications for details).",
          ];

    if ((state.fidelityWarnings ?? []).length > 0) {
      statusLines.push(
        `Fidelity warnings: ${(state.fidelityWarnings ?? []).join("; ")}`
      );
    }
    if ((state.architectureGaps ?? []).length > 0) {
      statusLines.push(
        `Architecture gaps: ${(state.architectureGaps ?? []).join("; ")}`
      );
    }

    const techDebtDoc = await readDoc(appRoot, TECH_DEBT_PATH);
    if (
      !techDebtDoc.startsWith("[Document missing:") &&
      techDebtDoc.trim().length > 0
    ) {
      statusLines.push(
        `QA reported technical debt — see [${TECH_DEBT_PATH}](${TECH_DEBT_PATH}).`
      );
      if (
        !readme.includes(`[${TECH_DEBT_PATH}](${TECH_DEBT_PATH})`) &&
        !readme.includes(TECH_DEBT_PATH)
      ) {
        readme = upsertReadmeSection(
          readme,
          "Technical debt",
          `Issues flagged by QA for the orchestrator: [${TECH_DEBT_PATH}](${TECH_DEBT_PATH}).`
        );
      }
    }

    if ((state.projectSummary || "").trim()) {
      statusLines.push(
        `Project summary for owner: [${PROJECT_SUMMARY_PATH}](${PROJECT_SUMMARY_PATH}).`
      );
    }
    if ((state.techDebtActionPlan || "").trim()) {
      statusLines.push(
        `Tech-debt action plan (decide): [${TECH_DEBT_PLAN_PATH}](${TECH_DEBT_PLAN_PATH}).`
      );
    }
    if ((state.userReport || "").trim()) {
      statusLines.push(
        `Full user report: [${USER_REPORT_PATH}](${USER_REPORT_PATH}).`
      );
      readme = upsertReadmeSection(
        readme,
        "Owner report",
        [
          "Post-development summary and optional tech-debt plan for your decision:",
          `- [${USER_REPORT_PATH}](${USER_REPORT_PATH})`,
          state.techDebtActionPlan
            ? `- [${TECH_DEBT_PLAN_PATH}](${TECH_DEBT_PLAN_PATH}) — plan mode; choose what to do`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    readme = upsertReadmeSection(
      readme,
      "Pipeline status",
      statusLines.join("\n")
    );
    await writeDoc(appRoot, README_PATH, readme);

    const pending = (state.pendingSpecs ?? []).length;
    const resumeHint =
      state.resumeHint ||
      (pending > 0
        ? `workflow=resume — ${pending} pending spec(s)`
        : "");

    await writePipelineResult(appRoot, {
      ok: !(state.failureKind === "fidelity" || state.failureKind === "llm_empty"),
      workflow: state.workflow || "full",
      appRoot,
      projectRoot: state.projectRoot || ".",
      filesWritten: state.filesWritten ?? [],
      fidelityWarnings: state.fidelityWarnings ?? [],
      architectureGaps: state.architectureGaps ?? [],
      failureKind: state.failureKind || null,
      resumeHint: resumeHint || null,
      testsPassed: state.testsPassed ?? null,
      deliveryFixRound: state.deliveryFixRound ?? 0,
      projectSummary: state.projectSummary || null,
      techDebtDisposition: state.techDebtDisposition || null,
      techDebtActionPlan: state.techDebtActionPlan || null,
      userReport: state.userReport || null,
      userReportPath: (state.userReport || "").trim() ? USER_REPORT_PATH : null,
    });

    if (state.workflow === "docs" || state.docsOnly) {
      await setArchitecturePhase(appRoot, "done");
    } else {
      await setImplementationPhase(appRoot, "done");
    }

    if ((state.userReport || "").trim()) {
      notify(
        "orchestratorFinalize",
        "PRESENT TO USER — open .docs/user-report.md (summary + optional tech-debt plan)"
      );
    }

    notify(
      "orchestratorFinalize",
      state.workflow === "docs" || state.docsOnly
        ? "Docs pipeline complete; README updated (see .docs/architecture-progress.json)"
        : `Workflow '${state.workflow || "full"}' complete; see .docs/implementation-progress.json`
    );

    return {
      appRoot,
      resumeHint,
      projectSummary: state.projectSummary || "",
      techDebtActionPlan: state.techDebtActionPlan || "",
      userReport: state.userReport || "",
    };
  });
}

async function fidelityCriticRequirementsNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("fidelityCriticRequirements", async () => {
    const appRoot = appRootOf(state);
    const requirements = await readDoc(appRoot, REQUIREMENTS_PATH);
    const reqText = requirements.startsWith("[Document missing:")
      ? ""
      : requirements;
    const violations = findFidelityViolations(state.userIdea || "", reqText);

    if (violations.length === 0) {
      await archNotify(
        (s, m) => notify(s, m),
        appRoot,
        "fidelityCriticRequirements",
        "fidelity PASS",
        {
          phase: "fidelity",
          fidelity: { ok: true, warnings: [] },
        }
      );
      return {
        appRoot,
        fidelityWarnings: [],
        fidelityFixRound: 0,
        failureKind: "",
      };
    }

    const round = (state.fidelityFixRound ?? 0) + 1;
    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "fidelityCriticRequirements",
      `fidelity FAIL: ${violations.slice(0, 3).join("; ")}${
        violations.length > 3 ? ` (+${violations.length - 3})` : ""
      }`,
      {
        phase: "fidelity",
        fidelity: { ok: false, warnings: violations },
      }
    );

    // Append Constraints so a redo SA can see gaps (but do NOT continue to TA as PASS)
    const constraints = [
      "",
      "## Constraints (userIdea — fidelity FAIL)",
      "",
      "The following must not be contradicted:",
      "",
      state.userIdea,
      "",
      "Detected issues (auto):",
      ...violations.map((v) => `- ${v}`),
      "",
    ].join("\n");

    await writeDoc(
      appRoot,
      REQUIREMENTS_PATH,
      (reqText.trimEnd() + "\n" + constraints).trimEnd() + "\n"
    );

    if (round > MAX_FIDELITY_FIX_ROUNDS) {
      throw classifiedError(
        `[fidelityCriticRequirements] fidelity FAIL after ${round} round(s): ${violations.join("; ")}`,
        "fidelity",
        "workflow=docs — fix requirements to match userIdea then resume"
      );
    }

    // Signal conditional edge to re-open requirements expansion
    return {
      appRoot,
      requirements: await readDoc(appRoot, REQUIREMENTS_PATH),
      fidelityWarnings: violations,
      fidelityFixRound: round,
      failureKind: "fidelity",
      pendingPreReqs: [
        `Correct fidelity gaps: ${violations.slice(0, 3).join("; ")}`,
      ],
      preReqTotal: 1,
      currentPreReq: `Correct fidelity gaps: ${violations.slice(0, 3).join("; ")}`,
      resumeHint: `fidelity redo ${round}/${MAX_FIDELITY_FIX_ROUNDS}`,
    };
  });
}

/** B2: post-TA+specs coverage critic (heuristic, no LLM writer). */
async function deliveryCriticArchitectureNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("deliveryCriticArchitecture", async () => {
    const appRoot = appRootOf(state);
    const tech = await readDoc(appRoot, TECHNOLOGIES_PATH);
    const techText = tech.startsWith("[Document missing:") ? "" : tech;
    const slugs =
      (state.pendingSpecs ?? []).length > 0
        ? [...(state.pendingSpecs ?? [])]
        : await listSpecSlugs(appRoot);

    const gaps = findArchitectureCoverageGaps(
      state.userIdea || "",
      techText,
      slugs
    );

    if (gaps.length === 0) {
      await archNotify(
        (s, m) => notify(s, m),
        appRoot,
        "deliveryCriticArchitecture",
        "architecture critic PASS",
        { phase: "specs" }
      );
      return { appRoot, architectureGaps: [], failureKind: "" };
    }

    await archNotify(
      (s, m) => notify(s, m),
      appRoot,
      "deliveryCriticArchitecture",
      `architecture critic FAIL: ${gaps.slice(0, 3).join("; ")}`,
      { phase: "specs" }
    );

    // One redo of TA: surface gaps; if already failed once, hard fail
    if ((state.architectureGaps ?? []).length > 0) {
      throw classifiedError(
        `[deliveryCriticArchitecture] gaps remain: ${gaps.join("; ")}`,
        "fidelity",
        "workflow=docs — align technologies/specs with userIdea"
      );
    }

    // Gate consult: TA asks SA what requirements/specs imply for the gaps
    const saAdvice = await consultTeammate({
      asker: "technologyArchitect",
      advisor: "systemArchitect",
      question: `Architecture coverage gaps vs userIdea. What must technologies.md / specs cover next?\nGaps: ${gaps.join("\n")}`,
      context: [
        `## userIdea\n${state.userIdea || ""}`,
        `## technologies.md\n${techText.slice(0, 4000)}`,
        `## spec slugs\n${slugs.join(", ")}`,
      ].join("\n\n"),
    });

    return {
      appRoot,
      architectureGaps: gaps,
      failureKind: "fidelity",
      resumeHint: saAdvice
        ? `architecture gaps: ${gaps.slice(0, 3).join("; ")} | SA: ${saAdvice.slice(0, 200)}`
        : `architecture gaps: ${gaps.slice(0, 3).join("; ")}`,
      currentPreReq: saAdvice
        ? `Address architecture gaps with SA guidance: ${saAdvice.slice(0, 400)}`
        : undefined,
    };
  });
}

/** B3: post-batch SE critic — reopen incomplete slugs after gate PASS. */
async function deliveryCriticDeliveryNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("deliveryCriticDelivery", async () => {
    const appRoot = appRootOf(state);
    // Only runs when SE reported no pending; spot-check completed batch files
    const completed = state.completedSpecs ?? [];
    const written = state.filesWritten ?? [];
    if (completed.length === 0) {
      return { appRoot };
    }

    const verified = await verifyDelivery({
      stage: "softwareEngineer",
      slugs: completed.slice(-3),
      filesWritten: written,
      userIdea: state.userIdea || "",
      appRoot,
      tscOk: true,
    });

    if (verified.ok) {
      notify("deliveryCriticDelivery", "delivery critic PASS");
      return { appRoot, failureKind: "" };
    }

    recordDeliveryVerifyFail();
    const feedback = formatVerifyFeedback(verified);
    const round = (state.deliveryFixRound ?? 0) + 1;
    notify(
      "deliveryCriticDelivery",
      `delivery critic FAIL — reopening ${verified.reopenSlugs.join(", ")} (round ${round})`
    );

    if (round >= MAX_DELIVERY_FIX_ROUNDS) {
      throw classifiedError(
        `[deliveryCriticDelivery] exhausted: ${feedback}`,
        verified.failureKind || "spec_incomplete",
        "workflow=resume — delivery critic reopen budget exhausted"
      );
    }

    return {
      appRoot,
      pendingSpecs: [
        ...verified.reopenSlugs,
        ...(state.pendingSpecs ?? []).filter(
          (s) => !verified.reopenSlugs.includes(s)
        ),
      ],
      deliveryVerifyFeedback: feedback,
      deliveryFixRound: round,
      failureKind: verified.failureKind || "spec_incomplete",
    };
  });
}

async function resumePrepareNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage(
    "resumePrepare",
    async () => {
      const appRoot = appRootOf(state);
      const todo = await readDoc(appRoot, TODO_PATH);
      const items = todo.startsWith("[Document missing:")
        ? []
        : parseTodoChecklist(todo);

      // C1: reopen phantom [x] without Files to touch on disk
      const phantoms = await findPhantomDoneSlugs(appRoot, items);
      if (phantoms.length > 0) {
        const updated = await unmarkTodoSlugs(appRoot, phantoms);
        if (updated) {
          await writeDoc(appRoot, TODO_PATH, updated);
          notify(
            "resumePrepare",
            `Reopened ${phantoms.length} phantom [x] spec(s): ${phantoms.join(", ")}`
          );
        }
      }

      const todoAfter = phantoms.length > 0
        ? await readDoc(appRoot, TODO_PATH)
        : todo;
      const itemsAfter = todoAfter.startsWith("[Document missing:")
        ? []
        : parseTodoChecklist(todoAfter);

      const pending: string[] = [];
      const orphans: string[] = [];
      for (const item of itemsAfter) {
        if (item.done) continue;
        const exists = await pathExists(join(appRoot, specPath(item.slug)));
        if (exists) pending.push(item.slug);
        else orphans.push(item.slug);
      }

      if (orphans.length > 0) {
        notify(
          "resumePrepare",
          `Orphan [ ] without .spec.md: ${orphans.join(", ")} — rerun workflow=feature`
        );
      }

      if (pending.length === 0) {
        const hint =
          orphans.length > 0
            ? `missing specs: ${orphans.join(",")} — rerun workflow=feature`
            : "nothing pending";
        notify(
          "resumePrepare",
          orphans.length > 0
            ? `No pending [ ] with .spec.md (${orphans.length} orphan slug(s))`
            : "No pending [ ] specs with existing .spec.md — nothing to resume"
        );
        return {
          appRoot,
          pendingSpecs: [],
          pendingQaSpecs: [],
          resumeHint: hint,
        };
      }

      getProgress().setPending({
        pendingSpecs: pending,
        pendingQaSpecs: pending,
      });
      notify(
        "resumePrepare",
        `Resuming ${pending.length} pending spec(s): ${pending.join(", ")}`
      );

      return {
        appRoot,
        pendingSpecs: pending,
        pendingQaSpecs: [...pending],
        currentSpec: pending[0] ?? "",
        completedSpecs: [],
        qaFixRound: 0,
        deliveryFixRound: 0,
        deliveryVerifyFeedback: "",
        todo: todoAfter.startsWith("[Document missing:") ? "" : todoAfter,
      };
    },
    { detail: "retomando todos pendentes" }
  );
}

async function workflowRouterNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("workflowRouter", async () => {
    const appRoot = appRootOf(state);
    await mkdir(appRoot, { recursive: true });

    const explicit = resolveExplicitWorkflow({
      workflow: state.workflow,
      docsOnly: state.docsOnly,
      userIdea: state.userIdea,
    });

    const { workflow, reason } = await classifyWorkflow({
      userIdea: state.userIdea || "",
      appRoot,
      explicit,
    });

    const cleanedIdea = stripWorkflowTag(state.userIdea || "") || state.userIdea;
    const meta = WORKFLOW_CATALOG[workflow];

    notify(
      "workflowRouter",
      `rota=${workflow} — ${reason}; ${meta.route}`
    );

    return {
      workflow,
      workflowReason: reason,
      docsOnly: workflow === "docs",
      userIdea: cleanedIdea,
    };
  });
}

async function punchPrepareNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage(
    "punchPrepare",
    async () => {
      const appRoot = appRootOf(state);
      const slug = "punch";
      const body = [
        "# punch",
        "",
        "## Goal",
        state.userIdea,
        "",
        "## Acceptance criteria",
        "- The requested UI/copy/tweak change is applied",
        "- No unrelated refactors",
        "",
        "## Files to touch",
        "- Minimal set under project root (see technologies.md layout)",
        "",
        "## Out of scope",
        "- New features unrelated to this tweak",
      ].join("\n");

      await writeDoc(appRoot, specPath(slug), body + "\n");

      let todo = await readDoc(appRoot, TODO_PATH);
      if (todo.startsWith("[Document missing:")) {
        todo = `- [ ] ${slug}: Punch — ${state.userIdea.slice(0, 80)}\n`;
      } else if (!parseTodoChecklist(todo).some((t) => t.slug === slug)) {
        todo =
          todo.trimEnd() +
          `\n- [ ] ${slug}: Punch — ${state.userIdea.slice(0, 80)}\n`;
      }
      await writeDoc(appRoot, TODO_PATH, todo.endsWith("\n") ? todo : todo + "\n");

      getProgress().setPending({
        pendingSpecs: [slug],
        pendingQaSpecs: [slug],
      });
      notify("punchPrepare", `Prepared spec '${slug}' from user idea`);

      return {
        pendingSpecs: [slug],
        pendingQaSpecs: [slug],
        currentSpec: slug,
        todo,
      };
    },
    { detail: "preparando spec pontual" }
  );
}

async function fixPrepareNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage(
    "fixPrepare",
    async () => {
      const appRoot = appRootOf(state);
      const existing = await listSpecSlugs(appRoot);
      const slug = existing[0] || "fix";

      if (existing.length === 0) {
        const body = [
          "# fix",
          "",
          "## Goal",
          "Fix the reported bug / failing behavior.",
          "",
          "## Bug report",
          state.userIdea,
          "",
          "## Acceptance criteria",
          "- Reported issue is resolved",
          "- Existing tests pass (add coverage if missing)",
        ].join("\n");
        await writeDoc(appRoot, specPath(slug), body + "\n");
      }

      const failureLog = [
        "User-reported issue (fix workflow):",
        state.userIdea,
        "",
        "(No prior automated failure log — SE should inspect and fix.)",
      ].join("\n");

      getProgress().setPending({
        pendingQaSpecs: existing.length > 0 ? existing : [slug],
      });
      notify(
        "fixPrepare",
        `Prepared fix for '${slug}' (${existing.length} existing spec(s))`
      );

      return {
        currentSpec: slug,
        pendingQaSpecs: existing.length > 0 ? existing : [slug],
        qaFailureLog: failureLog,
        qaFixRound: 0,
        testsPassed: false,
      };
    },
    { detail: "preparando correção" }
  );
}

function routeAfterPreReq(state: OrchestratorStateType): string {
  return (state.pendingPreReqs ?? []).length > 0
    ? "systemArchitectReqItem"
    : "orchestratorCleanReadme";
}

function routeFromWorkflow(state: OrchestratorStateType): string {
  const id = (state.workflow || "full") as WorkflowId;
  if (isWorkflowId(id)) {
    return WORKFLOW_CATALOG[id].entry;
  }
  return WORKFLOW_CATALOG.full.entry;
}

function routeAfterFidelity(state: OrchestratorStateType): string {
  if (state.failureKind === "fidelity" && (state.pendingPreReqs ?? []).length > 0) {
    return "systemArchitectReqItem";
  }
  return "technologyArchitect";
}

function routeAfterSpecEnrich(state: OrchestratorStateType): string {
  return (state.pendingSpecDrafts ?? []).length > 0
    ? "systemArchitectSpecItem"
    : "deliveryCriticArchitecture";
}

function routeAfterArchitectureCritic(state: OrchestratorStateType): string {
  if (
    state.failureKind === "fidelity" &&
    (state.architectureGaps ?? []).length > 0
  ) {
    return "technologyArchitect";
  }
  if (state.workflow === "docs" || state.docsOnly) {
    return "orchestratorFinalize";
  }
  return "scaffoldPrepare";
}

function routeAfterSoftwareEngineer(state: OrchestratorStateType): string {
  if ((state.pendingSpecs ?? []).length > 0) {
    return "softwareEngineer";
  }
  return "deliveryCriticDelivery";
}

function routeAfterDeliveryCritic(state: OrchestratorStateType): string {
  if ((state.pendingSpecs ?? []).length > 0) {
    return "softwareEngineer";
  }
  return "qaEngineer";
}

function routeAfterResumePrepare(state: OrchestratorStateType): string {
  return (state.pendingSpecs ?? []).length > 0
    ? "scaffoldPrepare"
    : "orchestratorFinalize";
}

function routeAfterQa(state: OrchestratorStateType): string {
  if (state.testsPassed === false && (state.qaFailureLog ?? "").length > 0) {
    if (state.qaFailureClass === "bootstrap") {
      return "bootstrapFix";
    }
    return "softwareEngineerFix";
  }
  if ((state.pendingQaSpecs ?? []).length > 0) {
    return "qaEngineer";
  }
  return "systemArchitectProjectSummary";
}

function routeAfterProjectSummary(state: OrchestratorStateType): string {
  return state.pendingTechDebtReview
    ? "systemArchitectTechDebtReview"
    : "orchestratorFinalize";
}

const fullGraph = new StateGraph(OrchestratorState)
  .addNode("workflowRouter", workflowRouterNode)
  .addNode("punchPrepare", punchPrepareNode)
  .addNode("fixPrepare", fixPrepareNode)
  .addNode("resumePrepare", resumePrepareNode)
  .addNode("orchestratorBootstrapReadme", orchestratorBootstrapReadmeNode)
  .addNode("systemArchitectReqItem", systemArchitectReqItemNode)
  .addNode("orchestratorAfterPreReq", orchestratorAfterPreReqNode)
  .addNode("orchestratorCleanReadme", orchestratorCleanReadmeNode)
  .addNode("uiUxRequirements", uiUxRequirementsNode)
  .addNode("fidelityCriticRequirements", fidelityCriticRequirementsNode)
  .addNode("technologyArchitect", technologyArchitectNode)
  .addNode("uiUxDesignSystem", uiUxDesignSystemNode)
  .addNode("systemArchitectTodoPlan", systemArchitectTodoPlanNode)
  .addNode("systemArchitectSpecItem", systemArchitectSpecItemNode)
  .addNode("uiUxSpecEnrich", uiUxSpecEnrichNode)
  .addNode("technologyArchitectSpecEnrich", technologyArchitectSpecEnrichNode)
  .addNode("deliveryCriticArchitecture", deliveryCriticArchitectureNode)
  .addNode("scaffoldPrepare", scaffoldPrepareNode)
  .addNode("bootstrapFix", bootstrapFixNode)
  .addNode("softwareEngineer", softwareEngineerNode)
  .addNode("deliveryCriticDelivery", deliveryCriticDeliveryNode)
  .addNode("softwareEngineerFix", softwareEngineerFixNode)
  .addNode("qaEngineer", qaEngineerNode)
  .addNode("systemArchitectProjectSummary", systemArchitectProjectSummaryNode)
  .addNode("systemArchitectTechDebtReview", systemArchitectTechDebtReviewNode)
  .addNode("orchestratorFinalize", orchestratorFinalizeNode)
  .addEdge(START, "workflowRouter")
  .addConditionalEdges("workflowRouter", routeFromWorkflow, {
    orchestratorBootstrapReadme: "orchestratorBootstrapReadme",
    systemArchitectTodoPlan: "systemArchitectTodoPlan",
    punchPrepare: "punchPrepare",
    fixPrepare: "fixPrepare",
    resumePrepare: "resumePrepare",
  })
  .addEdge("orchestratorBootstrapReadme", "systemArchitectReqItem")
  .addEdge("systemArchitectReqItem", "orchestratorAfterPreReq")
  .addConditionalEdges("orchestratorAfterPreReq", routeAfterPreReq, {
    systemArchitectReqItem: "systemArchitectReqItem",
    orchestratorCleanReadme: "orchestratorCleanReadme",
  })
  .addEdge("orchestratorCleanReadme", "uiUxRequirements")
  .addEdge("uiUxRequirements", "fidelityCriticRequirements")
  .addConditionalEdges("fidelityCriticRequirements", routeAfterFidelity, {
    systemArchitectReqItem: "systemArchitectReqItem",
    technologyArchitect: "technologyArchitect",
  })
  .addEdge("technologyArchitect", "uiUxDesignSystem")
  .addEdge("uiUxDesignSystem", "systemArchitectTodoPlan")
  .addEdge("systemArchitectTodoPlan", "systemArchitectSpecItem")
  .addEdge("systemArchitectSpecItem", "uiUxSpecEnrich")
  .addEdge("uiUxSpecEnrich", "technologyArchitectSpecEnrich")
  .addConditionalEdges(
    "technologyArchitectSpecEnrich",
    routeAfterSpecEnrich,
    {
      systemArchitectSpecItem: "systemArchitectSpecItem",
      deliveryCriticArchitecture: "deliveryCriticArchitecture",
    }
  )
  .addConditionalEdges(
    "deliveryCriticArchitecture",
    routeAfterArchitectureCritic,
    {
      technologyArchitect: "technologyArchitect",
      scaffoldPrepare: "scaffoldPrepare",
      orchestratorFinalize: "orchestratorFinalize",
    }
  )
  .addEdge("scaffoldPrepare", "softwareEngineer")
  .addEdge("punchPrepare", "softwareEngineer")
  .addEdge("fixPrepare", "softwareEngineerFix")
  .addConditionalEdges("resumePrepare", routeAfterResumePrepare, {
    scaffoldPrepare: "scaffoldPrepare",
    orchestratorFinalize: "orchestratorFinalize",
  })
  .addConditionalEdges("softwareEngineer", routeAfterSoftwareEngineer, {
    softwareEngineer: "softwareEngineer",
    deliveryCriticDelivery: "deliveryCriticDelivery",
  })
  .addConditionalEdges("deliveryCriticDelivery", routeAfterDeliveryCritic, {
    softwareEngineer: "softwareEngineer",
    qaEngineer: "qaEngineer",
  })
  .addConditionalEdges("qaEngineer", routeAfterQa, {
    softwareEngineerFix: "softwareEngineerFix",
    bootstrapFix: "bootstrapFix",
    qaEngineer: "qaEngineer",
    systemArchitectProjectSummary: "systemArchitectProjectSummary",
  })
  .addConditionalEdges(
    "systemArchitectProjectSummary",
    routeAfterProjectSummary,
    {
      systemArchitectTechDebtReview: "systemArchitectTechDebtReview",
      orchestratorFinalize: "orchestratorFinalize",
    }
  )
  .addEdge("systemArchitectTechDebtReview", "orchestratorFinalize")
  .addEdge("softwareEngineerFix", "qaEngineer")
  .addEdge("bootstrapFix", "qaEngineer")
  .addEdge("orchestratorFinalize", END);

/** Compiled graph; workflow (or docsOnly alias) selects the route after workflowRouter. */
export const compiledGraph = fullGraph.compile();
export const compiledDocsGraph = compiledGraph;

// ============================================================
// 3. MCP server
// ============================================================
const server = new McpServer(
  {
    name: "zteam",
    version: "1.0.0",
  },
  {
    capabilities: {
      logging: {},
    },
  }
);

server.tool(
  "run_development_pipeline",
  [
    "Runs a spec-driven LangGraph development pipeline under a project root.",
    "START → workflowRouter picks a route (or use workflow override), then:",
    "full/docs: bootstrap → SA pré-reqs → clean README → fidelity → TA → specs → (SE/QA if full) → SA project summary → optional tech-debt plan → finalize;",
    "feature: specs → SE* → QA* → SA summary → optional tech-debt plan; punch/fix/resume: … → QA → SA summary → optional tech-debt plan;",
    `Workflows: ${workflowCatalogText()}.`,
    "Set workflow to full|docs|feature|punch|fix|resume to force a route; omit to auto-classify.",
    "docsOnly=true is an alias for workflow=docs (deprecated).",
    "Pass workspaceRoot = absolute path of the Cursor-open folder (REQUIRED; MCP never uses sticky WORKSPACE_ROOT env).",
    "Set projectRoot to a relative folder under that workspace (default '.') treated as the app root for all writes.",
    "Requires .zteam/config.json (workspace and/or app) unless skipConfigGate=true.",
    "Config models are absolute truth: cursor aliases (inherit/auto/cursor/cursor-auto) → returns delegationPlaybook for Cursor Task (no 9router LLM); any other id → ChatOpenAI literal via 9router (validated against GET /models).",
    "Mixed cursor+9router primaries → failureKind=mixed_runtime.",
    "FILE writes are sanitized (no .., strip projectRoot prefix, strip markdown fences).",
    "On failure, check .docs/pipeline-result.json and resumeHint (prefer workflow=resume).",
  ].join(" "),
  {
    userIdea: z.string().describe("The high-level idea or feature request"),
    workspaceRoot: workspaceRootArg,
    projectRoot: z
      .string()
      .optional()
      .default(".")
      .describe(
        "Relative project folder under workspaceRoot treated as app root (default '.')"
      ),
    workflow: z
      .enum(["full", "docs", "feature", "punch", "fix", "resume"])
      .optional()
      .describe(
        "Force a workflow route; omit to auto-classify from idea + existing docs"
      ),
    docsOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Deprecated alias for workflow=docs (planning only, skip SE/QA)"
      ),
    skipConfigGate: z
      .boolean()
      .optional()
      .default(false)
      .describe("Skip .zteam/config.json gate (smoke/dev only)"),
  },
  async (
    { userIdea, workspaceRoot, projectRoot, workflow, docsOnly, skipConfigGate },
    extra
  ) => {
    const root = projectRoot || ".";
    const started = Date.now();
    const resolved = mcpResolveWorkspace(workspaceRoot);
    if (!resolved.ok) return resolved.result;
    const ws = resolved.ws;
    const appRoot = resolveAppRoot(root, ws.root);
    const recursionLimit = resolveGraphRecursionLimit();
    const metrics = createMetrics();
    const explicit = resolveExplicitWorkflow({
      workflow,
      docsOnly,
      userIdea,
    });
    const mode = explicit || "auto";
    const session = createProgressSession({
      sendNotification: (notification) =>
        extra.sendNotification(
          notification as Parameters<typeof extra.sendNotification>[0]
        ),
      progressToken: extra._meta?.progressToken,
    });
    session.traceId = metrics.traceId;

    // Materialize .zteam/ (README + skills/SKILL.md) before any LLM / config gate
    await ensureZteamBootstrapRoots(ws.root, appRoot);

    const teamConfig = await loadTeamConfig(ws.root, appRoot);
    const workspaceDiag = diagnoseWorkspace(ws.root, ws.source);

    if (!skipConfigGate && !configGateSatisfied(teamConfig)) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              needsConfigPayload({
                workspaceRoot: ws.root,
                appRoot,
                workspace: workspaceDiag,
              }),
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const runtimeRes = resolveTeamRuntime(teamConfig);
    if (!runtimeRes.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: false,
                failureKind: runtimeRes.failureKind,
                error: runtimeRes.message,
                roles: runtimeRes.roles,
                models: teamConfig.models,
                appRoot,
                workspaceRoot: ws.root,
                resumeHint:
                  "Use the same runtime for all primaries: all inherit/auto/cursor OR all 9router ids. Fix .zteam/config.json then re-run.",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    if (runtimeRes.runtime === "cursor") {
      const playbook = buildCursorDelegationPlaybook({
        workflow: explicit || "full",
        userIdea,
        workspaceRoot: ws.root,
        projectRoot: root,
        appRoot,
        models: teamConfig.models,
        maxTokens: teamConfig.maxTokens,
      });
      session.emit(
        "pipeline",
        "notify",
        `llmRuntime=cursor — returning delegationPlaybook (${playbook.stages.length} stages); skill must run Cursor Task`
      );
      session.close();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: true,
                llmRuntime: "cursor",
                delegated: true,
                workflow: explicit || mode,
                appRoot,
                workspaceRoot: ws.root,
                projectRoot: root,
                models: teamConfig.models,
                maxTokens: teamConfig.maxTokens,
                delegationPlaybook: playbook,
                resumeHint: playbook.resumeHint,
                notifications: session.lines,
                ms: Date.now() - started,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return withRunContext(
      {
        workspaceRoot: ws.root,
        workspaceSource: ws.source,
        teamConfig,
      },
      () =>
        withProgressSession(session, async () => {
          session.emit(
            "pipeline",
            "stage",
            `MCP start (workflow=${mode}) workspace=${ws.root} (${ws.source}) projectRoot=${root} appRoot=${appRoot} recursionLimit=${recursionLimit} trace=${metrics.traceId}`
          );
          try {
            assertSafeAppRoot(appRoot, root);
            assertExpectedWorkspace(ws.root);
            assertPathInsideWorkspace(ws.root, appRoot);

            if (shouldHealthcheckForWorkflow(explicit || "full")) {
              const health = await healthcheckNineRouter();
              session.emit(
                "pipeline",
                health.ok ? "notify" : "error",
                health.message
              );
              if (!health.ok) {
                const err = new Error(health.message);
                (err as Error & { failureKind?: string }).failureKind =
                  "healthcheck";
                throw err;
              }
            }

            {
              const listed = await listNineRouterModelIds();
              if (!listed.ok) {
                const err = new Error(
                  `Could not list 9router models: ${listed.message}`
                );
                (err as Error & { failureKind?: string }).failureKind =
                  "invalid_model";
                throw err;
              }
              const missing = missingNineRouterModels(
                teamConfig,
                listed.ids
              );
              if (missing.length > 0) {
                const err = new Error(
                  `Models not found on 9router: ${missing.join("; ")}`
                );
                (err as Error & { failureKind?: string }).failureKind =
                  "invalid_model";
                throw err;
              }
              session.emit(
                "pipeline",
                "notify",
                `models validated against 9router (${listed.message})`
              );
            }

            const result = await compiledGraph.invoke(
              {
                userIdea,
                projectRoot: root,
                workflow: explicit || "",
                docsOnly: Boolean(docsOnly) || explicit === "docs",
                workflowReason: "",
                notifications: [],
                resume: "",
                pendingPreReqs: [],
                completedPreReqs: [],
                currentPreReq: "",
                preReqTotal: 0,
                pendingSpecs: [],
                completedSpecs: [],
                pendingQaSpecs: [],
                qaFixRound: 0,
                bootstrapFixRound: 0,
                deliveryFixRound: 0,
                deliveryVerifyFeedback: "",
                fidelityFixRound: 0,
                architectureGaps: [],
                qaFailureClass: "",
                traceId: metrics.traceId,
                appRoot,
                filesWritten: [],
                fidelityWarnings: [],
                failureKind: "",
                resumeHint: "",
              },
              { recursionLimit }
            );
            session.emit(
              "pipeline",
              "stage",
              `MCP done in ${Date.now() - started}ms (workflow=${result.workflow || mode})`
            );
            const live = session.lines;
            const merged = {
              ...result,
              appRoot: result.appRoot || appRoot,
              workspaceRoot: ws.root,
              workspaceSource: ws.source,
              teamModels: teamConfig.models,
              filesWritten: result.filesWritten ?? [],
              recursionLimit,
              ...metricsSnapshot(),
              notifications:
                live.length > 0
                  ? live
                  : Array.isArray(result.notifications)
                    ? result.notifications
                    : [],
            };
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(merged, null, 2),
                },
              ],
            };
          } catch (err) {
            const hint =
              (err as { resumeHint?: string }).resumeHint ||
              `workflow=resume projectRoot=${root}`;
            const failureKind =
              (err as { failureKind?: string }).failureKind || "pipeline_error";
            setErrorClass(failureKind);
            session.emit(
              "pipeline",
              "error",
              `MCP failed after ${Date.now() - started}ms (${mode}): ${errorText(err)}`
            );
            await writePipelineResult(appRoot, {
              ok: false,
              workflow: mode,
              appRoot,
              projectRoot: root,
              failureKind,
              resumeHint: hint,
              error: errorText(err),
              ms: Date.now() - started,
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      ok: false,
                      failureKind,
                      error: errorText(err),
                      appRoot,
                      workspaceRoot: ws.root,
                      resumeHint: hint,
                      ...metricsSnapshot(),
                      notifications: session.lines,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          } finally {
            session.close();
            clearMetrics();
          }
        })
    );
  }
);

server.tool(
  "get_zteam_config",
  "Read merged .zteam/config.json (workspace + app) and workspace diagnosis.",
  {
    workspaceRoot: workspaceRootArg,
    projectRoot: z.string().optional().default("."),
  },
  async ({ workspaceRoot, projectRoot }) => {
    const resolved = mcpResolveWorkspace(workspaceRoot);
    if (!resolved.ok) return resolved.result;
    const ws = resolved.ws;
    const appRoot = resolveAppRoot(projectRoot || ".", ws.root);
    const bootstrap = await ensureZteamBootstrapRoots(ws.root, appRoot);
    const teamConfig = await loadTeamConfig(ws.root, appRoot);
    const runtimeRes = resolveTeamRuntime(teamConfig);
    const payload = {
      ok: true,
      exists: teamConfig.exists,
      sources: teamConfig.sources,
      models: teamConfig.models,
      maxTokens: teamConfig.maxTokens,
      llmRuntime: runtimeRes.ok ? runtimeRes.runtime : null,
      runtimeError: runtimeRes.ok
        ? null
        : {
            failureKind: runtimeRes.failureKind,
            message: runtimeRes.message,
            roles: runtimeRes.roles,
          },
      cursorAliases: ["inherit", "auto", "cursor", "cursor-auto"],
      needsConfig: !configGateSatisfied(teamConfig),
      questions: configGateSatisfied(teamConfig) ? [] : [...SETUP_QUESTIONS],
      modelQuestions: [...MODEL_QUESTIONS],
      modelSuggestions: ROLE_MODEL_SUGGESTIONS,
      suggestedDefaults: {
        models: teamConfig.models,
        maxTokens: teamConfig.maxTokens,
      },
      workspace: diagnoseWorkspace(ws.root, ws.source),
      appRoot,
      bootstrap: {
        workspaceSkill: bootstrap.workspace.skill,
        appSkill: bootstrap.app?.skill ?? null,
      },
    };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "write_zteam_config",
  "Write .zteam/config.json to workspace, app, or both; optionally update .gitignore.",
  {
    workspaceRoot: workspaceRootArg,
    projectRoot: z.string().optional().default("."),
    scope: z.enum(["workspace", "app", "both"]),
    models: z.object({
      systemArchitect: z.string().min(1),
      technologyArchitect: z.string().min(1),
      uiUxDesigner: z
        .string()
        .min(1)
        .optional()
        .default(DEFAULT_MODELS.uiUxDesigner),
      softwareEngineer: z.string().min(1),
      qaEngineer: z.string().min(1),
      fallback: z.string().optional().default(""),
      systemArchitectFallback: z.string().optional().default(""),
      technologyArchitectFallback: z.string().optional().default(""),
      uiUxDesignerFallback: z.string().optional().default(""),
      softwareEngineerFallback: z.string().optional().default(""),
      qaEngineerFallback: z.string().optional().default(""),
    }),
    maxTokens: z
      .object({
        systemArchitect: z.number().int().positive().optional(),
        technologyArchitect: z.number().int().positive().optional(),
        uiUxDesigner: z.number().int().positive().optional(),
        softwareEngineer: z.number().int().positive().optional(),
        qaEngineer: z.number().int().positive().optional(),
      })
      .optional(),
    gitignoreIgnore: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true and no .gitignore, create one with .zteam/; if .gitignore exists, append .zteam/"),
  },
  async ({
    workspaceRoot,
    projectRoot,
    scope,
    models,
    maxTokens,
    gitignoreIgnore,
  }) => {
    const resolved = mcpResolveWorkspace(workspaceRoot);
    if (!resolved.ok) return resolved.result;
    const ws = resolved.ws;
    const appRoot = resolveAppRoot(projectRoot || ".", ws.root);
    const written: string[] = [];
    const gitignore: Record<string, unknown>[] = [];

    const targets: string[] = [];
    if (scope === "workspace" || scope === "both") targets.push(ws.root);
    if (scope === "app" || scope === "both") {
      if (resolve(appRoot) !== resolve(ws.root) || scope === "app") {
        targets.push(appRoot);
      }
    }
    // Deduplicate
    const unique = [...new Set(targets.map((t) => resolve(t)))];

    for (const dir of unique) {
      const { path } = await writeTeamConfig(dir, { models, maxTokens });
      written.push(path);
      if (gitignoreIgnore) {
        const gi = await ensureGitignoreIgnoresZteam(dir, {
          createIfMissing: true,
        });
        gitignore.push(gi);
      } else {
        gitignore.push(
          await ensureGitignoreIgnoresZteam(dir, { createIfMissing: false })
        );
      }
    }

    const teamConfig = await loadTeamConfig(ws.root, appRoot);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              ok: true,
              written,
              gitignore,
              models: teamConfig.models,
              maxTokens: teamConfig.maxTokens,
              exists: teamConfig.exists,
              workspace: diagnoseWorkspace(ws.root, ws.source),
              appRoot,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_pipeline_state",
  "Read .docs/pipeline-state.json for a projectRoot (debug / resume).",
  {
    workspaceRoot: workspaceRootArg,
    projectRoot: z
      .string()
      .optional()
      .default(".")
      .describe("Relative project folder under workspaceRoot"),
  },
  async ({ workspaceRoot, projectRoot }) => {
    const resolved = mcpResolveWorkspace(workspaceRoot);
    if (!resolved.ok) return resolved.result;
    const ws = resolved.ws;
    const appRoot = resolveAppRoot(projectRoot || ".", ws.root);
    assertSafeAppRoot(appRoot, projectRoot || ".");
    const state = await readPipelineState(appRoot);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            state || {
              ok: false,
              message: "no pipeline-state.json",
              workspace: diagnoseWorkspace(ws.root, ws.source),
              appRoot,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "approve_gate",
  "Human-in-the-loop: resume, abort, or redirect a paused pipeline (ZTEAM_HITL=1).",
  {
    workspaceRoot: workspaceRootArg,
    projectRoot: z.string().optional().default("."),
    decision: z.enum(["resume", "abort", "redirect"]),
    redirectHint: z.string().optional(),
  },
  async ({ workspaceRoot, projectRoot, decision, redirectHint }) => {
    const resolved = mcpResolveWorkspace(workspaceRoot);
    if (!resolved.ok) return resolved.result;
    const ws = resolved.ws;
    const appRoot = resolveAppRoot(projectRoot || ".", ws.root);
    const result = await applyHitlDecision(appRoot, decision, redirectHint);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              appRoot,
              workspace: diagnoseWorkspace(ws.root, ws.source),
              ...result,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return resolve(thisFile) === resolve(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
  });
}

/**
 * Section C smoke: content-retry classification + heartbeat emission.
 * Call via `npm run smoke` (sets a short PROGRESS_HEARTBEAT_MS before import).
 */
export async function runSectionCSmoke(): Promise<{
  ok: true;
  heartbeats: number;
  lines: string[];
}> {
  try {
    assertUsableLlmText("", "smoke");
    throw new Error("expected empty text to throw");
  } catch (err) {
    if (!(err instanceof LlmContentError) || !isRetryableError(err)) {
      throw new Error(`empty text should be retryable LlmContentError: ${errorText(err)}`);
    }
  }

  try {
    assertHasFileSections("hello without files", "smoke");
    throw new Error("expected missing FILE sections to throw");
  } catch (err) {
    if (
      !(err instanceof LlmContentError) ||
      err.kind !== "no_file_sections" ||
      !isRetryableError(err)
    ) {
      throw new Error(
        `missing FILE sections should be retryable: ${errorText(err)}`
      );
    }
  }

  try {
    assertHasFileSections("===FILE: a.ts===\n\n", "smoke");
    throw new Error("expected empty FILE body to throw");
  } catch (err) {
    if (
      !(err instanceof LlmContentError) ||
      err.kind !== "empty_file_body" ||
      !isRetryableError(err)
    ) {
      throw new Error(`empty FILE body should be retryable: ${errorText(err)}`);
    }
  }

  const interval = HEARTBEAT_MS;
  if (interval > 5_000) {
    throw new Error(
      `PROGRESS_HEARTBEAT_MS too high for smoke (${interval}); use <= 5000 (smoke script sets 400)`
    );
  }

  const session = createProgressSession();
  await withProgressSession(session, async () => {
    await withHeartbeat("smoke", "sleep de teste", async () => {
      await sleep(interval * 2 + 150);
    });
  });

  const heartbeats = session.lines.filter((l) => l.includes("heartbeat:"));
  if (heartbeats.length < 1) {
    throw new Error(
      `expected >=1 heartbeat after ~${interval * 2}ms; lines:\n${session.lines.join("\n")}`
    );
  }

  console.error(
    `[smoke] OK — retryable content errors + ${heartbeats.length} heartbeat(s) (interval=${interval}ms)`
  );
  return { ok: true, heartbeats: heartbeats.length, lines: [...session.lines] };
}
