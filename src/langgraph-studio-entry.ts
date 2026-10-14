/**
 * LangGraph Studio / CLI entry — exports the compiled pipeline graph.
 * Importing orchestrator for this export does not start the MCP server
 * (`isMainModule` guards `main()` in orchestrator.ts).
 */
export { compiledGraph as graph } from "./orchestrator.ts";
