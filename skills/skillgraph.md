# Skill: SkillGraph — durable proven procedures

@skill id=skillgraph
@type Skill
@status active
@graph skillgraph
@store neo4j
@related_to thinkgraph
@related_to knowgraph
@related_to codegraph

## Purpose

SkillGraph holds **reusable proven procedures, guardrails, proof patterns, and query
patterns** — durable operating skills for future agents. Store: Neo4j (a subgraph,
the least-complete of the four; its MCP read tools are deferred for later). The
source of truth is the concise `skills/*.md` files in this directory; graph metadata
(the `@skill` headers) makes them linkable later.

## Rules

- Create a skill only AFTER a useful workflow is proven — never speculatively.
- Each skill is concise: purpose, when-to-use, steps, guardrails, proof.
- No generic memory dumps, no auto-generated documentation clutter, no fake-success
  records, no task-ledger/planner state pretending to be a skill.
- Skills are written only when a procedure is intentionally distilled and approved —
  never automatically by a post-turn process.
- Files remain the source of truth; SkillGraph metadata can index them later.

## How future agents use this

Read the relevant `skills/<name>.md` before acting in that area. The four graph
skills — [[thinkgraph]], [[knowgraph]], [[codegraph]], [[skillgraph]] — define the
graph authorities and MCP boundaries; consult them before any graph read/write.
