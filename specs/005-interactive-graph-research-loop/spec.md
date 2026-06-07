# Interactive Graph Research Loop

## Goal
Replace scattered partial Markdown/sprawling notes with one authoritative feature spec and an executable task plan.

## Core Product Principle
ThinkGraph prepares the research.
PlanFlow controls the research depth.
Research Swarm gathers evidence.
KnowGraph earns factual memory.
Magentic-One stays fast, conversational, and coordinating.

## Primary UX
1. User chats with Magentic-One.
2. Magentic-One replies naturally and keeps chat moving.
3. A downstream graph agent processes completed chat pairs.
4. The graph view begins populating beside chat.
5. ThinkGraph and KnowGraph appear in the same graph canvas as different layers/colors.
6. ThinkGraph layer shows provisional reasoning.
7. KnowGraph layer shows source-backed evidence.
8. When the graph agent has enough structure, it emits a Research Pack.
9. Magentic-One presents the Research Pack to PlanFlow.
10. PlanFlow creates a Search Swarm Plan.
11. User edits swarm depth by adding/removing search terms, angles, or sources.
12. User approves.
13. Research Agent runs the approved Search Swarm Plan.
14. Swarm workers count down / show progress on card faces and/or PlanFlow.
15. Results stream into KnowGraph Neo4j/Python ingestion as they arrive.
16. The shared graph updates dynamically.
17. Magentic-One answers using separated ThinkGraph + KnowGraph context.

## Hard Role Boundaries

### Magentic-One
* fast chat
* route/coordinator
* explains state
* reasons with user about Research Pack and PlanFlow
* asks clarifying questions
* does not extract graph chunks
* does not populate ThinkGraph
* does not populate KnowGraph
* does not search
* does not ingest evidence

### Graph Agent
* reads completed user/assistant chat pairs
* builds provisional ThinkGraph layer
* extracts entities, relationships, claims, assumptions, risks, counterarguments, open questions, evidence-needed questions, and researchable questions
* emits Research Pack when ready
* does not perform web research
* does not store sourced evidence as fact

### Plan Agent / PlanFlow
* receives Research Pack
* creates editable Search Swarm Plan
* shows search terms, angles, source targets, depth, coverage, and missing coverage
* lets user edit swarm count/depth
* requires approval before research

### Research Agent
* runs only after approval
* executes approved Search Swarm Plan
* uses parallel search workers
* each worker has one search term/source/angle
* returns source-backed evidence/gaps/provenance
* does not write KnowGraph directly

### KnowGraph Agent / Python Neo4j Ingestion
* consumes source-backed Research Agent outputs
* ingests evidence incrementally
* stores citations, provenance, support/weakens/contradicts links, evidence gaps, entities, relationships, and properties
* rejects unsourced reasoning as fact

## Shared Graph Visualization
ThinkGraph and KnowGraph occupy the same graph canvas.
* ThinkGraph nodes/edges = provisional reasoning layer
* KnowGraph nodes/edges = sourced evidence layer
* Layers visually distinct by color/style
* User can toggle layers if simple and safe
* Evidence edges may indicate supports, weakens, contradicts, or gap
* Active traversal/agent activity can light relevant nodes/edges
* TurboFlow remains instrumentation for agent/card execution

## Visual UX
* graph populates as chat pairs are processed
* card faces show active stage/step
* swarm count is visible
* swarm worker progress is visible, e.g. 7/42 complete
* PlanFlow shows draft/approved/running/complete states
* KnowGraph updates incrementally as evidence arrives
* final answer can highlight which graph nodes/evidence were used if safe

## State Machine
```json
{
  "stage": "chatting | graph_pack_building | research_pack_ready | planflow_editing | approved_for_research | research_swarm_running | knowgraph_ingesting | dual_graph_answer_ready",
  "research_mode": "manual_approval",
  "approved": false
}
```
Manual approval is default. Auto research is future-only and must not be enabled.

## Research Pack Shape
```json
{
  "status": "shaping | research_pack_ready",
  "research_question": "",
  "entities": [],
  "relationships": [],
  "claims": [],
  "assumptions": [],
  "risks": [],
  "counterarguments": [],
  "evidence_needed": [],
  "disconfirming_questions": [],
  "search_terms": [],
  "source_targets": [],
  "missing": [],
  "why_ready_or_not": ""
}
```

## Search Swarm Plan Shape
```json
{
  "status": "draft | ready_for_approval | approved | running | complete",
  "research_question": "",
  "depth_label": "quick_scan | standard | deep_dive | custom",
  "swarm_count": 0,
  "estimated_cost_level": "low | medium | high | custom",
  "search_workers": [
    {
      "id": "",
      "label": "",
      "angle": "",
      "search_query": "",
      "source_targets": [],
      "expected_evidence": "",
      "disconfirming_focus": "",
      "priority": "low | medium | high",
      "status": "draft | approved | running | complete | failed"
    }
  ],
  "coverage": {
    "bull_case": false,
    "bear_case": false,
    "risks": false,
    "catalysts": false,
    "source_backed_claims": false,
    "disconfirming_evidence": false,
    "timing": false
  },
  "missing_coverage": [],
  "approval_required": true,
  "approved": false
}
```

## Swarm Depth
* swarm_count is a visible research-depth metric
* quick_scan = 3 to 5 workers
* standard = 8 to 15 workers
* deep_dive = 25+ workers
* custom = user-defined
* user can add/remove/edit workers before approval

## Acceptance Tests

1. Input: `test`
   * Expected: Magentic-One responds naturally; no Apollo/WHO/document ingest; graph layers remain empty/minimal; no Research Agent; no KnowGraph ingestion.

2. Input: `I want to use knowledge graphs for trading research.`
   * Expected: Magentic-One asks clarifying question; graph agent begins sparse ThinkGraph layer; no PlanFlow yet unless Research Pack is ready; no Research Agent.

3. Input: `Research ASTS vs RKLB for 6-18 month asymmetric telecom/space upside; include catalysts, dilution risk, customer concentration, and disconfirming evidence.`
   * Expected: Graph agent creates Research Pack; ThinkGraph layer populates; PlanFlow offers Search Swarm Plan; initial swarm_count visible; Research Agent does not run yet.

4. Input: `Add supplier risk, FCC/regulatory risk, dilution history, customer concentration, technical milestones, bear case, insider selling, and competitor comparison.`
   * Expected: Search Swarm Plan updates; swarm_count increases; coverage updates; Research Agent still does not run.

5. Input: `Make it a 42-worker deep dive and go.`
   * Expected: Approved plan launches or asks confirmation if cap exists; Research Agent runs approved workers; progress count visible; results stream into KnowGraph ingestion; KnowGraph layer populates.
