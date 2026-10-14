# Skill — TA technologies (backend)

**Role:** technologyArchitect · **Phase:** technologies · **projectType:** backend · **needsUiFlow:** false · **Status:** pilot

## Mission
Pick routes, persistence, authz, and contract testing approach with a lean 9-Layer backend profile.

## Must deliver
- **9-Layer Matrix profile (`backend`)**: `adopt` Layers **3** (API/Service layer), **5** (DB/Cache/Storage as needed), **8** (Vitest + runtime/Docker), **9** (AuthN/Z, secrets, structured logs/OTel); Layer **1** = `none` (headless API); default `none` for Layers **2, 4, 6, 7** unless `userIdea` requires Edge/Gateway, Queues/Workflows, Vector search, or Product AI/RAG
- API layout + persistence
- Authz middleware pattern
- Contract test tooling

## Anti-patterns
- Front-end SPA stack for pure API
- Skipping failure contracts

## Artefacts
- .docs/technologies.md
