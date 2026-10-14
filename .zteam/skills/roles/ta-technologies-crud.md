# Skill — TA technologies (crud)

**Role:** technologyArchitect · **Phase:** technologies · **projectType:** crud · **needsUiFlow:** varies · **Status:** pilot  
**Source:** team analyze `skills-ta-review.md` (2026-09-26)

## Mission
Select a boring, stable stack for data persistence and API/forms delivery.

## Must deliver
- **9-Layer Matrix profile (`crud` / `webapp`)**: `adopt` Layers **1** (UI/Forms), **3** (REST/RPC API), **5** (DB persistence; Cache/S3 `none` unless needed), **8** (Vitest + build), **9** (AuthN/Z + input validation); default `none` for Layers **2** (Edge), **4** (Queues/Temporal), **6** (Vector DB), **7** (Product AI/RAG) unless required by `userIdea`
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
