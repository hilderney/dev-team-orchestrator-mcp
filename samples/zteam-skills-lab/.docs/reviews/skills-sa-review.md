# Analysis — skills-sa

Idea: Propose Must-deliver Anti-patterns Artefacts ONLY for YOUR role skills from .docs/skill-briefing.md. P0 webgame+crud first. No other roles. No product code.
Roles: systemArchitect

## systemArchitect
### sa-requirements-webgame.md
**Mission (1 line):** Define game loop, state transitions, and win/loss conditions.
**Must deliver:**
- State machine diagram (Idle → Playing → Paused → Game Over).
- Overlay exclusivity rules (e.g., Settings blocks Gameplay).
- Core loop requirements (Input → Update → Render).
- Win/Loss trigger definitions.
- Resource constraints (e.g., max entities).
**Anti-patterns:**
- Describing UI layout instead of game logic.
- Vague "fun" requirements without measurable triggers.
- Hardcoding specific levels into core requirements.
**Artefacts:** State Transition Table, Game Loop Spec.
**Ready enough?** stub→pilot

### sa-requirements-crud.md
**Mission (1 line):** Define data entities, validation rules, and API boundary contracts.
**Must deliver:**
- Entity-Relationship mapping (simplified).
- Field-level validation rules (Required, Format, Range).
- Success/Error path definitions for each mutation.
- User role permissions per endpoint.
- Data retention/deletion policy.
**Anti-patterns:**
- Specifying DB schema instead of business requirements.
- Mixing API response formats with business logic.
- Over-engineering "future" fields.
**Artefacts:** Data Dictionary, API Requirement Matrix.
**Ready enough?** pilot→ready

### sa-todo-plan-core.md
**Mission (1 line):** Decompose requirements into a TDD-sequenced execution plan.
**Must deliver:**
- Dependency-ordered task list (P0 → P1).
- Mapping of tasks to specific role skills (QA-red → SE-green).
- Definition of "Done" for each milestone.
- Risk identification for critical paths.
**Anti-patterns:**
- Creating a Gantt chart instead of a task list.
- Planning implementation before QA-red tests.
- Over-granularity (tasks < 1 hour).
**Artefacts:** Sequenced Todo List, Milestone Map.
**Ready enough?** stub→pilot

### sa-spec-write-core.md
**Mission (1 line):** Translate requirements into technical specifications for TA/SE.
**Must deliver:**
- Functional spec bridging "What" to "How".
- Interface definitions (Inputs/Outputs).
- Edge case handling specifications.
- Integration points between modules.
**Anti-patterns:**
- Writing code snippets in the spec.
- Ambiguous language ("should be fast", "user-friendly").
- Specifying the "How" (TA's job) instead of the "What".
**Artefacts:** Technical Specification Document.
**Ready enough?** stub→pilot
