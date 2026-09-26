/** Named pipeline workflows (modular routes). */
export const WORKFLOW_IDS = [
  "full",
  "docs",
  "feature",
  "punch",
  "fix",
  "resume",
  "tests",
  "analyze",
] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export type WorkflowMeta = {
  id: WorkflowId;
  /** First LangGraph node after workflowRouter */
  entry:
    | "orchestratorBootstrapReadme"
    | "systemArchitectTodoPlan"
    | "punchPrepare"
    | "fixPrepare"
    | "resumePrepare"
    | "qaTddRed"
    | "analyzePrepare";
  summary: string;
  route: string;
};

export const WORKFLOW_CATALOG: Record<WorkflowId, WorkflowMeta> = {
  full: {
    id: "full",
    entry: "orchestratorBootstrapReadme",
    summary: "Greenfield / projeto novo",
    route:
      "bootstrap → SA pré-reqs* → juice → fidelity → TA → UI/UX look-and-feel → SA todo plan → (SA→UX→TA spec)* → arch critic → scaffold → QA-red* → SE* → delivery critic → QA-verify* → SA summary → optional tech-debt plan → finalize",
  },
  docs: {
    id: "docs",
    entry: "orchestratorBootstrapReadme",
    summary: "Só planejar (sem SE/QA)",
    route:
      "bootstrap → SA pré-reqs* → juice → fidelity → TA → UI/UX look-and-feel → SA todo plan → (SA→UX→TA spec)* → arch critic → finalize",
  },
  feature: {
    id: "feature",
    entry: "systemArchitectTodoPlan",
    summary: "Feature em app com docs existentes (opcional: 1 slug)",
    route:
      "SA todo plan → (SA→UX→TA spec)* → arch critic → scaffold → QA-red* → SE* → delivery critic → QA-verify* → SA summary → optional tech-debt plan → finalize",
  },
  punch: {
    id: "punch",
    entry: "punchPrepare",
    summary: "Mudança pontual (cor, copy, tweak)",
    route:
      "punch prepare → QA-red → SE → delivery critic → QA-verify → SA summary → optional tech-debt plan → finalize",
  },
  fix: {
    id: "fix",
    entry: "fixPrepare",
    summary: "Bug / teste falhando",
    route:
      "fix prepare → SE fix → QA-verify → SA summary → optional tech-debt plan → finalize",
  },
  resume: {
    id: "resume",
    entry: "resumePrepare",
    summary: "Retomar todos [ ] com spec existente",
    route:
      "resume prepare → scaffold → QA-red* → SE* → delivery critic → QA-verify* → SA summary → optional tech-debt plan → finalize",
  },
  tests: {
    id: "tests",
    entry: "qaTddRed",
    summary: "Só testes (TDD red + verify) para um slug/requisito",
    route:
      "QA-red* → QA-verify* → SA summary → optional tech-debt plan → finalize",
  },
  analyze: {
    id: "analyze",
    entry: "analyzePrepare",
    summary: "Análise read-mostly (time ou um papel)",
    route: "analyze prepare → analyze role(s) → finalize",
  },
};

export function isWorkflowId(value: string): value is WorkflowId {
  return (WORKFLOW_IDS as readonly string[]).includes(value);
}

export function workflowCatalogText(): string {
  return WORKFLOW_IDS.map((id) => {
    const w = WORKFLOW_CATALOG[id];
    return `${id}: ${w.summary} (${w.route})`;
  }).join("; ");
}
