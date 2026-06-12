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
