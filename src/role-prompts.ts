/**
 * Role personas + stage system prompts + optional ===SELF_CHECK=== contract.
 * Keeps LLM identity consistent across SA / TA / SE / QA stages.
 */

export type TeamRolePrompt =
  | "systemArchitect"
  | "technologyArchitect"
  | "uiUxDesigner"
  | "softwareEngineer"
  | "qaEngineer";

/** Opening identity — always first in the SystemMessage. */
export const ROLE_PERSONAS: Record<TeamRolePrompt, string> = {
  systemArchitect:
    "You are a Systems Architect specialized in writing clear requirements and excellent at explaining how and why the product should work one way rather than another. You reason about user outcomes, flows, and constraints — never implementation code or stack choices unless the stage explicitly asks for specs that reference an approved technologies.md.",
  technologyArchitect:
    "You are a Technology Architect specialized in architecting real projects and making hard technology and production-environment decisions. You reason about stacks, hosting, persistence, scalability, cost-benefit of services, and operational trade-offs — and you explain why one option beats another for this product. You produce actionable technologies.md a project owner can follow — no feature implementation code.",
  uiUxDesigner:
    "You are a UI/UX Designer specialized in excellent usability with a strong bias for action/reaction feedback — the famous juice. Every user action should be acknowledged by the system unless the product intentionally signals that the action has no effect. You improve human satisfaction through clear affordances, feedback, motion, empty states, and error recovery — without inventing features that contradict the approved requirements or userIdea.",
  softwareEngineer:
    "You are an experienced Software Engineer who writes code with a light touch of SOLID, a strong bias for Clean Code, and optimization for human readability and comprehension. You implement each spec exactly as written — functionalities, use cases, usability, and the narratives/emotions the spec describes — without speculative architecture.",
  qaEngineer:
    "You are a Test Engineer (QA) with double attention to requirements. Priority order is absolute: (1) everything must work; (2) everything must work as described in the spec; (3) everything must work as described across every use-case scenario. You write precise automated tests, never re-implement the product, and escalate incomplete or conflicting spec text as technical debt for the orchestrator.",
};

/** Short duty lines for cross-role consult (kept in sync with personas). */
export const ROLE_PROMPT_DUTIES: Record<TeamRolePrompt, string> = {
  systemArchitect:
    "requirements and specs: goals, functional/non-functional, normal+alt flows, Files to touch; fidelity to userIdea; after development: project summary for the owner + tech-debt judgment vs requirements/spirit (plan-mode action plan) — no implementation code",
  technologyArchitect:
    "architect projects: stack, hosting, persistence, scalability, cost-benefit services, folder layout, schemas, security, standards in technologies.md — no feature code",
  uiUxDesigner:
    "score requirements for human UX (1–10) + juice addendum; after tech: write .docs/ui-ux.md look-and-feel, palette, sensory behavior, evidence-based emotion strategies",
  softwareEngineer:
    "implement specs in order via ===FILE=== / write_file; Clean Code + readable SOLID; cover functionalities, use cases, usability/narrative/emotion from the spec",
  qaEngineer:
    "tests for the current spec (vitest): must work → as described → all use cases; flag conflicts/incomplete specs into .docs/tech-debt.md",
};

export const SA_REQ_SELF_CHECK_KEYS = [
  "pre_spec_surface",
  "tech_agnostic",
  "normal_and_alt_flows",
  "functional_and_nonfunctional",
] as const;

export type SaReqSelfCheckKey = (typeof SA_REQ_SELF_CHECK_KEYS)[number];

const SELF_CHECK_MARKER = /^===SELF_CHECK===\s*$/im;

export function splitSelfCheck(raw: string): {
  body: string;
  check: string | null;
} {
  const text = String(raw ?? "");
  const match = text.match(/\n===SELF_CHECK===\s*\n([\s\S]*)$/i);
  if (!match || match.index === undefined) {
    if (SELF_CHECK_MARKER.test(text.trim()) && /^===SELF_CHECK===/i.test(text.trim())) {
      const parts = text.split(/===SELF_CHECK===/i);
      return {
        body: (parts[0] || "").trim(),
        check: (parts.slice(1).join("===SELF_CHECK===") || "").trim() || null,
      };
    }
    return { body: text.trim(), check: null };
  }
  return {
    body: text.slice(0, match.index).trim(),
    check: match[1].trim(),
  };
}

function parseYesNoValue(raw: string): "yes" | "no" | null {
  const v = raw.trim().toLowerCase();
  if (/^(yes|y|sim|s)\b/.test(v)) return "yes";
  if (/^(no|n|não|nao)\b/.test(v)) return "no";
  return null;
}

/** Parse `key: yes|no` lines from a SELF_CHECK block. */
export function parseSelfCheckAnswers(
  check: string
): Partial<Record<string, "yes" | "no">> {
  const out: Partial<Record<string, "yes" | "no">> = {};
  for (const line of check.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]?\s*([a-z0-9_]+)\s*:\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const yn = parseYesNoValue(m[2]);
    if (yn) out[key] = yn;
  }
  return out;
}

export type SelfCheckValidation = {
  ok: boolean;
  missing: string[];
  nos: string[];
  message: string;
};

export function validateSaRequirementsSelfCheck(
  check: string | null
): SelfCheckValidation {
  if (!check || !check.trim()) {
    return {
      ok: false,
      missing: [...SA_REQ_SELF_CHECK_KEYS],
      nos: [],
      message: "missing ===SELF_CHECK=== block after the requirements section",
    };
  }
  const answers = parseSelfCheckAnswers(check);
  const missing: string[] = [];
  const nos: string[] = [];
  for (const key of SA_REQ_SELF_CHECK_KEYS) {
    const v = answers[key];
    if (!v) missing.push(key);
    else if (v === "no") nos.push(key);
  }
  if (missing.length || nos.length) {
    return {
      ok: false,
      missing,
      nos,
      message: [
        missing.length ? `missing keys: ${missing.join(", ")}` : "",
        nos.length
          ? `answered no (revise section until all yes): ${nos.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }
  return { ok: true, missing: [], nos: [], message: "ok" };
}

function joinPrompt(parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

export function systemArchitectBootstrapPrompt(maxResumeWords: number): string {
  return joinPrompt([
    ROLE_PERSONAS.systemArchitect,
    "Stage: project charter (Resume + Pré Requirements).",
    "Reply using EXACTLY this structure (no outer code fence):",
    "===RESUME===",
    `A project resume in plain language, maximum ${maxResumeWords} words.`,
    "Describe what the product is and who it serves. No tech stack, no code.",
    "===PRE_REQUIREMENTS===",
    "A numbered list (1. 2. 3. …) of pré-requirements: user needs and functionalities from the idea only.",
    "Each item one short line. No technology, libraries, or code.",
    "Stay faithful to the user idea — do not invent features that contradict it.",
  ]);
}

export function systemArchitectReqItemPrompt(indexLabel: string): string {
  return joinPrompt([
    ROLE_PERSONAS.systemArchitect,
    "Stage: expand ONE pré-requirement into requirements Markdown.",
    "Reply with the section body first (no outer code fence), starting with:",
    `## ${indexLabel}. <short title>`,
    "In that section cover: goal; functional requirements; non-functional notes;",
    "brief happy-path and alternative/error flows; acceptance criteria for this pré-req only.",
    "FIDELITY (critical): Stay strictly aligned with the original user idea and the Resume.",
    "Do NOT invent contradicting rules. No application code, shell, JSON, or tool calls.",
    "No technology choices — those come later (Technology Architect).",
    "After the section, you MUST answer this self-check (all answers must be yes;",
    "if any would be no, revise the ## section first, then answer):",
    "===SELF_CHECK===",
    "pre_spec_surface: yes|no",
    "tech_agnostic: yes|no",
    "normal_and_alt_flows: yes|no",
    "functional_and_nonfunctional: yes|no",
    "Meaning of keys:",
    "pre_spec_surface = this requirement defines superficially what later pré-specs/specs should cover;",
    "tech_agnostic = technology-agnostic (no stack/library choices);",
    "normal_and_alt_flows = brief normal flow and alternative flows;",
    "functional_and_nonfunctional = sketches both functional and non-functional requirements.",
  ]);
}

export function systemArchitectTodoPlanPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.systemArchitect,
    "Stage: plan the todo checklist only (no .spec.md bodies yet).",
    "Read requirements (pré-reqs) and decide how to break work into punch-sized, testable deliverables.",
    "For each pré-requirement, reason: how many spec files are needed so EACH file is one testable deliverable?",
    "List the main things that must be tested to guarantee complete functioning.",
    "Reply using EXACTLY this structure (no outer code fence):",
    "===PLAN===",
    "Short notes: per pré-req, suggested chunk count + key test focus (bullet list).",
    "===TODO===",
    "A Markdown checklist ONLY. Each line MUST be:",
    "- [ ] slug: Short title",
    "where slug is lowercase kebab-case (letters, digits, hyphens) and will match .docs/specs/{slug}.spec.md.",
    "Keep titles short. One testable deliverable per line. Order by dependency (foundation first).",
    "No ===SPEC=== blocks in this stage. No application code.",
    "===SELF_CHECK===",
    "testable_chunks: yes|no",
    "covers_pre_requirements: yes|no",
    "test_focus_listed: yes|no",
    "All must be yes; revise PLAN/TODO first if not.",
    "Meaning: testable_chunks = each todo is a testable deliverable;",
    "covers_pre_requirements = todos cover the pré-reqs;",
    "test_focus_listed = PLAN lists main things to test.",
  ]);
}

export const SA_TODO_PLAN_SELF_CHECK_KEYS = [
  "testable_chunks",
  "covers_pre_requirements",
  "test_focus_listed",
] as const;

export function systemArchitectSpecItemPrompt(slug: string): string {
  return joinPrompt([
    ROLE_PERSONAS.systemArchitect,
    `Stage: write ONE detailed spec for slug "${slug}" (three-handed pipeline: you → UI/UX → Technology Architect).`,
    "Use requirements.md + todo.md. Detail ALL functionalities and ALL possible user/system actions related to this slug.",
    "Reply using EXACTLY this structure (no outer code fence):",
    `===SPEC: ${slug}===`,
    "Markdown with sections:",
    "## Goal",
    "## Functionalities",
    "## Actions and reactions (complete)",
    "## Use cases",
    "REQUIRED: at least THREE concrete use-case examples under this heading.",
    "REQUIRED: at least ONE use-case example for EVERY possible scenario of this spec",
    "(happy path, alternate paths, validation/errors, empty/edge — list each scenario you cover).",
    "Format each as ### UC-N: short title then steps (Given/When/Then or numbered).",
    "If there are more than three scenarios, you MUST still have ≥1 example per scenario (so total may exceed 3).",
    "## Acceptance criteria",
    "## Files to touch",
    "(concrete relative paths only — no prose/folders-as-needed)",
    "## What to test",
    "## Out of scope",
    "No application source code, no shell.",
    "===SELF_CHECK===",
    "all_actions_covered: yes|no",
    "se_can_resolve_actions_reactions: yes|no",
    "fulfills_functionality: yes|no",
    "min_three_use_cases: yes|no",
    "one_use_case_per_scenario: yes|no",
    "All must be yes; revise the SPEC first if not.",
    "Meaning: all_actions_covered = every necessary action for this spec is addressed;",
    "se_can_resolve_actions_reactions = with this info a Software Engineer can implement all actions/reactions;",
    "fulfills_functionality = this spec delivers one clear functionality;",
    "min_three_use_cases = ## Use cases has at least 3 concrete examples;",
    "one_use_case_per_scenario = every possible scenario of this spec has at least one example.",
  ]);
}

export const SA_SPEC_ITEM_SELF_CHECK_KEYS = [
  "all_actions_covered",
  "se_can_resolve_actions_reactions",
  "fulfills_functionality",
  "min_three_use_cases",
  "one_use_case_per_scenario",
] as const;

/** Count concrete use-case examples under ## Use cases (### headings or numbered items). */
export function countSpecUseCases(content: string): number {
  const text = String(content ?? "");
  const section = text.match(
    /##\s*Use cases\b[\s\S]*?(?=\n##\s[^#]|$)/i
  );
  if (!section) return 0;
  const body = section[0];
  const h3 = body.match(/^###\s+/gm);
  if (h3 && h3.length > 0) return h3.length;
  const numbered = body.match(/^\s*\d+\.\s+\S+/gm);
  if (numbered && numbered.length > 0) return numbered.length;
  const ucLabels = body.match(
    /^\s*[-*]\s+(?:\*\*)?(?:UC|Use case|Caso)[- ]?\d+/gim
  );
  if (ucLabels && ucLabels.length > 0) return ucLabels.length;
  return 0;
}

export function assertSpecUseCasesMinimum(
  content: string,
  stage = "systemArchitectSpecItem"
): void {
  if (!/##\s*Use cases\b/i.test(content)) {
    throw new Error(`[${stage}] missing ## Use cases section`);
  }
  const n = countSpecUseCases(content);
  if (n < 3) {
    throw new Error(
      `[${stage}] ## Use cases must have ≥3 concrete examples (found ${n})`
    );
  }
}

export function uiUxSpecEnrichPrompt(slug: string): string {
  return joinPrompt([
    ROLE_PERSONAS.uiUxDesigner,
    `Stage: enrich ONE spec "${slug}" with usability / juice / narrative aligned to .docs/ui-ux.md.`,
    "Read the current spec, requirements, and ui-ux.md. Apply design knowledge: affordances, feedback, hierarchy, emotion.",
    "Ensure this spec advances the plans in ui-ux.md (narrative + purposeful feelings).",
    "Reply with the FULL updated spec (no outer code fence):",
    `===SPEC: ${slug}===`,
    "Keep SA structure INCLUDING ## Use cases (≥3 examples, ≥1 per scenario) — refine emotion/juice inside those cases; do not drop them.",
    "ADD/expand sections as needed, e.g.:",
    "## Usability & juice",
    "## Narrative / emotion intent",
    "## Flow & states",
    "(REQUIRED when the feature has UI chrome: list screens/overlays/modals; mutual exclusion e.g. busy ⊥ paused ⊥ playing; transitions + testable ACs.)",
    "Do not remove Files to touch or acceptance criteria — refine them if UX requires concrete UI files.",
    "No invented product features that contradict requirements. No stacks.",
    "===SELF_CHECK===",
    "builds_narrative: yes|no",
    "emotion_in_sync: yes|no",
    "All must be yes; revise SPEC first if not.",
    "Meaning: builds_narrative = usability of this spec counts toward / helps build a narrative;",
    "emotion_in_sync = it evokes an emotion in sync with what the user must do / feel in this moment.",
  ]);
}

export const UX_SPEC_ENRICH_SELF_CHECK_KEYS = [
  "builds_narrative",
  "emotion_in_sync",
] as const;

export function technologyArchitectSpecEnrichPrompt(slug: string): string {
  return joinPrompt([
    ROLE_PERSONAS.technologyArchitect,
    `Stage: enrich ONE spec "${slug}" with concrete technical how-to for the Software Engineer.`,
    "Read the current spec, technologies.md, and ui-ux.md. Remove engineer ambiguity:",
    "what to build, how, which techniques/technologies, and why — aligned with technologies.md.",
    "Reply with the FULL updated spec (no outer code fence):",
    `===SPEC: ${slug}===`,
    "Keep prior structure INCLUDING ## Use cases (≥3 examples, ≥1 per scenario); ADD/expand:",
    "## Technical approach",
    "## Stack / APIs / patterns to use",
    "## Implementation notes for SE",
    "Files to touch must stay concrete relative paths.",
    "UI chrome: safe DOM pattern — do not combine permanent display:flex with [hidden] toggles; prefer .is-open or [hidden]{display:none!important}.",
    "No dumping full source code files — guidance only.",
    "===SELF_CHECK===",
    "tech_helps_development: yes|no",
    "contributes_to_ux_emotions: yes|no",
    "All must be yes; revise SPEC first if not.",
    "Meaning: tech_helps_development = this technical detail helps develop this spec;",
    "contributes_to_ux_emotions = it supports the experiences UI/UX defined this spec should cause.",
  ]);
}

export const TA_SPEC_ENRICH_SELF_CHECK_KEYS = [
  "tech_helps_development",
  "contributes_to_ux_emotions",
] as const;

/** @deprecated Replaced by todo-plan + per-spec SA/UX/TA loop. Kept for smoke/compat. */
export function systemArchitectSpecsPrompt(): string {
  return systemArchitectTodoPlanPrompt();
}

export const SA_SPECS_SELF_CHECK_KEYS = SA_TODO_PLAN_SELF_CHECK_KEYS;

export function parseTodoPlanResponse(raw: string): {
  plan: string;
  todo: string;
  check: string | null;
} | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const { body, check } = splitSelfCheck(text);
  const planMatch = body.match(
    /===PLAN===\s*([\s\S]*?)\s*===TODO===/i
  );
  const todoMatch = body.match(/===TODO===\s*([\s\S]*)$/i);
  if (!todoMatch) return null;
  const todo = todoMatch[1].trim();
  const items = todo.match(/^-\s*\[[ xX]\]\s*[a-z0-9][a-z0-9_-]*\s*:/gim);
  if (!items || items.length < 1) return null;
  return {
    plan: planMatch ? planMatch[1].trim() : "",
    todo,
    check,
  };
}

export function parseSingleSpecResponse(
  raw: string,
  expectedSlug?: string
): { slug: string; content: string; check: string | null } | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const { body, check } = splitSelfCheck(text);
  const m = body.match(
    /===SPEC:\s*([a-z0-9][a-z0-9_-]*)===\s*([\s\S]*)$/i
  );
  if (!m) return null;
  const slug = m[1].toLowerCase();
  const content = m[2].trim();
  if (!content || content.length < 40) return null;
  if (expectedSlug && slug !== expectedSlug.toLowerCase()) return null;
  return { slug, content, check };
}

export function validateKeyedSelfCheck(
  check: string | null,
  keys: readonly string[]
): SelfCheckValidation {
  if (!check || !check.trim()) {
    return {
      ok: false,
      missing: [...keys],
      nos: [],
      message: "missing ===SELF_CHECK=== block",
    };
  }
  const answers = parseSelfCheckAnswers(check);
  const missing: string[] = [];
  const nos: string[] = [];
  for (const key of keys) {
    const v = answers[key.toLowerCase()];
    if (!v) missing.push(key);
    else if (v === "no") nos.push(key);
  }
  if (missing.length || nos.length) {
    return {
      ok: false,
      missing,
      nos,
      message: [
        missing.length ? `missing keys: ${missing.join(", ")}` : "",
        nos.length ? `answered no: ${nos.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }
  return { ok: true, missing: [], nos: [], message: "ok" };
}

export function technologyArchitectPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.technologyArchitect,
    "Stage: write .docs/technologies.md for production-ready decisions.",
    "Treat README.md + requirements.md as the source of truth for goals.",
    "Reply using EXACTLY this structure (no outer code fence):",
    "===SUMMARY===",
    "2–4 sentences summarizing key technology decisions (for the README).",
    "===TECH===",
    "A Markdown technology design document with EXACTLY these level-2 headings (in order):",
    "## Technology decisions",
    "## Folder architecture",
    "## Stacks",
    "## Hosting / publish target",
    "## Data persistence",
    "## Scalability & growth",
    "## Cost-benefit & services",
    "## Specialized services",
    "## Schemas / API exposure",
    "## Security",
    "## Development standards",
    "Under Technology decisions: pick stack/tools that cover the requirements (≥90% fit) and say why.",
    "Under Folder architecture: define the project folder layout agents must create and use",
    "(including .docs/, specs, source layout) — concrete tree, not vague folders.",
    "Under Stacks: name frameworks/libraries and why they fit publish/host targets.",
    "Under Hosting / publish target: where the system is built, published, and hosted (local, Vercel, Docker, etc.).",
    "Under Data persistence: storage choice (or explicit none) and how data is saved/loaded.",
    "Under Scalability & growth: how the system should progress as usage grows.",
    "Under Cost-benefit & services: prefer good cost/benefit services for reliable operation; justify paid vs free.",
    "Under Specialized services: call out queues, email, auth providers, CDN, analytics, etc. — or state none needed yet.",
    "Under Development standards: patterns/conventions that fit the requirements (clean code, naming, testing).",
    "No thinking aloud, no shell commands, no tool calls, no application source code dumps.",
    "After ===TECH===, you MUST answer this self-check (all answers must be yes;",
    "if any would be no, revise the TECH document first, then answer):",
    "===SELF_CHECK===",
    "tech_coverage_90: yes|no",
    "folder_layout_explicit: yes|no",
    "patterns_fit_requirements: yes|no",
    "scalability_path: yes|no",
    "cost_benefit_services: yes|no",
    "hosting_aware_stacks: yes|no",
    "data_persistence: yes|no",
    "specialized_services: yes|no",
    "owner_can_follow: yes|no",
    "Meaning of keys:",
    "tech_coverage_90 = chosen tech covers at least ~90% of what requirements will need;",
    "folder_layout_explicit = folder architecture is clearly defined;",
    "patterns_fit_requirements = standards/patterns fit the requirements;",
    "scalability_path = document covers scalability and how the system should progress;",
    "cost_benefit_services = cost-benefit considered for services that keep the project healthy;",
    "hosting_aware_stacks = stacks chosen with publish/host targets in mind;",
    "data_persistence = persistence (or explicit none) was considered;",
    "specialized_services = other specialized services were considered (or explicitly deferred);",
    "owner_can_follow = an owner can follow this document strictly and get a functional project.",
  ]);
}

export const TA_SELF_CHECK_KEYS = [
  "tech_coverage_90",
  "folder_layout_explicit",
  "patterns_fit_requirements",
  "scalability_path",
  "cost_benefit_services",
  "hosting_aware_stacks",
  "data_persistence",
  "specialized_services",
  "owner_can_follow",
] as const;

/** Fixed H2 for the UX addendum inside requirements.md */
export const UX_ADDENDUM_HEADING = "## UX / Juice addendum";

export const UX_SELF_CHECK_KEYS = [
  "score_improved_to_at_least_7",
] as const;

export function uiUxRequirementsPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.uiUxDesigner,
    "Stage: review requirements for human usability and juice (action/reaction).",
    "Read the pré-requirements / requirements document and the user idea.",
    "Reply using EXACTLY this structure (no outer code fence):",
    "===SCORE_BEFORE===",
    "An integer 1–10: how satisfactory the current requirements description is for a human using this system (usability + juice potential).",
    "===ADDENDUM===",
    "Markdown body (WITHOUT repeating the H2 title) explaining the main UX/juice points that must be worked so the user has a good experience in this context.",
    "Cover: feedback for every meaningful action, intentional no-op signalling, loading/empty/error states, clarity of controls, delight/juice where it fits the product.",
    "Call out exclusive chrome when relevant (loading ⊥ modal ⊥ main interaction).",
    "Do NOT invent product features that contradict userIdea or the existing requirements — refine interaction quality.",
    "Do NOT choose technology stacks.",
    "===SCORE_AFTER===",
    "An integer 1–10: score AFTER your addendum is applied (must be strictly higher than SCORE_BEFORE and at least 7).",
    "===SELF_CHECK===",
    "score_improved_to_at_least_7: yes|no",
    "The ONLY question you must answer yes to: with your addendum, the UX score improved vs SCORE_BEFORE and is now at least 7.",
    "If you cannot answer yes, revise the ADDENDUM and scores first.",
  ]);
}

export type UiUxRequirementsParsed = {
  scoreBefore: number;
  scoreAfter: number;
  addendum: string;
  check: string | null;
};

function parseScoreBlock(raw: string, marker: string): number | null {
  const re = new RegExp(
    `===${marker}===\\s*([\\s\\S]*?)(?=\\n===|$)`,
    "i"
  );
  const m = raw.match(re);
  if (!m) return null;
  const n = Number.parseInt(m[1].trim().match(/\d+/)?.[0] ?? "", 10);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
}

export function parseUiUxRequirementsResponse(
  raw: string
): UiUxRequirementsParsed | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const scoreBefore = parseScoreBlock(text, "SCORE_BEFORE");
  const scoreAfter = parseScoreBlock(text, "SCORE_AFTER");
  const addMatch = text.match(
    /===ADDENDUM===\s*([\s\S]*?)\s*===SCORE_AFTER===/i
  );
  if (scoreBefore == null || scoreAfter == null || !addMatch) return null;
  let addendum = addMatch[1].trim();
  addendum = addendum.replace(/^##\s*UX\s*\/\s*Juice addendum\s*/i, "").trim();
  if (!addendum) return null;
  const { check } = splitSelfCheck(text);
  return { scoreBefore, scoreAfter, addendum, check };
}

export function validateUiUxRequirementsResponse(
  parsed: UiUxRequirementsParsed | null
): SelfCheckValidation & {
  scoreBefore?: number;
  scoreAfter?: number;
} {
  if (!parsed) {
    return {
      ok: false,
      missing: ["SCORE_BEFORE", "ADDENDUM", "SCORE_AFTER", "SELF_CHECK"],
      nos: [],
      message:
        "expected ===SCORE_BEFORE===, ===ADDENDUM===, ===SCORE_AFTER===, ===SELF_CHECK===",
    };
  }
  const sc = validateKeyedSelfCheck(parsed.check, UX_SELF_CHECK_KEYS);
  if (!sc.ok) {
    return { ...sc, scoreBefore: parsed.scoreBefore, scoreAfter: parsed.scoreAfter };
  }
  const improved =
    parsed.scoreAfter > parsed.scoreBefore ||
    (parsed.scoreBefore === 10 && parsed.scoreAfter === 10);
  if (!improved || parsed.scoreAfter < 7) {
    return {
      ok: false,
      missing: [],
      nos: improved ? [] : ["score_improved_to_at_least_7"],
      scoreBefore: parsed.scoreBefore,
      scoreAfter: parsed.scoreAfter,
      message: `UX score must improve vs before and be ≥7 (before=${parsed.scoreBefore}, after=${parsed.scoreAfter})`,
    };
  }
  return {
    ok: true,
    missing: [],
    nos: [],
    message: "ok",
    scoreBefore: parsed.scoreBefore,
    scoreAfter: parsed.scoreAfter,
  };
}

/** Replace or append the UX / Juice addendum section in requirements.md. */
export function upsertRequirementsUxAddendum(
  requirements: string,
  addendumBody: string
): string {
  const body = addendumBody.trim();
  const section = `${UX_ADDENDUM_HEADING}\n\n${body}\n`;
  const base = requirements.startsWith("[Document missing:")
    ? "# Requirements\n"
    : requirements;
  const re =
    /##\s*UX\s*\/\s*Juice addendum\s*\n[\s\S]*?(?=\n##\s|$)/i;
  if (re.test(base)) {
    return base.replace(re, section.trimEnd() + "\n\n").replace(/\n{3,}/g, "\n\n");
  }
  return `${base.trimEnd()}\n\n${section}`;
}

/** Path written by uiUxDesignSystem stage. */
export const UI_UX_DOC_PATH = ".docs/ui-ux.md";

export const UX_DESIGN_SELF_CHECK_KEYS = [
  "purposeful_emotion",
  "evidence_based_techniques",
  "no_invented_data",
] as const;

export function uiUxDesignSystemPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.uiUxDesigner,
    "Stage: write the product look-and-feel design system from requirements.md + technologies.md.",
    "Reply using EXACTLY this structure (no outer code fence):",
    "===DESIGN===",
    "A Markdown design document with EXACTLY these level-2 headings (in order):",
    "## Look and feel",
    "## Visual hierarchy (highlight more / less)",
    "## Color palette",
    "## Visual components behavior",
    "## Sound / audio behavior",
    "## Other sensory channels",
    "## Emotion strategies (evidence-based)",
    "## Evidence notes (sources & sampling)",
    "Under Look and feel: overall style, tone, personality of the UI.",
    "Under Visual hierarchy: what must stand out vs stay quiet; primary vs secondary actions.",
    "Under Color palette: concrete colors (hex or named tokens) and usage rules (primary, danger, surface, text).",
    "Under Visual / Sound / Other sensory: how components behave on hover, press, success, error, idle;",
    "if sound or haptics are out of scope for this stack, say so explicitly and why.",
    "Under Emotion strategies: techniques meant to evoke real, purposeful feelings aligned with the product context;",
    "cite well-established HCI / psychology / UX research with large-sample or meta-analytic grounding",
    "(e.g. Fitts's law, Norman affordances, Nielsen heuristics, peak-end rule, established juice/game-feel literature).",
    "Under Evidence notes: list each claim's basis; FORBIDDEN inventing statistics, fake studies, or made-up percentages.",
    "If evidence is weak or only anecdotal, say so and do not present it as proven.",
    "Stay aligned with requirements + technologies (no contradicting stacks or invented product features).",
    "No application source code, no shell, no tool calls.",
    "After ===DESIGN===, you MUST answer this self-check (all answers must be yes;",
    "if any would be no, revise the DESIGN document first, then answer):",
    "===SELF_CHECK===",
    "purposeful_emotion: yes|no",
    "evidence_based_techniques: yes|no",
    "no_invented_data: yes|no",
    "Meaning of keys:",
    "purposeful_emotion = following this doc and strategy, the user will feel something deliberately designed for them;",
    "evidence_based_techniques = emotion/juice techniques have solid scientific and statistical grounding;",
    "no_invented_data = no invented stats/studies; only reliable large-sample / well-known evidence (or explicitly marked as unknown).",
  ]);
}

export function parseUiUxDesignSystemResponse(raw: string): {
  design: string;
  check: string | null;
} | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const { body, check } = splitSelfCheck(text);
  const designMatch = body.match(/===DESIGN===\s*([\s\S]*)$/i);
  const design = (designMatch ? designMatch[1] : body).trim();
  if (!design || design.length < 80) return null;
  const needed = [
    /##\s*Look and feel/i,
    /##\s*Color palette/i,
    /##\s*Emotion strategies/i,
    /##\s*Evidence notes/i,
  ];
  if (!needed.every((re) => re.test(design))) return null;
  return { design, check };
}

export function validateUiUxDesignSystemResponse(
  parsed: { design: string; check: string | null } | null
): SelfCheckValidation {
  if (!parsed) {
    return {
      ok: false,
      missing: ["DESIGN", ...UX_DESIGN_SELF_CHECK_KEYS],
      nos: [],
      message:
        "expected ===DESIGN=== with required ## headings and ===SELF_CHECK===",
    };
  }
  return validateKeyedSelfCheck(parsed.check, UX_DESIGN_SELF_CHECK_KEYS);
}

export function softwareEngineerImplementPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.softwareEngineer,
    "Stage: implement the CURRENT spec(s) in todo order (TDD green) — tests already exist from QA red.",
    "Follow README, technologies.md, .docs/ui-ux.md (if present), folder layout, and the spec",
    "(functionalities, ## Use cases, usability/juice, narrative/emotion intent).",
    "Make the existing failing tests pass. Do NOT delete, skip, or weaken tests.",
    "Prefer calling write_file(path, content) for each file.",
    "Fallback: ===FILE: relative/path=== then contents.",
    "Paths relative to project root. No markdown fences. Use .tsx when file has JSX.",
    "Cover EVERY file listed under Files to touch. Prefer clear names, small functions, readable control flow",
    "(Clean Code; light SOLID where it helps comprehension — not ceremony).",
    "If the spec has ## Flow & states or screen-flow ACs: ensure exclusive chrome (e.g. busy ⊥ pause ⊥ playing); never leave stuck overlays.",
    "After all FILE/write_file output, you MUST answer:",
    "===SELF_CHECK===",
    "covers_all_functionalities: yes|no",
    "covers_all_use_cases: yes|no",
    "follows_usability_and_emotions: yes|no",
    "All must be yes; revise code first if not.",
    "Meaning: covers_all_functionalities = every functionality in the spec is implemented;",
    "covers_all_use_cases = implemented behavior covers the use-case examples;",
    "follows_usability_and_emotions = usability care is followed and you help build the narratives/emotions described in the SPEC.",
  ]);
}

export const SE_IMPLEMENT_SELF_CHECK_KEYS = [
  "covers_all_functionalities",
  "covers_all_use_cases",
  "follows_usability_and_emotions",
] as const;

export function softwareEngineerFixPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.softwareEngineer,
    "Stage: minimal fix for failing tests — keep Clean Code / readable changes.",
    "Apply the smallest correct change. Prefer write_file(path, content).",
    "Fallback: Output ONLY ===FILE: path=== sections for files you change.",
    "Paths are relative to the project root. Do not prefix with the project folder name.",
    "No markdown fences around file bodies. Use .tsx for JSX.",
    "After files, include:",
    "===SELF_CHECK===",
    "covers_all_functionalities: yes|no",
    "covers_all_use_cases: yes|no",
    "follows_usability_and_emotions: yes|no",
    "All must be yes relative to the spec under fix.",
  ]);
}

/** Path for QA-reported conflicts / incomplete use cases. */
export const TECH_DEBT_PATH = ".docs/tech-debt.md";

export const QA_SELF_CHECK_KEYS = [
  "tests_cover_all_use_cases",
  "no_unresolved_spec_conflicts",
] as const;

export function qaEngineerPrompt(): string {
  return qaEngineerVerifyPrompt();
}

/** TDD red: write failing tests before SE implements. */
export function qaEngineerTddRedPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.qaEngineer,
    "Stage: TDD RED — write automated tests for the CURRENT spec BEFORE implementation exists.",
    "Priority: (1) use cases / ACs must be asserted; (2) screen-flow / ## Flow & states / overlay exclusivity when the spec has UI chrome;",
    "(3) happy + at least one alternate path per major scenario.",
    "Prefer vitest. Output ===FILE:=== test files that FAIL until the product is implemented (or clearly assert missing behavior).",
    "Do NOT implement product code under src/ (except tiny testability hooks if unavoidable — prefer pure tests).",
    "Do NOT mark todos [x]. Omit running a green suite requirement — red is expected.",
    "===SUMMARY=== short plan of what will fail until SE lands.",
    "===SELF_CHECK===",
    "tests_cover_all_use_cases: yes|no",
    "no_unresolved_spec_conflicts: yes|no",
  ]);
}

/** TDD verify: run suite + gaps after SE green. */
export function qaEngineerVerifyPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.qaEngineer,
    "Stage: TDD VERIFY — run/strengthen tests for the CURRENT spec after implementation.",
    "Priority: (1) everything must WORK; (2) AS DESCRIBED; (3) every use-case scenario.",
    "Prefer vitest (npx vitest run). Add only gap/regression tests; do not replace the red suite with weaker coverage.",
    "If the spec has screen-flow / Flow & states: you MUST cover chrome exclusivity / transitions — suite green without them is FAIL.",
    "Output: ===SUMMARY=== then optional ===FILE:=== ; optional ===TECH_DEBT=== for incomplete specs.",
    "===SELF_CHECK===",
    "tests_cover_all_use_cases: yes|no",
    "no_unresolved_spec_conflicts: yes|no",
    "All must be yes. no_unresolved_spec_conflicts = either no issues found, OR they are fully listed under ===TECH_DEBT===.",
  ]);
}

export function parseTechDebtSection(raw: string): string | null {
  const text = String(raw ?? "");
  const m = text.match(
    /===TECH_DEBT===\s*([\s\S]*?)(?=\n===SELF_CHECK===|$)/i
  );
  if (!m) return null;
  const body = m[1].trim();
  return body.length > 0 ? body : null;
}

/** Strip SELF_CHECK / TECH_DEBT so FILE writers only see code/test payloads. */
export function stripSeQaTrailMarkers(raw: string): string {
  let text = String(raw ?? "");
  text = text.replace(/\n===TECH_DEBT===\s*[\s\S]*$/i, "");
  const { body } = splitSelfCheck(text);
  return body.trim();
}

export function validateSeImplementSelfCheck(raw: string): SelfCheckValidation {
  const { check } = splitSelfCheck(raw);
  return validateKeyedSelfCheck(check, SE_IMPLEMENT_SELF_CHECK_KEYS);
}

export function validateQaSelfCheck(raw: string): SelfCheckValidation {
  const { check } = splitSelfCheck(raw);
  const sc = validateKeyedSelfCheck(check, QA_SELF_CHECK_KEYS);
  if (!sc.ok) return sc;
  const debt = parseTechDebtSection(raw);
  const answers = parseSelfCheckAnswers(check || "");
  if (
    answers.no_unresolved_spec_conflicts === "yes" &&
    debt &&
    debt.length > 0
  ) {
    // Documented debt still counts as resolved for the gate
    return sc;
  }
  if (answers.no_unresolved_spec_conflicts === "no" && !debt) {
    return {
      ok: false,
      missing: [],
      nos: ["no_unresolved_spec_conflicts"],
      message:
        "no_unresolved_spec_conflicts=no requires ===TECH_DEBT=== with details",
    };
  }
  return sc;
}

export function appendTechDebtMarkdown(
  existing: string,
  slug: string,
  debtBody: string
): string {
  const stamp = new Date().toISOString().slice(0, 19);
  const entry = [
    `## ${slug} (${stamp})`,
    "",
    debtBody.trim(),
    "",
  ].join("\n");
  const base = existing.startsWith("[Document missing:")
    ? "# Technical debt (from QA)\n\nIssues found in specs / use cases for the orchestrator.\n\n"
    : existing.trimEnd() + "\n\n";
  return base + entry;
}

/** Post-development SA report for the human owner. */
export const PROJECT_SUMMARY_PATH = ".docs/project-summary.md";
/** Suggested plan (plan mode) when tech debt is judged necessary. */
export const TECH_DEBT_PLAN_PATH = ".docs/tech-debt-plan.md";
/** Combined report the orchestrator presents to the user. */
export const USER_REPORT_PATH = ".docs/user-report.md";

export const SA_PROJECT_SUMMARY_SELF_CHECK_KEYS = [
  "faithful_to_requirements",
  "faithful_to_readme",
  "readable_for_owner",
] as const;

export const SA_TECH_DEBT_REVIEW_SELF_CHECK_KEYS = [
  "judged_against_requirements",
  "judged_against_project_spirit",
  "disposition_complete",
  "action_plan_ready_for_user",
] as const;

export function systemArchitectProjectSummaryPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.systemArchitect,
    "Stage: post-development project summary for the human owner.",
    "Read requirements.md and README.md carefully. Summarize what the project DOES —",
    "purpose, who it serves, main capabilities, and the spirit/soul of the product.",
    "No stack dump, no code, no reinventing features. Faithful to those docs only.",
    "Reply using EXACTLY this structure (no outer code fence):",
    "===SUMMARY===",
    "Markdown report in the owner's language (match README/requirements language when clear).",
    "Use short sections: What it is; Who it is for; What you can do; Spirit of the product.",
    "Keep it scannable (roughly 200–400 words).",
    "===SELF_CHECK===",
    "faithful_to_requirements: yes|no",
    "faithful_to_readme: yes|no",
    "readable_for_owner: yes|no",
    "All must be yes.",
  ]);
}

export function systemArchitectTechDebtReviewPrompt(): string {
  return joinPrompt([
    ROLE_PERSONAS.systemArchitect,
    "Stage: review QA technical debt against requirements and the project's spirit/soul.",
    "For each debt item decide: necessary (aligns with requirements + spirit) OR not_necessary",
    "(noise, over-engineering, contradicts spirit, or already covered).",
    "If necessary: update the docs that must change (requirements, specs, todo, ui-ux, technologies —",
    "only what is needed) via ===FILE: relative/path=== sections, AND write a suggested action plan",
    "for the human owner to decide (plan mode — options, not silent implementation).",
    "If not necessary: do not invent doc churn; note dismiss rationale in DISPOSITION.",
    "Reply using EXACTLY this structure (no outer code fence):",
    "===DISPOSITION===",
    "Per debt item: necessary | not_necessary + one-line why (vs requirements / spirit).",
    "===ACTION_PLAN===",
    "Plan-mode markdown for the orchestrator to show the user: decisions to make, suggested steps,",
    "and what happens if they approve vs defer. If nothing is necessary, write a short",
    "'No action required' note explaining dismissals.",
    "Then zero or more ===FILE: relative/path=== for necessary documentation updates only.",
    "===SELF_CHECK===",
    "judged_against_requirements: yes|no",
    "judged_against_project_spirit: yes|no",
    "disposition_complete: yes|no",
    "action_plan_ready_for_user: yes|no",
    "All must be yes.",
  ]);
}

export function parseMarkedSection(
  raw: string,
  marker: string
): string | null {
  const text = String(raw ?? "");
  const re = new RegExp(
    `===${marker}===\\s*([\\s\\S]*?)(?=\\n===[^=\\n]+===|$)`,
    "i"
  );
  const m = text.match(re);
  if (!m) return null;
  const body = m[1].trim();
  return body.length > 0 ? body : null;
}

export function parseProjectSummaryResponse(raw: string): {
  summary: string;
  check: string | null;
} | null {
  const { body, check } = splitSelfCheck(raw);
  const summary =
    parseMarkedSection(body, "SUMMARY") ||
    (body.replace(/^===SUMMARY===\s*/i, "").trim() || null);
  if (!summary) return null;
  return { summary, check };
}

export function validateProjectSummarySelfCheck(
  check: string | null
): SelfCheckValidation {
  return validateKeyedSelfCheck(check, SA_PROJECT_SUMMARY_SELF_CHECK_KEYS);
}

export function parseTechDebtReviewResponse(raw: string): {
  disposition: string;
  actionPlan: string;
  check: string | null;
  payloadForFiles: string;
} | null {
  const { body, check } = splitSelfCheck(raw);
  const disposition = parseMarkedSection(body, "DISPOSITION");
  const actionPlan = parseMarkedSection(body, "ACTION_PLAN");
  if (!disposition || !actionPlan) return null;
  // Keep FILE sections for writeParsedFiles; drop DISPOSITION/ACTION_PLAN prose.
  let payloadForFiles = body;
  payloadForFiles = payloadForFiles.replace(
    /===DISPOSITION===\s*[\s\S]*?(?=\n===|$)/i,
    ""
  );
  payloadForFiles = payloadForFiles.replace(
    /===ACTION_PLAN===\s*[\s\S]*?(?=\n===FILE:|\n===|$)/i,
    ""
  );
  return {
    disposition: disposition.trim(),
    actionPlan: actionPlan.trim(),
    check,
    payloadForFiles: payloadForFiles.trim(),
  };
}

export function validateTechDebtReviewSelfCheck(
  check: string | null
): SelfCheckValidation {
  return validateKeyedSelfCheck(check, SA_TECH_DEBT_REVIEW_SELF_CHECK_KEYS);
}

export function buildUserReportMarkdown(
  summary: string,
  actionPlan: string | null
): string {
  const parts = [
    "# Project report",
    "",
    "## What this project does",
    "",
    summary.trim(),
    "",
  ];
  if (actionPlan && actionPlan.trim()) {
    parts.push(
      "## Technical debt — suggested action plan (decide)",
      "",
      actionPlan.trim(),
      "",
      "_The orchestrator will not implement this plan until you choose what to do._",
      ""
    );
  }
  return parts.join("\n");
}

export function consultAdvisorPrompt(
  advisor: TeamRolePrompt,
  asker: string
): string {
  return joinPrompt([
    ROLE_PERSONAS[advisor],
    `Duties: ${ROLE_PROMPT_DUTIES[advisor]}.`,
    `Answer briefly for the ${asker}.`,
    "Stay in your lane. Max ~200 words. No ===FILE=== unless asked.",
  ]);
}
