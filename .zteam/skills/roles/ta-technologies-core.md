# Skill — TA technologies (core)

**Role:** technologyArchitect · **Phase:** technologies · **projectType:** core · **needsUiFlow:** — · **Status:** pilot  
**Source:** team analyze `skills-ta-review.md` (2026-09-26)

## Mission
Establish shared tooling and quality standards across project types.

## Must deliver
- Stack + folder layout + standards in `.docs/technologies.md` (11 fixed H2 headings)
- **9-Layer System Design + AI Stack Matrix** (`adopt | defer | none` for: *1. Clients & Interfaces · 2. Edge, DNS & Traffic · 3. APIs & Service Layer · 4. Messaging & Workflows · 5. Data, Storage & Cache · 6. Search, Vector & Retrieval · 7. AI, RAG & Agents [product only] · 8. Eval, Compute & Deployment · 9. Security & Observability*) guided by `projectType` defaults
- Test runner / CI expectation (lint → test → build)
- Dependency policy (YAGNI — only expand `adopt` layers in detail)
- Env/config strategy

## Anti-patterns
- Tooling that adds more friction than value
- Over-complex build pipelines for simple projects
- Implementing features in the TA stage

## Artefacts
- `.docs/technologies.md`
