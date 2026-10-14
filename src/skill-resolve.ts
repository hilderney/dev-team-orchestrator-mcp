/**
 * Resolve and load role skills from `.zteam/skills/roles/`
 * (exact projectType → qualifier aliases → *-core).
 */
import { access, readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  needsUiFlow,
  type TeamRole,
} from "./zteam-config.js";

export const PACKAGE_SKILLS_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".zteam",
  "skills",
  "roles"
);

export type SkillPhase =
  | "bootstrap"
  | "requirements"
  | "juice"
  | "technologies"
  | "look-and-feel"
  | "todo-plan"
  | "spec-write"
  | "spec-flow"
  | "spec-tech"
  | "tdd-red"
  | "tdd-green"
  | "tdd-verify"
  | "fix"
  | "summary"
  | "tech-debt"
  | "analyze"
  | "delivery-critic";

export const ROLE_ABBREV: Record<TeamRole, string> = {
  systemArchitect: "sa",
  technologyArchitect: "ta",
  uiUxDesigner: "ux",
  softwareEngineer: "se",
  qaEngineer: "qa",
};

/** Map LangGraph / invoke stage id (or Cursor playbook stage id) → skill phase. */
export function stageToSkillPhase(stage: string): SkillPhase | null {
  const s = (stage || "").trim();
  if (!s) return null;
  if (s.startsWith("analyze:") || s === "analyze") return "analyze";
  const map: Record<string, SkillPhase> = {
    // LangGraph / invokeRoleLlm stage ids
    orchestratorBootstrapReadme: "bootstrap",
    systemArchitectReqItem: "requirements",
    uiUxRequirements: "juice",
    technologyArchitect: "technologies",
    uiUxDesignSystem: "look-and-feel",
    systemArchitectTodoPlan: "todo-plan",
    systemArchitectSpecItem: "spec-write",
    uiUxSpecEnrich: "spec-flow",
    technologyArchitectSpecEnrich: "spec-tech",
    qaTddRed: "tdd-red",
    softwareEngineer: "tdd-green",
    softwareEngineerFix: "fix",
    qaEngineer: "tdd-verify",
    systemArchitectProjectSummary: "summary",
    systemArchitectTechDebtReview: "tech-debt",
    analyzePrepare: "analyze",
    deliveryCriticDelivery: "delivery-critic",
    // Cursor delegation playbook stage ids
    "sa-requirements": "requirements",
    "ux-juice": "juice",
    "ta-stack": "technologies",
    "ux-design-system": "look-and-feel",
    "sa-todo-and-specs": "todo-plan",
    "qa-tdd-red": "tdd-red",
    "se-implement": "tdd-green",
    "delivery-critic": "delivery-critic",
    "qa-tdd-verify": "tdd-verify",
  };
  return map[s] ?? null;
}

/**
 * Ordered candidate filenames (best → fallback).
 */
export function skillFileCandidates(
  role: TeamRole,
  phase: SkillPhase,
  projectType?: string | null
): string[] {
  const abbr = ROLE_ABBREV[role];
  const type = (projectType || "").trim().toLowerCase();
  const ui = needsUiFlow(type || null);
  const names: string[] = [];
  const push = (n: string) => {
    if (n && !names.includes(n)) names.push(n);
  };

  if (type) {
    push(`${abbr}-${phase}-${type}.md`);
    // On-disk alias: ux-flow-* for phase spec-flow
    if (phase === "spec-flow") push(`${abbr}-flow-${type}.md`);
  }

  if (role === "softwareEngineer" && phase === "tdd-green") {
    if (type) push(`se-tdd-green-${type}.md`);
    push("se-implement-tdd-green.md");
  }

  if (role === "qaEngineer" && phase === "tdd-red") {
    if (ui) push("qa-tdd-red-screenflow.md");
    else push("qa-tdd-red-api-contract.md");
    if (type === "crud" || type === "webapp" || type === "forms") {
      push("qa-tdd-red-forms.md");
    }
  }

  if (role === "qaEngineer" && phase === "tdd-verify") {
    if (ui) push("qa-tdd-verify-screenflow.md");
    else push("qa-tdd-verify-api-contract.md");
  }

  if (role === "qaEngineer" && phase === "analyze") {
    push("qa-analyze-coverage.md");
  }

  push(`${abbr}-${phase}-core.md`);
  return names;
}

export type ResolvedSkill = {
  key: string;
  fileName: string;
  absPath: string;
  body: string;
  excerpt: string;
};

function skillSearchDirs(
  appRoot?: string | null,
  workspaceRoot?: string | null
): string[] {
  const dirs: string[] = [];
  const push = (d: string) => {
    if (d && !dirs.includes(d)) dirs.push(d);
  };
  if (appRoot) push(join(appRoot, ".zteam", "skills", "roles"));
  if (workspaceRoot) push(join(workspaceRoot, ".zteam", "skills", "roles"));
  push(PACKAGE_SKILLS_ROOT);
  return dirs;
}

/** Keep prompt lean: Mission + Must deliver + Anti-patterns (+ Artefacts if short). */
export function excerptSkillMarkdown(raw: string, maxChars = 2800): string {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const parts: string[] = [];
  const re =
    /^##\s+(Mission|Must deliver|Anti-patterns|Artefacts)\s*$/gim;
  const indices: { title: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    indices.push({ title: m[1], start: m.index });
  }
  if (indices.length === 0) {
    return text.length > maxChars ? text.slice(0, maxChars) + "\n…" : text;
  }
  for (let i = 0; i < indices.length; i++) {
    const cur = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1].start : text.length;
    const chunk = text.slice(cur.start, end).trim();
    if (/^##\s+Notes/i.test(chunk)) continue;
    parts.push(chunk);
  }
  let out = parts.join("\n\n").trim();
  if (out.length > maxChars) out = out.slice(0, maxChars) + "\n…";
  return out;
}

async function fileReadable(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve first existing skill file among candidates.
 */
export async function resolveSkill(opts: {
  role: TeamRole;
  phase: SkillPhase;
  projectType?: string | null;
  appRoot?: string | null;
  workspaceRoot?: string | null;
}): Promise<ResolvedSkill | null> {
  const candidates = skillFileCandidates(
    opts.role,
    opts.phase,
    opts.projectType
  );
  const dirs = skillSearchDirs(opts.appRoot, opts.workspaceRoot);
  for (const fileName of candidates) {
    for (const dir of dirs) {
      const absPath = join(dir, fileName);
      if (!(await fileReadable(absPath))) continue;
      const body = await readFile(absPath, "utf8");
      const excerpt = excerptSkillMarkdown(body);
      if (!excerpt) continue;
      return {
        key: fileName.replace(/\.md$/i, ""),
        fileName,
        absPath,
        body,
        excerpt,
      };
    }
  }
  return null;
}

/** Sync variant for Cursor playbook builder. */
export function resolveSkillSync(opts: {
  role: TeamRole;
  phase: SkillPhase;
  projectType?: string | null;
  appRoot?: string | null;
  workspaceRoot?: string | null;
}): ResolvedSkill | null {
  const candidates = skillFileCandidates(
    opts.role,
    opts.phase,
    opts.projectType
  );
  const dirs = skillSearchDirs(opts.appRoot, opts.workspaceRoot);
  for (const fileName of candidates) {
    for (const dir of dirs) {
      const absPath = join(dir, fileName);
      if (!existsSync(absPath)) continue;
      try {
        const body = readFileSync(absPath, "utf8");
        const excerpt = excerptSkillMarkdown(body);
        if (!excerpt) continue;
        return {
          key: fileName.replace(/\.md$/i, ""),
          fileName,
          absPath,
          body,
          excerpt,
        };
      } catch {
        /* next */
      }
    }
  }
  return null;
}

export function formatSkillPromptBlock(skill: ResolvedSkill): string {
  return [
    `### Active skill: ${skill.key}`,
    `(file: ${skill.fileName})`,
    "",
    skill.excerpt,
    "",
    "Follow this skill's Must deliver and Anti-patterns for this stage.",
  ].join("\n");
}
