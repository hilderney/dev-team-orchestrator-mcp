# Analysis — skills-catalog

Idea: Analyze and discuss what must go in each Phase-9 role skill (P0 webgame + crud first). Read .docs/skill-briefing.md. Each role proposes Must-deliver, Anti-patterns, Artefacts under ### skill-file.md headings for skills they own. Do not implement product code.
Roles: systemArchitect, technologyArchitect, uiUxDesigner, softwareEngineer, qaEngineer

## systemArchitect
### Risks & Gaps

**Risks:**
- **Over-engineering the Catalog:** There is a high risk of turning these skill files into heavy manuals rather than lean checklists.
- **TDD Friction:** The "QA-red $\rightarrow$ SE-green" loop is strict; if the `qa-tdd-red` skills are too vague, the SE will spend more time guessing the test intent than coding.

**Gaps vs Requirements:**
- **State Management:** Requirements mention "overlay exclusivity" for webgames, but no specific skill currently mandates a *State Machine* or *Global Store* spec.
- **CRUD Validation:** Requirements ask for "alt paths," but `se-tdd-green-crud` needs to explicitly mandate error-state handling to avoid "happy-path-only" delivery.

**DoD Weaknesses:**
- "Ready enough?" is subjective. Without a concrete example of a "pilot" vs "stub," roles will mark things as ready prematurely.

---

### se-tdd-green-webgame.md
**Mission (1 line):** Implement game logic and UI states to satisfy failing QA tests.
**Must deliver:**
- State-driven UI updates (no direct DOM manipulation in logic).
- Overlay exclusivity (only one modal/menu active at a time).
- Frame-rate independent movement/logic (if applicable).
**Anti-patterns:**
- Hardcoding magic numbers for game balance.
- Adding "polish" (juice) before the red test is green.
- Creating new tests to make the code pass.
**Artefacts:**
- Green test report.
- Minimal working implementation.
**Ready enough?** stub $\rightarrow$ pilot

### se-tdd-green-crud.md
**Mission (1 line):** Implement API endpoints and data persistence to satisfy contract tests.
**Must deliver:**
- Input validation at the boundary.
- Explicit error responses for 4xx/5xx paths.
- Atomic database transactions for multi-step writes.
**Anti-patterns:**
- Leaking DB schema directly to the API response.
- Implementing "nice-to-have" filters before the basic CRUD is green.
- Using `try-catch` to swallow errors.
**Artefacts:**
- Green API contract tests.
- Data migration/schema script.
**Ready enough?** stub $\rightarrow$ pilot

### se-fix-core.md
**Mission (1 line):** Resolve bugs or regressions identified by QA or Delivery Critic.
**Must deliver:**
- A regression test that fails without the fix.
- The minimal code change to resolve the issue.
**Anti-patterns:**
- "Shotgun debugging" (changing 5 things to fix 1).
- Fixing the symptom instead of the root cause.
**Artefacts:**
- Diff showing the fix.
- Verified regression test.
**Ready enough?** stub $\rightarrow$ pilot

### se-delivery-critic-core.md
**Mission (1 line):** Review SE code for laziness, efficiency, and adherence to the "Boring over Clever" rule.
**Must deliver:**
- Identification of unnecessary abstractions (YAGNI).
- Suggestions for stdlib/native platform replacements.
**Anti-patterns:**
- Requesting "cleaner" code that adds complexity without value.
- Nitpicking style over logic.
**Artefacts:**
- Review comments with "Lazier Alternative" suggestions.
**Ready enough?** stub $\rightarrow$ pilot

### se-analyze-core.md
**Mission (1 line):** Break down technical specs into implementable TDD tasks.
**Must deliver:**
- Sequence of "Red" milestones.
- Identification of shared utilities to avoid duplication.
**Anti-patterns:**
- Writing implementation code during analysis.
- Over-specifying the "how" instead of the "what".
**Artefacts:**
- Implementation task list.
**Ready enough?** stub $\rightarrow$ pilot

## technologyArchitect
### Risks & Gaps
- **Risk:** The "TDD contract" is a process, not a skill. If the skill files don't explicitly define *how* to hand off (e.g., specific file formats for "red" tests), the workflow will stall.
- **Gap:** No mention of State Management in `webgame` skills. Without a shared state spec, `ux-flow` and `se-tdd-green` will diverge.
- **DoD Weakness:** "Ready enough?" is subjective. Needs a binary check: "Can a junior SE implement this without asking the SA for clarification?"

---

### se-tdd-green-webgame.md
**Mission (1 line):** Implement game logic and UI states to satisfy failing QA tests.
**Must deliver:**
- State-driven UI updates (no direct DOM manipulation in logic).
- Frame-independent movement/timers (delta time).
- Input handling decoupled from game loop.
**Anti-patterns:**
- Hardcoding magic numbers for game balance (use a config object).
- Putting game logic inside the rendering function.
- Adding "polish" (juice) before the test is green.
**Artefacts:**
- `game-state.ts` (or equivalent).
- Green test report.
**Ready enough?** stub $\rightarrow$ pilot

### se-tdd-green-crud.md
**Mission (1 line):** Implement API endpoints and data persistence to satisfy contract tests.
**Must deliver:**
- Input validation at the boundary (fail fast).
- Atomic database transactions for multi-step writes.
- Standardized error responses (consistent JSON schema).
**Anti-patterns:**
- Leaking DB schema directly to the API response.
- Business logic inside the Controller/Route handler.
- Using `try-catch` to swallow errors instead of handling them.
**Artefacts:**
- API implementation.
- Data migration script.
**Ready enough?** stub $\rightarrow$ pilot

### se-delivery-critic-core.md
**Mission (1 line):** Review code for "laziness" (efficiency) and adherence to the TDD contract.
**Must deliver:**
- Identification of over-engineered abstractions (YAGNI).
- Verification that no "gold-plating" occurred beyond the test requirements.
- Check for missing edge-case handling in the "green" phase.
**Anti-patterns:**
- Requesting "cleaner" code that doesn't change behavior or performance.
- Suggesting new dependencies for trivial tasks.
**Artefacts:**
- Review comments/checklist.
**Ready enough?** stub $\rightarrow$ pilot

### se-analyze-core.md
**Mission (1 line):** Break down specs into implementable technical tasks.
**Must deliver:**
- Sequence of implementation (dependency graph).
- Identification of "boring" vs "complex" parts.
- Mapping of requirements to specific files/modules.
**Anti-patterns:**
- Writing a full implementation plan before the TA has approved the tech stack.
- Over-specifying the "how" instead of the "what".
**Artefacts:**
- Implementation task list.
**Ready enough?** stub $\rightarrow$ pilot

## uiUxDesigner
### Risks & Gaps
- **Risk:** The "TDD contract" (QA-red $\rightarrow$ SE-green $\rightarrow$ Critic $\rightarrow$ QA-verify) is a heavy process for P0. If not strictly mapped to the skills, it will devolve into "write code then write tests."
- **Gap:** No explicit skill for "State Machine Definition." Webgames live or die by state; if the SA/UX doesn't define the state transitions, the SE will over-engineer the logic.
- **DoD Weakness:** "Ready enough?" is subjective. Needs a binary check: "Can a junior SE implement this without asking for a meeting?"

---

### se-tdd-green-webgame.md
**Mission (1 line):** Implement game logic and rendering that satisfies failing QA tests.
**Must deliver:**
- State-driven updates (Input $\rightarrow$ State $\rightarrow$ Render).
- Frame-rate independent movement/logic (delta time).
- Overlay exclusivity (e.g., Pause Menu blocks Game Input).
**Anti-patterns:**
- Putting business logic in the render loop.
- Hard-coding magic numbers for game balance (use a config object).
- Using `setTimeout` for game loops instead of `requestAnimationFrame`.
**Artefacts:**
- Green test suite.
- Minimal working game loop.
**Ready enough?** stub $\rightarrow$ pilot

### se-tdd-green-crud.md
**Mission (1 line):** Implement API endpoints and data persistence satisfying API contract tests.
**Must deliver:**
- Input validation at the boundary (fail fast).
- Atomic transactions for multi-table updates.
- Standard HTTP response codes (201 Created, 400 Bad Request, 404 Not Found).
**Anti-patterns:**
- Leaking DB schema directly to the API response.
- Putting validation logic inside the DB layer.
- "God" endpoints that do too many things.
**Artefacts:**
- Green API tests.
- Database migration/schema.
**Ready enough?** stub $\rightarrow$ pilot

### se-delivery-critic-core.md
**Mission (1 line):** Review SE-green code for "laziness" (efficiency) and technical debt.
**Must deliver:**
- Identification of unrequested abstractions (YAGNI).
- Check for stdlib/native alternatives to custom code.
- Verification that no "scaffolding for later" was left behind.
**Anti-patterns:**
- Suggesting "better" patterns that add lines of code without adding value.
- Nitpicking style over logic.
**Artefacts:**
- Review comments with specific "delete this" suggestions.
**Ready enough?** stub $\rightarrow$ pilot

## softwareEngineer
## Opinion: Risks, Gaps vs Specs, DoD Weaknesses
- **Risks**: Skill stubs remain too vague across roles → pilot gate stalls; webgame flow/overlay exclusivity gets mis-specified, causing rework; TDD contract (red→green→verify) treated as checklist rather than feedback loop, leading to “green‑but‑broken” acceptance.  
- **Gaps vs requirements**: CRUD/API skills lack explicit validation + alt‑path coverage without arcade UX pressure; webgame skills miss concrete state‑exclusivity rules; several roles have only pilot markers with no must‑deliver list, making “needs more” verdicts subjective.  
- **DoD weaknesses**: Acceptance criteria expect `### skill-file.md` sections but no enforced format for “Ready enough?”; gap‑calling out relies on reviewer memory; no lightweight mechanism to promote a stub from `stub → pilot` beyond ad‑hoc consensus.

---

## Software Engineer Skill Proposals (Phase 9 P0)
*Role: softwareEngineer | Phase: 9 | Project types: webgame, crud/API*

### se-tdd-green-webgame.md
**Mission (1 line):** Minimal TDD green loop for webgame core mechanics with state flow & overlay exclusivity.  
**Must deliver:**
- One red‑green test cycle for game‑state transitions (e.g., start → play → pause → game‑over)  
- Overlay z‑index exclusivity test (only one modal/overlay active at a time)  
- Input handling stub (keyboard/gamepad) that does not branch into arcade UX  
**Anti-patterns:**
- Building full game loop before state‑transition tests pass  
- Adding score, sound, or level‑progression code before core flow is verified  
- Ignoring overlay exclusivity, causing stacked modals that break game flow  
**Artefacts:**
- `game.test.js` with exactly 3 tests (happy‑path state change, overlay exclusivity, input passthrough)  
- State‑transition diagram (hand‑drawn or markdown) kept alongside test file  
**Ready enough?** stub → pilot (needs test runner & assertion lib setup)

### se-tdd-green-crud.md
**Mission (1 line):** TDD green for CRUD API validation + alt paths without forced arcade UX.  
**Must deliver:**
- Validation test for create payload (required fields, type constraints) using stdlib or one existing dep  
- Alt‑path tests: 400 (bad request), 404 (not found), 422 (unprocessable entity)  
- Read/update tests with edge‑case IDs (empty string, non‑numeric, max length)  
**Anti-patterns:**
- Generating full ORM/schema migration scaffold before validation tests pass  
- Coupling auth/authorization logic beyond the validation scope  
- Adding pagination or caching config before happy‑path CRUD is verified  
**Artefacts:**
- `crud.test.js` with 5 tests (create‑valid, create‑invalid, read‑valid, update‑invalid, delete‑valid)  
- Minimal validation spec (1‑page markdown) listing rules & edge cases  
**Ready enough?** stub → pilot (needs API spec or in‑memory store)

## qaEngineer
_analyze failed: [analyze:qaEngineer] stream and invoke failed: This operation was aborted | This operation was aborted_
