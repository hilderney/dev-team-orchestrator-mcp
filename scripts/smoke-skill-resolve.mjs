/**
 * Smoke: skillFileCandidates / resolveSkill / playbook skillKey (no LLM).
 */
process.env.NINEROUTER_KEY ??= "smoke-dummy-key";

import assert from "node:assert/strict";
import {
  skillFileCandidates,
  resolveSkill,
  resolveSkillSync,
  stageToSkillPhase,
  formatSkillPromptBlock,
  PACKAGE_SKILLS_ROOT,
} from "../src/skill-resolve.ts";
import { buildCursorDelegationPlaybook } from "../src/zteam-config.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

assert.equal(stageToSkillPhase("qaTddRed"), "tdd-red");
assert.equal(stageToSkillPhase("qa-tdd-red"), "tdd-red");
assert.equal(stageToSkillPhase("softwareEngineer"), "tdd-green");
assert.equal(stageToSkillPhase("se-implement"), "tdd-green");
assert.equal(stageToSkillPhase("consult:sa->ta"), null);

{
  const webgame = skillFileCandidates("qaEngineer", "tdd-red", "webgame");
  assert.ok(webgame.includes("qa-tdd-red-webgame.md"));
  assert.ok(webgame.includes("qa-tdd-red-screenflow.md"));
  assert.ok(webgame.includes("qa-tdd-red-core.md"));
  assert.equal(webgame[webgame.length - 1], "qa-tdd-red-core.md");
}

{
  const backend = skillFileCandidates("qaEngineer", "tdd-red", "backend");
  assert.ok(backend.includes("qa-tdd-red-api-contract.md"));
  assert.ok(!backend.includes("qa-tdd-red-screenflow.md"));
  assert.ok(backend.includes("qa-tdd-red-core.md"));
}

{
  const { needsUiFlow } = await import("../src/zteam-config.ts");
  assert.equal(needsUiFlow("webgame"), true);
  assert.equal(needsUiFlow("godotgame"), true);
  assert.equal(needsUiFlow("crud"), true);
  assert.equal(needsUiFlow("backend"), false);

  const godotRed = skillFileCandidates("qaEngineer", "tdd-red", "godotgame");
  assert.ok(godotRed.includes("qa-tdd-red-godotgame.md"));
  assert.ok(godotRed.includes("qa-tdd-red-screenflow.md"));
}

{
  const flow = skillFileCandidates("uiUxDesigner", "spec-flow", "webgame");
  assert.ok(flow.includes("ux-spec-flow-webgame.md"));
  assert.ok(flow.includes("ux-flow-webgame.md"));
  assert.ok(flow.includes("ux-spec-flow-core.md"));
}

{
  const skill = resolveSkillSync({
    role: "qaEngineer",
    phase: "tdd-red",
    projectType: "webgame",
  });
  assert.ok(skill, "webgame tdd-red resolves");
  assert.equal(skill.key, "qa-tdd-red-screenflow");
  assert.match(skill.excerpt, /Mission/i);
  assert.match(formatSkillPromptBlock(skill), /Active skill: qa-tdd-red-screenflow/);
}

{
  const skill = resolveSkillSync({
    role: "qaEngineer",
    phase: "tdd-red",
    projectType: "backend",
  });
  assert.ok(skill, "backend tdd-red resolves");
  assert.equal(skill.key, "qa-tdd-red-api-contract");
}

{
  const aiSkill = resolveSkillSync({
    role: "qaEngineer",
    phase: "tdd-red",
    projectType: "ai-rag",
  });
  assert.ok(aiSkill, "ai-rag tdd-red resolves");
  assert.equal(aiSkill.key, "qa-tdd-red-ai-rag");
  assert.match(aiSkill.excerpt, /deterministic mock/i);
}

{
  const skill = await resolveSkill({
    role: "softwareEngineer",
    phase: "tdd-green",
    projectType: "webgame",
  });
  assert.ok(skill, "se tdd-green resolves");
  assert.ok(
    skill.key === "se-tdd-green-webgame" ||
      skill.key === "se-implement-tdd-green"
  );
}

{
  const models = {
    systemArchitect: "cursor:system-architect",
    technologyArchitect: "cursor:technology-architect",
    uiUxDesigner: "cursor:system-architect",
    softwareEngineer: "cursor:software-engineer",
    qaEngineer: "cursor:qa-engineer",
    fallback: "",
    systemArchitectFallback: "",
    technologyArchitectFallback: "",
    uiUxDesignerFallback: "",
    softwareEngineerFallback: "",
    qaEngineerFallback: "",
  };
  const maxTokens = {
    systemArchitect: 1000,
    technologyArchitect: 1000,
    uiUxDesigner: 1000,
    softwareEngineer: 1000,
    qaEngineer: 1000,
  };
  const playbook = buildCursorDelegationPlaybook({
    workflow: "full",
    userIdea: "smoke skill inject",
    workspaceRoot: join(PACKAGE_SKILLS_ROOT, "..", "..", ".."),
    projectRoot: ".",
    appRoot: join(PACKAGE_SKILLS_ROOT, "..", "..", ".."),
    models,
    maxTokens,
    projectType: "webgame",
  });
  const red = playbook.stages.find((s) => s.id === "qa-tdd-red");
  assert.ok(red, "qa-tdd-red stage");
  assert.equal(red.skillKey, "qa-tdd-red-screenflow");
  assert.match(red.instructions, /Active skill: qa-tdd-red-screenflow/);

  const se = playbook.stages.find((s) => s.id === "se-implement");
  assert.ok(se?.skillKey, "se-implement has skillKey");
  assert.match(se.instructions, /Active skill:/);
}

assert.ok(
  existsSync(join(PACKAGE_SKILLS_ROOT, "qa-tdd-red-screenflow.md")),
  "package skills root"
);

console.log("smoke-skill-resolve: ok");
process.exit(0);
