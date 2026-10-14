# Analysis — skills-ux

Idea: Propose Must-deliver Anti-patterns Artefacts ONLY for YOUR role skills from .docs/skill-briefing.md. P0 webgame+crud first. No other roles. No product code.
Roles: uiUxDesigner

## uiUxDesigner
### ux-juice-webgame.md
**Mission (1 line):** Add sensory feedback and polish to make game interactions feel responsive and satisfying.
**Must deliver:**
- Feedback loops for every user action (visual/audio cues).
- Tweening/easing for UI transitions (no instant snaps).
- Game-state visual indicators (active/disabled/loading).
- Particle or animation triggers for "win/loss" events.
- Input latency masking (immediate visual response before server ack).
**Anti-patterns:**
- Over-animation that obscures gameplay or slows down the loop.
- Sound effects that cannot be muted or are repetitive/harsh.
- "Juice" that hides critical state errors.
**Artefacts:** Feedback matrix (Action $\rightarrow$ Visual $\rightarrow$ Audio).
**Ready enough?** stub$\rightarrow$pilot

### ux-look-and-feel-webgame.md
**Mission (1 line):** Define the visual identity and consistent styling for the game interface.
**Must deliver:**
- Cohesive color palette (Primary, Secondary, Accent, Danger).
- Typography scale for readability across game screens.
- Consistent iconography set for game actions.
- Layout grid for responsive game canvas vs UI overlays.
- Visual hierarchy for HUD (Heads-Up Display) elements.
**Anti-patterns:**
- Using generic browser defaults for game elements.
- Inconsistent spacing/padding between different game menus.
- Color choices that fail accessibility (WCAG) contrast checks.
**Artefacts:** Style guide / Moodboard.
**Ready enough?** stub$\rightarrow$pilot

### ux-flow-webgame.md
**Mission (1 line):** Map the player journey from landing to game-over, managing state transitions.
**Must deliver:**
- State machine for screen transitions (Menu $\rightarrow$ Play $\rightarrow$ Pause $\rightarrow$ Result).
- Overlay exclusivity rules (only one modal/popup active at a time).
- Clear "Exit" and "Back" paths for every nested menu.
- Onboarding flow for first-time players.
- Critical path mapping for the core game loop.
**Anti-patterns:**
- Dead-end screens with no way to return to the main menu.
- Conflicting overlays (modals on top of modals).
- Hidden state changes that confuse the player.
**Artefacts:** User flow diagram / State transition map.
**Ready enough?** pilot$\rightarrow$ready

### ux-flow-webapp.md
**Mission (1 line):** Design efficient, intuitive navigation and task completion paths for CRUD operations.
**Must deliver:**
- Linear task flows for resource creation (Step 1 $\rightarrow$ Step 2).
- Clear validation error placement and recovery paths.
- Consistent navigation patterns (Breadcrumbs/Sidebars).
- Empty state designs for lists/dashboards.
- Confirmation loops for destructive actions (Delete/Reset).
**Anti-patterns:**
- Forcing "game-like" animations on productivity tasks.
- Deeply nested menus that hide primary CRUD actions.
- Lack of "Save" or "Cancel" clarity in forms.
**Artefacts:** Sitemap / Wireframes for core CRUD views.
**Ready enough?** stub$\rightarrow$pilot
