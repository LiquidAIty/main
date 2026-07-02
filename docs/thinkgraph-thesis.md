ThinkGraph × KnowGraph
Corrected Thesis: A Persistent, Model-Mediated Epistemic Graph System for LiquidAIty
Status: Design thesis and verification standard.  
It is not evidence that any implementation currently exists, works, or is connected to the live Harness.  
Implementation claims require live end-to-end proof from a real user message through the actual Harness tool path.
---
1. Thesis
LiquidAIty should use two distinct but connected project graph systems:
ThinkGraph is the persistent, user-visible working model of a project: accumulated discourse structure, model-proposed interpretations, questions, alternatives, constraints, unresolved contradictions, and user corrections.
KnowGraph is the source-bound evidence graph: external entities, sources, evidence spans, contextual assertions, dates, provenance, identity resolution, and contradictions.
They are not duplicates and they must never be silently merged.
ThinkGraph is deliberately provisional. It is allowed to contain multiple possible interpretations, incomplete associations, emerging categories, and branches not yet connected to the current objective.
KnowGraph is evidence-bound. It does not make a source-backed assertion merely because a model stated something fluently.
The product loop is:
```text
real project conversation and agent activity
        ↓
ThinkGraph: observed discourse structure + provisional statements
        ↓
user selects graph references and scope
        ↓
future Plan: an approved graph-pointer/context bundle
        ↓
future research / Mag One
        ↓
KnowGraph: sources, evidence, contextual assertions
        ↓
Harness + user evaluate evidence against prior ThinkGraph
        ↓
revised ThinkGraph
```
The organizing principle is epistemic revision through a graph, not a fixed taxonomy, not a task ledger, and not an animated chatbot skin.
---
2. Non-negotiable integrity rules
2.1 No fake graph behavior
The following are prohibited as product behavior:
```text
manual replay scripts that invent graph deltas
hand-authored seed payloads presented as model extraction
direct database inserts presented as a normal chat result
fixtures presented as live project memory
browser-created semantic nodes or browser-computed project meaning
regex/noun extraction presented as model understanding
a manual stock-thesis graph presented as graph growth from live chat
```
A plumbing test may use test data, but it must be labeled exactly as a test and must never be mixed into production project memory, topology analysis, routing, training data, or user-facing “live graph” claims.
2.2 No deterministic schema masquerading as emergence
TypeScript may enforce transport shape, stable IDs, idempotency, authentication, and database integrity.
TypeScript must not decide:
```text
what a project concept means
which words become meaningful resources
which concepts co-occur semantically
which relationship is true
which category a resource belongs to
which node is important
which branch should be retained
what a cluster means
```
No fixed business taxonomy, enum gate, strict OWL whitelist, TTL gate, regex classifier, or frontend adapter is the semantic authority.
2.3 No co-occurrence equals causality mistake
Observed discourse co-occurrence means only:
```text
these resources were placed together by a model
inside a bounded, provenance-linked local context
```
It does not mean:
```text
causes
depends on
is owned by
is partnered with
is evidence for
is factually true
```
A causal, strategic, financial, or factual claim must be represented as a separate provisional statement or a KnowGraph evidence-bound assertion.
2.4 No visual cosmetics before live truthfulness
A stable, attractive graph built from manually invented deltas remains misleading.
Before topology metrics, 3D, Graphify integration, cluster colors, bridge halos, or visual polish, prove:
```text
real user message
→ real completed visible assistant answer
→ real bounded model subagent
→ real Harness tool path
→ real thinkgraph\_apply\_delta call
→ real AGE delta
→ real existing graph view update
```
---
3. What ThinkGraph is
ThinkGraph is a persistent, model-mediated discourse and reasoning graph.
It has two relation layers over shared resources.
3.1 Observed discourse layer
The observed layer accumulates how meaningful project resources recur together across real conversation and agent-visible artifacts.
It can capture:
```text
a resource was mentioned in a bounded user context
a resource was mentioned in a bounded assistant-answer context
two resources were placed together within a model-chosen local context
a resource recurred across conversation
a resource appeared in user language, assistant language, or tool output
a resource is associated with a selected objective or graph pointer
```
This layer is conceptually similar to an InfraNodus-style discourse network, but it is not a blind word network.
The model chooses the meaningful resources and the local context boundaries. The system records those observations with provenance.
3.2 Interpreted reasoning layer
The interpreted layer contains model- or user-proposed, reviewable semantic commitments:
```text
candidate relationship
question
assumption
uncertainty
alternative explanation
contradiction
evidence requirement
research direction
constraint
revision
rejection
user correction
```
These are not truth claims by default.
They are first-class contextual statements when they need their own provenance, review, time scope, uncertainty, contradiction, or future evidence linkage.
3.3 Persistent branches and disconnected components
ThinkGraph persists across the project. A branch is not deleted merely because it was absent from the last answer.
A disconnected component can represent:
```text
an alternate thesis
an emerging theme
a future research branch
a recurring pattern not connected to the active objective
a structural gap
a user idea that lacks evidence or a semantic bridge
```
Disconnected does not mean false, irrelevant, hallucinated, or disposable.
It means no current stored path connects the component to the selected objective, evidence context, or another active graph region.
---
4. The model-mediated graph update contract
The graph must be produced by a real bounded model capability, not by a deterministic extraction pipeline.
4.1 Primary interaction
```text
user sends a substantive project message
        ↓
normal Harness streams the visible answer first
        ↓
when the visible answer is complete,
a bounded ThinkGraph subagent receives:
- user message
- completed visible answer
- bounded active ThinkGraph slice
- selected graph pointers, when present
- actual project / conversation / turn identifiers
        ↓
subagent produces one compact graph delta or no\_patch
        ↓
existing authenticated Harness tool path calls thinkgraph\_apply\_delta
        ↓
AGE persists the delta
        ↓
existing graph projection refreshes from AGE
```
The graph update may arrive just after the answer completes. It must not delay time-to-first-text.
4.2 The subagent decides the semantics
The subagent decides:
```text
which resources matter
which local contexts are meaningful
which observed co-occurrences are worth recording
whether a candidate statement is useful
which semantic term is proposed or reused
whether no graph update is warranted
```
The graph infrastructure only validates structural integrity and writes the model output.
4.3 `no\_patch` is a valid result
No graph update should be created for trivial interaction:
```text
greeting
PONG
test
format-only request
generic acknowledgement
duplicate content
tool chatter
boilerplate
```
This must be decided by the subagent's semantic judgment, not by a brittle hard-coded keyword list.
4.4 Full runtime proof required
A claimed live ThinkGraph feature is not complete until one real user-authored message produces evidence of all of the following:
```text
primary answer streamed
bounded ThinkGraph subagent invoked
actual tool list exposed to that subagent
actual thinkgraph\_apply\_delta request
actual authenticated MCP/tool transport request
actual AGE delta ID
before/after graph counts
new stored resource/context/statement refs
existing graph view updated from those refs
```
A replay script, direct DB write, fixture, or manual tool invocation cannot satisfy this proof.
---
5. The data model: mechanics versus meaning
The system needs a small structural floor. It does not need a hard-coded domain ontology.
5.1 Structural graph primitives
These are implementation mechanics, not a business taxonomy:
```text
Resource
DiscourseContext
Statement
SemanticTerm
Pointer
Review
Provenance
Version / Snapshot
EvidenceReference
AgentActivity
```
A physical property-graph implementation may use labels such as `ThinkNode`, `Statement`, or `DiscourseContext`. Those labels are storage mechanics and must not become a rigid semantic menu.
5.2 Resource
A Resource is a graph-addressable concept, entity, objective, phrase, question target, artifact, or other item the model considers meaningful.
Stable mechanics may be properties:
```text
stable ID
project ID
label
created timestamp
updated timestamp
origin
canonical text
deduplication key
```
Semantic classification must be graph-native and revisable:
```text
Resource
→ hasCandidateClass
→ SemanticTerm
```
More than one candidate class may coexist.
5.3 DiscourseContext
A DiscourseContext references a small, model-chosen local region of a real artifact.
It must preserve:
```text
project reference
conversation reference
message reference
assistant-message reference when applicable
turn reference
speaker / origin
context type
bounded source span or section reference when available
time
```
A discourse context is the durable audit path explaining why a resource or co-occurrence observation exists.
5.4 Observed co-occurrence
The durable explanatory layer is:
```text
DiscourseContext
→ mentions
→ Resource
```
A cumulative `coOccurredWith` relationship may be materialized for traversal and visualization, but it is derived from stored local contexts.
It needs:
```text
aggregation version
observation count
first observed
last observed
latest context reference
source/origin counts
derivation references or reproducible context query
```
It must always be possible to answer:
```text
Why are these two resources connected?
Which actual contexts produced this connection?
Was this connection user-derived, assistant-derived, or tool-derived?
```
5.5 Contextual statements
A Statement is used when the relationship itself needs identity and context.
```text
Statement
→ statementSubject → Resource
→ statementPredicate → SemanticTerm
→ statementObject → Resource or value resource
→ derivedFrom → DiscourseContext
→ proposedBy → AgentActivity or user reference
→ hasReview → Review
→ hasTimeScope → Context, when relevant
→ hasEvidenceReference → EvidenceReference, later
```
This is the form for:
```text
“ASTS may be affected by launch availability”
“this claim requires evidence”
“this branch conflicts with a prior assumption”
“this is an alternate thesis”
```
A direct edge is fine when it is simple, structural, and does not need independent provenance or lifecycle.
5.6 SemanticTerm and emergent ontology
A SemanticTerm represents a proposed or adopted class, predicate, property, category, alias, mapping, or lifecycle term.
A term is a graph resource with:
```text
label
kind
definition when supplied
provenance
review state
aliases / lexicalizations
relations to the contexts and resources that motivated it
external mappings only when later useful
```
Terms may be proposed, reused, refined, merged, split, deprecated, rejected, or adopted through graph-native review.
No model term becomes universal law merely because it appeared once.
---
6. ThinkGraph and KnowGraph are different epistemic systems
6.1 ThinkGraph
ThinkGraph holds:
```text
observed discourse patterns
candidate relations
working questions
objectives
user corrections
alternative branches
uncertainties
evidence needs
reviewable model interpretation
```
It may be wrong. It may be contradictory. It may be incomplete.
6.2 KnowGraph
KnowGraph holds source-bound evidence and source-scoped assertions:
```text
source
source span
extracted entity
source-backed assertion
date / time scope
provenance
review state
contradiction links
identity resolution
```
KnowGraph is not “absolute truth.” It is the operational evidence base under recorded source and context.
6.3 Identity is not careless equivalence
Do not collapse these into one entity:
```text
organization / issuer
security instrument
ticker symbol
brand name
alias
legal entity identifier
```
For example:
```text
Organization
→ issuedSecurity
→ Security

TickerSymbol
→ identifiesSecurity
→ Security

Alias
→ labels
→ Organization
```
Use strict equivalence only when identity has actually been resolved under the right semantics.
6.4 Evaluation loop
The evaluator is not OWL and is not the same model scoring its own answer in isolation.
```text
prior ThinkGraph statement
+ newly returned KnowGraph evidence
+ Harness evaluation
+ user judgment
        ↓
support
weaken
qualify
split
refine
reject
supersede
preserve unresolved
```
The revised result becomes new ThinkGraph graph data with provenance.
---
7. Reasoning traces: useful sidecar, not graph truth
Provider reasoning traces can be useful for debugging, teaching, model selection, and intervention. They are not the core of ThinkGraph.
7.1 Separate trace data from graph knowledge
```text
Trace rail:
provider visible thought summaries when available
opaque continuation markers
tool calls and tool results
MCP calls
latency
token/cost information
errors and retries

ThinkGraph:
reviewable resources, contexts, co-occurrence observations,
explicit assumptions, statements, questions, corrections,
evidence references
```
Raw or visible model reasoning must not automatically become:
```text
truth
evidence
durable project knowledge
public training data
canonical explanation
```
7.2 User control
The user may inspect a trace in a collapsed developer/review rail and pin a useful item as a private diagnostic attachment.
A user correction should become a new explicit graph statement or review, not an attempted edit of a provider’s hidden internal reasoning.
The correct intervention is:
```text
stop or finish the current bounded run
→ select graph statement / trace event
→ record correction, constraint, or rejected assumption
→ start a new bounded reasoning move with that graph context
```
---
8. Topology analysis: a future read operation, never permanent identity
Clusters, bridges, centrality, gaps, and similarity can be useful after ThinkGraph receives real live data.
They are not intrinsic properties of nodes.
Every topology output is context-dependent:
```text
analysis scope
project
graph snapshot
time window
selected edge kinds
selected node kinds
algorithm
algorithm version
parameters
run time
```
Therefore topology must be stored or returned as a versioned analysis result:
```text
TopologyAnalysisRun
→ usedSnapshot
→ assignedMetric
→ MetricObservation
→ Resource
```
A Resource must not acquire one permanent, context-free community ID or importance score.
8.1 Metrics must wait
Do not run Louvain, Leiden, betweenness, PageRank, gaps, or research-question generation against a manually seeded or tiny first graph and call the result insight.
First obtain a corpus of real live pair-subagent updates.
Then run analysis over bounded graph snapshots using an appropriate graph-analysis environment.
Potential later engines:
```text
ThinkGraph:
Python NetworkX or igraph over a bounded AGE read

KnowGraph:
Neo4j GDS after actual plugin availability and graph projection
are verified
```
The browser renders analysis results. It does not compute semantic topology.
---
9. Visual product definition
ThinkGraph must feel alive because actual project graph data is changing—not because the app is running decorative animation.
9.1 Default view
The initial ThinkGraph view should be a calm 2D, persistent graph. It should make the current project understandable in seconds.
The view displays real resources, real local observations, real statements, and real provenance.
A future 3D or glasses view may render the same graph records. It must not become another graph model.
9.2 Spatial stability
The graph must preserve spatial memory.
```text
existing resource positions stay stable
new resources arrive near their actual stored neighbors
only a local region settles briefly after a real delta
layout stops
global re-layout is explicit user action
```
Do not use a continuously running force layout.
Do not use random or hashed positions as a substitute for persisted user/view spatial state.
9.3 Visual language
The visual language must distinguish graph evidence and activity without claiming more than the data says:
```text
Resource:
simple circle

Contextual Statement:
distinct small marker / diamond

Observed co-occurrence:
subtle undirected relation

Interpreted Statement:
distinct directional relation on focus or selection

Current active change:
brief pulse only when an actual graph event occurs

Selected / pinned:
clear local emphasis

Evidence-linked statement:
later visual tether to KnowGraph reference

Disconnected component:
visible peripheral island
```
Labels must be sparse, legible, and shown based on zoom/selection. Predicate labels belong on hover, selection, or in Inspector.
No road-sign chrome, fake counters, decorative model-thinking bubbles, or permanent visual motion.
9.4 Inspector
The Inspector must expose stored data rather than invent an explanation:
```text
stable graph reference
connected contexts
mention/co-occurrence provenance
source message / answer refs
statement status and review
semantic-term references
linked evidence refs later
why this relation exists in the graph
```
9.5 Graph quality before cosmetics
The first visual objective is not color, glow, or 3D.
It is:
```text
a real live graph update from a normal user interaction
that changes the persistent graph correctly,
without producing a noun-clique hairball
and without rearranging the whole graph.
```
---
10. Graphify: bounded future role
Graphify is not ThinkGraph, KnowGraph, or the CodeGraph authority.
Its potential role is a separate, provenance-bound artifact extractor for code, configuration, documents, schemas, and media.
Possible future uses:
```text
read-only comparative scan against CBM
artifact graph snapshot linked to repository revision
candidate document extraction for KnowGraph ingestion
call-flow or configuration-path diagnostic artifact
```
It must not:
```text
replace CBM as authoritative code structure
write assistant instructions or repo policy
install project hooks without explicit approval
become another always-on graph authority
push inferred artifact relations directly into KnowGraph as evidence
be used to generate ThinkGraph discourse edges
```
Graphify should be evaluated only after the live ThinkGraph pair-subagent path is proven.
---
11. Correct implementation sequence
Gate A — purge and reconcile
Remove all manual replay artifacts and fake seed data.
Preserve the thesis and cleaned real conversation corpus.
Use Git history and CBM to distinguish failed-attempt additions from preexisting reusable plumbing.
Do not blindly delete preexisting ThinkGraph/MCP components.
Trace the currently running Harness process, actual environment, actual MCP transport, actual tool configuration, and actual tool list.
Gate B — prove the actual Harness tool path
Identify the one real path by which the running Harness discovers LiquidAIty graph tools.
Register or connect only the existing intended MCP/tool surface.
Verify the real model can see ThinkGraph reads and `thinkgraph\_apply\_delta`.
Secure the graph write boundary for internal authenticated use.
Do not create a second MCP host, route, or proxy unless runtime inspection proves it is necessary.
Gate C — build the bounded pair subagent
Keep primary answer streaming first.
After the completed visible answer, make one real bounded model call.
Pass only the user message, visible answer, graph slice, selected refs, and actual IDs.
Require `no\_patch` or a compact model-generated delta.
Route that delta through the real existing write tool.
Do not use replay scripts, fixtures, direct DB insertion, or manual semantic payloads.
Gate D — live proof
Run a real user-authored question.
Capture:
```text
user message reference
assistant message reference
subagent invocation reference
tool discovery proof
MCP/tool request reference
AGE delta reference
before/after graph count
new resource/context/statement refs
graph view update
```
Only after this proof may ThinkGraph be called live.
Gate E — accumulate real corpus
Use normal project work. Let real messages and answers build the graph. Monitor extraction quality with provenance and user correction.
Do not add topology metrics or visual complexity until there are enough real updates to analyze.
Gate F — metrics and visual refinement
Analyze a bounded, versioned graph snapshot.
Return clusters/bridges/gaps as contextual analysis results.
Add position persistence and local settle behavior.
Add edge/view slicing only as a backend query scope, never as browser-created semantic filtering.
Add optional trace rail.
Evaluate Graphify separately as a read-only artifact extractor.
Gate G — dual-graph evidence loop
Only after ThinkGraph live updates are reliable:
```text
selected ThinkGraph pointers
→ approved pointer/context bundle
→ research
→ KnowGraph evidence refs
→ Harness + user evaluation
→ revised ThinkGraph
```
---
12. Required proof standard
A feature is not complete because a script, preview, direct API call, or manually authored seed made it look plausible.
For each graph feature, the final report must distinguish:
```text
existing behavior observed
new code written
real live proof completed
manual/test-only proof completed
unverified claim
deferred work
```
A live ThinkGraph proof must explicitly state:
```text
manual replay used: NO
direct database write used: NO
fixture/static graph data used: NO
fake model output used: NO
normal Harness tool path used: YES
bounded model subagent used: YES
real user-authored message used: YES
```
---
13. Source basis
This corrected thesis draws from the original project thesis draft, the supplied Knowledge Graph and practitioner sources, the reviewed InfraNodus materials, and the observed LiquidAIty runtime reports. It supersedes any earlier claim that manually replayed graph records or a Sigma rendering constituted proof of the live ThinkGraph product path.
The intended system remains:
```text
persistent
model-mediated
provenance-rich
co-occurrence-aware
epistemically revisable
user-correctable
evidence-connected
graph-native
```
It must become that through a real Harness-to-tool-to-AGE loop, not through deterministic extraction or a visually polished manual seed.