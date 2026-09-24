/**
 * Workflow registry — modular routes for the LangGraph orchestrator.
 * Node implementations live in `src/orchestrator.ts`; this module is the
 * catalog + classifier used by the START router.
 */
export {
  WORKFLOW_IDS,
  WORKFLOW_CATALOG,
  isWorkflowId,
  workflowCatalogText,
  type WorkflowId,
  type WorkflowMeta,
} from "./types.js";

export {
  classifyWorkflow,
  resolveExplicitWorkflow,
  stripWorkflowTag,
  parseWorkflowTag,
} from "./classify.js";
