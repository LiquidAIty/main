---
name: conversation-graph-acceptance
description: Test whether ordinary saved Main conversation becomes correctly attributed, reusable native graph knowledge. Use for ThinkGraph ingestion, KnowGraph research, Builder handoffs, and graph replacement acceptance.
---

# Conversation to graph acceptance

@skill id=conversation-graph-acceptance
@type Skill
@status active

Use this procedure when graph records exist but their usefulness, attribution, recall, or downstream
consumption is uncertain. It is a testing procedure, not an ingestion prompt or permission to run models.
Follow the current task's execution authorization and repository law. Keep observations in the response
and existing native Runs; do not create another evidence store or task document.

## Establish the actual path

Use `skills/codebasedmemory.md` to resolve the affected owners, then read current source. The current
seams are `cognition.py` for completed-pair delivery, `idf.py::materialize_idf` for exact input,
`engraphis.py` for ThinkGraph, `mcp_host.py` for tool publication, and the existing Hermes profile
delegation adapter for connected saved Cards. Verify these pointers before relying on them.

Read saved Card IDs, prompts, parent models, native subagent selections, grants, Scripts, topology,
and current deck revision. Compare saved selections with the loaded native profile and actual Run
receipt. A Card title, historical Run, healthy endpoint, or process being alive does not prove execution.
Preserve existing sessions, graph data, unrelated configuration, and interrupted child Runs.

Separate five kinds of evidence:

| Evidence | What it establishes |
| --- | --- |
| Source and contract tests | The inspected mechanism under the tested conditions |
| Isolated native fixtures | Native storage, schema, scope, correction, and recall mechanics |
| Agent-authored test-user messages | Inputs deliberately submitted through the existing UI |
| Actual saved-agent Runs | Which saved profile/model/tools really interpreted and retained those inputs |
| Native readback and UI | What persisted, what was recalled/consumed, and what the user can inspect |

Never insert polished product records to stand in for the fourth category. Do not call fixture data
accumulated knowledge. A successful native write proves persistence, not semantic correctness.

## Exercise a small conversational sequence

Use short, ordinary messages appropriate to the user's domain. Avoid telling the test user to select
tools or understand graphs. Adapt the content; do not reuse a memorized expected answer.

1. Express an interest and experience without choosing an explanation.
2. Ask a follow-up that introduces related entities or a relationship.
3. Ask for a factual check against current primary sources.
4. Accept a broad goal while leaving the assistant's proposed details undecided.
5. Correct one interpretation and explicitly request a bounded Builder draft when useful context exists.
6. Return later with a paraphrase that should retrieve the earlier context.

After each completed pair, inspect the exact correlated ThinkGraph Run and native IDs before increasing
volume. Prove the recipient boundary: conversation completion must not invoke Graph Agent, send it the
conversation, or depend on that Card being present. Research is separately delegated; its useful sourced
findings are retained in KnowGraph. The removed automatic research stage demonstrated unwanted delivery
and extra profile activity, not a useful research benefit. A busy response is a failed handoff, not
accepted research; do not add another runner or restart the existing child to make a test succeed.

## Audit meaning before adding more data

Compare each retained claim against the actual separate `completedPair.user` and `.assistant` fields
in the worker's retained `in.idf`, not a reconstructed transcript summary.

Check:

- Speaker attribution: an assistant suggestion is not an accepted user decision. Accepting a journal
  does not accept the assistant's proposed thresholds, fields, companies, or rules.
- Status: interests, possibilities, disagreements, and questions retain their uncertainty. Do not turn
  a tentative explanation into a diagnosis or preference.
- Relationship fidelity: exact native endpoints, direction, relation, reason, and provenance survive
  readback and transport. Automatically created semantic links are not proof of agent-authored links.
  Missing native strength or justification must not become a fabricated confidence value or explanation.
- Source fidelity: an assistant's company list is not verified financial evidence. KnowGraph claims
  require the source actually read, relevant date, and native episode/entity/fact references.
- Context usefulness: preserved information helps a later task. More nodes, longer summaries, and
  successful extraction counts are not quality metrics by themselves.

When a claim is wrong, stop increasing test volume. Determine whether the earliest divergence is in
the saved prompt, selected context, completed-pair input, model-authored write, ingestion, or projection.
Repair that owner and repeat the discriminating case. Prompt wording alone is not proof of repair.
Use the native correction/history path when the actual agent corrects a claim; never erase the failed
case or reset the graph to make acceptance look clean.

Entities and relationships are the core transport. Question/evidence fields remain optional useful
capabilities; do not require every conversation to become a Q&A workflow or an automatic research job.

## Verify research and handoff independently

Read the actual granted Graphiti ingestion implementation. A similarly named ingestion helper may not
be the MCP operation used by the saved Graph Agent. Attribute chunking problems only after comparing
the actual source content, submitted ingestion payload, native processing result, and retrieved facts.
A queued episode is not a completed materialized knowledge graph.

For Builder, require the exact connected saved profile, an accepted native child Run, its own saved
model/grants and canonical IDF, graph reads with native references, and a useful completed output.
Main saying "Builder is working" or writing a long response does not establish delegation. Ordinary
prose may be long without being a requested report; assess the actual user request.

The checked-in Hermes supports native asynchronous delegation. Its ordinary child behavior and
separate-profile `background` contract differ; inspect the current native tool before changing an
adapter. Preserve native completion delivery and capacity limits. Do not add an application queue,
temporary saved Cards, or a second scheduler to work around a rejected call.

## Measure the boundaries separately

Record cold initialization/warmup, warm semantic recall, exact read, native write, projection, Main
preload, first useful answer, full Main response, background processing, research, and synthesis.
Keep the existing bounded preload budget. Missing optional context must not block ordinary Main chat.

For a slow Run, correlate native logs and tool/provider receipts with its exact Run ID. Distinguish
pre-inference setup, large tool results, provider latency, invalid tool arguments, profile contention,
and post-result delivery. Native provider retries can continue after an application timeout: compare
both terminal states before sending another message. Do not guess high reasoning effort from elapsed
time. Saved model selection does not prove the effective reasoning setting was forwarded.

Visible progress may use actual tool, reference, child-status, timing, and provider-exposed summary
events. Do not invent reasoning traces or expose private internal reasoning.

## Finish product proof and cleanup readiness

With the same accumulated native IDs, verify exact reads independently of semantic search, a useful
paraphrase, bounded receiving-Run IDF references, and correction history. After an authorized canonical
restart, repeat reads/recall without reinsertion. Inspect the populated graph in the real app: labels,
node content, relationship meaning, source access, pan/zoom/fit, and stable loading area.

For GPT plugin changes, compare the loaded public catalog with IDD publication and native schemas:
names unique, old names absent, scope server-owned, OAuth metadata retained. Current server catalog
proof does not refresh a conversation's cached tool descriptors; fresh selected-plugin discovery and
a successful native read remain separate acceptance requirements.

Follow the current owner's sequencing decision: normally prove replacement before removal; an explicit
instruction to clean obsolete recovery residue may authorize earlier removal. In either case,
inverse-audit the superseded runtime, dynamic callers, grants, imports, configuration, dependencies,
and tests, and do not relabel partial product proof as success. Preserve useful generic renderers even if an
old engine remains in their filename. Database files are not incidental cleanup targets.

Report a compact problem/evidence/owner/action/proof matrix. Label incomplete semantic quality,
research, synthesis, reload, or connector acceptance PARTIAL. Keep baseline failures separate and
report a regression ratio only for enumerated, actually exercised preservation invariants.
