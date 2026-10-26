# Runtime contract — Hermes Bot Mode

This is the owner-approved product contract and acceptance standard. It describes
what must work; it is not a claim that the current implementation has passed live
acceptance. This document is repository documentation only. Do not load it into
Card prompts, agent messages, or runtime context.

## One real conversation, real saved agents

LiquidAIty must provide one real conversation with real saved agents, powered by
official Hermes Bot Mode. The application must not pretend that agents talked.
A custom Card-to-Card runtime is outside this contract. Do not introduce one as
an alternative, fallback, or additional execution layer.

### Ordinary messages go to Main

Main is the default conversation participant and orchestrator. Ordinary user
messages reach the actual saved Main Card running through Hermes with its saved
system prompt, model, tools, and profile. Main must produce an actual answer.
There is no required `@Main` address or separate Main runtime.

### `@Name` directly addresses a saved Card

An explicit `@Name` addresses the corresponding saved, wired Card in the authorized
Project. The saved enabled wires define the roster itself. An unwired Card is not
rostered; mere visibility on the Canvas or an installed profile does not make it
addressable. The chooser and submission path must resolve that same roster,
rather than build a global Card list and hide unwanted entries afterward.
That Card must actually receive the message and execute through Hermes
with its own saved system prompt, model, tools, and profile.

Its actual answer appears as `@Name` in the same visible conversation. Main must
not replace direct delivery with an announcement that it asked the Card, answer
on the Card's behalf, or impersonate that Card. Mechanical address selection is
transport, not semantic planning or an application-owned agent executor.

Human access to a saved Project Card and an agent's permission to address another
Card are separate authorities. Preserve Project authorization, saved bindings,
and the established agent-to-agent permissions; do not invent additional limits
or silently widen agent grants.

### Main also communicates through Hermes Bot Mode

When Main communicates with another Card, Hermes must perform the real
`message_agent` operation, recipient execution, delivery, replies, and
continuation. The reply must come from the actual recipient.

User-initiated and Main-initiated Card communication must use the same real
Hermes runtime and saved agent identities. Do not add an application executor,
return runner, queue, scheduler, reply waiter, synthetic continuation, or second
communication mode. A queued acknowledgement is not a recipient's answer.

## Cards are the system-prompt authority

Each saved Card owns its system prompt, model, tools, and stable Hermes profile.
Preserve the saved prompt blocks and their existing compilation into the bound
Hermes profile. User messages are input to those Cards.

Application code must not invent Builder missions, replacement personas,
operating instructions, combined agent prompts, canned answers, or waiting and
delivery-status prose. Repository documentation and test instructions must not
be injected into agent context. Do not rewrite saved Card prompts to compensate
for a transport or runtime integration defect.

## The chat contains the actual conversation

The visible conversation contains correctly attributed user messages and actual
agent answers. Attribution comes from the saved Card that executed, not from
guessing who wrote a piece of text or relabelling Main's output.

- Use `@Name` for addressed-agent attribution, without emoji or extra role labels.
- Do not expose internal process commands, delivery JSON, notification envelopes,
  or model-only scaffolding as conversation messages.
- Do not substitute “I sent it,” “I asked,” or “waiting for a reply” for the
  actual result of a directly addressed Card.
- Do not manufacture replies, tool results, execution claims, or activity.
- Do not hide duplicate execution or a broken reply path through text matching,
  deletion of evidence, or cosmetic suppression.
- Preserve the actual conversation and its correct attribution after reload
  through the established persistence owners. Do not invent another conversation
  or session store to work around a missing Hermes contract.

Correct presentation alone is insufficient. If the wrong agent executed, the
recipient never executed, or the result never arrived, the integration failed.

## Keep the connection small

Application-owned code is limited to the existing authentication and Project
authorization, saved Card/profile resolution, explicit user addressing,
supported transport, and established conversation persistence and presentation.
Hermes owns agent execution and inter-agent communication.

Use the actual supported Hermes operations and compare the integration with the
corresponding Hermes Desktop contracts. Do not infer a usable operation from a
filename, copy Desktop's UI into the application, or recreate Hermes behavior
under new TypeScript names. Required external protocol identifiers retain their
actual names.

Prefer refactoring the existing connection. When a path is replaced, remove its
abandoned application-owned implementation and exclusive callers in the same
change. Do not accumulate alternative paths, compatibility layers without a real
consumer, mocks, simulated agents, or another runtime.

Preserve the existing UI and Canvas appearance and wiring, Card identities,
system prompts, CLI surfaces, profile bindings, saved data, and unrelated
functionality. Hermes vendored source remains protected unless the owner
explicitly authorizes an exact change. Terminal work remains a separate boundary;
it must not expand the messaging integration into a replacement runtime.

## Acceptance requires real product proof

The following must be demonstrated through the actual loaded application:

1. An ordinary user message reaches Main and Main produces an actual answer.
2. A user `@Name` message executes the named saved Card through Hermes, rather
   than making Main claim that it contacted that Card.
3. The recipient's real answer appears with correct `@Name` attribution in the
   same visible conversation.
4. Main's own inter-agent work uses the real `message_agent` operation, the
   recipient executes, and the resulting answer reaches the visible conversation.
5. Reload preserves the conversation and correct speaker identities.
6. Internal delivery payloads, fabricated status prose, and duplicate or
   misattributed Main messages do not substitute for actual agent communication.

Use short, meaningful human requests for live verification. Do not use scripted
models, mock recipients, exact-repeat output tricks, fabricated responses, or
runtime instructions disguised as test chatter. Do not alter Cards or grants
merely to make a test pass.

Source inspection, typechecks, builds, service health, actual agent execution,
persistence, visual verification, and owner acceptance are separate proof tiers.
A successful connection, initial Main acknowledgement, queued receipt, or
passing build does not establish that the complete conversation works.

If a required Hermes contract is absent, identify the exact missing operation
and the blocked behavior. Do not invent an imitation, quietly change runtime
ownership, or claim completion. Official Hermes Bot Mode remains the selected
runtime unless the owner explicitly changes that decision.
