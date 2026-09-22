# Hermes Plugin Candidates

Audit date: 2026-09-22

## Decision

There is exactly one high-confidence LiquidAIty Hermes-plugin responsibility today: the existing profile-scoped `card-tools` bridge. It is already the low-risk pilot. This audit does not recommend or implement another plugin.

CBM and Graphiti remain native external MCP. Hermes-native tools remain native. Card Python remains a future deterministic composition surface. Potential Graphiti wrappers and hidden plugin LLM/hooks have not met the authority, provenance, and receipt bar and therefore are not candidates in this document.

## Candidate 1 — retain the existing `card-tools` bridge

### Current implementation

- Source package: `packages/hermes-card-tools/plugin.yaml` and `packages/hermes-card-tools/__init__.py`.
- Materializer and grant compiler: `apps/backend/src/hermes/cardToolsPlugin.ts`.
- Session preparation/readback: `apps/backend/src/hermes/agentTerminal.ts` and `apps/backend/src/hermes/profileMaterialization.ts`.
- Execution owner: the canonical LiquidAIty application/Python-rails host, not the plugin process.
- Current first-party operation definitions: `apps/python-models/app/mcp_host.py`, `apps/python-models/app/python_models/tool_registry.py`, and `apps/python-models/app/python_models/engraphis.py`.

The package validates one exact `tools.json` manifest, registers only the granted tool definitions, forwards calls to the loopback application host with managed Card/task identity, translates a visible one-word Bot title to its stable native profile in `pre_tool_call`, and contributes one bounded roster prompt section.

### Current transport

```text
saved Card selection
-> backend compiles exact first-party definitions
-> profile-scoped Hermes card-tools plugin
-> signed loopback application request
-> canonical LiquidAIty/Python-rails execution owner
-> normal tool result and Run observation
```

For Codex App Server Cards, those same effective first-party definitions are presented as App Server Dynamic Tools and executed by the existing Hermes executor. External MCP is deliberately excluded from Dynamic Tools and remains native MCP.

### Why this plugin is better than an external MCP-only presentation

- It is a small first-party Agent-runtime bridge for operations LiquidAIty owns.
- It has the exact Hermes profile/Card/task context needed to sign and scope the call.
- It avoids creating one independent server and connection lifecycle per Card.
- It lets LiquidAIty compile saved grants into normal Hermes tool definitions without forking Hermes core.
- It preserves application authorization, revision guards, graph owners, and Run authority instead of directly touching PostgreSQL or graph databases.
- It keeps external MCP lifecycle and catalogs out of idle Card/session open.

This is not a reason to move CBM or Graphiti into the plugin. They have independent data, auth, process, lifecycle, and multi-client value.

### Required Hermes API

- `plugin.yaml` plus `register(ctx)`.
- `ctx.register_tool(...)` for exact compiled first-party definitions.
- `ctx.register_hook("pre_tool_call", ...)` only for the mechanical public-title-to-profile rewrite.
- `ctx.add_prompt_section(...)` only for the bounded exact Bot roster.
- Normal bundled/user/project plugin discovery and per-profile plugin enablement.

The plugin deliberately does not use `ctx.llm`, `pre_llm_call`, or `ctx.call_mcp`. That keeps reasoning visible in the Card turn and keeps external MCP on the exact late-bound path.

### Packaging

Keep one repo-owned source package and materialize it as one profile-scoped user plugin under the bound Hermes profile.

Do not make it:

- a project plugin, because project discovery is cwd- and `HERMES_ENABLE_PROJECT_PLUGINS`-dependent;
- a bundled vendored-Hermes plugin, because that expands upstream fork divergence;
- a pip-installed machine prerequisite, because product correctness would depend on untracked machine state;
- several microplugins, because that multiplies discovery, enablement, prompt, collision, and failure surfaces.

### Card grant mapping

```text
plugin package exists
does not imply tool exposure

tool exists in current first-party catalog
intersection exact saved Card tool selection
intersection current Run authorization
intersection successful profile readback
= registered/model-facing tool
```

Unexpected plugin tools or an unrepresentable grant fail exact readback. The plugin must never register the whole application catalog and rely on prose to control use.

### Authentication and authority

- Accept only a managed Card environment with the expected profile, Card, task, and dashboard session identity.
- Accept only the configured loopback application host.
- Sign the request envelope and verify current credentials at execution time.
- Send mutations through canonical application authorization and revision guards.
- Never let plugin code directly mutate PostgreSQL, AGE, Engraphis, Graphiti, or CBM storage.
- Redact credentials from logs, receipts, errors, and generated artifacts.

### Receipts

Every high-value or mutating operation must remain visible through the normal tool/Run surface with:

- tool start and completion/failure;
- redacted arguments;
- current Card, profile, task, session, and Run association;
- application execution owner;
- returned native IDs and references;
- error envelope;
- duration;
- Attention/AGE observation only when a real supported native-reference event occurred.

The plugin must not make a second transcript, task board, tool history, or receipt database.

### Failure behavior

Hermes isolates an unrelated plugin load failure to that plugin. For a managed saved Card, this exact plugin is a required representation of the Card's selected first-party grants, so missing or mismatched readback should fail that Card session honestly rather than silently broadening or dropping tools.

It must not make any of these global dependencies:

- application startup;
- Main open when Main does not need the failing external owner;
- Builder terminal open before an authorized tool turn;
- Hermes Gateway readiness;
- CBM/Graphiti process readiness;
- another Card's session.

External MCP failure remains tool-local/turn-local and the temporary profile binding is removed after the authorized turn.

### Migration steps

No transport migration is approved. The bridge already exists.

The only follow-up cleanup is evidence-led removal of superseded profile residue:

1. Prove direct `@Name`/Bot messaging through current `card-tools` and the native Hermes roster.
2. Remove stale `card-bot-dm` materialization only after that proof.
3. Remove the orphaned `liquidaity-card-mcp` enabled entry where no implementation exists.
4. Reopen Main, Builder, ThinkGraph, and an ordinary Card and verify exact plugin/tool readback.
5. Preserve the current `card-tools` source, manifest, application auth path, and Dynamic Tool split.

### Tests

The retained bridge needs focused proof at these boundaries:

- manifest and schema validation;
- exact saved Card grant inclusion and absence;
- signed Card/task/session identity;
- visible-title Bot target translation and ambiguity rejection;
- application authorization and revision failure;
- plugin load/readback failure isolation;
- Codex Dynamic Tools for first-party grants and native MCP exclusion;
- zero external MCP binding at idle Card open;
- exact authorized-turn CBM/Graphiti binding before provider inference;
- binding removal after completion/failure;
- Main, Builder, ThinkGraph, KnowGraph, Magnetic, Team, and an ordinary Card open without a global external-service gate.

### Rollback/removal of the old path

There is no new pilot to roll back. If the retained bridge itself fails its authority or isolation contract, disable its affected Card grant and restore the last proven `card-tools` package/materializer together; do not substitute direct database access, a fake tool catalog, a global MCP binding, or a second plugin manager.

When stale `card-bot-dm` or `liquidaity-card-mcp` entries are removed in a later bounded cleanup, rollback means restoring only the exact removed profile entry while investigating—not restoring historical delegate-role, Kanban-adapter, external-MCP-at-open, or startup-gate code.

## Pilot decision

No pilot was implemented.

The one obvious low-risk first-party seam is already implemented. A second pilot would either duplicate it, hide an external MCP, broaden authority from exact tool consent to server-level plugin consent, add hidden model work, or put more code in every managed Card's startup path. The next useful work is live per-Card usage measurement and mission-conditional grant reduction, not another execution mechanism.

