# Magentic → Coder Workflow (CBM-Driven, Filtered Visual Plan)

## Objective
Use `magentic_one` as the orchestrator that:
1. Consumes context from chat + ThinkGraph + Plan + KnowGraph + CodeGraph
2. Uses **Codebase-Memory MCP (14 tools)** for structural grounding
3. Chooses CodeGraph filters to visually scope work for the coder
4. Produces a precise coder prompt
5. Runs post-change graph pull to review and visualize what changed

---

## Desired User Experience
1. User asks for a coding change.
2. Magentic analyzes all context sources and CBM tool outputs.
3. Magentic emits:
   - coding plan
   - coder prompt
   - `codegraphViewContract` filter preset (what graph should show now)
4. UI auto-applies filters so graph visually matches plan scope.
5. Coder executes changes.
6. System performs post-change graph refresh/diff pull.
7. UI shows “before vs after” structural impact for user comprehension.

---

## Runtime Flow (High-Level)

### Phase A — Pre-plan structural localization
Magentic calls CBM tools first:
- `list_projects`
- `get_architecture`
- `get_graph_schema`
- `search_graph`
- `query_graph`
- `trace_path`
- optional: `search_code`, `get_code_snippet`

Output:
- ranked candidate files/symbols
- dependency/call-path facts
- risk/impact hypotheses

### Phase B — Plan + filter selection
Magentic composes a structured output:
- `progressText`
- `codingPlan` (ordered steps)
- `coderPrompt` (implementation task)
- `codegraphViewContract` to set UI filters

`codegraphViewContract` should include:
- `projectId`
- `nodeLabelAllowlist`
- `edgeTypeAllowlist`
- `focusPaths`
- `focusSymbols`
- `showLabels`
- `maxNodes`

### Phase C — Coder execution handoff
Coder receives:
- exact files to touch
- structural rationale
- constraints and tests
- acceptance criteria

### Phase D — Post-implementation graph review
After coder run:
- re-run CBM queries on touched zones
- pull updated layout (`/api/layout`) and structural metrics
- compare before/after for:
  - touched nodes/edges
  - changed call paths
  - dependency deltas

Magentic emits:
- `reviewSummary`
- `impactDelta`
- optional updated `codegraphViewContract` to show final result graph

---

## Filter Preset Strategy (for visual alignment)

### 1) Planning Scope preset
Use when deciding where to edit.
- Labels: `File, Module, Function, Class, Interface, Route`
- Edges: `IMPORTS, CALLS, DEFINES, HANDLES, CONTAINS_FILE`

### 2) Execution Scope preset
Use when coder is actively implementing.
- Labels: `File, Function, Method, Type`
- Edges: `CALLS, DEFINES, USAGE`
- Include strict `focusPaths` from coding plan

### 3) Review Scope preset
Use post-change for explanation.
- Labels: `File, Function, Route, Module`
- Edges: `CALLS, IMPORTS, HANDLES, WRITES, RAISES`
- emphasize touched + adjacent paths

---

## Data Contract (Magentic JSON output)

```json
{
  "selectedCardId": "card_codegraph_agent",
  "progressText": "Scoped coding plan to runtime + graph surface integration.",
  "codingPlan": [
    { "step": 1, "goal": "Confirm runtime contract path for codegraph filters." },
    { "step": 2, "goal": "Implement minimal MCP bridge and prompt routing." },
    { "step": 3, "goal": "Validate before/after graph impact." }
  ],
  "coderPrompt": "...",
  "codegraphViewContract": {
    "projectId": "C-Projects-LiquidAIty-main",
    "nodeLabelAllowlist": ["File", "Module", "Function", "Route", "Interface", "Class"],
    "edgeTypeAllowlist": ["IMPORTS", "CALLS", "DEFINES", "HANDLES", "CONTAINS_FILE"],
    "focusPaths": [
      "client/src/pages/agentbuilder.tsx",
      "apps/backend/src/v3/cards/runtime.ts"
    ],
    "focusSymbols": ["runMagenticCard", "CodeGraphSurface"],
    "showLabels": true,
    "maxNodes": 12000
  }
}
```

---

## Implementation Notes for Current Repo

### Already present
- Magentic can emit `codegraphViewContract` in runtime output.
- Agentbuilder already parses and applies `codegraphViewContract`.
- CodeGraphSurface already supports label/edge/showLabels/maxNodes filtering.

### Needed to complete vision
1. Expose CBM 14 tools to runtime tool-calls (real MCP execution bridge).
2. Add pre/post graph snapshot capture object in runtime events.
3. Add visual “before vs after” mode (or at minimum touched-zone highlight).
4. Add strict coder handoff template including structural facts + acceptance tests.

---

## Suggested Runtime Events
- `magentic_plan_scope_selected`
- `magentic_filters_applied`
- `coder_prompt_issued`
- `post_change_graph_refreshed`
- `post_change_impact_computed`

These events should carry `codegraphViewContract` and summary deltas.

---

## Success Criteria
1. Magentic always outputs a filter contract with each coding plan.
2. Graph automatically updates to match plan scope before coder starts.
3. Coder receives a deterministic prompt with scoped files/symbols.
4. Post-change graph refresh shows structural delta users can understand.
5. Users can visually confirm what changed and why.
