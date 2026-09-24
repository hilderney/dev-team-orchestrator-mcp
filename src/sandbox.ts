/**
 * Workspace safety + optional container sandbox hints (P1-5 / Fase F).
 */
import { resolve } from "node:path";

export function assertExpectedWorkspace(workspaceRoot: string): void {
  const expected = process.env.ZTEAM_EXPECTED_WORKSPACE?.trim();
  if (!expected) return;
  const a = resolve(workspaceRoot);
  const b = resolve(expected);
  if (a !== b) {
    throw new Error(
      `WORKSPACE_ROOT mismatch: got ${a}, expected ZTEAM_EXPECTED_WORKSPACE=${b}`
    );
  }
}

/** Refuse writing outside resolved workspace (sibling repo footgun). */
export function assertPathInsideWorkspace(
  workspaceRoot: string,
  absPath: string
): void {
  const root = resolve(workspaceRoot);
  const target = resolve(absPath);
  const rel = target.startsWith(root)
    ? target.slice(root.length)
    : null;
  if (rel === null || (rel.length > 0 && !rel.startsWith("\\") && !rel.startsWith("/"))) {
    // Windows: also compare case-insensitive
    if (target.toLowerCase().startsWith(root.toLowerCase())) return;
    throw new Error(
      `Refusing write outside workspace: ${target} not under ${root}`
    );
  }
}

export type SandboxConfig = {
  enabled: boolean;
  image: string;
  memoryMb: number;
  cpus: number;
};

export function sandboxConfig(): SandboxConfig {
  return {
    enabled: process.env.ZTEAM_SANDBOX === "1",
    image:
      process.env.ZTEAM_SANDBOX_IMAGE ||
      "node:22-bookworm",
    memoryMb: Number.parseInt(process.env.ZTEAM_SANDBOX_MEMORY_MB ?? "2048", 10) || 2048,
    cpus: Number.parseFloat(process.env.ZTEAM_SANDBOX_CPUS ?? "2") || 2,
  };
}

/**
 * Build a docker run command for ephemeral pipeline (caller executes if enabled).
 * Dependencies (vitest) should be preinstalled in a custom image when available.
 */
export function sandboxDockerArgs(
  appRoot: string,
  command: string[]
): string[] {
  const cfg = sandboxConfig();
  return [
    "run",
    "--rm",
    `--memory=${cfg.memoryMb}m`,
    `--cpus=${cfg.cpus}`,
    "-v",
    `${appRoot}:/app`,
    "-w",
    "/app",
    cfg.image,
    ...command,
  ];
}
