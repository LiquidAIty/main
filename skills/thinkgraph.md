# Skill: ThinkGraph — directional project reasoning

@skill id=thinkgraph
@type Skill
@status active
@graph thinkgraph
@store apache-age
@related_to knowgraph
@related_to codegraph
@related_to skillgraph

## Purpose

ThinkGraph is the **user-visible directional project reasoning map**: a context
compactor and stable pointer/index over the project's questions, hypotheses,
decisions, constraints, query seeds, unresolved entities, rejected paths, and
research actions. It is NOT a transcript summary, a second KnowGraph, or a place
for private chain-of-thought. Store: Apache AGE (`thinkgraph_liq`), `:ThinkNode` +
`:THINK_EDGE`. Accessed only through MCP.

## Authority

- The **Harness** (normal project chat) WRITES ThinkGraph, only through `thinkgraph.apply_delta`.
- The Harness READS ThinkGraph and selected KnowGraph slices through MCP read tools.
- Mag One, research agents, and post-turn SLM summarizers NEVER write ThinkGraph.
- Old PlanFlow / Mission / Task Ledger paths NEVER write ThinkGraph.

## MCP tools (Harness-only)

Read: `thinkgraph.get_slice`, `thinkgraph.search`, `thinkgraph.get_open_questions`,
`thinkgraph.get_query_seeds`, `thinkgraph.get_decisions`, `thinkgraph.get_rejected_paths`.
Write: `thinkgraph.apply_delta` (the ONLY durable writer).

## Node classes

Question, Hypothesis, Entity, UnresolvedEntity, QuerySeed, Constraint, Decision,
ResearchAction, RejectedPath, KnowGraphReference.

## Edge predicates (typed, directional)

suggests, requires_verification, depends_on, contradicts, supports, refines,
replaces, answers, blocks, leads_to, rejected_because, investigates, references.

## Rules

- Write only when a useful project concept emerges (question, query seed, hypothesis,
  decision, constraint, unresolved entity, rejected path, research action, relationship).
- Do NOT write every chat turn. Do NOT dump the transcript.
- Concise, user-readable notes only — never raw private reasoning.
- Never promote speculation into KnowGraph; use a `KnowGraphReference` to point at evidence.
- `apply_delta` carries provenance (projectId, conversationId, turnId, userMessageId,
  assistantMessageId, origin=harness_chat, timestamp, deltaId) and is idempotent per
  projectId+turnId+deltaId. The tool validates integrity only — YOU decide meaning.
- Use stable `think:<id>` refs and bounded slices for later research handoff to Mag One.
