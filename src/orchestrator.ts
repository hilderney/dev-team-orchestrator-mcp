import "dotenv/config";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/** Package root (this MCP server repo), resolved from this file. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** @deprecated Prefer resolveAppRoot(projectRoot); kept for CLI logging. */
export const PROJECT_ROOT = PACKAGE_ROOT;

const REQUIREMENTS_PATH = ".docs/requirements.md";
const TECHNOLOGIES_PATH = ".docs/technologies.md";
const TODO_PATH = ".docs/todo.md";
const SPECS_DIR = ".docs/specs";
const README_PATH = "README.md";

function getWorkspaceRoot(): string {
  const fromEnv = process.env.WORKSPACE_ROOT?.trim();
  return fromEnv ? resolve(fromEnv) : process.cwd();
}

/** Absolute path to the app project root (workspace + relative projectRoot). */
export function resolveAppRoot(projectRoot = "."): string {
  return resolve(getWorkspaceRoot(), projectRoot || ".");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

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
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function readDoc(appRoot: string, relPath: string): Promise<string> {
  try {
    return await readFile(join(appRoot, relPath), "utf8");
  } catch {
    return `[Document missing: ${relPath} was not found under ${appRoot}. Proceed with available context only.]`;
  }
}

function notify(
  stage: string,
  message: string,
  prev: string[] = []
): string[] {
  const line = `[${stage}] notify: ${message}`;
  console.error(line);
  return [...prev, line];
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

/** Parse ===FILE: path=== sections from an LLM response. */
function parseFileSections(raw: string): { path: string; content: string }[] {
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

async function writeParsedFiles(appRoot: string, raw: string): Promise<number> {
  const files = parseFileSections(raw);
  for (const file of files) {
    await writeDoc(appRoot, file.path, file.content);
  }
  return files.length;
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

async function runProjectTests(
  appRoot: string
): Promise<{ ok: boolean; log: string }> {
  const pkgPath = join(appRoot, "package.json");
  const hasPkg = await pathExists(pkgPath);
  const command = hasPkg ? "npm" : "node";
  const args = hasPkg ? ["test"] : ["--test"];

  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
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
      resolvePromise({ ok: code === 0, log: log.trim() || `(exit ${code})` });
    });
  });
}

function assertUsableLlmText(text: string, stage: string): void {
  if (!text.trim()) {
    throw new Error(`[${stage}] empty LLM response`);
  }
}

function assertHasFileSections(text: string, stage: string): void {
  assertUsableLlmText(text, stage);
  if (parseFileSections(text).length === 0) {
    throw new Error(`[${stage}] no ===FILE:=== sections in response`);
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

// ============================================================
// 1. 9Router OpenAI-compatible provider
// ============================================================
const NINEROUTER_BASE = process.env.NINEROUTER_BASE ?? "http://localhost:20128/v1";
const NINEROUTER_KEY = process.env.NINEROUTER_KEY;

if (!NINEROUTER_KEY) {
  throw new Error("NINEROUTER_KEY não definida no .env");
}

const MODEL_SYSTEM_ARCHITECT =
  process.env.MODEL_SYSTEM_ARCHITECT ?? "9RSA-system-architect-free";
const MODEL_TECHNOLOGY_ARCHITECT =
  process.env.MODEL_TECHNOLOGY_ARCHITECT ?? "9RTA-technology-architect-free";
const MODEL_SOFTWARE_ENGINEER =
  process.env.MODEL_SOFTWARE_ENGINEER ?? "9RSE-software-engineer-free";
const MODEL_QA_ENGINEER =
  process.env.MODEL_QA_ENGINEER ?? "9RQA-qa-free";

const MAX_TOKENS_SYSTEM_ARCHITECT = parseMaxTokens(
  process.env.MAX_TOKENS_SYSTEM_ARCHITECT,
  1600
);
const MAX_TOKENS_TECHNOLOGY_ARCHITECT = parseMaxTokens(
  process.env.MAX_TOKENS_TECHNOLOGY_ARCHITECT,
  2500
);
const MAX_TOKENS_SOFTWARE_ENGINEER = parseMaxTokens(
  process.env.MAX_TOKENS_SOFTWARE_ENGINEER,
  3500
);
const MAX_TOKENS_QA_ENGINEER = parseMaxTokens(
  process.env.MAX_TOKENS_QA_ENGINEER,
  2000
);
const MAX_QA_FIX_ROUNDS = parseMaxQaFixRounds();

function makeLLM(model: string, maxTokens: number): ChatOpenAI {
  return new ChatOpenAI({
    model,
    configuration: {
      baseURL: NINEROUTER_BASE,
      apiKey: NINEROUTER_KEY,
    },
    temperature: 0.2,
    maxTokens,
  });
}

async function invokeWithRetry(
  llm: ChatOpenAI,
  messages: BaseMessage[],
  opts: { stage: string; attempts?: number; validate?: (content: string) => void }
): Promise<{ content: unknown }> {
  const attempts = opts.attempts ?? 3;
  let lastError: unknown;

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await llm.invoke(messages);
      const content = String(res.content ?? "");
      opts.validate?.(content);
      return res;
    } catch (err) {
      lastError = err;
      if (i >= attempts || !isRetryableNetworkError(err)) {
        throw err;
      }
      const delayMs = 1000 * 2 ** (i - 1);
      console.error(`[${opts.stage}] retry ${i}: ${errorText(err)} (waiting ${delayMs}ms)`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function timedStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.error(`[${name}] start`);
  try {
    const result = await fn();
    console.error(`[${name}] done in ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    console.error(`[${name}] failed after ${Date.now() - started}ms: ${errorText(err)}`);
    throw err;
  }
}

// ============================================================
// 2. State + nodes
// ============================================================
const OrchestratorState = Annotation.Root({
  userIdea: Annotation<string>(),
  projectRoot: Annotation<string>(),
  docsOnly: Annotation<boolean>(),
  notifications: Annotation<string[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  requirements: Annotation<string>(),
  techDesign: Annotation<string>(),
  todo: Annotation<string>(),
  pendingSpecs: Annotation<string[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
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
  testsPassed: Annotation<boolean>(),
  code: Annotation<string>(),
  tests: Annotation<string>(),
});

type OrchestratorStateType = typeof OrchestratorState.State;

function appRootOf(state: OrchestratorStateType): string {
  return resolveAppRoot(state.projectRoot || ".");
}

async function systemArchitectRequirementsNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("systemArchitectRequirements", async () => {
    const appRoot = appRootOf(state);
    await mkdir(appRoot, { recursive: true });

    const llm = makeLLM(MODEL_SYSTEM_ARCHITECT, MAX_TOKENS_SYSTEM_ARCHITECT);
    const res = await invokeWithRetry(
      llm,
      [
        new SystemMessage(
          [
            "You are a System Architect.",
            "Reply using EXACTLY this structure (no outer code fence):",
            "===SUMMARY===",
            "One short paragraph (2–4 sentences) summarizing what the system does.",
            "===REQUIREMENTS===",
            "A full Markdown requirements document covering: business vision,",
            "functional requirements, non-functional requirements, and high-level architecture.",
            "Under ===REQUIREMENTS===: Markdown only — no application code, shell commands,",
            "JSON, tool calls, or instructions to create files.",
          ].join(" ")
        ),
        new HumanMessage(
          [
            `Project root (relative): ${state.projectRoot || "."}`,
            "",
            state.userIdea,
          ].join("\n")
        ),
      ],
      {
        stage: "systemArchitectRequirements",
        validate: (c) => assertUsableLlmText(c, "systemArchitectRequirements"),
      }
    );

    const raw = String(res.content ?? "");
    const parsed = parseSummaryAndRequirements(raw);
    const requirements = parsed
      ? stripOuterMarkdownFence(parsed.requirements)
      : stripOuterMarkdownFence(raw);
    const summary = parsed
      ? parsed.summary
      : `This project implements: ${state.userIdea}`.trim();

    await writeDoc(appRoot, REQUIREMENTS_PATH, requirements);

    const readme = [
      `# Project`,
      "",
      summary.trim(),
      "",
      "## Documentation",
      "",
      `- [Requirements](${REQUIREMENTS_PATH}) — business vision, functional/NFR, high-level architecture`,
      "",
      "Prefer these documents over chat state when implementing or testing.",
      "",
    ].join("\n");
    await writeDoc(appRoot, README_PATH, readme);

    const notifications = notify(
      "systemArchitectRequirements",
      `Wrote ${README_PATH} and ${REQUIREMENTS_PATH} under ${state.projectRoot || "."}`,
      []
    );

    return { requirements, notifications };
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

    const llm = makeLLM(MODEL_TECHNOLOGY_ARCHITECT, MAX_TOKENS_TECHNOLOGY_ARCHITECT);
    const res = await invokeWithRetry(
      llm,
      [
        new SystemMessage(
          [
            "You are a Technology Architect.",
            "Treat README.md as the source of truth for project goals.",
            "Reply using EXACTLY this structure (no outer code fence):",
            "===SUMMARY===",
            "2–4 sentences summarizing key technology decisions (for the README).",
            "===TECH===",
            "A Markdown technology design document with EXACTLY these level-2 headings (in order):",
            "## Technology decisions",
            "## Folder architecture",
            "## Stacks",
            "## Schemas / API exposure",
            "## Security",
            "## Development standards",
            "Under Folder architecture: define the project folder layout agents must create and use",
            "(including .docs/, specs, source layout).",
            "Under Development standards: require clean code, semantic naming, and human-readable code.",
            "No thinking aloud, no shell commands, no tool calls.",
          ].join(" ")
        ),
        new HumanMessage(
          [
            "## README.md",
            readmeFromDisk,
            "",
            "## .docs/requirements.md",
            requirementsFromDisk,
          ].join("\n")
        ),
      ],
      {
        stage: "technologyArchitect",
        validate: (c) => assertUsableLlmText(c, "technologyArchitect"),
      }
    );

    const raw = String(res.content ?? "");
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

    const notifications = notify(
      "technologyArchitect",
      `Wrote ${TECHNOLOGIES_PATH} and updated ${README_PATH}`,
      []
    );

    return { techDesign, notifications };
  });
}

async function systemArchitectSpecsNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("systemArchitectSpecs", async () => {
    const appRoot = appRootOf(state);
    const [readme, requirements, technologies] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
    ]);

    const llm = makeLLM(MODEL_SYSTEM_ARCHITECT, MAX_TOKENS_SYSTEM_ARCHITECT);
    const res = await invokeWithRetry(
      llm,
      [
        new SystemMessage(
          [
            "You are a System Architect doing spec-driven planning.",
            "Break requirements into small deliverable tasks.",
            "Reply using EXACTLY this structure (no outer code fence):",
            "===TODO===",
            "A Markdown checklist. Each line MUST be:",
            "- [ ] slug: Short title",
            "where slug is lowercase kebab-case (letters, digits, hyphens) and matches the spec file name.",
            "===SPEC: slug===",
            "One Markdown spec per todo item (same slug), suitable for spec-driven development:",
            "goal, acceptance criteria, files to touch, out of scope.",
            "Emit one ===SPEC: slug=== block per todo line. Keep specs concise.",
            "No application source code, no shell commands.",
          ].join(" ")
        ),
        new HumanMessage(
          [
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
      ],
      {
        stage: "systemArchitectSpecs",
        validate: (c) => assertUsableLlmText(c, "systemArchitectSpecs"),
      }
    );

    const raw = String(res.content ?? "");
    const parsed = parseTodoAndSpecs(raw);

    let todoMd: string;
    let specs: { slug: string; content: string }[];
    if (parsed) {
      todoMd = parsed.todo;
      specs = parsed.specs;
    } else {
      // Fallback: single catch-all task so the pipeline can continue
      todoMd = "- [ ] implement-core: Implement core deliverable from requirements\n";
      specs = [
        {
          slug: "implement-core",
          content: [
            "# implement-core",
            "",
            "## Goal",
            "Implement the core deliverable described in requirements and technologies.",
            "",
            "## Acceptance criteria",
            "- Primary deliverable exists under the project root",
            "- Matches stack and folder layout in technologies.md",
            "",
            "## Files to touch",
            "- As defined in technologies.md",
            "",
            "## Out of scope",
            "- Unrelated refactors",
          ].join("\n"),
        },
      ];
    }

    await writeDoc(appRoot, TODO_PATH, todoMd.endsWith("\n") ? todoMd : todoMd + "\n");
    for (const spec of specs) {
      await writeDoc(appRoot, specPath(spec.slug), spec.content + "\n");
    }

    const pendingFromTodo = parseTodoChecklist(todoMd)
      .filter((t) => !t.done)
      .map((t) => t.slug);
    const pendingSpecs =
      pendingFromTodo.length > 0 ? pendingFromTodo : specs.map((s) => s.slug);

    let readmeUpdated = await readDoc(appRoot, README_PATH);
    readmeUpdated = upsertReadmeSection(
      readmeUpdated,
      "Implementation plan",
      [
        "Tasks and specs for spec-driven development:",
        "",
        `- [Todo](${TODO_PATH}) — deliverable checklist`,
        `- Specs in [\`${SPECS_DIR}/\`](${SPECS_DIR}/) — one \`.spec.md\` per todo item`,
      ].join("\n")
    );
    await writeDoc(appRoot, README_PATH, readmeUpdated);

    const notifications = notify(
      "systemArchitectSpecs",
      `Wrote ${TODO_PATH} and ${specs.length} spec(s) under ${SPECS_DIR}/`,
      []
    );

    return {
      todo: todoMd,
      pendingSpecs,
      pendingQaSpecs: [...pendingSpecs],
      completedSpecs: [],
      notifications,
    };
  });
}

async function softwareEngineerNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("softwareEngineer", async () => {
    const appRoot = appRootOf(state);
    const pending = [...(state.pendingSpecs ?? [])];
    if (pending.length === 0) {
      const notifications = notify(
        "softwareEngineer",
        "No pending specs; nothing to implement",
        []
      );
      return { notifications };
    }

    const slug = pending[0];
    const [readme, requirements, technologies, todo, specBody] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, REQUIREMENTS_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
      readDoc(appRoot, TODO_PATH),
      readDoc(appRoot, specPath(slug)),
    ]);

    const llm = makeLLM(MODEL_SOFTWARE_ENGINEER, MAX_TOKENS_SOFTWARE_ENGINEER);
    const res = await invokeWithRetry(
      llm,
      [
        new SystemMessage(
          [
            "You are a Software Engineer.",
            "Implement ONLY the current spec. Follow README, technologies.md folder layout, and the spec.",
            "Write clean, semantic, human-readable, production-quality code.",
            "Do not write essays outside ===FILE=== blocks.",
            "Output one or more files using EXACTLY this format (no outer wrapper):",
            "===FILE: relative/path/from/project/root===",
            "<file contents>",
            "Paths are relative to the project root (not the MCP package root).",
          ].join(" ")
        ),
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
        stage: "softwareEngineer",
        validate: (c) => assertHasFileSections(c, "softwareEngineer"),
      }
    );

    const rawContent = String(res.content ?? "");
    await writeParsedFiles(appRoot, rawContent);
    await markTodoDone(appRoot, slug);

    const remaining = pending.slice(1);
    const notifications = notify(
      "softwareEngineer",
      remaining.length > 0
        ? `Completed spec '${slug}'; ${remaining.length} remaining`
        : `Completed spec '${slug}'; all implementation tasks done`,
      []
    );

    return {
      code: rawContent,
      currentSpec: slug,
      pendingSpecs: remaining,
      completedSpecs: [slug],
      notifications,
    };
  });
}

async function softwareEngineerFixNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("softwareEngineerFix", async () => {
    const appRoot = appRootOf(state);
    const slug = state.currentSpec || (state.pendingQaSpecs ?? [])[0] || "";
    const [readme, technologies, specBody] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
      slug ? readDoc(appRoot, specPath(slug)) : Promise.resolve("(no current spec)"),
    ]);

    const llm = makeLLM(MODEL_SOFTWARE_ENGINEER, MAX_TOKENS_SOFTWARE_ENGINEER);
    const res = await invokeWithRetry(
      llm,
      [
        new SystemMessage(
          [
            "You are a Software Engineer fixing failing tests.",
            "Apply the minimal fix. Output ONLY ===FILE: path=== sections for files you change.",
            "Paths are relative to the project root.",
          ].join(" ")
        ),
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
        validate: (c) => assertHasFileSections(c, "softwareEngineerFix"),
      }
    );

    const rawContent = String(res.content ?? "");
    await writeParsedFiles(appRoot, rawContent);

    const notifications = notify(
      "softwareEngineerFix",
      `Applied fix for '${slug}' (round ${(state.qaFixRound ?? 0) + 1})`,
      []
    );

    return {
      code: rawContent,
      qaFixRound: (state.qaFixRound ?? 0) + 1,
      notifications,
    };
  });
}

async function qaEngineerNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("qaEngineer", async () => {
    const appRoot = appRootOf(state);
    let pendingQa = [...(state.pendingQaSpecs ?? [])];
    if (pendingQa.length === 0) {
      pendingQa = await listSpecSlugs(appRoot);
    }

    const slug = pendingQa[0] ?? state.currentSpec ?? "";
    const [readme, todo, technologies, specBody] = await Promise.all([
      readDoc(appRoot, README_PATH),
      readDoc(appRoot, TODO_PATH),
      readDoc(appRoot, TECHNOLOGIES_PATH),
      slug ? readDoc(appRoot, specPath(slug)) : Promise.resolve(""),
    ]);

    const llm = makeLLM(MODEL_QA_ENGINEER, MAX_TOKENS_QA_ENGINEER);
    const res = await invokeWithRetry(
      llm,
      [
        new SystemMessage(
          [
            "You are a QA Engineer. Be concise.",
            "Create or update automated tests for the CURRENT spec only.",
            "Prefer node:test (or the project's existing test runner from technologies.md).",
            "Output:",
            "1) Optional short checklist (max ~10 bullets).",
            "2) One or more ===FILE: relative/path=== test files.",
            "FORBIDDEN: re-implementing the app, huge frameworks, essays.",
          ].join(" ")
        ),
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
            "## .docs/technologies.md",
            technologies,
          ].join("\n")
        ),
      ],
      {
        stage: "qaEngineer",
        validate: (c) => assertUsableLlmText(c, "qaEngineer"),
      }
    );

    const tests = String(res.content ?? "");
    await writeParsedFiles(appRoot, tests);

    const result = await runProjectTests(appRoot);
    console.error(
      `[qaEngineer] test run ${result.ok ? "PASSED" : "FAILED"} for spec '${slug}'`
    );

    if (!result.ok) {
      const round = state.qaFixRound ?? 0;
      if (round >= MAX_QA_FIX_ROUNDS) {
        throw new Error(
          `[qaEngineer] tests still failing after ${MAX_QA_FIX_ROUNDS} fix rounds:\n${result.log}`
        );
      }
      const notifications = notify(
        "qaEngineer",
        `Tests failed for '${slug}'; requesting SE fix (round ${round + 1}/${MAX_QA_FIX_ROUNDS})`,
        []
      );
      return {
        tests,
        currentSpec: slug,
        qaFailureLog: result.log,
        testsPassed: false,
        notifications,
      };
    }

    const remaining = pendingQa.filter((s) => s !== slug);
    const notifications = notify(
      "qaEngineer",
      remaining.length > 0
        ? `Tests passed for '${slug}'; ${remaining.length} spec(s) left`
        : "All tests passed for all specs",
      []
    );

    return {
      tests,
      currentSpec: slug,
      pendingQaSpecs: remaining,
      qaFailureLog: "",
      qaFixRound: 0,
      testsPassed: remaining.length === 0,
      notifications,
    };
  });
}

async function orchestratorFinalizeNode(
  state: OrchestratorStateType
): Promise<Partial<OrchestratorStateType>> {
  return timedStage("orchestratorFinalize", async () => {
    const appRoot = appRootOf(state);
    let readme = await readDoc(appRoot, README_PATH);

    const statusLines = state.docsOnly
      ? [
          "Pipeline mode: **docs-only** (requirements, technologies, todo, specs).",
          "Implementation and QA were skipped.",
        ]
      : [
          "Pipeline mode: **full**.",
          state.testsPassed
            ? "All automated tests passed."
            : "Pipeline finished (see notifications for details).",
        ];

    readme = upsertReadmeSection(
      readme,
      "Pipeline status",
      statusLines.join("\n")
    );
    await writeDoc(appRoot, README_PATH, readme);

    const notifications = notify(
      "orchestratorFinalize",
      state.docsOnly
        ? "Docs pipeline complete; README updated"
        : "Full pipeline complete; README updated",
      []
    );

    return { notifications };
  });
}

function routeAfterSpecs(state: OrchestratorStateType): string {
  return state.docsOnly ? "orchestratorFinalize" : "softwareEngineer";
}

function routeAfterSoftwareEngineer(state: OrchestratorStateType): string {
  return (state.pendingSpecs ?? []).length > 0 ? "softwareEngineer" : "qaEngineer";
}

function routeAfterQa(state: OrchestratorStateType): string {
  if (state.testsPassed === false && (state.qaFailureLog ?? "").length > 0) {
    return "softwareEngineerFix";
  }
  if ((state.pendingQaSpecs ?? []).length > 0) {
    return "qaEngineer";
  }
  return "orchestratorFinalize";
}

const fullGraph = new StateGraph(OrchestratorState)
  .addNode("systemArchitectRequirements", systemArchitectRequirementsNode)
  .addNode("technologyArchitect", technologyArchitectNode)
  .addNode("systemArchitectSpecs", systemArchitectSpecsNode)
  .addNode("softwareEngineer", softwareEngineerNode)
  .addNode("softwareEngineerFix", softwareEngineerFixNode)
  .addNode("qaEngineer", qaEngineerNode)
  .addNode("orchestratorFinalize", orchestratorFinalizeNode)
  .addEdge(START, "systemArchitectRequirements")
  .addEdge("systemArchitectRequirements", "technologyArchitect")
  .addEdge("technologyArchitect", "systemArchitectSpecs")
  .addConditionalEdges("systemArchitectSpecs", routeAfterSpecs, {
    softwareEngineer: "softwareEngineer",
    orchestratorFinalize: "orchestratorFinalize",
  })
  .addConditionalEdges("softwareEngineer", routeAfterSoftwareEngineer, {
    softwareEngineer: "softwareEngineer",
    qaEngineer: "qaEngineer",
  })
  .addConditionalEdges("qaEngineer", routeAfterQa, {
    softwareEngineerFix: "softwareEngineerFix",
    qaEngineer: "qaEngineer",
    orchestratorFinalize: "orchestratorFinalize",
  })
  .addEdge("softwareEngineerFix", "qaEngineer")
  .addEdge("orchestratorFinalize", END);

/** Same graph; docsOnly is passed via state (routes to finalize after specs). */
export const compiledGraph = fullGraph.compile();
export const compiledDocsGraph = compiledGraph;

// ============================================================
// 3. MCP server
// ============================================================
const server = new McpServer({
  name: "dev-team-orchestrator",
  version: "1.0.0",
});

server.tool(
  "run_development_pipeline",
  [
    "Runs a spec-driven LangGraph development pipeline under a project root.",
    "Flow: System Architect (requirements) → Technology Architect → System Architect (todo + specs)",
    "→ Software Engineer (one spec at a time) → QA (tests + run; SE fix loop) → Orchestrator finalize.",
    "Set docsOnly=true to stop after todo/specs + finalize (no SE/QA).",
    "Set projectRoot to a relative folder (default '.') treated as the app root for all writes.",
    "Docs: README.md, .docs/requirements.md, .docs/technologies.md, .docs/todo.md, .docs/specs/*.spec.md.",
    "Models via 9router (NINEROUTER_BASE); 9router handles model failover — this tool only retries network/5xx.",
    `systemArchitect → ${MODEL_SYSTEM_ARCHITECT};`,
    `technologyArchitect → ${MODEL_TECHNOLOGY_ARCHITECT};`,
    `softwareEngineer → ${MODEL_SOFTWARE_ENGINEER};`,
    `qaEngineer → ${MODEL_QA_ENGINEER}.`,
    "Do not use Cursor Task subagents for this work.",
  ].join(" "),
  {
    userIdea: z.string().describe("The high-level idea or feature request"),
    projectRoot: z
      .string()
      .optional()
      .default(".")
      .describe(
        "Relative project folder under WORKSPACE_ROOT/cwd treated as app root (default '.')"
      ),
    docsOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, run docs-only pipeline through todo+specs (skip SE/QA)"
      ),
  },
  async ({ userIdea, projectRoot, docsOnly }) => {
    const mode = docsOnly ? "docs-only" : "full";
    const root = projectRoot || ".";
    const started = Date.now();
    console.error(`[pipeline] MCP start (${mode}) projectRoot=${root}`);
    try {
      const result = await compiledGraph.invoke({
        userIdea,
        projectRoot: root,
        docsOnly: Boolean(docsOnly),
        notifications: [],
        pendingSpecs: [],
        completedSpecs: [],
        pendingQaSpecs: [],
        qaFixRound: 0,
      });
      console.error(`[pipeline] MCP done in ${Date.now() - started}ms (${mode})`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      console.error(
        `[pipeline] MCP failed after ${Date.now() - started}ms (${mode}): ${errorText(err)}`
      );
      throw err;
    }
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
