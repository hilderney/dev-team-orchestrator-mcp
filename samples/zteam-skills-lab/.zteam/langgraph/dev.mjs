#!/usr/bin/env node
/**
 * Launch LangGraph Studio Agent Server for the zteam pipeline graph.
 * Topology only — does not mirror live MCP pipeline runs.
 */
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const metaPath = join(here, "package-root.json");

async function main() {
  let packageRoot;
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    packageRoot = meta.packageRoot;
  } catch (err) {
    console.error(
      "[zteam/langgraph] missing or invalid package-root.json:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }
  if (typeof packageRoot !== "string" || !packageRoot.trim()) {
    console.error("[zteam/langgraph] packageRoot is empty in package-root.json");
    process.exit(1);
  }
  const configPath = join(packageRoot, "langgraph.json");
  try {
    await access(configPath);
  } catch {
    console.error(
      "[zteam/langgraph] langgraph.json not found at:",
      configPath,
      "\nRe-run ensure_zteam_setup / get_zteam_config after fixing the MCP package path."
    );
    process.exit(1);
  }

  console.error("[zteam/langgraph] starting Studio Agent Server…");
  console.error(
    "[zteam/langgraph] Studio UI: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024"
  );
  console.error("[zteam/langgraph] cwd:", packageRoot);

  const child = spawn(
    "npx",
    ["@langchain/langgraph-cli", "dev", "-c", "langgraph.json"],
    {
      cwd: packageRoot,
      stdio: "inherit",
      shell: true,
      env: process.env,
    }
  );
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error("[zteam/langgraph] failed:", err);
  process.exit(1);
});
