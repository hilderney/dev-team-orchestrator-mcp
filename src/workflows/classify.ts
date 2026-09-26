import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  isWorkflowId,
  type WorkflowId,
} from "./types.js";

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

const WORKFLOW_TAG_RE =
  /\[workflow:\s*(full|docs|feature|punch|fix|resume|tests|analyze)\s*\]/i;

/** Strip `[workflow:x]` tags from the user idea (kept for routing only). */
export function stripWorkflowTag(userIdea: string): string {
  return userIdea.replace(WORKFLOW_TAG_RE, "").replace(/\s+/g, " ").trim();
}

export function parseWorkflowTag(userIdea: string): WorkflowId | null {
  const m = userIdea.match(WORKFLOW_TAG_RE);
  if (!m) return null;
  const id = m[1].toLowerCase();
  return isWorkflowId(id) ? id : null;
}

/**
 * Resolve explicit workflow from MCP/CLI arg, docsOnly alias, or idea tag.
 * Empty string means “auto-classify”.
 */
export function resolveExplicitWorkflow(opts: {
  workflow?: string | null;
  docsOnly?: boolean | null;
  userIdea?: string;
}): WorkflowId | "" {
  const raw = (opts.workflow ?? "").trim().toLowerCase();
  if (raw && isWorkflowId(raw)) return raw;
  if (opts.docsOnly) return "docs";
  const tagged = opts.userIdea ? parseWorkflowTag(opts.userIdea) : null;
  if (tagged) return tagged;
  return "";
}

/**
 * Heuristic router: docs on disk + idea keywords.
 * Prefer explicit override via resolveExplicitWorkflow first.
 */
export async function classifyWorkflow(opts: {
  userIdea: string;
  appRoot: string;
  explicit?: WorkflowId | "";
}): Promise<{ workflow: WorkflowId; reason: string }> {
  if (opts.explicit && isWorkflowId(opts.explicit)) {
    return {
      workflow: opts.explicit,
      reason: `override explícito (${opts.explicit})`,
    };
  }

  const idea = stripWorkflowTag(opts.userIdea || "");
  const lower = idea.toLowerCase();

  const reqPath = join(opts.appRoot, ".docs", "requirements.md");
  const techPath = join(opts.appRoot, ".docs", "technologies.md");
  const hasReqs = await pathExists(reqPath);
  const hasTech = await pathExists(techPath);
  const docsExist = hasReqs && hasTech;

  if (
    /\b(resume|retomar|continuar\s+pipeline|pending\s+specs?)\b/i.test(lower) &&
    docsExist
  ) {
    return {
      workflow: "resume",
      reason: "pedido de resume + docs existentes",
    };
  }

  if (
    /\b(docs?\s*-?\s*only|s[oó]\s+docs|apenas\s+docs|s[oó]\s+planejar|apenas\s+planejar|planejamento\s+apenas)\b/i.test(
      lower
    )
  ) {
    return { workflow: "docs", reason: "pedido explícito de docs/planejamento" };
  }

  if (
    /\b(s[oó]\s+testes?|apenas\s+testes?|tests?\s*-?\s*only|tdd\s+red|gerar\s+testes?)\b/i.test(
      lower
    )
  ) {
    return { workflow: "tests", reason: "pedido explícito de só testes" };
  }

  if (
    /\b(analisa[rs]?|analyze|review\s+only|s[oó]\s+an[aá]lise|parecer)\b/i.test(
      lower
    )
  ) {
    return { workflow: "analyze", reason: "pedido explícito de análise" };
  }

  if (
    /\b(bug|erro|falha|failing|broken|crash|exception|corrig(ir|e)|fix(es)?)\b/i.test(
      lower
    )
  ) {
    if (docsExist) {
      return { workflow: "fix", reason: "keywords de bug/fix + docs existentes" };
    }
    return {
      workflow: "full",
      reason: "keywords de bug/fix sem docs — greenfield full",
    };
  }

  if (
    docsExist &&
    idea.length > 0 &&
    idea.length < 280 &&
    /\b(s[oó]|apenas|only|cor|bot[aã]o|button|copy|texto|label|css|estilo|padding|margin|tweak|ajuste\s+r[aá]pido|punch|renomear|typo)\b/i.test(
      lower
    )
  ) {
    return {
      workflow: "punch",
      reason: "ajuste pontual curto + docs existentes",
    };
  }

  if (!hasReqs) {
    return {
      workflow: "full",
      reason: "sem .docs/requirements.md — greenfield",
    };
  }

  if (docsExist) {
    return {
      workflow: "feature",
      reason: "docs existentes — feature incremental",
    };
  }

  return { workflow: "full", reason: "default greenfield" };
}
