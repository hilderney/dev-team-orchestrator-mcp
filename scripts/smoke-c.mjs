/**
 * Section C smoke (resilience + progress heartbeat).
 * Set PROGRESS_HEARTBEAT_MS before importing orchestrator (const at module load).
 * dotenv inside orchestrator will not override these values.
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";
process.env.PROGRESS_HEARTBEAT_MS = "400";

const { runSectionCSmoke } = await import("../src/orchestrator.ts");

try {
  const result = await runSectionCSmoke();
  console.log(
    JSON.stringify(
      {
        ok: true,
        heartbeats: result.heartbeats,
        sample: result.lines.slice(0, 5),
      },
      null,
      2
    )
  );
} catch (err) {
  console.error("[smoke] FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
