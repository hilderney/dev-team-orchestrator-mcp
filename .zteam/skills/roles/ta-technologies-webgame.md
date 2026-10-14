# Skill — TA technologies (webgame)

**Role:** technologyArchitect · **Phase:** technologies · **projectType:** webgame · **needsUiFlow:** true · **Status:** pilot  
**Source:** team analyze `skills-ta-review.md` (2026-09-26) + `pacman-z2` host probe update (2026-10-14)

## Mission
Define the leanest stack for high-performance webgame loops, safe chrome, and host-compatible persistence.

## Must deliver
- **9-Layer Matrix profile (`webgame`)**: `adopt` Layers **1** (Clients/Canvas/DOM) & **8** (Vitest + static build); default `none` for Layers **2, 3, 4, 6, 7** **ONLY when** `userIdea` is purely single-player local; if `userIdea` requires **account uniqueness, authentication, or global leaderboard/ranking**, `adopt` Layer **2** (light HTTP API) and Layer **5** (server persistence) instead of browser-only `localStorage`
- **Host environment compatibility (`.docs/host.json`)**: read `.docs/host.json` when present. When `hasNodeSqlite: true` or `nativeCompileLikelyOk: false`, **prefer built-in `node:sqlite` (`DatabaseSync`)** or pure-JS/WASM (`sql.js`) and **forbid `better-sqlite3` / `node-gyp` native C++ addons**
- Game loop strategy (rAF vs fixed timestep)
- State management (single source of truth vs scattered)
- Rendering choice (Canvas/WebGL vs DOM for overlays)
- Input handling abstraction
- Chrome/DOM safety (avoid flex+[hidden] traps; prefer state machine)

## Anti-patterns
- Assuming `localStorage` is sufficient when `userIdea` asks for unique accounts or global high-score rankings
- Selecting `better-sqlite3` or native C++ addons on Windows/hosts where `.docs/host.json` reports `nativeCompileLikelyOk: false` (causes `Cannot find package` in QA-red)
- Heavy SPA frameworks for the core game loop when unnecessary
- Over-engineering a physics engine when simple collision suffices

## Artefacts
- `.docs/technologies.md`
- Tech stack / asset pipeline notes
