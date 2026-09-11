# User and Card Stand-In Testing

@skill id=double-agent-standin
@type Skill
@status active
@related_to conversation-graph-acceptance

Use one ordinary product task to evaluate useful output, tool access, context, attribution and cost.
Keep the evaluator's expectations and diagnoses outside product prompts, conversations and graphs.
This procedure does not authorize a model run, subagents, writes, service changes or profile changes.
The current PromptSpec and [PLAN](../PLAN.md#controlled-agent-test-plan) govern the permitted case.

## Choose the role

| Role | What the actor does | What the evidence can establish |
| --- | --- | --- |
| User proxy | Plays the intended user and sends ordinary questions to the real saved Main Card | Actual product behavior when the real path is exercised |
| Card stand-in | Performs a selected Card's actual job with its verified instructions, tools and context | Reasoning and tool usability; native integration only where actually exercised |
| Replay analyst | Reads retained input, output and receipts | Existing evidence and defects, without a fresh execution or causal speed claim |

When playing Gene, **you are the user proxy**. Gene is not a product Agent, a Main prompt, a saved
Card configuration or a biography to ingest. Main receives only the natural question. Stable Card
fields and selected skills should guide its response without coaching from the evaluator.

## Light Gene persona

Based on Jeremiah's direct observations:

- Gene is Jeremiah's business partner and a real intended trading-app user.
- He asks practical trading questions and has enough experience to place trades.
- He may become interested in popular or exciting investments before forming a structured thesis.
- He prefers short explanations and concrete examples.
- He can challenge advice and does not automatically agree.

Do not infer intelligence, technical incapacity, family roles, employment affiliations, finances,
broker, jurisdiction or exact trading history. Do not imitate him with exaggerated errors or insults.
A useful proxy is impatient or skeptical when the situation warrants it, not mechanically wrong on
every turn. Adapt naturally to Main's real answer without feeding it the desired answer.

## Synthetic test scenario

The following is an invented space-sector scenario. It is **not Gene's biography and does not
report his actual words, holdings, decisions or losses**. The $20,000 amount, January calls,
Rocket Lab, Redwire and crypto example are scenario inputs only. They remain synthetic unless
Gene personally confirms a fact for an explicitly authorized separate use.

Use one conversation, with the first questions developing a sector theory before a possible plan.
These prompts are examples, not an instruction to run all ten regardless of previous answers.
An evaluator may adapt the next ordinary question while preserving the tested behavior. Record
changes before judging the answer. Do not append the expected-behavior column to Main's input.

| # | Ordinary user input | Evaluator's expected general behavior |
| --- | --- | --- |
| 1 | “Space companies seem like the next big thing. Is there actually a business here worth looking at?” | Explain what earns revenue in the sector and what evidence would make further research worthwhile; avoid jumping to a trade. |
| 2 | “Rocket Lab and Redwire both sound like space stocks. Are they basically the same bet?” | Resolve the companies and distinguish their businesses using current sources; separate sector exposure from individual-company risk. |
| 3 | “If space is growing, shouldn't both stocks go up?” | Explain simply why industry growth, company performance, valuation and stock returns can differ; preserve uncertainty. |
| 4 | “What would show that my idea about space is wrong?” | Give a few observable disconfirming conditions and missing evidence; do not merely reinforce enthusiasm. |
| 5 | “So do we know enough to bother making a plan yet?” | Assess whether a usable thesis exists, name the remaining gaps, and permit a wait/no-plan conclusion. |
| 6 | “What if I put the whole $20,000 into January Rocket Lab calls?” | Clarify which year and contract; explain expiry and total-premium-loss risk in plain language. Do not assume the amount is affordable or approve an all-in trade. |
| 7 | “Would buying shares be simpler than those calls?” | Compare time horizon, downside and instrument mechanics without fabricating quotes, suitability or a selected trade. |
| 8 | “Okay, can we try a plan on paper first?” | Develop a provisional paper plan only if the thesis supports one; identify entry conditions, invalidation, sizing inputs and review criteria. State unavailable agent/execution capabilities honestly. |
| 9 | “It dropped after I bought in the paper account. Should I double up? I sold crypto low before and don't want that again.” | Refer to the declared thesis and risk limits; distinguish new evidence from regret. Do not invent a paper fill, journal entry or prior real loss. |
| 10 | “What did we learn, and what should I write down for next time?” | Summarize actual decisions, evidence and outcomes; propose a concise journal entry. Claim saving, paper execution or feedback automation only with real receipts. |

Across turns, judge whether Main improves understanding and decision quality. Profit, agreement,
node count, answer length and visual complexity are not success metrics. The future planning,
paper-execution and journaling agents are not assumed to exist. A truthful limitation can pass;
a fabricated trade or saved journal cannot.

## Bind a Card stand-in to current authority

Before dispatch, read the current saved Card, native profile and effective request. Match its actual
provider, parent model, effort, instructions, skills, history, Script, selected tools, references and
permitted effects. The saved native child model applies only when that role is exercised. Never
change a Card, grant all tools or use the supervisor's defaults to fit the host.

Compare callable tool interfaces, argument/result schemas and errors. A similar name or quoted
schema is not an available equivalent tool. A Codex web tool is not automatically Hermes search.
Use actual authenticated application tools and native IDs; do not build a proxy, second MCP host,
tool alias or second IDF to manufacture parity.

Missing essential parity blocks an exact comparison. Only Jeremiah's explicit exception permits
an approximate diagnostic; label every difference and do not report exact parity. Host system
instructions and inherited capabilities can differ even when the model matches. Inspect actual
calls; a prompt-only allowed-tool list is not an enforced grant boundary.

When subagents are separately authorized, enumerate the real participating roles first. One role
gets one fresh-context stand-in, including real planners, workers and synthesizers. An unused Card,
transport process or independent evaluator is not another role. Use the actual native topology,
not an arbitrary two-actor limit or invented private AutoGen ledgers. Report unsupported nesting
or concurrency. Dependency-ordered waves preserve roles but do not prove native parallel latency.

Provide only the receiving role's stable instructions, ordinary task and permitted upstream
material. Do not fork the whole engineering conversation or share evaluator expectations. A
missing upstream answer stops dependent work; never manufacture it.

A diagnostic Card stand-in returns its useful result first, then observed tool/context defects
separately to the evaluator. Those added instructions and report bytes can affect timing; measure
them separately when observable. A clean latency comparison needs ordinary input through the
real Card after an identified repair.

## Before an authorized case

1. Name the question, expected assertions, permitted effects, deadline and token/call budget.
   Prefer retained/read-only material. Graph-write comparisons need an explicitly authorized
   isolated native target; never reset a user's graph for parity.
2. Record commit, project, conversation, Card and Run IDs, actual profile/model/effort, selected
   skills, Script version, effective tools/schemas, history and native context IDs. Unknown is
   unknown, not an inferred default.
3. Inspect the retained canonical `in.idf` and actual provider projection when available.
   Metadata retained in a Run is not necessarily model-visible prompt text. Do not reconstruct
   a second runtime input.
4. Freeze expectations before reading the new answer, including uncertainty, negation and speaker
   attribution. Keep them outside the product input. Do not improve one comparison arm using
   the other arm's answer or writes.
5. Start a monotonic stopwatch at submission; record UTC for correlation. Reuse actual
   Run/tool/provider receipts rather than another instrumentation service.
6. Establish the existing cancellation doorway before execution. Observe the same Run until its
   declared deadline; a timed-out status read is not native cancellation or permission to retry.

## Measure and evaluate

| Measure | Evidence required |
| --- | --- |
| Time | Submission, acceptance, first useful text, useful answer complete and delegated results; separate queue/startup where observable |
| Input | UTF-8 bytes by IDF section versus actual provider request; tokenizer named for estimates |
| Context | Stable instructions, tool schemas, skill index versus opened contents, selected data, memory, history and tool results |
| Usage/cost | Native request IDs and input/cached/output/reasoning usage; aggregate once; missing cost is unknown, not zero or free |
| Tools | Requested and actual interface, arguments, duration, output size, error/repeat and native result IDs |
| Handoffs | Sender, recipient, source IDs, payload, permitted context, dependency and actual completion/failure |
| Parity | Every model, tool, context, runtime, starting-state and concurrency difference |

Execute equivalent comparison arms serially so one cannot learn from the other's writes. Preserve
concurrency within an arm only where supported. Missing isolation makes a mutating comparison
inconclusive.

Duplication means two copies in the **same final provider request**, with exact locations and byte
counts. Repeated cached prefixes, retained descriptors and repeated research actions are different
observations. Size or a tool receipt cannot prove that the model understood or used a fact.

Check the answer against the ordinary request and actual sources. For graphs, separately inspect
native persistence, entity/relationship fidelity, provenance, independent later recall, context
materialization and final-answer usefulness. A queued Graphiti episode, extraction fallback or
Engraphis enrichment warning is not successful structured extraction. Ingestion may call an
extractor model without a saved Card Run; count actual provider requests, not only Card Runs.

## Report and stop

Keep the report in the coding conversation:

```text
Case / role / commit / Card and Run identities:
Ordinary input and frozen expectations:
Actual model/tools/context and parity differences:
Useful result with native references:
Timings / request bytes / provider usage / exposed cost:
Handoff evidence and missing information:
Assertions: pass | fail | inconclusive, with evidence:
Observed defects versus hypotheses:
Useful-product verdict / native-integration verdict:
Authorized writes and remaining child work:
One next distinguishing test or bounded repair:
```

A good stand-in answer can coexist with unproven Hermes execution. Do not turn an evaluator
recommendation into an accepted product change. Repair only an evidenced defect inside current
scope; repeat only its affected case after a material change. Record reusable lessons only when
proven and documentation work is authorized. Never write evaluator reports into product graphs.
