/**
 * Smoke: role personas, SELF_CHECK split/validate (no LLM).
 */
import assert from "node:assert/strict";
import {
  ROLE_PERSONAS,
  splitSelfCheck,
  validateSaRequirementsSelfCheck,
  validateKeyedSelfCheck,
  SA_SPECS_SELF_CHECK_KEYS,
  TA_SELF_CHECK_KEYS,
  systemArchitectReqItemPrompt,
  technologyArchitectPrompt,
  uiUxRequirementsPrompt,
  uiUxDesignSystemPrompt,
  softwareEngineerImplementPrompt,
  qaEngineerPrompt,
  parseUiUxRequirementsResponse,
  validateUiUxRequirementsResponse,
  upsertRequirementsUxAddendum,
  parseUiUxDesignSystemResponse,
  validateUiUxDesignSystemResponse,
  UX_DESIGN_SELF_CHECK_KEYS,
  parseTodoPlanResponse,
  parseSingleSpecResponse,
  SA_TODO_PLAN_SELF_CHECK_KEYS,
  SA_SPEC_ITEM_SELF_CHECK_KEYS,
  UX_SPEC_ENRICH_SELF_CHECK_KEYS,
  TA_SPEC_ENRICH_SELF_CHECK_KEYS,
  countSpecUseCases,
  assertSpecUseCasesMinimum,
  validateSeImplementSelfCheck,
  validateQaSelfCheck,
  stripSeQaTrailMarkers,
  parseTechDebtSection,
  appendTechDebtMarkdown,
  systemArchitectProjectSummaryPrompt,
  systemArchitectTechDebtReviewPrompt,
  parseProjectSummaryResponse,
  validateProjectSummarySelfCheck,
  parseTechDebtReviewResponse,
  validateTechDebtReviewSelfCheck,
  buildUserReportMarkdown,
} from "../src/role-prompts.ts";

assert.match(ROLE_PERSONAS.systemArchitect, /Systems Architect/i);
assert.match(ROLE_PERSONAS.systemArchitect, /how and why/i);
assert.match(systemArchitectReqItemPrompt("1"), /===SELF_CHECK===/);
assert.match(systemArchitectReqItemPrompt("1"), /pre_spec_surface/);
assert.match(systemArchitectReqItemPrompt("1"), /tech_agnostic/);
assert.match(systemArchitectReqItemPrompt("1"), /normal_and_alt_flows/);
assert.match(systemArchitectReqItemPrompt("1"), /functional_and_nonfunctional/);
assert.match(ROLE_PERSONAS.technologyArchitect, /production/i);
assert.match(ROLE_PERSONAS.technologyArchitect, /cost-benefit|hosting|persistence/i);
assert.match(technologyArchitectPrompt(), /tech_coverage_90/);
assert.match(technologyArchitectPrompt(), /hosting_aware_stacks/);
assert.match(technologyArchitectPrompt(), /owner_can_follow/);
assert.match(technologyArchitectPrompt(), /## Hosting \/ publish target/);
assert.match(technologyArchitectPrompt(), /## Data persistence/);
assert.match(technologyArchitectPrompt(), /## Scalability & growth/);
assert.match(ROLE_PERSONAS.uiUxDesigner, /juice/i);
assert.match(uiUxRequirementsPrompt(), /SCORE_BEFORE/);
assert.match(uiUxRequirementsPrompt(), /score_improved_to_at_least_7/);
assert.match(softwareEngineerImplementPrompt(), /Software Engineer/i);
assert.match(softwareEngineerImplementPrompt(), /covers_all_functionalities/);
assert.match(softwareEngineerImplementPrompt(), /covers_all_use_cases/);
assert.match(softwareEngineerImplementPrompt(), /follows_usability_and_emotions/);
assert.match(ROLE_PERSONAS.softwareEngineer, /Clean Code/i);
assert.match(ROLE_PERSONAS.qaEngineer, /must work/i);
assert.match(qaEngineerPrompt(), /TECH_DEBT|tests_cover_all_use_cases/);
assert.match(qaEngineerPrompt(), /tests_cover_all_use_cases/);
assert.match(qaEngineerPrompt(), /no_unresolved_spec_conflicts/);

{
  const raw = `## 1. Login

Goal: user signs in.

===SELF_CHECK===
pre_spec_surface: yes
tech_agnostic: yes
normal_and_alt_flows: yes
functional_and_nonfunctional: yes
`;
  const { body, check } = splitSelfCheck(raw);
  assert.match(body, /^## 1\. Login/);
  assert.equal(validateSaRequirementsSelfCheck(check).ok, true);
  assert.doesNotMatch(body, /SELF_CHECK/);
}

{
  const bad = validateSaRequirementsSelfCheck(null);
  assert.equal(bad.ok, false);
}

{
  const { check } = splitSelfCheck(`## x\n\n===SELF_CHECK===\npre_spec_surface: no\ntech_agnostic: yes\nnormal_and_alt_flows: yes\nfunctional_and_nonfunctional: yes\n`);
  const v = validateSaRequirementsSelfCheck(check);
  assert.equal(v.ok, false);
  assert.ok(v.nos.includes("pre_spec_surface"));
}

{
  const v = validateKeyedSelfCheck(
    `testable_chunks: yes\ncovers_pre_requirements: yes\ntest_focus_listed: yes`,
    SA_SPECS_SELF_CHECK_KEYS
  );
  assert.equal(v.ok, true);
}

{
  const taCheck = TA_SELF_CHECK_KEYS.map((k) => `${k}: yes`).join("\n");
  const v = validateKeyedSelfCheck(taCheck, TA_SELF_CHECK_KEYS);
  assert.equal(v.ok, true);
  assert.equal(TA_SELF_CHECK_KEYS.length, 9);
}

{
  const v = validateKeyedSelfCheck(
    `tech_coverage_90: yes\nfolder_layout_explicit: no\npatterns_fit_requirements: yes\nscalability_path: yes\ncost_benefit_services: yes\nhosting_aware_stacks: yes\ndata_persistence: yes\nspecialized_services: yes\nowner_can_follow: yes`,
    TA_SELF_CHECK_KEYS
  );
  assert.equal(v.ok, false);
  assert.ok(v.nos.includes("folder_layout_explicit"));
}

{
  const raw = `===SCORE_BEFORE===
4
===ADDENDUM===
Every click needs visible feedback; empty states explain next action.
===SCORE_AFTER===
8
===SELF_CHECK===
score_improved_to_at_least_7: yes
`;
  const parsed = parseUiUxRequirementsResponse(raw);
  const v = validateUiUxRequirementsResponse(parsed);
  assert.equal(v.ok, true, v.message);
  assert.equal(parsed.scoreBefore, 4);
  assert.equal(parsed.scoreAfter, 8);
  const next = upsertRequirementsUxAddendum("# Requirements\n\n## 1. Foo\n\nx\n", parsed.addendum);
  assert.match(next, /## UX \/ Juice addendum/);
  assert.match(next, /Every click/);
}

{
  const bad = parseUiUxRequirementsResponse(`===SCORE_BEFORE===
8
===ADDENDUM===
x
===SCORE_AFTER===
6
===SELF_CHECK===
score_improved_to_at_least_7: yes
`);
  const v = validateUiUxRequirementsResponse(bad);
  assert.equal(v.ok, false);
}

{
  assert.match(uiUxDesignSystemPrompt(), /purposeful_emotion/);
  assert.match(uiUxDesignSystemPrompt(), /no_invented_data/);
  const designRaw = `===DESIGN===
## Look and feel
Warm, playful, readable.

## Visual hierarchy (highlight more / less)
Primary CTA loud; chrome quiet.

## Color palette
- primary: #2A6F97

## Visual components behavior
Press scales 0.98 with 80ms ease.

## Sound / audio behavior
None for this stack (browser-only silent default).

## Other sensory channels
None beyond visuals.

## Emotion strategies (evidence-based)
Peak-end rule (Kahneman et al.): make climax and exit moments clear.

## Evidence notes (sources & sampling)
Peak-end: established retrospective evaluation findings; cite as well-known, not invent %.

===SELF_CHECK===
purposeful_emotion: yes
evidence_based_techniques: yes
no_invented_data: yes
`;
  const parsed = parseUiUxDesignSystemResponse(designRaw);
  const v = validateUiUxDesignSystemResponse(parsed);
  assert.equal(v.ok, true, v.message);
  assert.equal(UX_DESIGN_SELF_CHECK_KEYS.length, 3);
}

{
  const planRaw = `===PLAN===
Pré-req Login → 2 chunks. Test: auth happy path + invalid password.

===TODO===
- [ ] project-setup: Scaffold app
- [ ] login-form: Login form actions

===SELF_CHECK===
testable_chunks: yes
covers_pre_requirements: yes
test_focus_listed: yes
`;
  const plan = parseTodoPlanResponse(planRaw);
  assert.ok(plan);
  assert.equal(
    validateKeyedSelfCheck(plan.check, SA_TODO_PLAN_SELF_CHECK_KEYS).ok,
    true
  );
  assert.match(plan.todo, /login-form/);

  const specRaw = `===SPEC: login-form===
## Goal
Login.

## Functionalities
Sign in.

## Actions and reactions (complete)
Submit → success toast.

## Use cases
### UC-1: Happy path login
1. User enters valid credentials
2. Submits
3. Sees success

### UC-2: Invalid password
1. User enters wrong password
2. Sees error feedback

### UC-3: Empty fields
1. User submits empty form
2. Sees validation

## Acceptance criteria
- works

## Files to touch
- src/Login.tsx

## What to test
- submit

## Out of scope
- SSO

===SELF_CHECK===
all_actions_covered: yes
se_can_resolve_actions_reactions: yes
fulfills_functionality: yes
min_three_use_cases: yes
one_use_case_per_scenario: yes
`;
  const spec = parseSingleSpecResponse(specRaw, "login-form");
  assert.ok(spec);
  assert.equal(
    validateKeyedSelfCheck(spec.check, SA_SPEC_ITEM_SELF_CHECK_KEYS).ok,
    true
  );
  assert.equal(countSpecUseCases(spec.content), 3);
  assert.doesNotThrow(() => assertSpecUseCasesMinimum(spec.content));
  assert.throws(() => assertSpecUseCasesMinimum("## Goal\nonly"));
  assert.equal(
    validateKeyedSelfCheck(
      "builds_narrative: yes\nemotion_in_sync: yes",
      UX_SPEC_ENRICH_SELF_CHECK_KEYS
    ).ok,
    true
  );
  assert.equal(
    validateKeyedSelfCheck(
      "tech_helps_development: yes\ncontributes_to_ux_emotions: yes",
      TA_SPEC_ENRICH_SELF_CHECK_KEYS
    ).ok,
    true
  );
}

{
  const seRaw = `===FILE: src/App.tsx===
export function App() { return null }

===SELF_CHECK===
covers_all_functionalities: yes
covers_all_use_cases: yes
follows_usability_and_emotions: yes
`;
  assert.equal(validateSeImplementSelfCheck(seRaw).ok, true);
  assert.doesNotMatch(stripSeQaTrailMarkers(seRaw), /SELF_CHECK/);
  assert.match(stripSeQaTrailMarkers(seRaw), /===FILE:/);

  const qaOk = `===SUMMARY===
Covered UC-1..3

===FILE: src/App.test.tsx===
import { describe, it } from "vitest";

===SELF_CHECK===
tests_cover_all_use_cases: yes
no_unresolved_spec_conflicts: yes
`;
  assert.equal(validateQaSelfCheck(qaOk).ok, true);
  assert.equal(parseTechDebtSection(qaOk), null);

  const qaDebt = `===SUMMARY===
UC conflict noted

===TECH_DEBT===
- login-form: UC-2 says toast; acceptance says inline error only

===SELF_CHECK===
tests_cover_all_use_cases: yes
no_unresolved_spec_conflicts: yes
`;
  assert.equal(validateQaSelfCheck(qaDebt).ok, true);
  assert.match(parseTechDebtSection(qaDebt) || "", /UC-2/);
  const stripped = stripSeQaTrailMarkers(qaDebt);
  assert.doesNotMatch(stripped, /TECH_DEBT/);
  assert.doesNotMatch(stripped, /SELF_CHECK/);
  const appended = appendTechDebtMarkdown(
    "[Document missing: .docs/tech-debt.md]",
    "login-form",
    parseTechDebtSection(qaDebt) || ""
  );
  assert.match(appended, /# Technical debt/);
  assert.match(appended, /## login-form/);
}

{
  assert.match(systemArchitectProjectSummaryPrompt(), /===SUMMARY===/);
  assert.match(systemArchitectProjectSummaryPrompt(), /faithful_to_requirements/);
  assert.match(systemArchitectTechDebtReviewPrompt(), /===ACTION_PLAN===/);
  assert.match(systemArchitectTechDebtReviewPrompt(), /project_spirit|spirit/i);

  const sumRaw = `===SUMMARY===
## What it is
A notes app for calm journaling.

===SELF_CHECK===
faithful_to_requirements: yes
faithful_to_readme: yes
readable_for_owner: yes
`;
  const sum = parseProjectSummaryResponse(sumRaw);
  assert.ok(sum);
  assert.match(sum.summary, /notes app/);
  assert.equal(validateProjectSummarySelfCheck(sum.check).ok, true);

  const debtRaw = `===DISPOSITION===
- UC conflict: necessary — toast vs inline breaks acceptance

===ACTION_PLAN===
1. Decide: toast or inline error?
2. If toast: update requirements FR-2
3. Defer: leave as-is until next sprint

===FILE: .docs/requirements.md===
# Requirements
Fixed toast note.

===SELF_CHECK===
judged_against_requirements: yes
judged_against_project_spirit: yes
disposition_complete: yes
action_plan_ready_for_user: yes
`;
  const debt = parseTechDebtReviewResponse(debtRaw);
  assert.ok(debt);
  assert.match(debt.disposition, /necessary/);
  assert.match(debt.actionPlan, /Decide/);
  assert.match(debt.payloadForFiles, /===FILE:/);
  assert.doesNotMatch(debt.payloadForFiles, /ACTION_PLAN/);
  assert.equal(validateTechDebtReviewSelfCheck(debt.check).ok, true);
  const report = buildUserReportMarkdown(sum.summary, debt.actionPlan);
  assert.match(report, /What this project does/);
  assert.match(report, /action plan/i);
}

console.log("smoke:role-prompts OK");
