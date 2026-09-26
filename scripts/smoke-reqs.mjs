/**
 * Smoke: resume / pré-requirements parsers + README builders (no LLM).
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";

const {
  parseResumeAndPreRequirements,
  parseNumberedList,
  buildBootstrapReadme,
  buildCleanReadme,
  clampResumeWords,
  countWords,
  assertSafeAppRoot,
  PACKAGE_ROOT,
  resolveAppRoot,
  shouldWriteRequirementsStub,
} = await import("../src/orchestrator.ts");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sample = `
===RESUME===
A retro Pac-Man canvas game with infinite lives and a death counter.
===PRE_REQUIREMENTS===
1. Classic maze playfield
2. WASD movement for Pac-Man
3. Pellets and score
4. Ghosts that chase the player
5. Power pellets that make ghosts vulnerable
`;

const parsed = parseResumeAndPreRequirements(sample);
assert(parsed, "parseResumeAndPreRequirements should succeed");
assert(parsed.preRequirements.length === 5, "expected 5 pré-reqs");
assert(countWords(parsed.resume) > 0, "resume non-empty");

const many = Array(600).fill("word").join(" ");
assert(countWords(clampResumeWords(many)) === 512, "clamp to 512 words");

const boot = buildBootstrapReadme(parsed.resume, parsed.preRequirements);
assert(boot.includes("## Resume"), "bootstrap has Resume");
assert(boot.includes("## Pré Requirements"), "bootstrap has Pré Requirements");
assert(boot.includes("1. Classic maze"), "numbered list");

const clean = buildCleanReadme(parsed.resume);
assert(clean.includes("## Resume"), "clean has Resume");
assert(clean.includes(".docs/requirements.md"), "clean links requirements");
assert(!clean.includes("Pré Requirements"), "clean drops pré-reqs list");

assert(parseNumberedList("1. a\n2) b\nnope\n3. c").length === 3, "numbered list parser");

let threw = false;
try {
  assertSafeAppRoot(PACKAGE_ROOT, ".");
} catch {
  threw = true;
}
assert(threw, "assertSafeAppRoot should refuse package root + projectRoot=.");

const other = resolveAppRoot("samples/smoke-app");
assertSafeAppRoot(other, "samples/smoke-app");

// --- bootstrap preserve requirements ---
{
  const prev = process.env.ZTEAM_FORCE_BOOTSTRAP;
  delete process.env.ZTEAM_FORCE_BOOTSTRAP;
  assert(
    shouldWriteRequirementsStub(""),
    "empty → write stub"
  );
  assert(
    shouldWriteRequirementsStub(
      "# Requirements\n\n_Sections are filled one pré-requirement at a time._\n"
    ),
    "stub-only → write stub"
  );
  const rich = `# Requirements

## Feature A

Detailed requirements text that is long enough to clear the eighty character floor for preservation.
`;
  assert(!shouldWriteRequirementsStub(rich), "rich ## → preserve");
  assert(
    shouldWriteRequirementsStub(rich, true),
    "force=true → wipe"
  );
  process.env.ZTEAM_FORCE_BOOTSTRAP = "1";
  assert(shouldWriteRequirementsStub(rich), "env force → wipe");
  if (prev === undefined) delete process.env.ZTEAM_FORCE_BOOTSTRAP;
  else process.env.ZTEAM_FORCE_BOOTSTRAP = prev;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      preReqs: parsed.preRequirements.length,
      resumeWords: countWords(parsed.resume),
      bootstrapPreserve: true,
    },
    null,
    2
  )
);
