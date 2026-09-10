# Double-Agent Stand-In

@skill id=double-agent-standin
@type Skill
@status active
@related_to conversation-graph-acceptance

## Purpose and recovery

Do the actual product job while independently inspecting the boundary for defects and waste.
Recovered from `2ddadeeb^` at the owner's request on September 9, 2026. The original July
procedure proved useful for finding context and execution leaks. Its old model assignments,
tool names, KG campaign, mandatory graph reports, and zero-cost claim are superseded.

## Two intents in every job

1. **Product work:** act as an ordinary user of the selected capability, or as the specified
   Card's stand-in. State which position is being played. Complete the real task with a useful
   answer, evidence, or permitted operation; evaluation alone does not satisfy this intent.
2. **Evaluation:** separately inspect context quality, duplicate reads/work, tool usability,
   attribution, missing results, elapsed time, and cost evidence. Keep diagnostic instructions
   and reports outside the product conversation and graph writes.

Start with Main. Use one bounded job before increasing agent count. Every additional subagent
also carries both intents. Match its requested model to the saved Card selection when available;
report any mismatch in model, reasoning setting, tools, history, or runtime. Do not change Cards
to fit the test. An external stand-in is not the Hermes runtime, even when its model matches.

## Preparation

The current executable case list, budgets and approval status belong in
[PLAN.md](../PLAN.md#controlled-agent-test-plan). This file is the reusable operating procedure.
It coordinates existing Card Runs and, when authorized, one coding-agent stand-in per participating
software role; it installs
no scheduler, runtime, instrumentation service or automatic agent team.

### Choose the position explicitly

| Position | Product intention | Evaluation intention | What it can prove |
| --- | --- | --- | --- |
| User of the real Card | Send the ordinary task through the approved UI/API doorway | Observe the real Run and user-visible result | Actual integration, subject to retained evidence |
| Card stand-in | Perform that Card's job using its selected material and available equivalent tools | Explain useful/missing context and encountered defects separately | Reasoning/tool usability; native integration only if actually exercised |
| Replay analyst | Inspect an existing input, output and receipt | Locate duplication, missing outputs and timing gaps | Retained-run evidence; no fresh behavior or causal speed improvement |

Start with replay analysis when it answers the question without another model call. A stand-in
that only criticizes a transcript has not performed the Card job. A real Card must receive ordinary
user input, without evaluator instructions or a coached solution added to its saved prompt.

### Mirror the actual scenario

Enumerate participating roles from current saved Cards, topology and native runtime configuration
before spawning. One software role gets one fresh-context stand-in; N participating roles get N.
Count actual controllers/planners, workers and synthesizers, including Main only if it participates.
An eligible but unused Card, transport process or the independent Codex parent is not another role.
There is no arbitrary two-actor limit and no extra helper/reviewer swarm.

For a native worker without a saved Card, resolve its role, model, tools and permitted context from
the actual owning Card/runtime evidence. Do not invent private worker prompts or reconstruct
AutoGen Task/Progress Ledgers. Missing essential role evidence blocks exact parity.

The parent creates the matching role topology and owns evaluation. Do not allow grandchildren
unless the real scenario requires that exact nesting and the host supports it. Read available
host slots at dispatch. Preserve intended concurrency where possible; otherwise use explicitly
reported dependency-ordered waves while retaining all N roles. Wave execution proves neither native
parallel latency nor exact concurrency parity. Never silently merge or remove roles to fit slots.

Keep each actor's role context separate. Pass only the actual permitted upstream output/reference
selection to its intended recipient. Record sender, receiver, source IDs, payload bytes, timing,
missing required information and actual completion/failure. Do not pass evaluator hypotheses or
manufacture a missing worker answer. An upstream failure stops dependent work honestly.

### Bind a coding subagent to the actual Card

This is the owner's primary diagnostic method, not a generic review delegation. After execution
is approved, the supervisor uses its existing subagent facility to create one actor for each selected
software role. Read the current Card and effective native request first. The Card's parent model selects
the stand-in model; its bounded-child model applies only if the task actually exercises a child.
Do not use yesterday's snapshot or the supervisor's model as a silent substitute.

Follow the Card exactly: its actual instructions, model/provider/effort, selected skills,
enabled/presented tools and Script, bounded context, task and handoff authority. Do not summarize
away role instructions, simplify the job, or choose a smaller tool/skill set for convenience.
If a required setting or interface cannot be matched, stop the exact-parity case and report the
specific mismatch. Only an explicitly owner-chosen exception permits an approximate diagnostic;
that result cannot establish exact parity. Do not edit the Card to make the host match it.

| Bind from current authority | Verify in the stand-in | If it cannot match |
| --- | --- | --- |
| Saved provider, parent model and effort | Explicit supported spawn selection and returned execution identity where available | Report the exact mismatch; no provider/model speed comparison |
| Stable Card instructions and ordinary dynamic task | Supply relevant exact text separately; no whole parent-chat fork or edited task | Identify omitted or higher-priority host instructions; the stand-in cannot reproduce a native system role exactly |
| Effective native/MCP tools and Script presentation | Resolve actual callable tools and compare argument/result schemas, defaults and errors | Mark unavailable tools or different interfaces; never mock a result or invent a tool alias |
| Selected skill contents/index, graph references and relevant memory/history | Reuse the actual bounded material available for this case | Record missing or extra context before comparing answers |
| Project, native IDs and authorized writes | Preserve identities and operate only on the approved scope | Use read-only/proposed operations if writes lack an isolated authorized target; label them unexecuted |

Start the actor with no inherited conversation when supported, then provide only its Card role,
task, selected evidence and compact evaluation instructions. This prevents this long engineering
conversation, abandoned ideas and supervisor research from becoming its task context. Existing
host system instructions still apply and may differ from Hermes; report that rather than claiming
an exact clone. Do not reconstruct or persist a second IDF.

Tool matching means executing the real operation through an available authenticated application
tool, with its actual response and native IDs. Quoting its schema does not make it callable. A
corresponding Codex web tool is not automatically equivalent to Hermes web search. If only a
different doorway is available, explicitly name both and narrow the finding to what they share.
Do not build proxy tools, wrappers or another MCP host to manufacture parity.

An external subagent may inherit more host tools than the Card owns. Supply the selected allowed
tool list, inspect its actual calls and disqualify a comparison that uses extra capabilities. A
prompt restriction is not an enforced grant boundary and must not be described as one. Production
Card grants remain unchanged. The actor never edits code, Cards or its own prompt to make its task
pass unless that editing is the actual separately authorized role task.

Dispatch each role once after the tool map and role dependencies are ready. While actors perform
their jobs, the supervisor owns
the stopwatch, request/tool receipts and boundary verification. Do not repeatedly send hints or
ask for status inside the actor's task. Preserve native events when available; if a Codex subagent
does not expose first-token timing or provider usage, leave those fields unknown. Wall-clock timing
alone cannot identify model latency.

Give the actor this compact structure, with actual values filled from the verified case rather
than a new persisted packet or a copied library manual:

```text
Position: stand in for the selected Card; complete its real task.
Card/model/tool parity: verified values and explicit differences.
Stable role: selected Card instructions.
Task and evidence: unchanged ordinary request and bounded source material.
Tools: actual callable names/contracts within the approved scope.
Completion and stop: frozen task assertions, authorized writes and deadline.
Return A: the useful product result with actual native references.
Return B: separate observed context/tool defects and uncertainty; no product-memory writes.
```

The diagnostic intent changes the actor's input and may add output/time. Record its instruction
and report size separately. Measure product completion before the diagnostic report where
observable; otherwise report a combined duration. A double-agent finding can expose a bug without
being a clean latency experiment. A claimed performance improvement needs the affected real Card
case after a specific fix, with ordinary input and no added evaluator prompt.

- Identify project, conversation, task, Card, and exact retained Run/input when applicable.
- Read only relevant role instructions, selected context, and callable tool contracts. Inspect
  the actual saved/runtime input before calling it representative; do not invent a second IDF.
- Keep a small record of supplied versus inspected material. Retained runtime settings and
  schemas are not automatically provider-visible prompt text; trace the final adapter to prove that.
- Verify real doorways through current source/catalog and effective grants. Existing
  `skills/codebasedmemory.md` owns code discovery. Do not restore historical tool names.
- Distinguish an external stand-in, a user testing the real Card, and a live Card run. Use the
  same task for a controlled comparison; label changes in tools, context, or source dates.

## Stopwatch and scale

### Before an authorized run

1. Select one case from the approved plan. Name its unresolved question, expected result,
   permitted writes, services, hard deadline and token/call budget. If Docker is unavailable,
   stop and tell the owner; do not start or repair it as part of this test.
2. Record the current commit, Card ID, profile, provider/access mode, parent and child models,
   reasoning setting, native tool names and schema hashes, selected skills, Script version,
   history/session state and graph selection IDs. Read existing authority; do not change it.
3. Use the actual retained `in.idf` and its native projection when available. Copying a task for
   a stand-in is a test input, never a second runtime materializer or persisted Card definition.
   Record omissions, transport differences and unavailable tools before interpreting results.
4. Freeze the ordinary task and expected assertions before inspecting the new answer. Include
   relevant negation, uncertainty and attribution from the real input. Preserve source dates.
   Do not improve one arm's task with lessons learned from the other arm.
5. Start a monotonic stopwatch immediately before submission. Record UTC alongside it for
   correlation. Reuse native Run/tool/provider receipts; no new event bus or report database.

### Perform, then evaluate

Run the ordinary task once. Let the actor select its own useful granted tools. Observe without
feeding it hints. If a stand-in is approved, give it the same task and material, and require two
separate outputs: the product result first, then its diagnostic report. Keep that report in the
coding conversation. Do not inject it into Main, a tool result, an episode or a graph memory.

For a comparison, execute the real-software and stand-in arms serially against equivalent starting
state. Preserve the intended concurrency within each arm, subject to the declared wave limitation.
One arm must not learn
from the other's writes. Prefer retained inputs/read-only work; graph-write comparisons require
an explicitly authorized isolated native workspace with actual source material. Never reset the
user's graphs for parity. If isolation is unavailable, report the comparison inconclusive.

Stop the same Run through its existing supported cancellation path at the predeclared deadline.
Record whether cancellation actually completed and whether child work remains active. A timed-out
status read is not proof that the child failed. Do not launch a replacement or continue increasing
the deadline. Never change Builder's grants or runtime limits to implement a test budget.

### Measurement record

| Measure | Required distinction |
| --- | --- |
| Time | Submission, acceptance, first useful text, useful answer complete, each delegated result available; queue/startup separated where observable |
| Input scale | UTF-8 bytes by retained-IDF section versus actual provider-request section; tokenizer name for estimates; unknown when unavailable |
| Context sources | Stable Card instructions, tool schemas, native system/skills index, explicitly opened skills, selected graph data, memory, history, tool results, current task |
| Usage | Per-request input, cached input, output and reasoning tokens from native receipts; aggregate once per request ID; mark inclusive counters to avoid double counting |
| Tools | Requested name, actual interface/schema, elapsed time, result size, failure, repeat and native result IDs |
| Role topology and handoffs | Actual software roles versus exact stand-in count, intended/achieved concurrency, waves, sender/recipient, payload bytes and lost required information |
| Cost | Provider/account receipt when exposed; otherwise unknown, with token totals. Cached input is not assumed free |
| Parity | Same task, sources, model, effort, tools, context and starting state? List every difference, including runtime and cache warmth |

For duplication, identify both exact locations in the **same final provider request**, their
bytes and surviving canonical owner. Repeating stable context across requests, cached prefixes,
large retained descriptors and repeating a completed research action are separate observations.
Neither byte counts nor a successful tool call prove that the model used a fact correctly.

Unknown usage is unknown, not zero; an external stand-in is not free. Explain whether the
information helped the task without inventing attention measurements or actually-used-token counts.

The September 10 source audit demonstrated two relevant traps. Builder's native CLI supplied usage
but an outer Run finish dropped it; that forwarding now has a regression test. Require the native
receipt and final retained Run fields before claiming measurements. A status helper may coerce
missing values to numeric zero; that response alone cannot establish zero usage. Separately, Builder's
PLAN vision heading included unrelated role/history sections until its next level-two heading. The
real-file regression now checks the boundary. Compare actual selected context, not just prompt names
or a small fixture, and never insert evaluator prose into that product section.

Resolve `delegationRole` through its current native consumer instead of treating a saved legacy
`team` object as active. Missing saved reasoning effort means native default/unknown, not low.
Main's compact native `execute_host_script` and its profile-delegation doorway are not equivalent to
separate public MCP calls. If the host lacks either, report unsupported parity and do not substitute
silently. A newly created local profile is not a saved Card, authenticated account or launch-ready arm.

Inventory both saved toolsets and the native profile's toolset configuration. The existing Hermes
session projection unions them: the September 10 old Builder profile pinned `computer_use` and
`hermes-acp` in addition to the Card's six selections. Expanding the selected toolsets in source found
23 unique names plus six explicit native selections, but did not establish live availability or the
complete effective catalog. Record the native readback and schemas; never treat a static count as
callability or silently give a stand-in only the visible Card subset. The concrete inventory and
unapproved construction contract are in `ARCHITECTURE.md`, outside product input and memory.

For graph comparisons, separate source selection, executing role, extraction method and scheduling.
A completed user/assistant pair can be input to a focused existing Card without an automatic post-chat
hook. Preserve attribution and order. Do not change all four variables in one arm and attribute the
result to regex or delegation alone. Compare on eligible real material and comparable initial knowledge;
if supported isolation is unavailable, graph-mutating comparison remains blocked. No graph reset,
test-chatter ingestion, extra engine or direct store access supplies that missing isolation.

The September 10 source audit established that an Engraphis ingestion can use the saved ThinkGraph
model for an extractor completion without a ThinkGraph Card Run. A delegated ThinkGraph Run can also
invoke that extractor. Record both kinds of actual work, plus provider-reported usage where available,
deduplicated by request identity. Do not count only saved Runs or assume ingestion is model-free.
Its structured extraction and configured regex graph enrichment can both contribute to one memory.
Keep an extractor-setting comparison separate from a source/role comparison.

Judge stored note, entity/relation enrichment, queued versus completed Graphiti extraction, independent
later recall, materialized context and final answer separately. Engraphis may retain a note after an
enrichment warning or return marked extraction fallback. Neither is successful structured extraction.
A graph scene can omit memory-only nodes and weak edges without losing the underlying note. A later
answer must preserve attribution, uncertainty and provenance; a native ID, node count or write/readback
loop alone cannot pass semantic quality. Keep evaluation criteria outside the actor's product input.

## Job report

### Assess usefulness against the frozen task

Check whether the result answers the actual question, distinguishes the user's intent from
assistant suggestions, preserves uncertainty, uses supported facts, and enables the next useful
action. For graph work, inspect entity identity, attributed notes, meaningful relationship
predicates, provenance, update behavior and later retrieval. Node count and visual complexity
are not quality criteria. An episode/source document is not automatically a useful entity.

For each defect, retain its earliest supporting event, the affected input/output excerpt or
native ID, practical consequence, confidence and one discriminating follow-up. Separate observed
facts from suspected causes. An actor's self-evaluation is evidence to check, not independent truth;
the supervising evaluator verifies it against receipts and actual results without another model
call when possible.

Use this compact report shape, outside the product:

```text
Case / position / Run IDs / commit:
Software roles / stand-in count / topology / concurrency or waves:
Task and expected assertions:
Card, profile, provider, models, effort, tools, skills and Script:
Parity differences and unavailable evidence:
A. Product result and native references:
B. Stopwatch events and input-size table:
Actor diagnostic overhead / extra host capabilities used:
Provider usage / tool calls / exposed cost:
Handoff receipts and missing information:
Assertions: pass | fail | inconclusive, with evidence:
Observed defects; hypotheses kept separate:
Product verdict / integration verdict:
One recommended repair or next distinguishing test:
Writes, remaining child work, cleanup and preserved state:
```

Useful defect categories: context, retrieval, execution, persistence, scope, authority, proof,
visualization, attribution, and cost. Report the earliest evidenced failure, not merely its symptom.
Do not promote an evaluator's recommendation into an accepted design change.

## Keep the real task moving

After one case, decide: keep the proven behavior; repair one evidenced defect within authorized
scope; or stop on missing evidence. Repeat only the affected case after a material change. Do not
run a model matrix or swarm to compensate for an unexplained failure. Promote a reusable lesson
into the relevant skill only after evidence; store a demonstrated prevention rule in `DONT.md`.
Keep current proof gaps in `PLAN.md`. No automatic report-to-graph or new task-document pipeline.

Use actual native write tools only when writes are authorized for the test. Otherwise label proposed
payloads unexecuted. Do not fabricate a successful operation or pollute production with fixtures.
An independent persistence check may establish a write; Main must not perform repetitive readback
as conversational behavior. Preserve graph data, Cards, sessions, and unrelated work.

Give separate verdicts for useful product work and the integration under evaluation. A good
stand-in answer can coexist with unproven Hermes execution or a poor graph result.
