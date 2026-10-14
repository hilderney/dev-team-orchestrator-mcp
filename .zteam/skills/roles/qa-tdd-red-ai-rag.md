# Skill — QA TDD red (AI / RAG / Agents)

**Role:** qaEngineer · **Phase:** tdd-red · **projectType:** ai-rag | ai | rag · **needsUiFlow:** false · **Status:** pilot

## Mission
Write failing unit and contract tests for product AI, RAG retrieval, and agent tool-calling specs (Layers 6–8) using deterministic mocks — before SE implements.

## Must deliver
- Deterministic mock/stub for the LLM or embeddings provider (never hit live external APIs in unit tests)
- Failing tests for retrieval/context assembly (top-k, empty retrieval fallback, citation/source mapping when in spec)
- Failing tests for structured output schema validation and provider error/timeout fallback
- Do **not** mark todos `[x]`

## Anti-patterns
- Live network calls to OpenAI/Claude/Gemini/Pinecone during `npm test`
- Asserting exact free-form prose instead of schema/contract invariants
- Implementing the RAG pipeline or prompt handler in the red stage

## Artefacts
- `**/*.{test,spec}.*` failing until SE green
