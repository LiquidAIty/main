# Saved Card Hermes Execution

@skill id=saved-card-hermes-execution
@type Skill
@status active

Use this procedure when tracing or changing how a saved Card reaches Hermes. A Card is the durable
identity/configuration/authority record; HermesLatest owns the live profile, session, model turn,
tools, skills, memory, terminal, Bot delivery, and task ledger.

## Current paths

```text
visible Main or addressed-Card message
  → POST /api/shared-chat/turn
  → sharedChatTurn.ts
  → savedCardAuthority.ts              exact Card, revision, Project and topology authority
  → savedCardRun.ts                    Python-rails Run preparation and settlement transport
  → /domain/main/runs/begin or /domain/runs/begin
  → card_invocation.py                 exact saved configuration + transient input
  → idf.py::materialize_idf            writes and reloads the one canonical in.idf
  → hermesCardSession.ts               materializes the Card profile and binds the Project conversation
  → HermesLatest prompt.submit         one correlated submission on the returned live session_id
  → Hermes events                      actual response, tool calls, usage, failure and completion
  → Python-rails Run settlement
```

Other literal doors:

- `POST /api/saved-specialists/invoke` is the authenticated internal bridge for explicitly defined
  saved-specialist operations. It is not a generic public "run any Card" tool.
- `POST /api/cards/runs/read` reads the latest/history projection only. It never starts execution.
- `/api/card-terminals/.../open` resolves the exact saved Card session and returns HermesLatest's
  existing PTY WebSocket attachment.
- `run_mag_one` prepares the saved Magnetic Card and submits its bounded root through
  `magnetic_taskgraph.py`; Hermes owns child tasks, attempts, assignment, retries and synthesis.

## Tool boundary

```text
authored Python/provider operation
  → OperationDefinition
  → live flat catalog projection
  → effective saved Card grants
  → Hermes Dynamic Tool declaration for this turn
  → authenticated MCP callback
  → the same OperationDefinition.handler
```

- The saved Card grant is the ceiling. AutoTools may narrow it for one accepted Run; it cannot add a
  capability.
- Server-owned Project/Card/conversation/Run fields are absent from the model-visible schema and are
  injected only by the authenticated dispatcher.
- CBM and Graphiti definitions retain explicit provider names and provider tool names. They do not
  create a second canonical ID or a generic "native tools" class.
- IDD projects editor choices. It does not authorize, validate, materialize or dispatch an ordinary Run.
- Card Python compiles one saved Script through Hermes's existing child-process Python execution. A
  blank or invalid Script is inert; it never creates another executor.

## Graph and Card roles

- Engraphis owns ThinkGraph data; the saved ThinkGraph Card is the model-facing helper that reads or
  writes through that authority.
- Graphiti owns KnowGraph data; the saved KnowGraph Card is the sourced-research helper that reads or
  writes through that authority.
- CodeGraph is the official Codebase Memory index. Main and Builder receive only their saved bounded
  CBM grants.
- AGE/PostgreSQL owns saved topology and truthful Run observations; it never runs a Card.

## Required proof

Prove source wiring, static contracts, loaded services and real product behavior separately. For one
accepted turn correlate the exact Card ID/revision, Project, conversation, stored session, live
`session_id`, submission ID, projected tool IDs, provider/model readback, terminal Hermes event and
Python settlement. Missing authority or provider state fails honestly; no fallback runtime, tool alias,
session owner or response substitute is permitted.
