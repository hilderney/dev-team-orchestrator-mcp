/**
 * Per-pipeline AsyncLocalStorage: workspace override + resolved team models.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvedTeamConfig } from "./zteam-config.js";

export type RunContext = {
  /** Absolute workspace root for this MCP/CLI invocation */
  workspaceRoot: string;
  workspaceSource: "arg" | "env" | "cwd";
  teamConfig?: ResolvedTeamConfig;
};

const als = new AsyncLocalStorage<RunContext>();

export function getRunContext(): RunContext | undefined {
  return als.getStore();
}

export function withRunContext<T>(
  ctx: RunContext,
  fn: () => Promise<T> | T
): Promise<T> | T {
  return als.run(ctx, fn);
}
