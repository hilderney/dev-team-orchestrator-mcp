/**
 * Environment probe (no LLM): writes `.docs/host.json` before Technology Architect / QA red
 * so agents know Node version, `node:sqlite` availability, and whether native C++ compilation
 * (`node-gyp` / `better-sqlite3`) is likely to fail on this machine.
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const HOST_PROBE_REL_PATH = ".docs/host.json";

export type HostProbe = {
  version: 1;
  probedAt: string;
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  nodeMajor: number;
  hasNodeSqlite: boolean;
  nativeCompileLikelyOk: boolean;
  preferredSqliteDriver: "node:sqlite" | "sql.js" | "better-sqlite3";
  notes: string[];
};

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

export async function probeHostEnvironment(): Promise<HostProbe> {
  const nodeVersion = process.version;
  const majorMatch = nodeVersion.match(/^v?(\d+)/);
  const nodeMajor = majorMatch ? Number.parseInt(majorMatch[1], 10) : 20;

  let hasNodeSqlite = false;
  try {
    const mod = await import("node:sqlite");
    hasNodeSqlite = Boolean(mod && typeof mod.DatabaseSync === "function");
  } catch {
    hasNodeSqlite = false;
  }

  // On Windows without VS BuildTools / VCToolsInstallDir, node-gyp native addons (better-sqlite3) often fail
  const isWin = process.platform === "win32";
  const hasVsTools = Boolean(
    process.env.VCToolsInstallDir ||
      process.env.VSINSTALLDIR ||
      process.env.GYP_MSVS_VERSION
  );
  const nativeCompileLikelyOk = !isWin || hasVsTools;

  const preferredSqliteDriver: HostProbe["preferredSqliteDriver"] = hasNodeSqlite
    ? "node:sqlite"
    : nativeCompileLikelyOk
      ? "better-sqlite3"
      : "sql.js";

  const notes: string[] = [];
  if (hasNodeSqlite) {
    notes.push(
      `Node ${nodeVersion} provides built-in 'node:sqlite' (DatabaseSync). Prefer 'node:sqlite' over native C++ addons like 'better-sqlite3'.`
    );
  }
  if (!nativeCompileLikelyOk) {
    notes.push(
      "Windows host without detected Visual C++ Build Tools: avoid 'better-sqlite3' or 'node-gyp' native modules; use 'node:sqlite' (built-in) or pure JS/WASM ('sql.js') instead."
    );
  }

  return {
    version: 1,
    probedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion,
    nodeMajor,
    hasNodeSqlite,
    nativeCompileLikelyOk,
    preferredSqliteDriver,
    notes,
  };
}

export async function ensureHostProbeFile(appRoot: string): Promise<{
  path: string;
  probe: HostProbe;
}> {
  const root = resolve(appRoot);
  const abs = join(root, HOST_PROBE_REL_PATH);
  await mkdir(dirname(abs), { recursive: true });
  const probe = await probeHostEnvironment();
  await writeFile(abs, JSON.stringify(probe, null, 2) + "\n", "utf8");
  return { path: abs, probe };
}

export async function readHostProbeFile(
  appRoot: string
): Promise<HostProbe | null> {
  const abs = join(resolve(appRoot), HOST_PROBE_REL_PATH);
  if (!(await pathExists(abs))) return null;
  try {
    return JSON.parse(await readFile(abs, "utf8")) as HostProbe;
  } catch {
    return null;
  }
}
