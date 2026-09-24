/**
 * Greenfield scaffold + bootstrap gate (P0-1 / P0-4).
 */
import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATE_DIR = join(PACKAGE_ROOT, "templates", "vite-vitest-react");

export type BootstrapMode = "off" | "shadow" | "hard";

export function bootstrapGateMode(): BootstrapMode {
  if (process.env.ZTEAM_SKIP_BOOTSTRAP_GATE === "1") return "off";
  const mode = (process.env.ZTEAM_BOOTSTRAP_GATE_MODE ?? "hard").toLowerCase();
  if (mode === "shadow" || mode === "off" || mode === "hard") return mode;
  return "hard";
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

function runCmd(
  command: string,
  args: string[],
  cwd: string
): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      env: process.env,
    });
    let log = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.on("error", (err) => {
      resolvePromise({ ok: false, log: log + String(err.message ?? err) });
    });
    child.on("close", (code) => {
      resolvePromise({ ok: code === 0, log: log.trim() || `(exit ${code})` });
    });
  });
}

/** Copy static Vite+Vitest+React template into appRoot when package.json is missing. */
export async function ensureAppScaffold(
  appRoot: string
): Promise<{ applied: boolean; files: string[] }> {
  const pkgPath = join(appRoot, "package.json");
  if (await pathExists(pkgPath)) {
    return { applied: false, files: [] };
  }
  await mkdir(appRoot, { recursive: true });
  await cp(TEMPLATE_DIR, appRoot, { recursive: true });
  const files = [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vitest.config.ts",
    "index.html",
    "src/main.tsx",
    "src/App.tsx",
    "tests/smoke/env.test.ts",
  ];
  return { applied: true, files };
}

export async function npmInstall(
  appRoot: string
): Promise<{ ok: boolean; log: string }> {
  const hasLock =
    (await pathExists(join(appRoot, "package-lock.json"))) ||
    (await pathExists(join(appRoot, "npm-shrinkwrap.json")));
  return runCmd("npm", [hasLock ? "ci" : "install"], appRoot);
}

export async function buildSmoke(
  appRoot: string
): Promise<{ ok: boolean; log: string }> {
  if (await pathExists(join(appRoot, "tsconfig.json"))) {
    const tsc = await runCmd("npx", ["tsc", "--noEmit"], appRoot);
    if (!tsc.ok) return tsc;
  }
  const pkgPath = join(appRoot, "package.json");
  if (!(await pathExists(pkgPath))) {
    return { ok: false, log: "no package.json for build smoke" };
  }
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (pkg.scripts?.build) {
      return runCmd("npm", ["run", "build"], appRoot);
    }
  } catch {
    /* fall through */
  }
  return { ok: true, log: "build smoke skipped (no scripts.build)" };
}

export type BootstrapGateResult = {
  ok: boolean;
  shadowWouldAbort: boolean;
  failureKind?: "bootstrap";
  message: string;
  installed: boolean;
};

/**
 * Before QA: require package.json + scripts.test + node_modules (install if needed).
 */
export async function runBootstrapGate(
  appRoot: string,
  opts?: { notify?: (msg: string) => void }
): Promise<BootstrapGateResult> {
  const mode = bootstrapGateMode();
  const notify = opts?.notify ?? (() => undefined);

  if (mode === "off") {
    return {
      ok: true,
      shadowWouldAbort: false,
      message: "bootstrap gate skipped (ZTEAM_SKIP_BOOTSTRAP_GATE)",
      installed: false,
    };
  }

  const pkgPath = join(appRoot, "package.json");
  if (!(await pathExists(pkgPath))) {
    const msg = "bootstrap: missing package.json (run scaffold first)";
    if (mode === "shadow") {
      notify(`would_abort: bootstrap — ${msg}`);
      return { ok: true, shadowWouldAbort: true, message: msg, installed: false };
    }
    return {
      ok: false,
      shadowWouldAbort: false,
      failureKind: "bootstrap",
      message: msg,
      installed: false,
    };
  }

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
  } catch {
    const msg = "bootstrap: package.json is not valid JSON";
    if (mode === "shadow") {
      notify(`would_abort: bootstrap — ${msg}`);
      return { ok: true, shadowWouldAbort: true, message: msg, installed: false };
    }
    return {
      ok: false,
      shadowWouldAbort: false,
      failureKind: "bootstrap",
      message: msg,
      installed: false,
    };
  }

  if (!pkg.scripts?.test?.trim()) {
    const msg = "bootstrap: package.json missing scripts.test";
    if (mode === "shadow") {
      notify(`would_abort: bootstrap — ${msg}`);
      return { ok: true, shadowWouldAbort: true, message: msg, installed: false };
    }
    return {
      ok: false,
      shadowWouldAbort: false,
      failureKind: "bootstrap",
      message: msg,
      installed: false,
    };
  }

  const nm = join(appRoot, "node_modules");
  let installed = false;
  if (!(await pathExists(nm))) {
    notify("bootstrap: node_modules missing — running npm install");
    const install = await npmInstall(appRoot);
    installed = install.ok;
    if (!install.ok) {
      const msg = `bootstrap: npm install failed: ${install.log.slice(0, 800)}`;
      if (mode === "shadow") {
        notify(`would_abort: bootstrap — ${msg}`);
        return {
          ok: true,
          shadowWouldAbort: true,
          message: msg,
          installed: false,
        };
      }
      return {
        ok: false,
        shadowWouldAbort: false,
        failureKind: "bootstrap",
        message: msg,
        installed: false,
      };
    }
  }

  return {
    ok: true,
    shadowWouldAbort: false,
    message: installed ? "bootstrap: install ok" : "bootstrap: ready",
    installed,
  };
}

/** Ensure scripts.test uses vitest when possible (P0-2). */
export async function ensureVitestTestScript(
  appRoot: string
): Promise<{ injected: boolean; command: string }> {
  const pkgPath = join(appRoot, "package.json");
  if (!(await pathExists(pkgPath))) {
    return { injected: false, command: "npx vitest run" };
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return { injected: false, command: "npx vitest run" };
  }
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object"
      ? ({ ...(pkg.scripts as Record<string, string>) } as Record<string, string>)
      : {};
  if (typeof scripts.test === "string" && scripts.test.trim()) {
    return { injected: false, command: "npm test" };
  }
  scripts.test = "vitest run";
  pkg.scripts = scripts;
  await mkdir(dirname(pkgPath), { recursive: true });
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  return { injected: true, command: "npm test" };
}

export async function runCanonicalTests(
  appRoot: string
): Promise<{ ok: boolean; log: string; command: string }> {
  const preflight = await ensureVitestTestScript(appRoot);
  const hasPkg = await pathExists(join(appRoot, "package.json"));
  if (!hasPkg) {
    return {
      ok: false,
      log: "no package.json — cannot run tests",
      command: preflight.command,
    };
  }
  // Prefer npx vitest when scripts.test mentions vitest or is missing runner clarity
  let command = "npm";
  let args = ["test"];
  try {
    const pkg = JSON.parse(
      await readFile(join(appRoot, "package.json"), "utf8")
    ) as { scripts?: { test?: string } };
    const testScript = pkg.scripts?.test ?? "";
    if (/vitest/i.test(testScript) || !testScript.trim()) {
      command = "npx";
      args = ["vitest", "run"];
    }
  } catch {
    command = "npx";
    args = ["vitest", "run"];
  }
  const result = await runCmd(command, args, appRoot);
  return {
    ok: result.ok,
    log: result.log,
    command: `${command} ${args.join(" ")}`,
  };
}

export async function runQaSmokeTests(
  appRoot: string
): Promise<{ ok: boolean; log: string; skipped: boolean }> {
  const smokeDir = join(appRoot, "tests", "smoke");
  if (!(await pathExists(smokeDir))) {
    return { ok: true, log: "no tests/smoke; skipped", skipped: true };
  }
  const result = await runCmd("npx", ["vitest", "run", "tests/smoke"], appRoot);
  return { ...result, skipped: false };
}

/** Mark project-setup todo done if present. */
export async function markProjectSetupDone(appRoot: string): Promise<void> {
  const todoPath = join(appRoot, ".docs", "todo.md");
  if (!(await pathExists(todoPath))) return;
  let todo = await readFile(todoPath, "utf8");
  const next = todo.replace(
    /^(\s*-\s*)\[\s\](\s+project-setup\b.*)$/gim,
    "$1[x]$2"
  );
  if (next !== todo) {
    await writeFile(todoPath, next, "utf8");
  }
}
