# MVP-FINAL — Assist-First Product Contract (Frozen Scope)

This document defines the **exact product being shipped**.
It is authoritative. Code must conform to this document.
No speculative features. No renames. No refactors unless required for compliance.

---

## 1. Product Definition

### What this is
A personal Assist experience that:
- chats with the user,
- remembers project knowledge automatically,
- and allows users to **see that memory**.

Assist Mode **is the product**.
Agent Builder exists only to improve Assist and is not user-facing.

### Who it is for
Users working inside a single project context who want:
- continuity of thought,
- persistent context,
- and an AI that improves over time without admin overhead.

### Immediate value
- Chat replies always use the project’s configured system prompt.
- Knowledge accumulates in the background without user action.
- Knowledge is visible through read-only projections.

---

## 2. Modes

### Assist Mode (Launch Mode)
- Public user experience.
- No admin UI.
- No wiring.
- No configuration.
- Stable, predictable, simple.

### Agent Builder Mode (Internal / Admin)
- Used to define and tune Assist behavior.
- Used to edit prompts and agent wiring.
- Never exposed to end users.

---

## 3. Fixed Tabs (No Additions)

Tabs are **frozen** and must not be added, removed, or renamed.

- Chat
- Plan
- Knowledge
- Links
- Dashboard

---

## 4. Tab Contracts

### 4.1 Chat

**Purpose**
Primary conversation loop.

**Assist Mode**
- Single chat thread.
- Assistant always responds using the project’s main Assist agent.
- After each assistant reply:
  - user + assistant text are ingested asynchronously.
  - ingest is fire-and-forget.
  - failures are logged only.
- Chat never blocks.
- Chat never 500s.

**Agent Builder Mode**
- Same chat loop.
- Uses the agent config currently being edited.
- Used to validate prompt changes.

**Non-Goals**
- No agent selectors.
- No model selectors.
- No ingest controls.
- No orchestration visuals.
- No debug UI.

---

### 4.2 Plan

**Purpose**
Represent intent, objectives, and narrative planning.

**Assist Mode**
- Wiki-style narrative.
- Freeform notes and objectives.
- Lightweight approval/status only.
- No execution semantics.

**Agent Builder Mode**
- Prompt and agent construction surface.
- Role / goal / constraints / instructions.
- Agent UI exists **only here**.

**Non-Goals**
- Not a task runner.
- Not a workflow engine.
- No agent configuration UI in Assist.

---

### 4.3 Knowledge

**Purpose**
Read-only projection of accumulated knowledge.

**Assist Mode**
- Graph visualization (MiniForce).
- “Load project subgraph” action.
- Passive exploration only.

**Explicitly Forbidden**
- No Cypher input.
- No Run button.
- No query results tables.
- No ingest controls.
- No schema editing.
- No metrics dashboards.

**Agent Builder Mode**
- Same projection.
- Optional lightweight diagnostics (e.g. last ingest counts).
- Still no admin query UI.

**Deferred (Not MVP)**
- Mind map view.
- Radial view.
- Hierarchical view.
- Timeline / time-series.
- Map view.
- Candlestick view.

All are alternate lenses on the same data and come later.

---

### 4.4 Links

**Purpose**
Surface sources that feed knowledge.

**Assist Mode**
- Displays connected sources.
- Shows status and recent activity.
- Read-only.

**Agent Builder Mode**
- Data source wiring.
- MCP / API / schema definitions.
- Effects on Assist only when explicitly wired.

**Non-Goals**
- Not a prompt editor.
- Not a workflow editor.

---

### 4.5 Dashboard

**Purpose**
Make the system feel alive and attentive.

**Assist Mode**
- Single agent-generated summary artifact:
  - what changed,
  - what matters,
  - current focus,
  - suggested next actions.
- Read-only.

**Agent Builder Mode**
- Preview and debug of dashboard-style agent output.

**Non-Goals**
- No controls.
- No orchestration UI.
- No charts as inputs.

---

## 5. Core Loop (Non-Negotiable)

1. User sends message.
2. Assist agent responds (system prompt always attached).
3. Fire-and-forget ingest of user + assistant text to graph + vectors.
4. Knowledge tab reflects accumulated memory.
5. UI never blocks on background work.

---

## 6. Agent Scope (MVP)

Exactly two agents exist in MVP:

1. Assist Main Agent (`llm_chat`)
2. Knowledge Ingest Agent (`kg_ingest`)

**Explicitly Excluded**
- Orchestrators
- Research swarms
- Judges
- Auto-generated agent graphs
- Model marketplaces

---

## 7. Stability Rules

- Assist chat must never crash.
- Missing configuration returns clear 4xx/409, never 500.
- Background failures are log-only.
- No background work blocks foreground UX.
- Tab structure and naming are frozen for MVP.

---

## 8. Deferred Work (Post-Launch Only)

- Prompt graphs and version graphs.
- Advanced knowledge lenses.
- Multi-agent orchestration.
- Automated agent builders.
- Interactive dashboards.

These must not be partially implemented in MVP.

---

## 9. Current State Alignment

As of latest commit:
- Assist chat loop is stable.
- System prompt attachment works.
- Fire-and-forget ingest works.
- Mode split enforced.
- Knowledge tab is read-only graph.
- Project drawer is stable.

**Remaining MVP gaps**
- Plan tab in Assist should read as narrative, not task list.
- Links tab needs explicit Assist-mode framing.
- Knowledge internal Cypher state must remain hidden.
- Dashboard summary artifact should replace placeholder grid.

End of contract.

## 3. Tabs (fixed set: Chat, Plan, Knowledge, Links, Dashboard)

### Chat
- **Purpose:** Primary conversation loop.
- **Assist behavior:** Single chat thread; assistant replies using the project’s main agent system prompt. After each reply, ingest (user + assistant text) fires asynchronously; failures only log; chat never blocks.
- **Agent Builder behavior:** Same loop, but uses the agent config being edited for validation. No multi-agent fan-out here.
- **Non-goals (MVP):** No agent/model selectors, no ingest controls, no debug UI, no orchestration visuals.

### Plan
- **Purpose:** Intent/plan artifact.
- **Assist behavior:** Wiki-style plan/notes representing objectives; lightweight status/approval only.
- **Agent Builder behavior:** Prompt and agent construction surface (role/goal/constraints/etc.). Agent UI exists only here.
- **Non-goals (MVP):** No task runner, no workflow editor, no agent config UI in Assist.

### Knowledge
- **Purpose:** Read-only projection of accumulated knowledge.
- **Assist behavior:** Graph visualization (MiniForce) with “Load project subgraph”; passive exploration only. No Cypher box, no run button, no results table, no ingest controls, no schema editing, no metrics soup.
- **Agent Builder behavior:** Same projection; optional lightweight diagnostics (e.g., last ingest summary). No admin query UI, no schema editing.
- **Non-goals (MVP):** Mind map/radial/hierarchical/timeline/map/candlestick views (deferred); no mutation controls.

### Links
- **Purpose:** Surface connected data sources/evidence.
- **Assist behavior:** Shows sources, status, and activity. No agent config or workflow editing.
- **Agent Builder behavior:** Wiring/data-source definitions (MCP/APIs/schemas). Effects on Assist only when explicitly wired.
- **Non-goals (MVP):** Not a prompt editor, not a workflow editor.

### Dashboard
- **Purpose:** Read-only summary artifact that makes the system feel alive.
- **Assist behavior:** Agent-generated summary of what changed, what matters, current focus, suggested next actions. No controls.
- **Agent Builder behavior:** Preview/debug of dashboard-style agent output.
- **Non-goals (MVP):** No charts as inputs, no controls, no orchestration UI.

## 4. Chat + Knowledge Loop (Core Loop)
1) User sends message.
2) Assist agent responds (always with system prompt attached).
3) Fire-and-forget ingest of user+assistant text to KG + vector; never blocks chat; failures log only.
4) Knowledge tab reflects accumulated memory (projection-only).
5) No hidden blocking steps; chat always returns a reply.

## 5. Agent Scope (MVP)
- **Exactly two agents:**
  - Assist Main Agent (llm_chat) for chat responses.
  - Knowledge Ingest Agent (kg_ingest) running asynchronously after replies.
- **Explicitly excluded:** Orchestrators, swarms, researchers, judges, auto-generated agent networks.

## 6. Stability Rules
- Chat must not 500; missing config returns clear 4xx/409 without crashing.
- Ingest failures never block chat; log-only.
- No background work may block foreground UX.
- Keep existing tab structure and naming; no renames in MVP.

## 7. Explicitly Deferred Ideas (not in MVP)
- Prompt graphs/version graphs.
- Mind map / radial / hierarchical / timeline / map / candlestick lenses.
- Agent swarms, researchers, judges.
- Orchestration visuals, research swarms, dashboards with controls.

## 8. Current State Summary (ground truth)
- Assist chat loop stable; system prompt attached; ingest fire-and-forget; 500 resolved.
- Mode split enforced; Agent UI only in Agent Builder.
- Tabs fixed (Chat, Plan, Knowledge, Links, Dashboard) with stable navigation.
- Knowledge tab: read-only graph, no ingest controls, ageRowsToGraph adapter preserved.
- Project drawer stable; createProjectPrompt restored.
- Gaps to finish: Plan tab in Assist should be wiki-style narrative (not task list), Links needs explicit behavior write-up, Knowledge internal Cypher state should remain hidden, Dashboard should be summary artifact (current grid is placeholder).
