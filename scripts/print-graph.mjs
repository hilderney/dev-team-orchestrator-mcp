import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(ROOT, ".docs", "langgraph.mmd");

async function mermaidFor(label, compiled) {
  const drawable =
    typeof compiled.getGraphAsync === "function"
      ? await compiled.getGraphAsync()
      : compiled.getGraph();
  if (typeof drawable.drawMermaid !== "function") {
    throw new Error(
      `${label}: drawMermaid() not available on drawable graph (got: ${Object.getOwnPropertyNames(
        Object.getPrototypeOf(drawable)
      ).join(", ")})`
    );
  }
  return drawable.drawMermaid();
}

async function main() {
  const { compiledGraph } = await import("../src/orchestrator.ts");

  // workflow / docsOnly are state flags; router picks entry after START.
  const fullMermaid = await mermaidFor("compiledGraph", compiledGraph);
  console.log("%% spec-driven pipeline (workflowRouter → full|docs|feature|punch|fix)");
  console.log(fullMermaid);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const combined = [
    "%% spec-driven pipeline (workflowRouter → full|docs|feature|punch|fix)",
    fullMermaid.trimEnd(),
    "",
  ].join("\n");
  await writeFile(OUT_PATH, combined, "utf8");
  console.error(`[graph] wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("[graph] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
