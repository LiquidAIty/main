# Agent Construction Playbook

This is the compact operating playbook for Agent Builder. It teaches a repeatable way to turn useful
open-source code—including an existing agent system—into a saved Card without copying its runtime,
inventing a parallel platform, or putting controls in the wrong surface.

## 1. Define the bounded outcome

Record one Requested Delta and one Preservation Set before choosing technology.

- Name the unsolved user outcome and the Card that should own it.
- Identify the current owner of identity, reasoning, deterministic work, state, credentials, UI, and persistence.
- State the smallest reversible experiment, the path it would replace, and observable keep/remove criteria.
- Preserve saved Cards, profiles, sessions, wires, presentation attachments, model/provider selections,
  graph authorities, and unrelated work.

Do not create a new Card merely because a repository calls one of its classes an agent. A repository can
be a library, a tool set, a data source, a processor, an internal agent system, or a complete subsystem
beneath one Hermes Card.

## 2. Search open source first

Before designing code, search current public repositories and package sources. Prefer the repository's
official organization and primary documentation. Retain URLs and observed versions; never rank by stars alone.

| Question | Evidence to retain |
| --- | --- |
| User fit | Exact capability that closes the Requested Delta |
| Reuse seam | Public Python API, MCP, HTTP, stdio, gRPC, hooks, CLI, or artifacts |
| Native system | Runtime, workers/agents, scheduler, state, events, commands, and artifacts already present |
| Safety | Credential handling, network/effect surface, live/paper boundary, deterministic validation |
| Operations | Maintenance, release activity, tests, observability, restart and failure behavior |
| Legal | License, commercial-use limits, data/provider terms, attribution, trademarks |
| Integration cost | Dependencies, runtime/language fit, likely fork cost, upstream patch opportunities |

Return a short candidate matrix: choose one, reject the others with reasons, list unknowns, and propose the
smallest adapter proof. Searching creates no clone, dependency, Card, wire, credential, graph fact, or
external message.

## 3. Decide what the repository becomes

- **Library:** deterministic code called within Python rails.
- **Tool set:** bounded functions exposed through existing Card grants.
- **Source subsystem:** collects and normalizes evidence with provenance.
- **Processor subsystem:** computes forecasts, portfolio/risk metrics, comparisons, or artifacts.
- **Internal agent system:** stays intact beneath one Hermes Card; Hermes supervises bounded work through
  its public seam.
- **Agent UI app:** retains its native live product surface when that surface is the value.

An internal subsystem worker is not automatically a saved Card. Promote a role to a peer Card only when it
needs its own durable identity, profile, memory, permissions, sessions, UI, or independent Mag One participation.

## 4. Put each concern in one product surface

| Surface | Content |
| --- | --- |
| Card/IDF workspace | Stable prompt, current mission, runtime/profile/model, grants, tools, skills, memory policy, Team policy, graph context, dynamic references, Script, identity, wires, presentation |
| Named subsystem Card tab | Adapter contract, public capabilities, readiness, lifecycle, native workers/agents, and diagnostics |
| Agent UI | Live dashboard, observations, charts, evidence, artifacts, work status, and authorized interventions |
| Agent UI Inspector | Durable domain sliders/selects, display options, broker/data references, cadence, risk, and subsystem parameters |

Agent settings never move into the Agent UI Inspector. The named subsystem tab is not another dashboard or
agent editor. Agent Builder may edit the content and form schema inside an existing Card presentation, but
does not invent new Card shapes.

## 5. Use the Card-managed subsystem contract

```text
saved Hermes Card
  -> one saved top-level Python Script
  -> granted product-neutral adapter tools
  -> thin Python adapter on Python rails
  -> repository public API or public protocol
```

`card-subsystem.v1` declares only an ID, label, Python adapter kind, named capability set
(`state`, `events`, `commands`, `artifacts`, `readiness`), named Card tab visibility, and optional
configuration-schema identity. It starts nothing and grants nothing.

Python is the control boundary, not a rewrite requirement. JavaScript, TypeScript, Rust, JVM, native, or
remote systems remain usable through a supported public protocol. Direct vendor-private member access is
not an adapter seam. If no public seam can satisfy the bounded experiment, stop and propose an
upstream-shaped pull request before forking.

## 6. Preserve agent systems instead of flattening them

- Keep their useful scheduler, replay, tools, traces, lifecycle, and deterministic machinery.
- Put one saved Hermes Card above the system as its durable supervisor.
- Disable subsystem-owned direct model/provider calls unless they can use saved account-backed Hermes
  authority; do not add BYOC credentials.
- Use the Card's optional native Hermes Team for bounded comparison, research, or review—not every heartbeat.
- Keep Mag One outside as the manager of peer saved Cards. It does not replace Hermes or the subsystem.
- Expose native workers in readiness/evidence; do not copy them into feature-limited AutoGen Assistant Cards.

## 7. Make several agents from one pattern safely

Several Cards may reuse one adapter and one support team. Each Card still owns an isolated profile,
workspace, memory, sessions, stable strategy prompt, risk configuration, Script, Runs, and subsystem state.
The shared team returns typed evidence or review artifacts; it never silently changes another Card's settings.

For strategy families, treat investor/trader styles as transparent theses and policies—not impersonation
or promised performance. Run every strategy in sandbox/paper mode. Compare candidates using out-of-sample
and regime-aware evidence, drawdown, risk-adjusted return, turnover, slippage assumptions, stability, and
data quality. A comparison Card may nominate a candidate for later review; it cannot enable live trading.

## 8. Keep authority exact

```text
native availability
intersection saved Card/profile selection
intersection current Run authorization
intersection required user approval
```

Agent Builder receives one exact create/edit operation. An edit may change only its authorized subset of
prompt, tools, typed configuration, saved Script, and subsystem attachments. The canonical deck/revision
save is the only persistence path. No direct database patch, provider/model fallback, hidden adapter, or
second runtime is allowed.

Function before form is a permanent construction gate:

```text
repository public seam
-> working adapter
-> real readiness/state
-> one bounded proven operation
-> then named tab, Agent UI, and settings Inspector
```

Source fixtures and component tests may prove mechanics, but they do not open this gate. The bounded
operation must produce the subsystem's real state/events and at least one native or explicitly transformed
artifact, cross the authenticated product transport, and render from the returned receipt. A presentation
may show an honest unavailable state during proof; it may not imply an unproven capability.

## 9. Produce a graph evidence packet, not graph filler

After proof, return a compact packet for a later graph-authorized agent:

```json
{
  "decision": "chosen repository and adapter seam",
  "sources": [{"url": "primary source", "claim": "bounded observed fact"}],
  "components": [{"identity": "native ID", "role": "source|processor|support|subsystem"}],
  "contracts": [{"name": "typed boundary", "owner": "authority"}],
  "proofs": [{"command": "bounded proof", "result": "pass|fail|unproven"}],
  "unknowns": ["unproven or credential-dependent fact"]
}
```

AgentGraph may later observe Card/wire/Run identities. ThinkGraph may record the evaluated decision.
KnowGraph may record sourced repository/license/API facts. CodeGraph remains native CBM structure. Never
write proposals as observed truth or copy this how-to procedure into a graph.

## 10. Proof before expansion

1. Current source and public extension seam.
2. Strict configuration/attachment validation and inverse regression checks.
3. One top-level Script compiles against only granted tools.
4. Adapter state/readiness and explicit unavailable states without fake values.
5. Pass the real receipt through the authenticated backend route, one event stream, stable-ID
   reconciliation, and the existing Agent UI. Verify the rendered UI reads that receipt rather than a
   hand-built frontend fixture. Keep controls gated by real availability.
6. Canonical Card save/readback with identity, profile, presentation, and wires preserved.
7. One real saved Card Run reaches native profile, skills, memory, and adapter tools.
8. Mag One invokes the same Card through the existing worker edge.
9. Only then consider consequential effects, new dependencies, more Cards, or upstream code changes.

If a credential, service, lifecycle, or approval is absent, fail closed and report it. A health check,
static test, graph read, or UI render is not a runtime receipt.
