# Compounding Knowledge Loops

## Graph-Mapped Code Search for Better Code and Faster Projects

**Status:** Pre-beta research and evaluation design  
**System:** LiquidAIty  
**Version:** 0.1, 24 August 2026

This document states a hypothesis, an architecture, and a pre-registered evaluation plan. It is not a
runtime prompt, an agent instruction file, a configuration source, or evidence that the proposed effects
have already occurred. LiquidAIty must not load this paper automatically into model context. Publication
claims remain gated on controlled tests and beta evidence.

## 1. Abstract

Coding agents repeatedly spend context and time rediscovering the same project structure, decisions,
external evidence, and execution history. Persisting everything in conversation history does not solve
the problem: prompt growth competes with relevance, source changes invalidate cached prose, and a single
memory store blurs distinct forms of authority. This paper proposes **compounding knowledge loops**, a
graph-guided development method in which verified work leaves bounded, typed evidence for later work.

LiquidAIty composes specialized open-source systems behind narrow contracts. Codebase Memory (CBM) maps
repository structure; ThinkGraph retains project reasoning; KnowGraph retains sourced knowledge and
provenance; and AgentGraph retains execution and delegation lineage. Hermes is the primary agent runtime,
while a pinned AutoGen runtime supplies selected multi-agent patterns. LiquidAIty Cards and its user
interface remain the user-owned composition surface. Exact graph references are selected into one inspectable
graph-first `in.idf` runtime input without merging graph databases or transferring their authority.

The scientific question is whether this composition improves coding outcomes cumulatively without causing
cumulative prompt growth. The engineering question is whether components remain replaceable while verified
project knowledge persists through stable identifiers and contracts. These are unproven LiquidAIty
hypotheses. The evaluation design measures discovery time, tool use, input tokens, defect recurrence,
handoff rework, decision preservation, provenance, and implementation quality. Negative results and
regressions are retained as first-class evidence.

## 2. Problem

### 2.1 Repeated rediscovery

Repository work rarely begins from zero, yet an agent often behaves as though it does. It searches for an
owner, reads adjacent files, reconstructs call paths, finds tests, and recovers architectural decisions.
Another agent or later session may repeat the same exploration. The cost is not only tool calls. Repeated
reconstruction creates new opportunities to select the wrong owner, miss a dependency, revive a rejected
design, or mistake an old description for current source.

### 2.2 Context growth is not continuity

Long prompts can preserve prose while weakening selection. A transcript intermixes current requirements,
stale implementation detail, hypotheses, failed experiments, source excerpts, and execution logs. Adding
more history therefore does not guarantee that a model receives the smallest correct context. Continuity
requires durable evidence plus a selection mechanism, not an indefinitely growing prompt.

### 2.3 Different evidence has different authority

A function-call edge, a product decision, an externally sourced fact, and a completed run are not the same
kind of record. Combining them in one undifferentiated memory creates ambiguous writers and invalidation
rules. Source structure should change when code changes. External facts require provenance and temporal
handling. Product intent requires alternatives and supersession. Execution history requires stable run and
artifact identity. The system therefore needs coordination without consolidation.

### 2.4 Handoffs lose boundaries

An agent handoff often transports a narrative summary. Narrative is useful, but it can omit the exact source
revision, graph node, selected evidence, test result, or unresolved decision. A downstream agent then cannot
distinguish a verified observation from an interpretation. The result is rework or silent drift.

### 2.5 Research objective

The proposed loop is:

```text
graph-guided code discovery
-> correct source and dependencies found faster
-> implementation and real proof
-> verified deltas returned to the correct graph authority
-> better bounded context for the next task
```

The objective is not maximum memory. It is higher reuse of verified knowledge per unit of model-visible
context, with source inspection and executable proof remaining authoritative.

## 3. Prior Work and Published Evidence

### 3.1 Structural code graphs

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) provides incremental parsing and concrete syntax
trees across programming languages. Structural indexing can turn parsed definitions and relationships into
queryable code graphs. This supplies a different retrieval primitive from filename search or embedding-only
similarity: callers, callees, imports, routes, ownership, and impact can be queried explicitly.

Vogel et al. describe [Codebase-Memory](https://arxiv.org/abs/2603.27277), a Tree-sitter-based knowledge
graph exposed through the Model Context Protocol. Their preprint reports an evaluation across 31
repositories in which the tested system achieved 83% answer quality, compared with 92% for their
file-exploration agent, while using ten times fewer tokens and 2.1 times fewer tool calls. Those numbers are
third-party results under the paper's tasks, implementation, and evaluation procedure. They are not
LiquidAIty measurements and must not be generalized to LiquidAIty before replication. The
[CBM repository](https://github.com/DeusData/codebase-memory-mcp) documents the maintained implementation,
its native graph operations, and its local persistence model.

Graph search does not replace source inspection. A graph can be stale, omit unsupported or excluded files,
misresolve a dynamic call, or return a bounded snippet that is insufficient to establish whole-function
behavior. LiquidAIty treats graph discovery as a navigation and impact accelerator; current source, focused
tests, compilation, and runtime evidence decide implementation truth.

### 3.2 Project and knowledge memory

[Engraphis](https://github.com/Coding-Dev-Tools/engraphis) is a local-first, inspectable memory system for
coding agents. [Graphiti](https://github.com/getzep/graphiti) provides a temporally aware knowledge-graph
approach for agent memory. These projects motivate durable, queryable context and temporal/provenance-aware
knowledge, but they do not establish the effect of LiquidAIty's four-authority composition.

### 3.3 Execution graphs

[Apache AGE](https://age.apache.org/overview/) adds graph capabilities to PostgreSQL. LiquidAIty uses the
relational and graph boundary to represent Card relationships and execution lineage without making the
execution graph the owner of source structure, external knowledge, or runtime decisions. This is an
engineering choice to be evaluated, not a claim of scientific superiority.

### 3.4 Agent runtimes and interoperability

The [Magentic-One paper](https://arxiv.org/abs/2411.04468) presents an open-source multi-agent system with an
orchestrator and specialized agents, including planning, progress tracking, replanning, and evaluation on
agentic benchmarks. The [AutoGen 0.7.5 source](https://github.com/microsoft/autogen/tree/python-v0.7.5)
provides the pinned runtime primitives used by LiquidAIty for selected multi-agent execution patterns.
[Hermes Agent](https://github.com/NousResearch/hermes-agent) supplies the primary persistent agent runtime.
LiquidAIty does not infer that results reported for Magentic-One transfer to its own Cards, tools, models, or
tasks.

The [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2026-07-28)
defines an interoperability boundary for exposing tools and contextual resources. MCP makes independently
implemented tools composable; it does not by itself decide which context is relevant, whether a graph is
fresh, or which system owns a fact.

## 4. LiquidAIty's Proposed Contribution

### 4.1 Compositional systems engineering

LiquidAIty's proposed contribution is a reusable composition pattern, not merely the presence of four
graphs. The method selects specialized mechanisms from different open-source stacks, preserves each
system's native authority, and integrates them at interfaces rather than rebuilding them as one framework.
Its working principles are:

1. **Bounded reuse:** adopt a proven component for the capability it already owns.
2. **Native authority:** keep writes, identifiers, and invalidation in the owning system.
3. **Minimal adapters:** translate stable contracts, not internal state or duplicated schemas.
4. **Pointer-based composition:** exchange native identifiers and bounded selections rather than copied
   subgraphs.
5. **Inspectable materialization:** record the exact context delivered to a runtime.
6. **Replaceable components:** retain project knowledge behind contracts when a component changes.
7. **Evidence-returning work:** convert verified outcomes into the appropriate authority for later reuse.

This is interface-level integration of independently useful runtimes, memory systems, graph databases,
coding tools, and user controls. The design's value depends on whether these contracts prevent duplicated
authority and whether the resulting loop improves observed work.

### 4.2 Current implementation anchors versus proposed effects

The repository contains concrete anchors for testing the proposal, including:

- CodeGraph/CBM integration and a repo-local Codex lifecycle;
- ThinkGraph storage through the project's SQLite/Engraphis boundary;
- KnowGraph storage through Graphiti/Neo4j boundaries;
- AgentGraph relationships and execution observations through Apache AGE/PostgreSQL;
- `apps/python-models/app/python_models/idf.py::materialize_idf` for canonical graph-first `in.idf`
  materialization;
- `card_domain.py::load_card_graph_reference` for bounded graph-reference loading;
- `data_anchor.py::read_codegraph_exact` for exact CodeGraph reads;
- native graph-attention and MCP-host boundaries;
- Hermes-backed saved Cards and the checked-in AutoGen 0.7.5 fork.

These anchors show that the proposal is implementable and testable. They do not prove end-to-end attribution,
token reduction, faster delivery, higher quality, or compounding improvement. Any local behavior not covered
by a recorded test or runtime observation remains a design target.

## 5. Four Distinct Graph Authorities

The graph systems coordinate through native identifiers and explicit selections. They do not become one
database.

| Authority | Owns | Does not own | Primary invalidation signal |
| --- | --- | --- | --- |
| CodeGraph / CBM | Repository files, symbols, structural relationships, callers, dependencies, change impact | Product intent, external facts, agent decisions, run control | Source and repository revision |
| ThinkGraph | Project intent, decisions, alternatives, rationale, unresolved questions | Source syntax, external factual authority, runtime execution | Explicit revision, supersession, or decision change |
| KnowGraph | Sourced external knowledge, entities, temporal claims, provenance | Project source, task routing, Card authority | Source revision, temporal validity, contradiction |
| AgentGraph | Card relationships, delegation, ownership, run/reference/artifact lineage, observed outcomes | Model intent, raw graph contents, runtime scheduling authority | Run and relationship events |

The one-writer rule is central. A graph may reference another graph's native ID, but it may not silently
copy and assume ownership of the referenced record. Cross-graph queries should return a composite view whose
members preserve source authority and provenance.

### 5.1 CodeGraph / CBM

CodeGraph provides structural navigation. A coding task can query symbols, trace impact, open the exact
current source, and identify connected tests. A clean index is disposable derived state; the repository is
authoritative. LiquidAIty's Codex-local lifecycle creates the exact project for a prompt, permits native MCP
reads while the model works, and removes the projection at safe completion. No application database or user
data participates in this lifecycle.

### 5.2 ThinkGraph

ThinkGraph stores evolving project direction: why an approach was selected, what it replaced, which
alternatives remain, and what is unresolved. A later task should receive only the relevant decision pointers
and bounded content, not the entire reasoning history. New evidence can supersede a decision without erasing
the historical chain.

### 5.3 KnowGraph

KnowGraph stores externally sourced knowledge with provenance and temporal metadata. The system should be
able to distinguish a cited primary source from a model summary and a current fact from an expired one. A
selected fact enters runtime context with its native identity and provenance.

### 5.4 AgentGraph

AgentGraph stores stable execution relationships and lineage. It can observe that a Card delegated a run,
which graph references were supplied, which artifacts were produced, and whether the run completed or
failed. It does not select agents semantically, authorize a runtime, or reconstruct private runtime state.

## 6. The Compounding Knowledge Loop

Let the distributed verified state after task `t` be:

```text
K_t = {C_t, T_t, N_t, A_t}
```

where `C`, `T`, `N`, and `A` denote records retained by CodeGraph, ThinkGraph, KnowGraph, and AgentGraph.
This notation is a logical set, not a merged database. For task `t + 1`, a selector produces bounded native
pointers:

```text
P_(t+1) subset_of IDs(K_t)
```

The runtime materializer resolves those pointers into exact, inspectable inputs:

```text
M_(t+1) = materialize(saved_card, dynamic_task, P_(t+1), effective_capabilities)
```

After execution, only verified deltas return to their owners:

```text
K_(t+1) = K_t + verified_delta_(t+1) - invalidated_records_(t+1)
```

The proposed compounding effect does not mean that every graph monotonically grows. Invalid evidence must be
superseded or removed, and CodeGraph is rebuilt from source. Compounding refers to the increasing availability
and reuse of verified, correctly owned knowledge—not accumulation without deletion.

### 6.1 Entry

A task begins with a saved Card, current dynamic input, and deliberate context selections. CodeGraph helps
locate likely structural owners. ThinkGraph supplies relevant decisions. KnowGraph supplies sourced facts.
AgentGraph supplies bounded lineage when prior execution is relevant.

### 6.2 Discovery and direct verification

The agent queries graph structure, then reads the complete relevant current source. It inspects Git state and
focused non-code configuration where needed. Graph results are hypotheses about where to look; source and
tests verify behavior.

### 6.3 Implementation and proof

The smallest coherent change is exercised with focused tests, compilation of the affected boundary, direct
rereading, persistence readback, or runtime proof proportional to risk. A successful-looking model response
is not proof.

### 6.4 Evidence return

The result is decomposed by authority. Structural changes become visible through a later CodeGraph index.
Approved design changes update ThinkGraph. New sourced facts update KnowGraph with provenance. Run outcomes,
references, and artifacts update AgentGraph. Failed tests and rejected approaches are retained where they are
needed to prevent rediscovery.

### 6.5 Next-task selection

The next task retrieves native pointers based on its actual scope. If the system works as proposed, the
fraction of relevant verified context rises while total model-visible context stays bounded. This is the
central hypothesis to test.

## 7. Bounded Context Through Graph Pointers and `in.idf`

### 7.1 Pointers before payloads

A pointer contains a native authority, stable identifier, revision or temporal qualifier when applicable,
and provenance. It is not a copied subgraph. Selection records which pointers were deliberately chosen for a
run. Hydration resolves only those records under capability and size constraints.

### 7.2 Exact runtime materialization

LiquidAIty defines one canonical graph-first UTF-8 runtime input, `in.idf`. It contains bounded selected native
graph records, references, provenance, and model-visible graph text first; stable receiving-Card context from
PostgreSQL; selected tools and effective saved grants; and finally the current dynamic mission and images.

This file is a run-scoped input, not a permanent graph authority. It makes the delivered context inspectable
and hashable. Adapters project native runtime requests mechanically from the reloaded bytes rather
than reconstructing competing payloads. The design target is byte-level identity from inspection through
dispatch and runtime consumption; this must be demonstrated by tests before it becomes a publication claim.

### 7.3 Boundedness policy

Context selection should be constrained by task scope, saved Card capabilities, explicit user selection,
authority-specific limits, and a recorded size/token budget. Boundedness must not be implemented as a hidden
keyword router that pretends to understand task semantics. Models choose meaning; deterministic code validates
identity, structure, capability, containment, limits, and hashes.

### 7.4 Auditability

For each evaluated run, the system should be able to reconstruct:

- which native references were selected;
- which revisions or validity windows applied;
- the exact `in.idf` hash and byte size;
- which runtime and saved Card consumed them;
- which tools and capabilities were effective;
- which proof artifacts and failures resulted.

This is technical auditability, not capture of private chain-of-thought.

## 8. Hermes and AutoGen Runtime Relationship

Hermes is LiquidAIty's primary persistent agent runtime for Main, Coder, and other Hermes-backed Cards. Saved
Cards own prompt, profile, provider/model, runtime binding, capability grants, and topology. LiquidAIty uses
one repo-owned adapter boundary rather than creating a second profile manager, tool catalog, memory store, or
runtime authority.

The checked-in AutoGen 0.7.5 fork supplies selected multi-agent patterns, including Magentic-One group chat,
Swarm, Society of Mind, and user-proxy primitives. AutoGen does not replace Hermes as the primary runtime, and
Hermes does not emulate AutoGen's private orchestration state. A saved runtime binding selects the appropriate
execution path. Both receive bounded inputs through LiquidAIty's Card and materialization contracts.

This relationship tests component replaceability: runtime-specific internals should remain behind adapters,
while Card identity, graph pointers, input artifacts, and observable run lineage remain stable. That
replaceability is a design target until demonstrated by contract tests and migration evidence.

## 9. Threats to Validity and Failure Modes

### 9.1 Internal validity

- **Task difficulty:** later tasks may be easier independent of accumulated knowledge.
- **Learning effects:** the human operator and models may improve during the study.
- **Model drift:** provider or model changes may dominate graph effects.
- **Cache effects:** provider caching can reduce tokens or latency without better selection.
- **Instrumentation effects:** measurement code may alter workflow or timing.
- **Unequal baselines:** graph-guided runs may receive better task specifications than controls.
- **Selective retention:** recording successes but not failures would inflate apparent compounding.

Mitigations include paired tasks, randomized or counterbalanced order, fixed model/runtime cohorts, identical
task specifications, separate cached and uncached token measures, blind quality review where feasible, and a
frozen analysis plan before outcome inspection.

### 9.2 Construct validity

Tool-call count is not equivalent to quality. Token count is not equivalent to useful context. Time to first
file is not equivalent to finding the correct owner. The evaluation therefore uses multiple measures and
requires source/test evidence for correctness labels.

### 9.3 External validity

LiquidAIty is one large, evolving Windows-centered repository with a particular owner, architecture, and tool
stack. Results may not generalize to small repositories, other languages, other models, new teams, or other
operating systems. The CBM preprint's broader repository evaluation does not eliminate this limitation.

### 9.4 Graph and lifecycle failures

- stale or divergent CodeGraph state;
- unsupported syntax, partial parsing, or excluded files;
- unresolved dynamic calls or false structural edges;
- an interrupted lifecycle deleting a newer task's graph;
- duplicate projects or inconsistent project identity;
- missing provenance or temporal invalidation;
- pointers resolving to deleted or unauthorized records;
- duplicated writers across graph authorities;
- `in.idf` reconstruction by competing adapters;
- unbounded pointer expansion;
- visual telemetry implying graph activity that did not occur.

Each failure must be visible and should fall back to direct source or explicit operator review where safe. A
CBM failure must not trigger database edits, backup proliferation, cache movement, process swarms, or an
application-level replacement search service.

### 9.5 Negative outcomes

The loop may not compound. Graph maintenance could cost more than rediscovery, stale edges could reduce
quality, pointer selection could omit essential context, or specialized components could create integration
overhead. These outcomes are scientifically meaningful and must be reported.

## 10. Pre-Registered Evaluation Plan

### 10.1 Research questions

- **RQ1:** Does graph-guided discovery reduce time to identify the correct code owner?
- **RQ2:** Does bounded graph-selected context reduce uncached and aggregate input tokens without lowering
  implementation quality?
- **RQ3:** Does returning verified deltas to distinct authorities reduce repeated searches, defects, and
  handoff rework over successive tasks?
- **RQ4:** Does the four-authority design preserve decisions, provenance, and execution lineage more
  accurately than transcript-only continuity?
- **RQ5:** Can Hermes and AutoGen remain replaceable behind narrow contracts while Card and context identity
  remain stable?

### 10.2 Hypotheses

- **H1:** Graph-guided runs have a lower median time to verified code-owner identification than matched
  source-search baselines.
- **H2:** Graph-guided runs use fewer redundant searches and tool calls.
- **H3:** Bounded pointer materialization reduces median uncached input tokens without a decrease in blinded
  implementation-quality score.
- **H4:** Later graph-guided tasks show fewer rediscovery events and repeated defects than matched controls.
- **H5:** Pointer-based handoffs preserve source identity, decisions, and provenance more accurately than
  prose-only handoffs.
- **H6:** Component-contract tests preserve Card identity and input hashes across supported Hermes and AutoGen
  paths.

All six are LiquidAIty hypotheses. Directional thresholds and statistical tests must be frozen before beta
outcomes are examined.

### 10.3 Study units and task sampling

The unit is one approved repository task with an explicit Requested Delta, Preservation Set, starting Git
revision, and acceptance proof. Tasks should be stratified by type: structural discovery, defect repair,
cross-boundary change, documentation/decision recovery, and handoff continuation. Exclude paid or destructive
missions not independently approved for the beta.

Use paired tasks or repeated task families when feasible. Counterbalance graph-guided and baseline ordering.
Record repository churn between pairs. Freeze model, reasoning effort, runtime version, tool grants, and
timeout policy within each comparison cohort.

### 10.4 Conditions

1. **Source-search baseline:** current source, focused text/file search, Git, and normal tests; no graph-derived
   selection.
2. **CodeGraph condition:** CBM structural discovery plus mandatory direct source verification.
3. **Composed-graph condition:** CodeGraph plus bounded ThinkGraph, KnowGraph, and AgentGraph pointers
   materialized through one exact graph-first `in.idf` input.

Transcript history and task specification must be held as constant as practical. The baseline must remain a
competent workflow, not an intentionally weakened control.

### 10.5 Primary outcomes

- elapsed time from task approval to verified correct owner identification;
- correctness of selected files and symbols against post-task evidence;
- number of redundant searches and total tool calls;
- uncached input tokens and aggregate input tokens;
- elapsed time from approval to verified completion;
- blinded implementation-quality score;
- repeated defect and rediscovery count over a defined later-task window;
- rework time after agent or session handoff.

### 10.6 Secondary outcomes

- preservation of explicit project decisions;
- precision and completeness of external-source provenance;
- handoff fidelity for revisions, symbols, pointers, artifacts, and unresolved questions;
- context byte size and pointer-to-payload expansion ratio;
- graph maintenance time and failure rate;
- stale/false/missing graph edge incidents;
- regression ratio in affected preservation sets;
- operator intervention count.

### 10.7 Instrumentation

Measurements should come from stable event timestamps, tool receipts, model usage records, Git revisions,
test artifacts, the `in.idf` hash, native graph identifiers, and independent review. Do not infer graph
use from answer prose or animation. Record provider caching separately. Preserve raw measurement artifacts
under access controls and publish an anonymized data dictionary with the eventual paper.

### 10.8 Analysis

Report distributions and paired effect sizes with uncertainty intervals, not only averages. Separate task
types and model/runtime cohorts. Analyze failures and regressions alongside successes. Treat missing data,
timeouts, interrupted runs, graph misses, and source-first fallbacks explicitly rather than silently dropping
them. Correct for multiple confirmatory hypotheses or identify one primary endpoint before beta.

### 10.9 Reproducibility record

For each included task, retain:

- frozen task specification and condition;
- repository revision and dirty state;
- component and model versions;
- selected native pointers;
- materialized input hashes and sizes;
- ordered tool/event trace without private reasoning;
- proof commands and outputs;
- reviewer rubric and outcome;
- deviations from protocol.

## 11. Beta Measurements and Publication Gate

The thesis is ready for public empirical claims only when all of the following are true:

1. the lifecycle and graph-selection mechanisms have end-to-end acceptance proof;
2. the evaluation protocol, outcomes, exclusions, and analysis are frozen before confirmatory analysis;
3. a sufficiently varied beta task set has been completed under comparable conditions;
4. missing, failed, interrupted, and negative runs are retained;
5. graph usage is evidenced by native query/selection events and exact runtime inputs;
6. quality is independently assessed against source and proof artifacts;
7. token results distinguish cached, uncached, and aggregate inputs;
8. effect estimates include uncertainty and do not overgeneralize beyond the sampled repository and cohorts;
9. security, privacy, licensing, and provenance review is complete;
10. the paper distinguishes third-party published results, local mechanism proof, beta observations, and
    untested hypotheses.

Until that gate is passed, acceptable statements describe architecture, mechanism, testability, and measured
local lifecycle behavior. Claims that LiquidAIty reduces tokens, accelerates delivery, improves quality, or
compounds knowledge remain prohibited.

## 12. Open-Source and Product Strategy

This section is a product and governance strategy, not a scientific result.

LiquidAIty can publish useful interface contracts, adapters, evaluation methods, and selected foundations
while differentiating through an integrated user experience, saved Card composition, operational reliability,
and carefully governed data schemas. Open-source licensing is component-specific; the project must comply with
each dependency's license and avoid presenting obscurity as scientific evidence or as a security control.

The proposed composition strategy favors:

- adopting open-source components for capabilities they already implement well;
- contributing general fixes upstream when practical;
- retaining narrow LiquidAIty adapters rather than forks without clear need;
- documenting controlled vendor divergences and their maintenance cost;
- keeping portable stable contracts around Cards, graph pointers, input files, tools, and run artifacts;
- separating public interoperability surfaces from protected operational data and product-specific schemas;
- making the top-level product valuable through coherent control, inspection, and user experience rather than
  through duplicated infrastructure.

Whether particular code, schemas, datasets, or trained assets should be public is a legal, commercial, and
community decision requiring separate review. It must not alter the evaluation protocol or the interpretation
of results.

## 13. Conclusion

Compounding knowledge loops propose a disciplined alternative to both stateless rediscovery and unlimited
prompt accumulation. The design coordinates four distinct graph authorities, exact pointer selection,
inspectable runtime inputs, and specialized agent runtimes through minimal contracts. Its intended outcome is
directional progress: each verified task should make later work easier to locate, safer to continue, and less
expensive to contextualize.

That outcome is not yet established. LiquidAIty's contribution at this stage is a concrete, falsifiable system
design and an evaluation protocol capable of distinguishing real cumulative improvement from tool novelty,
cache effects, operator learning, and selective reporting. The beta must decide whether the loop compounds.

## References

1. Vogel, M., Meyer-Eschenbach, F., Kohler, S., Grünewald, E., and Balzer, F. (2026).
   [Codebase-Memory: Tree-Sitter-Based Knowledge Graphs for LLM Code Exploration via MCP](https://arxiv.org/abs/2603.27277).
2. DeusData. [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp).
3. Tree-sitter contributors. [Tree-sitter documentation](https://tree-sitter.github.io/tree-sitter/).
4. Model Context Protocol contributors.
   [Model Context Protocol Specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28).
5. Fourney, A. et al. (2024).
   [Magentic-One: A Generalist Multi-Agent System for Solving Complex Tasks](https://arxiv.org/abs/2411.04468).
6. Microsoft. [AutoGen, Python v0.7.5 source](https://github.com/microsoft/autogen/tree/python-v0.7.5).
7. Nous Research. [Hermes Agent](https://github.com/NousResearch/hermes-agent).
8. Coding-Dev-Tools. [Engraphis](https://github.com/Coding-Dev-Tools/engraphis).
9. Zep. [Graphiti](https://github.com/getzep/graphiti).
10. Apache Software Foundation. [Apache AGE overview](https://age.apache.org/overview/).
