/** Thin wrapper: npm run pipeline:feature → run-pipeline --workflow feature */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const id = process.argv[2];
const rest = process.argv.slice(3);

const allowed = new Set(["full", "docs", "feature", "punch", "fix", "resume"]);

if (!id || !allowed.has(id)) {
  console.error(
    "Usage: node scripts/workflows/run.mjs <full|docs|feature|punch|fix|resume> [pipeline args…]"
  );
  process.exit(1);
}

const child = spawn(
  "npx",
  ["tsx", "scripts/run-pipeline.mjs", `--workflow=${id}`, ...rest],
  { cwd: root, stdio: "inherit", shell: true, env: process.env }
);
child.on("exit", (code) => process.exit(code ?? 1));
