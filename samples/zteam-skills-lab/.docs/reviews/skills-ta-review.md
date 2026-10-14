# Analysis — skills-ta

Idea: Propose Must-deliver Anti-patterns Artefacts ONLY for YOUR role skills from .docs/skill-briefing.md. P0 webgame+crud first. No other roles. No product code.
Roles: technologyArchitect

## technologyArchitect
### ta-technologies-webgame.md
**Mission (1 line):** Define the leanest stack for high-performance webgame loops and state.
**Must deliver:**
- Game loop strategy (requestAnimationFrame vs fixed timestep).
- State management (Single Source of Truth vs Component state).
- Rendering choice (Canvas/WebGL vs DOM for UI overlays).
- Asset loading/caching strategy.
- Input handling (Keyboard/Gamepad/Touch abstraction).
**Anti-patterns:**
- Using heavy frameworks (React/Angular) for the core game loop.
- Over-engineering a physics engine when simple AABB suffices.
- Adding dependencies for basic math/vector operations.
**Artefacts:** Tech Stack Matrix, Asset Pipeline Spec.
**Ready enough?** stub→pilot

### ta-technologies-crud.md
**Mission (1 line):** Select a boring, stable stack for data persistence and API delivery.
**Must deliver:**
- DB Schema strategy (Relational vs Document based on data shape).
- API Protocol (REST vs GraphQL vs RPC).
- Validation layer (Schema-based vs Manual).
- Authentication/Authorization mechanism.
- Error mapping (HTTP codes to domain errors).
**Anti-patterns:**
- Microservices for a single-domain CRUD app.
- Using NoSQL for highly relational data.
- Custom auth logic instead of industry standards (JWT/OAuth).
**Artefacts:** ER Diagram, API Contract Template.
**Ready enough?** stub→pilot

### ta-spec-tech-webgame.md
**Mission (1 line):** Translate game design into technical constraints and interfaces.
**Must deliver:**
- Interface definitions for GameState and Entity systems.
- Overlay exclusivity logic (Modal vs HUD vs GameWorld).
- Memory management/Garbage Collection mitigation plan.
- Performance budgets (FPS targets, Load time limits).
- Save/Load serialization format.
**Anti-patterns:**
- Specifying "how" to code instead of "what" the system must handle.
- Ignoring mobile browser constraints in the spec.
- Tight coupling between rendering and game logic.
**Artefacts:** Technical Specification Document, Interface Definitions.
**Ready enough?** stub→pilot

### ta-technologies-core.md
**Mission (1 line):** Establish shared tooling and quality standards across all project types.
**Must deliver:**
- Version control and branching strategy.
- CI/CD pipeline definition (Lint $\rightarrow$ Test $\rightarrow$ Build).
- Logging and Observability standard.
- Dependency management policy (YAGNI approach).
- Environment configuration strategy (.env vs Config files).
**Anti-patterns:**
- Tooling that adds more friction than value.
- Over-complex build pipelines for simple projects.
- Inconsistent linting/formatting across roles.
**Artefacts:** Tooling Manifest, CI Pipeline Config.
**Ready enough?** stub→pilot
