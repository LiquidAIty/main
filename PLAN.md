# Bootstrap Self-Build Plan

## Current Phase

Outside-loop bootstrap planning. ChatGPT plans, Codex scouts and scaffolds, and FableCoder
implements bounded CodeTaskPackets. ThinkGraph receives task memory; CodeGraph supplies repo
structure; KnowGraph supplies reusable validated knowledge.

`PLAN.md` is the living full route. Specs define durable parts of that route. Skills are the
durable progressive-work memory.

ChatGPT or the future UI planner writes PLAN/spec intent. A prompt remains raw intent until real
work begins. Codex or another middle scout reads PLAN, relevant specs, relevant skills, and fresh
CBM, then attaches the bounded attempt to a matching one-file skill or creates the smallest useful
new skill stub. Fable executes the attempt and writes result, proof, and CBM-after evidence into
that skill.

Success updates reusable procedure, proof, example, validation, and query metadata. Failure updates
failed-attempt, guardrail, and bounded-retry metadata. Fresh CBM every time is the freshness
mechanism. Code examples are retrieved fresh by CBM/CodeGraph query; raw diffs are not durable
memory.

## Skill Knowledge Route

Skills are authored as graphable Markdown in `skills/*.md`. Skills and their active attempts,
failed attempts, guardrails, decisions, reasoning receipts, proof claims, validations, and query
patterns live in KnowGraph / Neo4j for now. KnowGraph stores current known skill knowledge,
including in-progress learning attempts.

ThinkGraph is reserved for later UI and frontside planning memory. CodeGraph / CBM remains the
source for current code structure, files, symbols, call paths, and code evidence.

Before writing a Fable attempt, the planner or Codex uses KnowGraph skills together with fresh
CodeGraph / CBM evidence. Fable receives the required skills, guardrails, relevant failed attempts,
proof requirements, and query-ready examples. Successful and failed attempts update KnowGraph
skill memory.

## Current 11-Day Fast Build Route

LiquidAIty is an agent workbench where the system writes better prompts from graph context, sends
bounded work to coder agents, and learns from every attempt.

AutoSkill turns AI-edited repos into learning repos: every run can produce or update reusable
skill memory so future agents avoid repeated mistakes.

Core spine:

1. User asks in the UI.
2. Sol / Magentic-One front-door planner interprets the ask.
3. SkillGraph retrieves learned memory.
4. CodeGraph/CBM retrieves fresh code evidence.
5. ThinkGraph provides current project route/reasoning.
6. KnowGraph provides broader research/knowledge when relevant.
7. Prompt writer builds a bounded handoff.
8. Fable/OpenClaude-style coder executes.
9. Result/failure/proof writes back into skills.
10. Graphs re-index.
11. Next attempt starts smarter.

Runtime route stays fixed: the UI front door is unchanged; Sol / Magentic-One orchestration
remains the front-door workflow; cloud/API models are the normal backend with local Qwen 7B as
the fallback when no API/internet/billing is available or the user chooses local; the AutoGen
Python sidecar remains the real agent runtime rail; ReactFlow/TypeScript remains the control
plane; the Fable/OpenClaude-style coder is reached only through bounded handoffs
(`specs/magentic-one-autogen-runtime-spec.md`).

Feature direction: the prompt writer is a product surface, not a side effect. The UI should
eventually show and let the user edit the generated handoff before execution. The generated
handoff is not just text; it is graph-backed context
(`specs/graph-context-prompt-writer-spec.md`).

Architecture rule: do not physically merge CodeGraph, SkillGraph, ThinkGraph, and KnowGraph yet.
Create clean graph context contracts and packets. Storage can differ underneath. Agents consume
packets and tools, not raw databases.

Graph roles stay separated: SkillGraph holds learned attempts, failures, guardrails, decisions,
proof requirements, and query patterns; CodeGraph/CBM holds fresh code evidence; ThinkGraph holds
project reasoning and the current route (`specs/thinkgraph-planning-memory-spec.md`); KnowGraph
holds broader knowledge, research, and public skill imports. Skill creation follows
`specs/autoskill-policy-spec.md`.

Retrieval roadmap note: Neo4j full-text/vector/GraphRAG retrieval remains planned. MVP retrieval
stays deterministic for now. Semantic SkillSection retrieval should be added after the first full
learn loop works. This feature stays on the roadmap.

## Later Acceleration

* Future agent: GitHub Skill Scout. Purpose: scrape open-source public skills, repos, prompts,
  and patterns, import inspiration into KnowGraph, and help write better local skills. Not in the
  immediate implementation pass; it belongs after local SkillGraph retrieval and the
  prompt-writer loop prove useful.

## Build Order

* Establish Code-Based Memory as the first foundational reusable skill.
* Ingest graphable Markdown skills into KnowGraph / Neo4j through a deterministic host-source
  importer and provide a minimal skill listing query.
* Establish TaskRealm, CodeTaskPacket, and SemanticReport formats.
* Execute `tasks/active/T001-bootstrap-codegraph-thinkgraph.md` to restore a real CodeGraph
  planning-context reader.
* Persist SemanticReports as ThinkGraph-style task memory.
* Feed ThinkGraph, CodeGraph, and KnowGraph context into planner prompts.
* Move planning into the UI.
* Replace the Codex middle-scout role with LocalScout.

## Foundational Skill

Every code task begins with fresh CBM and refreshes CBM again after changes. Completed tasks may
produce query-ready, graph-backed SkillExamples so future agents can retrieve the current code
pattern without relying on stale paths, raw diffs, or completed-task log piles.

Reusable completed tasks move into matching skill examples. Non-reusable results become
graph/semantic memory. Future agents, including cheap/local agents, query matching skills before
doing bounded work so they do not rediscover the process.

Skills are one-file graphable Markdown artifacts by default. They may contain OWL-ish graph lines,
query patterns, proof metadata, and compact completed-task lessons. Current code examples are
retrieved fresh from CBM/CodeGraph by query. Separate JSON, example, or query files are unnecessary
for one skill unless a future importer/exporter explicitly generates them.

## Skill Graph Compounding

Skills are the durable continuity layer for progressive code work. Every successful code task must
create or update a graphable skill connected to its specs, source task, touched CodeGraph nodes,
changed files/symbols, proof claims, validation commands, and related skills.

Before creating a real implementation attempt, the middle scout searches skills using the user
prompt, relevant specs, fresh CBM graph structure, touched subsystem, guardrails, and related
skills. A matching skill receives the bounded attempt. If none match, the middle scout creates the
smallest useful one-file skill stub and appends the attempt there.

Future planner and frontend use GraphRAG over PLAN, specs, skills, and fresh CodeGraph evidence:

1. Receive the user prompt and read PLAN/spec intent.
2. Refresh CBM and find relevant CodeGraph nodes/files/symbols.
3. Query the skill graph for matching skills and proven patterns.
4. Append a bounded attempt to the matching skill or create a short skill stub.
5. Give Fable the bounded skill attempt.
6. Update the skill with success or failure evidence.

This lets cheap/local agents execute bounded work without rediscovering repo-specific workflows.
The first real attempt is `knowgraph-skill-ingestion.prepare-001` in
`skills/knowgraph-skill-ingestion-skill.md`.

## Prepared Future Work

`tasks/active/T001-bootstrap-codegraph-thinkgraph.md`: restore CodeGraph context enough for
evidence-grounded planning without implementing the later autonomous runtime. It is not executed or
treated as a new attempt by this process-normalization pass.

## Deferred Work

UI planning, LocalScout, a local coding runner, full autonomous execution, marketplace work, a giant
graph UI, and broader runtime changes are deferred.
