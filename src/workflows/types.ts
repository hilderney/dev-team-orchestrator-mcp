/** Named pipeline workflows (modular routes). */
export const WORKFLOW_IDS = [
  "full",
  "docs",
  "feature",
  "punch",
  "fix",
  "resume",
] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export type WorkflowMeta = {
  id: WorkflowId;
  /** First LangGraph node after workflowRouter */
  entry:
    | "orchestratorBootstrapReadme"
    | "systemArchitectSpecs"
    | "punchPrepare"
    | "fixPrepare"
    | "resumePrepare";
  summary: string;
  route: string;
};

export const WORKFLOW_CATALOG: Record<WorkflowId, WorkflowMeta> = {
  full: {
    id: "full",
    entry: "orchestratorBootstrapReadme",
    summary: "Greenfield / projeto novo",
    route:
      "bootstrap README → SA pré-reqs* → clean README → fidelity → TA → specs → scaffold → SE* → QA* → finalize",
  },
  docs: {
    id: "docs",
    entry: "orchestratorBootstrapReadme",
    summary: "Só planejar (sem SE/QA)",
    route:
      "bootstrap README → SA pré-reqs* → clean README → fidelity → TA → specs → finalize",
  },
  feature: {
    id: "feature",
    entry: "systemArchitectSpecs",
    summary: "Feature em app com docs existentes",
    route: "SA specs → scaffold → SE* → QA* → finalize",
  },
  punch: {
    id: "punch",
    entry: "punchPrepare",
    summary: "Mudança pontual (cor, copy, tweak)",
    route: "punch prepare → SE → QA → finalize",
  },
  fix: {
    id: "fix",
    entry: "fixPrepare",
    summary: "Bug / teste falhando",
    route: "fix prepare → SE fix → QA → finalize",
  },
  resume: {
    id: "resume",
    entry: "resumePrepare",
    summary: "Retomar todos [ ] com spec existente",
    route: "resume prepare → scaffold → SE* → QA* → finalize",
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
