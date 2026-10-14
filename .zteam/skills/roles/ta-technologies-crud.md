# Skill — TA technologies (crud)

**Role:** technologyArchitect · **Phase:** technologies · **projectType:** crud · **needsUiFlow:** varies · **Status:** pilot  
**Source:** team analyze `skills-ta-review.md` (2026-09-26)

## Mission
Select a boring, stable stack for data persistence and API/forms delivery.

## Must deliver
- Persistence strategy matching data shape
- API protocol choice (REST/GraphQL/RPC as fit)
- Shared validation layer location
- Authn/z mechanism when in scope
- Error mapping (HTTP/domain)

## Anti-patterns
- Microservices for a single-domain CRUD app
- Custom auth instead of standard JWT/OAuth when standards fit
- Per-form copy-paste validation with no shared schema

## Artefacts
- `.docs/technologies.md`
- ER / API contract template notes
