# DONT.md — preserve the real product

Use this for prohibitions and known failure patterns. [plugin.md](plugin.md) owns the positive Hermes
web-plugin contract; [AGENTS.md](AGENTS.md#scope-and-closed-features) owns execution law;
[PLAN.md](PLAN.md) owns current status; [ARCHITECTURE.md](ARCHITECTURE.md) owns source boundaries.
A historical report is evidence, never permission to act.

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
6. IDD is the authoring definition source: a field list in Cards, a dictionary for Builder, and
   dropdown/default definitions for templates. It is not runtime input, an IDF, a prompt envelope,
   an execution receipt, or a second tool catalog. Refer to existing catalogs and executable schemas;
   do not copy option lists between consumers.
7. No fake graph data, sample records, placeholder activity, simulated success or invented receipts.
   A saved record can still be the wrong data. Prove useful behavior using a real project.
8. Product instructions belong in these documents, never automatic graph inserts or UI banners.
   Do not add explanatory panels, evidence panels or branding to Card controls.
9. Main/Builder's established pull-up behavior is intentional. Preserve their session and input
   ownership. Do not change mounts, polling, panel dimensions or collapse behavior as a side effect.
10. Keep saved tools available without Card Python. The current `tool_recipe` uses the official
    LiquidAIty plugin's bounded child of the Hermes host interpreter and saved MCP grants; it does not
    replace or re-authorize ordinary profile tools. Do not invent a tool or widen grants to make proof
    succeed. WorldView layer visibility is not tool authorization, and Hermes profile memory is not a
    Tools-tab grant or LiquidAIty-selected toolset.
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

Engraphis owns ThinkGraph; Graphiti/Neo4j owns KnowGraph; CBM owns CodeGraph; AGE owns
saved Card relationships and observed Run lineage. Do not resurrect Constellation or combine writers.

Main and Bot Mode are not ThinkGraph processing owners. Hermes's plugin host may observe a completed Main
session and run the one-way database-to-database intake through `ctx.spawn_task`; Main does not call,
supervise, steer, approve, or settle it. The hook captures the exact User/Main `state.db` row IDs at the
completed-turn boundary; Python rails reads only those rows, the registered auxiliary model extracts
structured candidates, and Engraphis owns the pair marker plus zero-or-more settlement.
Do not add Main tools, grants, prompt instructions, a Main session route, history polling, caller-supplied
chat copies, a TypeScript conversation store, a minimum Think count, or a Python semantic validator.
Do not migrate or replay old test conversations, fabricate a Run receipt, add an application/Hermes prompt
queue, restore a generic child-Card executor, or substitute a regex-first skeleton, candidate/approval
state, shadow graph, direct model edge writer, or second extractor.
KnowGraph retains actual sourced research through its existing owner. Its dedicated queued Entity write stores
one exact `entity_uuid` property and removes any Know `ABOUT` or `MENTIONS` attachment edge.
One current Know is one first-class `Episodic:Know`: one verified source document and exact passage, one
self-contained observation, one separately labeled bounded interpretation, and optional direction relative to
an explicit proposition. Its typed citation properties and plain-text episode content must remain durable and
searchable. Do not bundle several sources into one Know, repeat the same source-backed finding, or attach one
Know to multiple Entities. Balance belongs across research coverage and synthesis, not as a mandatory
positive/negative pair inside every record. Only Entities are visible Project graph nodes; Knows and citations
remain attached evidence/provenance.

Do not restore an automatic Jev relevance filter or default Relevant/Recent packet before Card inference.
The actual task and deliberate provider graph selections own input context. Keep existing provider retrieval
available; do not replace the removed filter with another ranking loop. The current inspector shows
at most two provider-projected attached records; it has no Search/Results or Relevant/Recent control.

Keep entity identity, attributed claims, uncertainty, meaningful relationships and provenance distinct.
A stored note, queued episode, provider ID or attractive graph is not proof of useful knowledge.
Keep long evidence in inspectable details; do not manufacture short labels with keyword rules.
Do not populate product graphs with coding instructions, test expectations or invented persona facts.
A person's attribution belongs with source evidence; a test persona is not automatically a graph node.

Preserve the accepted renderer, size, motion, labels, presets, colors, controls and inspectors.
A request to inspect, test or capture a screenshot does not authorize visual changes. A data problem
does not authorize a renderer replacement, and a rendering problem does not authorize a data reset.

## Known failure patterns

| Failure | Prevention and disproof |
| --- | --- |
| PLAN headings leaked roadmap and audit prose into Builder input | Keep PLAN out of profile SOUL, literal user input, and the visible navigation map; do not restore any documentation loader or IDF layer. |
| Public Card fixtures contained revisions missing from real reads | Compare actual saved revision readback with the transport fixture before testing an edit. |
| A mocked PTY never emitted exit and remained stopping | Fix the fixture's lifecycle fidelity; preserve real session reuse and stop behavior. |
| A catalog import started provider discovery during unit tests | Guard non-subject CBM/Graphiti discovery; retain exact public/private schemas and authentication assertions. |
| Pytest PYTHONPATH concealed a script-import failure | Test the existing executable bootstrap in isolation when imports change; do not add another bootstrap. |
| A healthy PTY or Gateway was mistaken for an executed Card turn | Prove real input, Hermes Gateway delivery, rendered output, and completion of the same saved Run. Do not restore an app plugin, callback bridge, or copied profile. |
| Duplicate skill IDs blocked Hermes skill discovery | Compare exact identity/content through its owner. Do not weaken uniqueness or delete copies without scope authorization. |
| Missing usage became zero during transport or numeric coercion | Preserve unknown versus measured zero and forward provider usage through the existing finish owner. |
| Shared or unmapped history was exposed to make a transcript readable | Prove Hermes session, saved Run, and Project-conversation attribution; preserve rejection of foreign or unknown content. |
| A component or callback existed without a live caller | Trace callers and exercise the actual path. A fixture that supplies a nonexistent callback does not prove integration. |
| Source tests passed while another revision was running | Compare loaded source identity before product claims. Build, health, saved execution and visual acceptance are separate. |
| Selected tools were skipped or assumed available elsewhere | Compare effective saved selection with the actual provider tool surface and executor receipt. A schema or Hermes connection claim is not availability proof. |
| Cleanup spread into profiles, databases, vendors or closed UI | Stop at the named boundary. Previous maintenance authorization is not a standing purge or restoration license. |
| A restore changed appearance but was called accepted | Identify the user-accepted baseline first; mechanics and Git equality do not substitute for Jeremiah's visual acceptance. |
| Decomposition, routing or knowledge meaning moved into deterministic code | Keep semantic work with models; code validates structure, scope and actual execution. No keyword planner or semantic sanitizer. |
| Work resumed from a stale plan or compaction summary as if complete | Reconcile current status and diff; mark each started item completed, removed, deferred or unproven before opening more work. |

## Incident record — 2026-11-07 Rejected workspace-open synchronization and provisioning

This is an owner-requested account of a Codex implementation failure, not a proposal or a restoration
recipe. Codex was supposed to preserve saved Cards, the wire-controlled roster, ordinary Hermes Bot Mode,
and the simple displayed graph map. Instead, it added application-owned configuration work that the owner
had not requested or approved. Calling that work "synchronization," "provisioning," or a "helper" did not
make it necessary. The owner had to repeatedly stop the work and demand its removal.

### What Codex added and why it was harmful

An effect in `client/src/pages/agentbuilder.tsx` ran when the saved deck loaded or its revision changed.
It called three bulk operations: `synchronizeHermesProjectProfileCredentials`,
`synchronizeHermesSavedCardProfiles`, and `synchronizeHermesTopologyProfiles`. A workspace read therefore
became a sequence of credential writes, full-profile rewrites, and roster publications, even when the
owner had not edited an agent. An unrelated placement/deck revision could enter the same path.

The credential loop wrote each profile's environment and then called `reload.env` and `reload.mcp`
against its session. Those were not harmless "make sure it is ready" reads. The installed Hermes
`tui_gateway/methods_tools.py` reload handler tears down/re-discovers MCP registrations, refreshes live
session tools, and explicitly warns about prompt-cache invalidation. Repeating it across Cards can
repeatedly rebuild the shared runtime while Main is trying to start. The profile rewrites also caused
configuration rescans. This cost was created by the application's calls; it was not evidence that Bot
Mode needed a second lifecycle owner.

The recorded Main turn had about **221 seconds between admission and the provider request**. Profile
rescans and WebSocket stalls occurred in that interval. The graph-map read measured **33 ms** in a
separate observation. The owner reports that the preceding working turn took **18 seconds end to end,
including the model call and return**; the minutes-long delay did not exist before these additions.
Treat this as an introduced regression, not acceptable startup overhead or an inherent cost of Bot Mode.
The logs identify needless overlapping work, not a complete allocation of every second to one function.
Do not blame the map or substitute an upstream bug for the demonstrated application-side cause.

This was wasted implementation and recovery work: code, tests and explanations were built for an
unapproved layer; the owner then had to spend attention correcting the scope; the same code had to be
traced and deleted while preserving working data. After being told to delete it, Codex briefly tried a
smaller provisioning helper and then placed that work in Card creation. Both were rejected and removed.
Deletion does not mean "move it somewhere less visible." That replacement attempt repeated the error.

### What was removed and what remained

- Removed the workspace-open effect, revision guard, failure aggregation, exclusive imports, bulk
  profile-publication module and its exclusive test.
- Removed automatic enablement, the bulk credential-minting endpoint and exclusive tests, credential
  fingerprints/bookkeeping, and forced environment/MCP reload calls. No replacement at startup, Card
  creation, Send, a timer, a background task, or a renamed helper is accepted.
- Removed map diagnostics and redundant serialization/config-copy work. The displayed Entity map,
  Project authorization, linked mentions and the once-per-turn request-only read remain.
- Retained the existing explicit Card save, and attached roster publication to a successful saved edit
  only when authorized membership changes. A last qualifying wire removal must publish an empty roster.
- Preserved existing credentials, saved grants, authorization checks, Hermes 0.23.0, `process_complete`,
  Skills, ThinkGraph, and the separate approved Team/Magnetic policies. A credential verifier or owner
  check still used by real MCP calls is not dead code merely because the rejected issuer was removed.

The deletion pass opened/reopened Trading and compared 44 profile/configuration files: no file writes
occurred on open or Card movement. A reversible Card edit affected its own profile. Wire edits affected
changed rosters. One restore drag hit an overlapping blue wire; the exact original edge records and
affected rosters were restored, not approximated. Final readback preserved 11 Cards, 9 wires, original
placements and all original profile-file contents. An authenticated `graphiti.get_know` call under the
saved KnowGraph profile returned the existing record in **376.81 ms**, without a new prompt or write.
That proved tool access, not citation quality, a new research result, or recovery of the full 221 seconds.

After the owner authorized one ordinary Main rerun, Send was recorded at **18:14:16.793 Eastern**;
Hermes admitted it at **18:14:16.964**, opened the provider request at **18:14:19.597**, and dispatched the
615-character response at **18:14:23.864**. That is **7.071 seconds from Send to response dispatch**,
including one provider call reported as **4.1 seconds**. The reply and enabled Send control were then
observed in Preview while ThinkGraph remained active independently. Exact browser paint time was not
instrumented. The minutes-long wait did not recur in this run, but **2.633 seconds of admission-to-provider
preparation still exceeds the owner's one-second application budget**. Do not call that residual cost a pass.

### What future Codex work must do instead

Hermes owns Bot sessions, delivery, reply capture/completion, MCP discovery/connections/tool dispatch,
and its own cache and refresh lifecycle. The version-matched positive contract and source references are
in [plugin.md — Official Hermes Bot Mode and MCP ownership](plugin.md#official-hermes-bot-mode-and-mcp-ownership).
LiquidAIty's retained difference is saved wire authority, not another Bot runtime. Team/Magnetic policy
is separate and must not be removed as a side effect of deleting the rejected layer.

1. Opening/reopening reads saved state. Moving a Card, receiving a reply or changing an unrelated deck
   revision must perform zero profile writes, credential refreshes, MCP reloads or roster publications.
2. Publish only the configuration changed by an actual edit, through its existing owner. Do not republish
   the whole deck as a repair, readiness check, migration, reconciliation or safety measure.
3. Do not add runtime coordination helpers, aliases, registries, credential issuers, managers, listeners,
   watchers, pollers or caches to imitate Hermes. A different filename is not a different design.
4. Treat `process_complete` and reported sender metadata as runtime evidence, not disposable spam.
   Never suppress a genuine result/failure merely to make chat look cleaner.
5. Test the tool as the receiving saved Card: same profile, connection, credentials and grants. Check the
   actual returned schema/result. A checked box, prompt assertion, mock or manually inserted Know is not
   proof that the agent can use the tool or persist a valid result.
6. Any application/context operation above the owner's one-second budget is suspect and must be reported
   separately from inference. Use existing request evidence; do not add another telemetry system, repeated
   prompts or background benchmark to hide the cost. Unknown elapsed time is not a pass.
7. A missing/expired credential is an exact authentication problem to report. Hermes can use supported
   configured credentials/OAuth; it does not magically mint LiquidAIty's custom bearer or extend its
   expiry. Do not resurrect the banned issuer or weaken authorization to conceal that limitation.
8. Remove exclusive callers, imports, mounts, types, tests and stale normative documentation with a
   rejected path. Preserve live authorization and unrelated working behavior. No replacement is implied.

The lesson is not "write a better synchronization helper." It is **do not add this layer again**.
Its measured cost and the owner's repeated corrections are evidence against it, not a backlog of features
to recreate. Preserving progress requires following the existing owner, not making the owner debug an
assistant-invented runtime before their actual feature can work.

## Incident record — 2026-10-23 Hermes Bot and TaskGraph boundary overreach

An attempted Bot Mode, Team and Magnetic repair repeatedly expanded beyond the owner's requested
boundary. Work was described or implemented as application-owned Card execution, direct-target routes,
session maps, polling, copied task behavior, large Card-editor prompt surfaces and broad source deletion
instead of preserving Hermes as the execution owner. The resulting product symptoms included delayed
Main admission, `session_stream_transport_failed`, roster/profile mismatches, missing subagent selection,
responses that claimed a Card was working without a corresponding `message_agent` call, and Canvas activity
that did not reliably represent actual running Hermes work. Broad deletion and restoration also placed
unrelated UI, Card, runtime and owner work at risk while the requested repair concerned only the bounded
Bot/TaskGraph integration.

The owner's correction establishes the following permanent controls for this boundary:

1. Treat the three accepted Hermes differences as three independent seams: the profile-scoped local Bot
   roster, the reduced Automatic Team specialization over Hermes' existing task ledger, and the nullable
   root-scoped assignee ceiling used by Magnetic.
2. Do not call all three “Bot Mode changes.” Only the profile-scoped roster changes Bot target authority.
3. Preserve Hermes ownership of `message_agent`, Bot Chats, sessions, delivery, queueing, task rows,
   dependencies, dispatch, workers, retries, completion and wakeups. LiquidAIty projects saved authority and
   observes events; it does not duplicate those owners.
4. Reuse upstream Triage, decomposition, root wakeup, worker execution, goal judging and notification before
   adding any Team code. Automatic Team may add only the missing direct entrance, exact root-local worker
   policy, mandatory fanout, depth-one restriction and bounded failure behavior.
5. Saved enabled Card wires determine Bot reachability in LiquidAIty. The application computes the exact
   profile list; the Hermes resolver enforces it. Prompt prose is never the authorization boundary.
6. Saved blue topology determines one Magnetic root's worker ceiling. A global dispatcher allowlist, prompt
   reminder or post-hoc application cancellation is not an equivalent mission-scoped authority.
7. Each reachable Card contributes only its saved `[ORCHESTRATOR SKILL]` introduction to an orchestrator's
   effective prompt. Never copy a connected Card's full prompt, create a combined editable roster block, or
   add a Card-link shortcut disguised as an introduction.
8. All saved Cards still start and bind when a Project opens. Main remains headless, every non-Main Card
   retains its existing CLI presentation, Magnetic remains a Bot without a CLI, and no repair may redesign
   the accepted UI.
9. Agent counts and Card activity must come from actual Hermes events and correlated Run observations. A
   planned roster, pending intent, prompt mention or synthetic status never counts as a running agent.
10. If repair attempts produce serial contract errors at adjacent layers, stop adding adapters and re-audit
    the ownership seam. Repeated error-by-error patching is evidence that the implementation boundary is
    wrong, not permission to create another runtime.
11. Never restore a historical Hermes overlay wholesale. Recover only the exact source-proven behavior that
    remains accepted against the current pinned upstream version, with focused tests for ordinary unchanged
    behavior as well as the local difference.
12. A Bot/TaskGraph repair must remain a small semantic delta. Unexpected multi-thousand-line changes,
    broad route or UI edits, or large unrelated deletion counts require an immediate stop and owner review.
13. Do not delete or reset saved Cards, Runs, profiles, sessions, databases, graph data, layout or unrelated
    source to make this boundary easier to test. Test state is not permission to destroy product state.
14. Report source, deterministic tests, build, loaded application, real Main/Card execution, persistence,
    real activity rendering and owner visual acceptance separately. A lower proof tier never fills a higher
    one, and a model statement that work started is not execution evidence.

## Incident record — 2026-11-04 Never destroy the Hermes runtime boundary again

This incident must be remembered as a runtime-ownership failure, not as an isolated bug in one route.
The immediate symptom was a failed Main-to-KnowGraph handoff, but the destructive mistake was repeatedly
treating that failure as permission to build, patch, or delete an application-owned imitation of Hermes.
That approach consumed attention, reopened completed UI, confused source with the loaded runtime, and made
the repair harder to reason about. Future work must begin from the architectural fact below and must stop
the instant it starts recreating an owner Hermes already provides.

### The architectural fact

LiquidAIty is a **Hermes web-dashboard plugin and its own UI**. It is not a Hermes Desktop plugin, not a
second agent runtime, and not a Gateway manager. The existing LiquidAIty React workspace stays intact
inside its registered Hermes dashboard page. Hermes
Desktop is useful reference evidence, but its renderer code, `host.request`, Electron bridges, private
stores, and private hooks are not automatically public Hermes APIs and must never be copied merely because
Desktop uses them. The canonical positive design is [`plugin.md`](plugin.md): reuse Hermes's documented
Gateway JSON-RPC contract and its generated `@hermes/shared` TypeScript client instead of recreating that
client in LiquidAIty.

The ownership line for Main is literal:

```text
LiquidAIty TypeScript = pixels, exact Project/Card/wire configuration, structural validation,
                       and the thinnest mapping from Hermes-generated events into those pixels
Hermes = protocol client contract, chat session, composer submission, history, Stop, voice, images,
         admission, execution, Bot Mode delivery, late replies, reply identity, and completion
```

Cards configure Hermes profiles. Saved enabled wires define the exact authorized Bot roster. Main receives
the user's original input, including literal `@mentions`; the UI must not parse a mention into a direct
target, manufacture a recipient-specific prompt, or prepend a synthetic `@Card` identity to a reply.
Hermes decides whether Main invokes `message_agent`, performs the delivery, and reports who replied.

The public Hermes entries are the directory-plugin and web-dashboard contracts Hermes itself discovers:

```text
plugin.yaml
+ __init__.py exposing register(ctx)
+ only documented PluginContext capabilities

dashboard/manifest.json
+ a prebuilt bootstrap registered through window.__HERMES_PLUGINS__
+ window.__HERMES_PLUGIN_SDK__ for host React and authenticated browser helpers
```

Use `PluginContext` methods only for the capabilities they actually promise. For example,
`ctx.inject_message(...)` is an in-process, profile-scoped, consent-gated request to an already-live Hermes
host. It is not the browser chat API. Hermes separately documents Gateway JSON-RPC over WebSocket for a
full custom UI and ships the generated request channel, event types, heartbeat and reconnect/replay logic in
`HermesLatest/apps/shared`. Reuse those exact components. Do not fill a gap with a Desktop `plugin.js`, an
Electron mount, an iframe, a private renderer import, a LiquidAIty-authored Gateway decoder, a backend
requester, an SSE reconstruction, direct state-database access, or another session API.

### What destroyed the boundary

The rejected application path accumulated all the recognizable parts of a duplicate runtime:

```text
useAgentBuilderMainChat
→ mainSessionClient
→ /api/main/session
→ mainSession.routes
→ backend-owned Gateway connection and requestForBot
→ application filtering of message.delta / message.complete
→ application SSE text / done / error frames
```

That path opened sessions, retained session handles, submitted prompts, decoded completion, forwarded Stop,
owned browser voice state, read history, filtered events, persisted selected replies, and attempted to
discover later Bot activity. Calling it a “thin bridge” did not make it thin. The presence of admission IDs,
session maps, event listeners, completion flags, response streams, history watermarks, activity refreshes,
or reply-wait logic is sufficient evidence that LiquidAIty has crossed the boundary. Do not keep any such
piece as a compatibility wrapper. Do not rename it and claim the runtime was removed. Do not move the same
dispatcher from one route to another and call that deletion.

The following replacements are equally prohibited:

- a new `/api/main/session` equivalent under another route name;
- a generic `requestForBot`, `runCard`, `submitToProfile`, or direct-target helper;
- a LiquidAIty-authored JSON-RPC decoder, EventSource/SSE chat reader, transcript poller, or completion waiter
  that replaces Hermes's generated client and replay contract;
- a background listener that waits after Main's answer and injects a second application-owned response;
- an iframe or embedded Hermes Desktop renderer;
- a Desktop runtime `plugin.js` or `@hermes/plugin-sdk` conversion of LiquidAIty;
- application discovery, startup, restart, ticket minting, or lifecycle management for the Gateway (calling
  a documented host-supplied `buildWsUrl` or connection-descriptor function is consumption, not management);
- direct reads or writes of Hermes SQLite state as a product integration;
- a fallback model call, mock Card, duplicate transcript, or synthetic receipt when Hermes is unavailable.

If a proposed repair contains one of those shapes, stop before writing it. The correct next action is to
identify the missing public Hermes plugin capability, preserve every supported path, and report the exact
unsupported seam. A blocked real boundary is better than a successful fake one.

### Deleting transport must never delete the UI

When the owner says to remove a duplicate transport, delete the transport—not the chat, composer, Card
canvas, graph UI, voice control, image control, Builder surface, or layout. The Main chat component is a
pixel surface and must remain present. Its visual component types may be made owner-local after transport
files are deleted, but the UI must not be replaced with `null`, a blank pane, or a different product.

At the same time, a mounted composer whose Send callback always returns `false` is not a preserved working
chat. It is only preserved pixels and must be reported as unsupported at the live binding tier. Never use an
inert Send button to make screenshots look intact or to claim that chat survived. Either bind the existing
UI through a documented Hermes plugin capability or state that the capability is missing. Do not blur those
two states.

Use this deletion sequence whenever a duplicate runtime is found:

1. Freeze all repair ideas. Do not design the replacement while deleting the rejected path.
2. Name the exact transport files, route mounts, callers, shutdown hooks, tests, and dependent imports.
3. Delete the transport owner, its client decoder, its hook/state machine, and its backend requester.
4. Preserve frontend components and layout separately. Remove only type imports that belonged to the
   deleted transport; keep presentation types with the presentation owner.
5. Preserve unrelated Hermes-owned surfaces such as the Builder CLI. If a deleted helper was shared, move
   the surviving behavior to an existing Hermes-owned entrance; never carry the deleted Gateway requester
   forward under the CLI's name.
6. Search the executable source for every deleted symbol, path, route, and replacement alias.
7. Run source and spec typechecks, focused UI tests, builds, and `git diff --check` before considering a
   new integration.
8. Only after residue is zero may a new repair use the real public Hermes plugin and programmatic-integration
   APIs, with `@hermes/shared` rather than a new protocol implementation.

Do not interleave steps 1–7 with speculative fixes. That was the specific failure mode in this incident:
each newly noticed possibility became another branch of work before the invalid branch had actually been
removed. Deletion-first is not ceremony; it prevents the next layer from depending on residue that should
not exist.

### Follow the recorded failure, not a familiar substitute

The retained Main admission `c32b6621fb7d4b43a03487296485ac99` is the diagnostic anchor for this incident.
Hermes row 688 recorded the exact model-selected call:

```text
message_agent(target="knowgraph", message="...")
```

Hermes row 689 recorded:

```text
_handle() missing 1 required positional argument: 'names'
```

Those rows prove that Main selected `message_agent`, supplied a target and message, and failed inside the
tool before delivery. They do not prove that KnowGraph ran, that a reply was lost, that the saved roster was
wrong, or that LiquidAIty chose the wrong recipient. The Trading Project's saved Main profile configuration
already included `knowgraph` in its exact Bot roster.

The Hermes source transition must also be stated precisely. One vendor revision changed
`bot_mode_probe._handle` from `_handle(name)` to `_handle(name, names)` and repaired most callers, while one
`bot_mode_dm` self-target call remained `_handle(me)`. A later source change corrected that caller to
`_handle(me, roster)`. Current source is already correct. Do not edit an already-correct line, pass a dummy
list, patch LiquidAIty with a different workaround, or call a generated/install workspace “stale” without
correlating it to the exact admission. A vendor checkout updated to the latest version can still contain a
vendor defect; “latest,” “current checkout,” “installed copy,” and “code loaded by this admission” are four
different claims.

For every recorded runtime exception, report these facts separately:

1. what the retained receipt or traceback proves;
2. what current source proves;
3. what exact loaded source identity is correlated, if any;
4. whether the defect belongs to LiquidAIty, the public Hermes plugin contract, or Hermes vendor code;
5. which proof is absent.

Never infer loaded identity from a nearby environment directory, update receipt, process name, commit title,
or matching error string. Never call code stale merely because another copy differs. Never claim a source
fix resolved a live failure without a new authorized loaded run.

### Main completion and a later Bot reply are independent

Main's foreground answer must be allowed to finish immediately. A later authorized Bot Mode reply is a new
Hermes-owned event with Hermes-owned sender identity. Do not hold Main's response open while research runs.
Do not make Main wait for another profile. Do not convert `message_agent`'s queued acknowledgement into a
completion receipt. Do not infer the sender from the original `@mention`, target roster, answer prose, or
application Card selection.

Displaying a later reply correctly requires Hermes's documented session event/replay contract, session/
Project correlation, and Hermes sender identity. The display must append the authorized reply once, in the
correct Project, and detach its pixel listener when the Project changes or the view closes. Use the generated
Gateway event types and `session.events.since` replay already implemented by `@hermes/shared`; do not recreate
Desktop's event store, write another listener protocol, or infer identity inside LiquidAIty. A reply-display
fix also cannot repair a `message_agent` call that failed before delivery.

### Saved Card memory and learning

Saved Card profiles use the existing catalog `holographic` memory provider. They disable the built-in
`MEMORY.md`/`USER.md` stores and the automatic background review that creates or edits skills. Do not restore
the removed Hermes Learning Graph controls in the Card editor, another Markdown-memory manager, or automatic
skill-making UI. Engraphis/ThinkGraph and Graphiti/KnowGraph remain separate MCP-backed graph authorities;
they are not folded into Holographic and Holographic is not rendered as either graph.

### Project cleanup is not runtime repair

Project deletion and Bot Mode repair are separate authorities. On 2026-11-04 the owner explicitly deleted
every saved development Project except `Trading` so future diagnosis could not drift into broken proof
Projects. That deletion did not authorize deleting repository products or source evidence. In particular,
`agent-products/nrgsim` remains source reference for later work even though its former saved Projects were
deleted. Never treat a missing saved Project as permission to remove its repository folder, and never use a
repository folder as evidence that a saved Project still exists.

Before any destructive data action, list exact Project IDs, names, codes, and owner scope; state the survivor;
use the current application deletion order in a transaction; and read the Project table back. Do not broaden
that request into profile, graph, database, runtime, source-folder, or Git deletion. No destructive action is
an acceptable way to make a runtime test easier.

### History is evidence, not a restoration menu

Review transport history with parent-to-commit diffs, not commit messages. This boundary repeatedly removed
and reintroduced activity readers, history refreshes, response routes, direct recipient dispatch, session
opening, and late-reply persistence. A dispatcher moved into a new helper is still present. A route removed
from one commit and restored in a later commit is not an approved design merely because it once worked.

When six relevant diffs are requested, report only diffs that actually change delivery behavior. For each,
name the SHA, file and symbol, and the observable change. Say explicitly whether behavior was added, removed,
reintroduced, or merely moved. Never infer intent from a title such as “restore,” “working,” “thin,” or
“cleanup.” Current owner direction and current source decide what survives.

### Proof and stop conditions

The zero-regression requirement still applies, but it may only be claimed for exercised invariants. Report
these tiers independently:

```text
SOURCE: exact owners, deletions, public plugin contract, and residue search
OFFLINE: focused tests, typechecks, builds, and diff checks
LOADED: the running application loaded the changed source
LIVE HERMES: a real saved Main turn and real message_agent delivery completed
PERSISTENCE: authoritative state was written and read back
VISUAL: the loaded UI was inspected and accepted
```

A passing typecheck does not prove chat. A mounted composer does not prove Send. A queued tool response does
not prove a reply. A saved roster does not prove delivery. A source correction does not prove the loaded
runtime. A real Main answer does not prove a later KnowGraph reply. With no authorized new prompt, say
`LIVE HERMES: NOT RUN` and do not soften it.

Stop immediately and return to the owner boundary when any repair requires:

- a Desktop plugin or private renderer API (the documented generated Gateway client is not a private renderer
  API);
- Gateway lifecycle management in LiquidAIty;
- another Main route, client stream, session map, or reply waiter;
- a vendor edit not explicitly authorized by the active PromptSpec;
- deletion of chat pixels or another closed frontend feature;
- a new data owner, transcript, state machine, scheduler, poller, or fallback;
- an unproven claim that a generated environment executed a retained admission;
- a live prompt, restart, Git mutation, or data change that the owner prohibited.

The correct standard is not “make something answer.” It is: preserve the UI, preserve saved authority,
remove duplicate runtime ownership completely, use only Hermes's documented plugin and programmatic
contracts, and tell the truth when a required capability remains unavailable. Never destroy the real runtime
again in order to produce a success-shaped demo.

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
