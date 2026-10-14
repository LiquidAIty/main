# DONT.md — preserve the real product

Use this for prohibitions and known failure patterns. [AGENTS.md](AGENTS.md#scope-and-closed-features)
owns execution law; [PLAN.md](PLAN.md) owns current status; [ARCHITECTURE.md](ARCHITECTURE.md)
owns source boundaries. A historical report is evidence, never permission to act.

## Scope first

- Follow the current PromptSpec and preserve accepted features. Discovery, a TODO, an assistant
  proposal, or a nearby defect does not authorize an edit.
- Ask Jeremiah before editing outside the repository or outside the PromptSpec's production scope.
  Show the exact coupling before touching a closed feature.
- Ask before a new design, authority, abstraction, dependency, runtime, storage path or user experience.
  Routine choices already authorized do not need repeated permission.
- Map each changed file and meaningful hunk to its requirement or demonstrated prerequisite.
  Finish one boundary before opening another. Cleanup covers only residue inside that boundary.
- Do not edit documentation unless the PromptSpec authorizes it. Keep reusable rules separate
  from incident history, test output and implementation reports.

## Product preservation

1. Do the requested work. Preserve unrelated source, saved Cards, profiles, prompts, grants,
   projects, graph data, sessions, layout, and current dirty work. Never perform a broad restore.
2. Do not copy a nearby implementation because it exists. Trace its real callers, data owner,
   persistence and runtime consumer. A self-supporting test is not a product integration.
3. When replacing an approach, remove its abandoned live callers and duplicate entrance in the
   same completed repair, after proving the retained capability. Do not remove distinct useful work.
4. A Card is one saved agent with its own profile. Hermes internal agents remain within their
   owning Card. Connected saved Cards never share a profile or become child Cards.
5. Use existing Hermes, Mag One and graph capabilities through their real boundaries. No extra
   runtime, scheduler, graph writer, input format, artifact-ID prerequisite or fake terminal.
6. IDD is the common definition source: a field list in Cards, a dictionary for Builder, and
   dropdown/default definitions for templates. IDF is the actual bounded input for one Run.
   Refer to existing catalogs and executable schemas; do not copy option lists between consumers.
7. No fake graph data, sample records, placeholder activity, simulated success or invented receipts.
   A saved record can still be the wrong data. Prove useful behavior using a real project.
8. Product instructions belong in these documents, never automatic graph inserts or UI banners.
   Do not add explanatory panels, evidence panels or branding to Card controls.
9. Main/Builder's established pull-up behavior is intentional. Preserve their session and input
   ownership. Do not change mounts, polling, panel dimensions or collapse behavior as a side effect.
10. Keep saved tools available without Hooks. Card Hooks use the preserved Hermes Python runner and
    saved grants; they do not replace or re-authorize ordinary profile tools. Do not invent a tool or
    widen grants to make a proof succeed. WorldView layer visibility is not tool authorization, and
    Hermes profile memory is not a Tools-tab grant or LiquidAIty-selected toolset.
11. LiquidAIty owns the product CBM publication and its one application frontend. Codex owns one separately
    registered official development frontend and must not depend on GPT Web, the plugin, or the running
    application. Both use the same upstream daemon/cache/runtime identity. Product clients use the published
    tools and the coverage procedure in `skills/codebasedmemory.md`. No direct cache/database access, extra
    frontend or daemon, automatic repair, OAuth change, or index-freshness gate. Known source and excluded files
    can be read directly.
12. Required tests/builds may exceed a minute. Poll the existing command; do not duplicate it or
    discard work because it is slow. Source proof, tests, saved readback, loaded runtime and UI
    acceptance are different claims. Report each honestly.
13. Mag One needs Main's user-approved mission and usable connected agents. Do not add
    another approval workflow or product gate. A stand-in test does not prove that readiness.
14. Read only relevant reusable procedures, then verify current source and actual runtime evidence.
    Do not restore feature manifests, automatic LLM wiki generation or report-to-graph writes.
15. Keep familiar controls in predictable places with direct, visible effects. Show relevant state
    where the user acts; do not demand acknowledgment of routine activity. Cleanup must preserve
    useful controls, not bury them or replace them with explanations. The owner's design reference is
    [Amber Case's interview](https://www.designwhine.com/amber-case-interview-why-ai-has-it-backwards/).
16. Prompt blocks are independently replaceable. Preserve untouched blocks, headings and whitespace;
    never collapse the prompt into Role or silently hide its other sections. Main is the sole headless
    Card and has no CLI tab. Every saved non-Main Hermes Card retains its own Hermes CLI. Builder's
    lower CLI remains bound to `builder`, mounted, and initially collapsed beneath Main chat.

## Graph meaning and authority

Engraphis owns ThinkGraph; Graphiti/Neo4j owns KnowGraph; native CBM owns CodeGraph; AGE owns
saved Card relationships and observed Run lineage. Do not resurrect Constellation or combine writers.

Main is not the owner of ThinkGraph writes. The completed-pair Python preparation and settlement rails remain,
but the rejected TypeScript child-Card executor was removed and no current automatic caller is claimed.
Do not reconnect those rails through a direct target runner, regex-first graph skeleton, pending-candidate
queue, approval state, shadow graph, broad historical deletion, direct model edge writer, second extractor,
or database-side semantic shortcut.
KnowGraph retains actual sourced research through its existing owner. Its dedicated queued Entity write
records one exact structural `ABOUT` attachment; `MENTIONS` remains extraction output, not attachment authority.
One Know is one atomic `know.v1` episode with both a cited supporting idea and a cited counter idea. Do not
store or project a one-sided cited statement as a Know, split its two sides into separate Knows, or attach the
same Know to multiple Entities. Only Entities are visible Project graph nodes; episodes and citations remain
attached evidence/provenance.

Current grounding is one most Relevant plus one distinct most Recent record from each authority by default.
Native owners produce candidates and Jev ranks them; TypeScript must not rank prose, substitute recency for
failed relevance, or persist a relevance decision as graph truth. Inspector Search/Results is transient and
must not widen Main/Builder's default packet.

Keep entity identity, attributed claims, uncertainty, meaningful relationships and provenance distinct.
A stored note, queued episode, native ID or attractive graph is not proof of useful knowledge.
Keep long evidence in inspectable details; do not manufacture short labels with keyword rules.
Do not populate product graphs with coding instructions, test expectations or invented persona facts.
A person's attribution belongs with source evidence; a test persona is not automatically a graph node.

Preserve the accepted renderer, size, motion, labels, presets, colors, controls and inspectors.
A request to inspect, test or capture a screenshot does not authorize visual changes. A data problem
does not authorize a renderer replacement, and a rendering problem does not authorize a data reset.

## Known failure patterns

| Failure | Prevention and disproof |
| --- | --- |
| PLAN headings leaked roadmap and audit prose into Builder input | Keep PLAN out of runtime input. Verify identical IDF bytes when PLAN changes or is absent; do not restore the removed loader. |
| Public Card fixtures contained revisions missing from real reads | Compare actual saved revision readback with the transport fixture before testing an edit. |
| A mocked PTY never emitted exit and remained stopping | Fix the fixture's lifecycle fidelity; preserve real session reuse and stop behavior. |
| A catalog import started native discovery during unit tests | Guard non-subject CBM/Graphiti discovery; retain exact public/private schemas and authentication assertions. |
| Pytest PYTHONPATH concealed a script-import failure | Test the existing executable bootstrap in isolation when imports change; do not add another bootstrap. |
| A healthy PTY or Gateway was mistaken for an executed Card turn | Prove real input, Hermes Gateway delivery, rendered output, and completion of the same saved Run. Do not restore an app plugin, callback bridge, or copied profile. |
| Duplicate skill IDs blocked native discovery | Compare exact identity/content through its owner. Do not weaken uniqueness or delete copies without scope authorization. |
| Missing usage became zero during transport or numeric coercion | Preserve unknown versus measured zero and forward native usage through the existing finish owner. |
| Shared or unmapped history was exposed to make a transcript readable | Prove Hermes session, saved Run, and Project-conversation attribution; preserve rejection of foreign or unknown content. |
| A component or callback existed without a live caller | Trace callers and exercise the actual path. A fixture that supplies a nonexistent callback does not prove integration. |
| Source tests passed while another revision was running | Compare loaded source identity before product claims. Build, health, saved execution and visual acceptance are separate. |
| Selected tools were skipped or assumed available elsewhere | Compare effective saved selection with the actual provider tool surface and executor receipt. A schema or Hermes connection claim is not availability proof. |
| Cleanup spread into profiles, databases, vendors or closed UI | Stop at the named boundary. Previous maintenance authorization is not a standing purge or restoration license. |
| A restore changed appearance but was called accepted | Identify the user-accepted baseline first; mechanics and Git equality do not substitute for Jeremiah's visual acceptance. |
| Decomposition, routing or knowledge meaning moved into deterministic code | Keep semantic work with models; code validates structure, scope and actual execution. No keyword planner or semantic sanitizer. |
| Work resumed from a stale plan or compaction summary as if complete | Reconcile current status and diff; mark each started item completed, removed, deferred or unproven before opening more work. |

## Evidence and completion

Report source exists, structural connection, focused tests, build, loaded health, real saved product
execution and Jeremiah's visual acceptance independently. A timeout is a timeout; an accepted Run
is not a completed Run. Repaired damage is recovery, not a newly delivered feature. Do not use
restored, complete, safe or passing to hide a missing proof level.

Do not change fixtures or expected behavior to obtain green tests. Preserve negative cases and
real contracts. A simulated unit test stays a simulation; never insert it into a product database.
Only enumerate a zero regression ratio for preservation invariants actually exercised.

## Historical reference — not current instructions

The full pre-audit incident record remains in Git at
`b6ff569b68bcfec3601b6db4669ac3aa86abecb1:DONT.md`. Use read-only `git show` for a relevant
incident; do not load the entire chronology as implementation instructions or restore removed paths.

| Historical material | Lasting lesson |
| --- | --- |
| August purge and repeated-churn record | Remove an authorized superseded path completely; do not add parallel runtimes, wrappers, fake activity or duplicate authorities. |
| September 4 Hermes CLI and inspector corrections | Preserve Hermes sessions, pull-up/collapse controls and distinct product surfaces; presentation is not execution proof. |
| September 8–9 graph migrations and rejected datasets | Old Constellation directions, exact historical dataset deletions and prior renderer experiments are superseded evidence, not current permission. |
| September 10 Builder/Card removals and startup repairs | The two named historical Card removals were exceptions. No unrelated Card, Run, profile, credential or graph may be deleted under them. |
| Old PLAN-loader, Team-policy and tool-suppression instructions | They describe removed approaches. Current source and current owner decisions govern; never revive them from a recovered document. |

Historical details and receipts remain recoverable from that exact Git object. They are condensed
here so the current prohibitions are readable and incompatible historical commands do not appear
as current law.
