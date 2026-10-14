/**
 * Deterministic delivery verification (DoD) — no LLM.
 * Pattern: deliver → verifyDelivery → redo with feedback | advance.
 */
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type VerifyStage =
  | "softwareEngineer"
  | "systemArchitect"
  | "technologyArchitect"
  | "scaffold"
  | "requirements"
  | "specs";

export type VerifyFailureKind =
  | "llm_empty"
  | "spec_incomplete"
  | "tsc"
  | "bootstrap"
  | "fidelity"
  | "qa";

export type VerifyDeliveryInput = {
  stage: VerifyStage;
  slugs?: string[];
  filesWritten: string[];
  userIdea?: string;
  appRoot: string;
  /** Spec bodies keyed by slug (optional; loaded from disk if missing). */
  specBodies?: Record<string, string>;
  /** tsc smoke result; if omitted and tsconfig exists, caller should run it. */
  tscOk?: boolean;
  tscLog?: string;
};

export type VerifyDeliveryResult = {
  ok: boolean;
  reasons: string[];
  missingFiles: string[];
  reopenSlugs: string[];
  failureKind?: VerifyFailureKind;
};

export const MAX_DELIVERY_FIX_ROUNDS = (() => {
  const n = Number.parseInt(process.env.MAX_DELIVERY_FIX_ROUNDS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
})();

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

/** True for a clean relative file path (no prose, dirs, spaces, parens). */
export function isCleanFilePath(p: string): boolean {
  if (!p) return false;
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm || norm.includes("..")) return false;
  if (/\s/.test(norm)) return false;
  if (/[()]/.test(norm)) return false;
  if (norm.endsWith("/")) return false;
  if (!/\.[a-zA-Z0-9]+$/.test(norm)) return false;
  if (!/^[a-zA-Z0-9_./-]+$/.test(norm)) return false;
  return true;
}

/**
 * Parse "## Files to touch" (or similar) bullet paths from a .spec.md body.
 * Returns relative paths; ignores vague lines and prose/ambiguous paths.
 */
export function parseFilesToTouch(specMd: string): string[] {
  const text = specMd || "";
  const header = text.match(/^##\s+Files?\s+to\s+touch\s*$/im);
  if (!header || header.index === undefined) return [];
  const afterHeader = text.slice(header.index + header[0].length);
  const nextH2 = afterHeader.search(/\r?\n##\s+/);
  const block =
    nextH2 >= 0 ? afterHeader.slice(0, nextH2) : afterHeader;
  const paths: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!m) continue;
    let p = m[1].trim().replace(/\\/g, "/");
    p = p.replace(/^[`'"]+|[`'"]+$/g, "").trim();
    p = p.split(/\s+[—–]\s+|\s+-\s+/)[0].trim();
    p = p.replace(/[,;.]+$/, "").trim();
    if (!p) continue;
    if (/^(as\s+|minimal|see\s+|tbd|n\/a|none)/i.test(p)) continue;
    p = p.replace(/^\.\//, "");
    if (!isCleanFilePath(p)) continue;
    paths.push(p);
  }
  return [...new Set(paths)];
}

/**
 * If a Files-to-touch section exists with substantive bullets but none are clean
 * file paths, return issue strings (empty = OK / no section).
 */
export function filesToTouchSectionIssues(specMd: string): string[] {
  const text = specMd || "";
  const header = text.match(/^##\s+Files?\s+to\s+touch\s*$/im);
  if (!header || header.index === undefined) return [];
  const afterHeader = text.slice(header.index + header[0].length);
  const nextH2 = afterHeader.search(/\r?\n##\s+/);
  const block =
    nextH2 >= 0 ? afterHeader.slice(0, nextH2) : afterHeader;
  const bullets: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!m) continue;
    const raw = m[1].trim();
    if (!raw) continue;
    if (/^(as\s+|minimal|see\s+|tbd|n\/a|none)/i.test(raw)) continue;
    bullets.push(raw);
  }
  if (bullets.length === 0) return [];
  const paths = parseFilesToTouch(specMd);
  if (paths.length === 0) {
    return [
      `Files to touch has no clean file paths (got: ${bullets.slice(0, 3).join("; ")})`,
    ];
  }
  return [];
}

/** Assert Files-to-touch section is clean when present with bullets. */
export function assertFilesToTouchClean(specMd: string, slug?: string): void {
  const issues = filesToTouchSectionIssues(specMd);
  if (issues.length > 0) {
    const prefix = slug ? `spec '${slug}': ` : "";
    throw new Error(`${prefix}${issues.join("; ")}`);
  }
}

/** Fallback DoD: at least one src/ (or app/) path written per feature slug. */
function hasSrcCoverage(filesWritten: string[]): boolean {
  return filesWritten.some((f) =>
    /^(src|app|lib|pages|components)\//i.test(f.replace(/\\/g, "/"))
  );
}

export async function loadSpecBody(
  appRoot: string,
  slug: string
): Promise<string> {
  const abs = join(appRoot, ".docs", "specs", `${slug}.spec.md`);
  try {
    return await readFile(abs, "utf8");
  } catch {
    return "";
  }
}

async function verifyProjectSetup(
  appRoot: string,
  body: string,
  written: string[],
  reasons: string[],
  missingFiles: string[],
  reopenSlugs: string[]
): Promise<void> {
  const slug = "project-setup";
  const pkgOk = await pathExists(join(appRoot, "package.json"));
  const pkgWritten = written.some((w) => /(^|\/)package\.json$/i.test(w));
  if (!pkgOk && !pkgWritten) {
    missingFiles.push("package.json");
    if (!reopenSlugs.includes(slug)) reopenSlugs.push(slug);
    reasons.push("project-setup: missing package.json");
  }

  const parsed = parseFilesToTouch(body || "");
  if (parsed.length === 0) {
    const hasEntry =
      (await pathExists(join(appRoot, "src/App.tsx"))) ||
      (await pathExists(join(appRoot, "src/main.tsx"))) ||
      written.some((w) =>
        /^(src\/App\.tsx|src\/main\.tsx)$/i.test(w.replace(/\\/g, "/"))
      );
    if (!hasEntry) {
      missingFiles.push("src/App.tsx|src/main.tsx");
      if (!reopenSlugs.includes(slug)) reopenSlugs.push(slug);
      reasons.push(
        "project-setup: missing scaffold entry (src/App.tsx or src/main.tsx)"
      );
    }
    return;
  }

  const beforeMissing = missingFiles.length;
  for (const rel of parsed) {
    const abs = join(appRoot, ...rel.split("/"));
    const onDisk = await pathExists(abs);
    const justWritten = written.some(
      (w) =>
        w === rel ||
        w.endsWith("/" + rel) ||
        rel.endsWith("/" + w) ||
        w.toLowerCase() === rel.toLowerCase()
    );
    if (!onDisk && !justWritten) {
      missingFiles.push(rel);
      if (!reopenSlugs.includes(slug)) reopenSlugs.push(slug);
    }
  }
  if (
    missingFiles.length > beforeMissing &&
    !reasons.some((r) => r.includes("project-setup"))
  ) {
    reasons.push(
      `project-setup missing Files to touch: ${missingFiles.slice(beforeMissing).join(", ")}`
    );
  }
}

/**
 * Verify a delivery batch. Deterministic — no LLM.
 */
export async function verifyDelivery(
  input: VerifyDeliveryInput
): Promise<VerifyDeliveryResult> {
  const reasons: string[] = [];
  const missingFiles: string[] = [];
  const reopenSlugs: string[] = [];
  const slugs = input.slugs ?? [];
  const written = (input.filesWritten || []).map((f) =>
    f.replace(/\\/g, "/")
  );

  if (input.stage === "softwareEngineer" || input.stage === "scaffold") {
    if (written.length === 0 && !slugs.includes("project-setup")) {
      return {
        ok: false,
        reasons: ["OUT=0 / no files written"],
        missingFiles: [],
        reopenSlugs: [...slugs],
        failureKind: "llm_empty",
      };
    }

    // A3: N specs marked with only 1 file (or fewer files than specs)
    if (slugs.length > 1 && written.length < slugs.length) {
      reasons.push(
        `batch has ${slugs.length} specs but only ${written.length} file(s) written — refuse fake completion`
      );
      reopenSlugs.push(...slugs);
    }

    for (const slug of slugs) {
      if (slug === "punch") continue;
      let body = input.specBodies?.[slug];
      if (body === undefined) {
        body = await loadSpecBody(input.appRoot, slug);
      }

      if (slug === "project-setup") {
        await verifyProjectSetup(
          input.appRoot,
          body || "",
          written,
          reasons,
          missingFiles,
          reopenSlugs
        );
        continue;
      }

      if (written.length === 0) {
        reasons.push("OUT=0 / no files written");
        if (!reopenSlugs.includes(slug)) reopenSlugs.push(slug);
        continue;
      }

      const expected = parseFilesToTouch(body || "");
      if (expected.length > 0) {
        for (const rel of expected) {
          const abs = join(input.appRoot, ...rel.split("/"));
          const onDisk = await pathExists(abs);
          const justWritten = written.some(
            (w) =>
              w === rel ||
              w.endsWith("/" + rel) ||
              rel.endsWith("/" + w) ||
              w.toLowerCase() === rel.toLowerCase()
          );
          if (!onDisk && !justWritten) {
            missingFiles.push(rel);
            if (!reopenSlugs.includes(slug)) reopenSlugs.push(slug);
          }
        }
      } else if (slugs.length >= 1 && !hasSrcCoverage(written)) {
        reasons.push(
          `spec '${slug}' has no parseable Files to touch and batch wrote no src/ files`
        );
        if (!reopenSlugs.includes(slug)) reopenSlugs.push(slug);
      }

      // Anti false-green: UI flow specs need tests. SE stage is soft (any *.test.*
      // from QA-red is enough); strict path hints belong to QA-verify prompts.
      const needsFlowTests =
        /##\s*Flow\s*&\s*states/i.test(body || "") ||
        /screen[- ]?flow|overlay\s+exclus|busy.*pause|SF-\d+/i.test(body || "");
      if (needsFlowTests) {
        const isTestPath = (w: string) =>
          /\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(w);
        const softAnyTest = written.some(isTestPath);
        const testHint =
          /screen|overlay|flow|router|busy|pause/i;
        const hasFlowTest = written.some(
          (w) => isTestPath(w) && testHint.test(w)
        );
        const anyUiTest = written.some(
          (w) =>
            /\.(test|spec)\./i.test(w) &&
            /screen|overlay|flow|router|play|busy|pause/i.test(w)
        );
        if (!hasFlowTest && !anyUiTest && !softAnyTest) {
          let diskHit = false;
          let diskAnyTest = false;
          try {
            const walk = async (dir: string, depth = 0): Promise<void> => {
              if (depth > 4 || (diskHit && diskAnyTest)) return;
              const entries = await readdir(dir, { withFileTypes: true });
              for (const e of entries) {
                if (diskHit && diskAnyTest) return;
                if (e.name === "node_modules" || e.name === ".git") continue;
                const p = join(dir, e.name);
                if (e.isDirectory()) await walk(p, depth + 1);
                else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(e.name)) {
                  diskAnyTest = true;
                  if (
                    /screen|overlay|flow|router|play|busy|pause/i.test(e.name)
                  ) {
                    diskHit = true;
                  }
                }
              }
            };
            await walk(input.appRoot);
          } catch {
            /* ignore */
          }
          // SE TDD green: accept any on-disk test suite from QA-red
          const okSoft =
            input.stage === "softwareEngineer" && (diskAnyTest || softAnyTest);
          if (!diskHit && !okSoft) {
            reasons.push(
              `spec '${slug}' requires screen-flow / Flow & states tests but none found (path hint: *screen*|overlay|flow|busy|pause*.test.*)`
            );
            if (!reopenSlugs.includes(slug)) reopenSlugs.push(slug);
          }
        }
      }
    }

    if (missingFiles.length > 0 && !reasons.some((r) => /missing Files to touch/i.test(r))) {
      reasons.push(`missing Files to touch: ${missingFiles.join(", ")}`);
    }

    if (input.tscOk === false) {
      reasons.push(
        `tsc --noEmit failed: ${(input.tscLog || "").slice(0, 400)}`
      );
      for (const s of slugs) {
        if (!reopenSlugs.includes(s)) reopenSlugs.push(s);
      }
      return {
        ok: false,
        reasons,
        missingFiles,
        reopenSlugs,
        failureKind: "tsc",
      };
    }

    if (reasons.length > 0 || missingFiles.length > 0 || reopenSlugs.length > 0) {
      return {
        ok: false,
        reasons: reasons.length > 0 ? reasons : ["spec_incomplete"],
        missingFiles,
        reopenSlugs: reopenSlugs.length > 0 ? reopenSlugs : [...slugs],
        failureKind: "spec_incomplete",
      };
    }
  }

  if (input.stage === "requirements") {
    const idea = (input.userIdea || "").trim();
    if (!idea) {
      return {
        ok: true,
        reasons: [],
        missingFiles: [],
        reopenSlugs: [],
      };
    }
    const reqPath = join(input.appRoot, ".docs", "requirements.md");
    let req = "";
    try {
      req = await readFile(reqPath, "utf8");
    } catch {
      req = "";
    }
    const hasSections = /^##\s+/m.test(req);
    if (
      !req.trim() ||
      req.trim().length < 80 ||
      (/Sections are filled one pré-requirement/i.test(req) && !hasSections)
    ) {
      return {
        ok: false,
        reasons: ["requirements empty or stub"],
        missingFiles: [],
        reopenSlugs: [],
        failureKind: "llm_empty",
      };
    }
  }

  return {
    ok: true,
    reasons: [],
    missingFiles: [],
    reopenSlugs: [],
  };
}

/** Structured feedback for the next SE/SA prompt. */
export function formatVerifyFeedback(result: VerifyDeliveryResult): string {
  const lines = [
    `VERIFY FAIL${result.reopenSlugs.length ? ` for ${result.reopenSlugs.join(", ")}` : ""}:`,
    ...result.reasons.map((r) => `- ${r}`),
  ];
  if (result.missingFiles.length > 0) {
    lines.push(`- missing: ${result.missingFiles.join(", ")}`);
  }
  lines.push(
    "Do NOT mark todos done. Emit ONLY the missing files as ===FILE:=== sections (or write_file calls)."
  );
  return lines.join("\n");
}

/**
 * Named API / product tokens from userIdea that should appear in docs.
 * Conservative: multi-word brands and known API names.
 */
export function extractCriticalTokens(userIdea: string): string[] {
  const idea = userIdea || "";
  const tokens: string[] = [];
  const apiLike =
    idea.match(
      /\b([A-Z][a-zA-Z0-9]*(?:dex|TCG|API|io)|TCGdex|pokemontcg|PokeAPI|OpenAI|Stripe)\b/gi
    ) || [];
  for (const t of apiLike) {
    if (t.length >= 4) tokens.push(t);
  }
  if (/\b(pt-BR|en-US|pt_br|locale\s*[:=])/i.test(idea)) {
    const loc = idea.match(/\b(pt-BR|en-US|pt_br)\b/i);
    if (loc) tokens.push(loc[1]);
  }
  return [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
}

export function findArchitectureCoverageGaps(
  userIdea: string,
  technologiesMd: string,
  specSlugs: string[]
): string[] {
  const gaps: string[] = [];
  const tech = (technologiesMd || "").toLowerCase();
  const slugSet = new Set(specSlugs.map((s) => s.toLowerCase()));
  const tokens = extractCriticalTokens(userIdea);

  for (const token of tokens) {
    if (!tech.includes(token.toLowerCase())) {
      gaps.push(`technologies.md missing critical token from userIdea: ${token}`);
    }
  }

  const idea = userIdea.toLowerCase();
  const featureHints: Array<{ re: RegExp; slugHints: string[]; label: string }> =
    [
      {
        re: /\b(collection|cole[cç][aã]o)\b/i,
        slugHints: ["collection", "colecao", "my-collection"],
        label: "collection",
      },
      {
        re: /\b(favorite|favorit)/i,
        slugHints: ["favorite", "favorites", "favoritos"],
        label: "favorites",
      },
      {
        re: /\b(search|busca|pesquis)/i,
        slugHints: ["search", "card-search", "busca"],
        label: "search",
      },
    ];

  for (const hint of featureHints) {
    if (!hint.re.test(idea)) continue;
    const covered = hint.slugHints.some(
      (h) =>
        [...slugSet].some((s) => s.includes(h)) ||
        [...slugSet].some((s) => h.includes(s))
    );
    if (!covered) {
      gaps.push(`userIdea mentions ${hint.label} but no matching spec slug`);
    }
  }

  // 9-Layer System Design + AI Stack heuristics (forward: userIdea -> tech + specs)
  const layerSignals: Array<{
    layer: string;
    ideaRe: RegExp;
    techRe: RegExp;
    slugHints: string[];
  }> = [
    {
      layer: "Layer 4 (Messaging & Workflows)",
      ideaRe:
        /\b(kafka|rabbitmq|sqs|nats|pulsar|temporal|message\s+queue|background\s+job|webhook\s+worker)\b/i,
      techRe:
        /\b(kafka|rabbitmq|sqs|nats|pulsar|temporal|queue|worker|messaging|bullmq)\b/i,
      slugHints: [
        "queue",
        "worker",
        "job",
        "messaging",
        "webhook",
        "workflow",
        "event",
        "temporal",
        "kafka",
      ],
    },
    {
      layer: "Layer 6/7 (Vector Search / AI, RAG & Agents)",
      ideaRe:
        /\b(rag|vector\s+search|semantic\s+search|embeddings?|pgvector|pinecone|milvus|weaviate|llamaindex|chatbot)\b/i,
      techRe:
        /\b(rag|vector|embedding|pgvector|pinecone|milvus|weaviate|openai|claude|gemini|llamaindex|llm)\b/i,
      slugHints: [
        "rag",
        "vector",
        "search",
        "embed",
        "ai",
        "chat",
        "agent",
        "assistant",
        "llm",
        "retrieval",
      ],
    },
    {
      layer: "Layer 9 (Security & AuthN/AuthZ)",
      ideaRe: /\b(oauth2?|oidc|openid|jwt\s+auth|rbac|multi-tenant|sso)\b/i,
      techRe:
        /\b(oauth|oidc|openid|jwt|rbac|auth|session|token|vault|permissions?)\b/i,
      slugHints: [
        "auth",
        "login",
        "oauth",
        "session",
        "rbac",
        "security",
        "tenant",
        "user",
      ],
    },
  ];

  const hasSlugMatch = (hints: string[]) =>
    hints.some((h) =>
      [...slugSet].some((s) => s.includes(h) || h.includes(s))
    );

  for (const sig of layerSignals) {
    if (!sig.ideaRe.test(idea)) continue;
    if (!sig.techRe.test(tech)) {
      gaps.push(
        `userIdea requires ${sig.layer} but technologies.md has no matching decision`
      );
    }
    if (slugSet.size > 0 && !hasSlugMatch(sig.slugHints)) {
      gaps.push(
        `userIdea requires ${sig.layer} but no matching spec slug (${sig.slugHints.slice(0, 4).join("/")})`
      );
    }
  }

  // Reverse (anti-overengineering): if technologies.md explicitly adopts a heavy layer row in the 9-Layer Matrix
  // without any matching spec slug (and userIdea didn't ask for it), flag orphan architecture.
  if (slugSet.size > 0) {
    const adoptedRows = (technologiesMd || "")
      .split(/\r?\n/)
      .filter((line) => /^\s*\|.*\|\s*adopt\s*\|/i.test(line));
    for (const row of adoptedRows) {
      if (
        /Messaging\s*&\s*Workflows/i.test(row) &&
        /\b(kafka|rabbitmq|sqs|nats|pulsar|temporal)\b/i.test(row) &&
        !hasSlugMatch(["queue", "worker", "job", "messaging", "webhook", "workflow", "event", "temporal", "kafka"])
      ) {
        gaps.push(
          "technologies.md adopts Layer 4 (Messaging & Workflows) heavy broker but no spec slug covers it (orphan layer)"
        );
      }
      if (
        /(Search,\s*Vector|AI,\s*RAG\s*&\s*Agents)/i.test(row) &&
        /\b(pinecone|milvus|weaviate|pgvector|llamaindex|openai|claude|gemini|rag)\b/i.test(row) &&
        !hasSlugMatch(["rag", "vector", "search", "embed", "ai", "chat", "agent", "assistant", "llm", "retrieval"])
      ) {
        gaps.push(
          "technologies.md adopts Layer 6/7 (Vector/AI/RAG) but no spec slug covers it (orphan layer)"
        );
      }
    }
  }

  return gaps;
}

/** Reopen phantom [x] todos whose Files to touch are missing on disk. */
export async function findPhantomDoneSlugs(
  appRoot: string,
  todoItems: Array<{ slug: string; done: boolean }>
): Promise<string[]> {
  const phantoms: string[] = [];
  for (const item of todoItems) {
    if (!item.done) continue;
    if (item.slug === "project-setup") {
      const pkg = join(appRoot, "package.json");
      if (!(await pathExists(pkg))) {
        phantoms.push(item.slug);
        continue;
      }
      const body = await loadSpecBody(appRoot, item.slug);
      const expected = parseFilesToTouch(body);
      if (expected.length === 0) {
        const hasEntry =
          (await pathExists(join(appRoot, "src/App.tsx"))) ||
          (await pathExists(join(appRoot, "src/main.tsx")));
        if (!hasEntry) phantoms.push(item.slug);
      } else {
        let anyPresent = false;
        for (const rel of expected) {
          if (await pathExists(join(appRoot, ...rel.split("/")))) {
            anyPresent = true;
            break;
          }
        }
        if (!anyPresent) phantoms.push(item.slug);
      }
      continue;
    }
    const specAbs = join(appRoot, ".docs", "specs", `${item.slug}.spec.md`);
    if (!(await pathExists(specAbs))) {
      phantoms.push(item.slug);
      continue;
    }
    const body = await readFile(specAbs, "utf8");
    const expected = parseFilesToTouch(body);
    if (expected.length === 0) continue;
    let anyPresent = false;
    for (const rel of expected) {
      if (await pathExists(join(appRoot, ...rel.split("/")))) {
        anyPresent = true;
        break;
      }
    }
    if (!anyPresent) phantoms.push(item.slug);
  }
  return phantoms;
}

export async function unmarkTodoSlugs(
  appRoot: string,
  slugs: string[],
  todoPath = ".docs/todo.md"
): Promise<string | null> {
  const abs = join(appRoot, todoPath);
  let todo: string;
  try {
    todo = await readFile(abs, "utf8");
  } catch {
    return null;
  }
  let updated = todo;
  for (const slug of slugs) {
    updated = updated.replace(
      new RegExp(`^(-\\s*\\[)[xX](\\]\\s*${slug}\\s*:)`, "gim"),
      "$1 $2"
    );
  }
  return updated === todo ? null : updated;
}
