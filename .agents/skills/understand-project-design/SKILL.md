---
name: understand-project-design
description: Preserve LiquidAIty product intent when auditing, changing, or removing agent, graph, Project, Card, memory, or runtime behavior. Recover the owner decision and current implementation before applying familiar architecture patterns. Skip unrelated prose and mechanical formatting.
---

# Understand the project before changing its design

LiquidAIty is intentionally a Project and graph workbench around Hermes. Its differences from other
agent apps are product choices to understand, not defects to normalize. A familiar framework, an upstream
default, or existing local code is not permission to replace the owner's design.

Use this skill for understanding and preservation. `AGENTS.md`, `DONT.md`, the active request, and the
installed `promptspec-receiver` own execution rules. Do not duplicate their process or create another
plan, handoff, runtime gate, classifier, or approval system.

## Establish the intended change

Recover these facts in the task before editing; keep the explanation proportional to the request:

- What user-visible behavior is requested now? Distinguish a question, review, proposal, test, and change.
- Which latest owner decisions constrain it? Exploration is not implementation approval.
- What working capabilities and data must survive, including controls whose implementation looks unusual?
- Which existing owner should perform the work, and which callers actually use it today?
- Which claims are observed, source-confirmed, historical, proposed, or still unknown?

Do not substitute "I understand" for this evidence. Trace one concrete input through the actual saved
identity, transport, execution owner, persistence, and visible result when those boundaries matter.
Use the CBM CLI and source procedure in `skills/codebasedmemory.md`; source wins over graph metadata.
Use the repository's current rules for delegation rather than deciding here who may write code.

## Preserve these product distinctions

Read the current governing documents for details and changes. These distinctions prevent recurring
misinterpretation; they are not a frozen list of implementation claims.

- **Card and profile:** a Card is the UI for an actual Hermes profile. Do not invent a second agent or
  profile authority behind it. Main, Builder, and other profiles retain distinct identities. Saved UI
  values require effective Hermes readback before claiming that the running agent uses them.
- **Hermes and UI:** Hermes owns agent execution, Bot delivery and its session mechanisms. The app owns
  Project access, presentation and its authorized integration. First inspect whether Hermes already
  performs the requested operation. Do not reproduce it in TypeScript, a Python wrapper, or a plugin.
- **Wires and work:** saved connections determine the authorized roster. Visibility, a title, an installed
  profile or a prompt claim does not grant authority. A wire does not prove a task ran.
- **Conversation and context:** durable history, displayed history, model-bound history, retrieved
  passages and current tool state are different. A context-selection request does not authorize data
  deletion. A history limit does not mean changing the model's total context capacity.
- **Project and profile:** reusable configuration is not a shared private conversation. Verify Project,
  user, roster, credential and retrieval scope separately; do not declare isolation from a title or ID.
- **Graph owners:** preserve Engraphis Think/source ownership, Graphiti Know/evidence ownership, CBM
  structure ownership and AGE topology/observation ownership. A graph view is not another graph store.
- **Learning and foreground chat:** Main is not the Think extraction owner. Respect the current approved
  storage-side path. A research flag is not permission to add an automatic research dispatcher.
- **Evidence and prose:** queued, completed, stored, read back, visible and semantically correct are
  separate claims. A model saying it used Bot Mode or wrote a graph is not execution proof.

## Use outside research without replacing the product

When another application suggests a different design, state the user problem it solves, the existing
LiquidAIty/Hermes owner, the smallest compatible option, and the cost or behavior change. Keep adoption
in a proposal section until approved. Do not silently import its session manager, queue, memory store,
framework, provider fallback, control labels or default history policy.

An upstream capability is not automatically connected to this app. Conversely, an app wrapper is not
necessary merely because it exists. Verify the literal current entrypoint and public extension seam.
When referring to upstream behavior, name the owner explicitly: Hermes, Engraphis, Graphiti or LiquidAIty.
Avoid the ambiguous standalone word "native."

## Prevent feature and idea loss

Before a removal or replacement, name the affected user capabilities, not just the files. For each,
classify it as retained, intentionally removed by the latest request, superseded with proven parity,
potential regression, or unresolved. Use current callers and relevant historical evidence; a large
deletion count is not proof of improvement, and removed code is not automatically a lost requirement.

Keep that classification in the task. Do not create a new permanent ledger unless requested. Do not
restore an abandoned implementation just because it once carried a useful idea. Preserve the idea and
propose its smallest correct owner. Ask before removing a capability whose intent remains consequentially
unclear. Do not use a broad phrase such as "remove the extra session code" to remove the Card's own
required Hermes execution, chat controls, voice, identity checks or storage without checking the exact scope.

## Handle documentation that conflicts with reality

Documentation should make later work easier, but repeated prose does not establish current truth.
Compare the latest owner direction, relevant source, current saved state and dated proof. State the exact
contradiction instead of silently choosing the version that supports a preferred rewrite.

Do not treat an old TODO as approval, TARGET as CURRENT, or a report proposal as an instruction to execute.
Update canonical documentation only within current authorization. Do not add a new universal rule for
every incident or copy this skill into other instruction files. Reference it instead.

## Finish the requested boundary

Prove the observable change at the appropriate tier. An enabled button, passing unit test, real model
reply, actual tool call and durable graph readback prove different things. Report what was not exercised.
Test natural work through the existing product when authorized; do not inject implementation instructions
or fake success chatter into its knowledge stores to make a test pass.

Do not expand a base-system repair into unrelated edge cases or platform redesign. A real privacy or
scope blocker must be explained with concrete coupling, not invented as a reason to avoid the task.
Once the scoped result is achieved, hand it back with a truthful preservation summary and keep optional
ideas separate. If the approach is wrong, stop adding layers and return to the existing owner.

This skill is guidance, not a guarantee. Its value must be demonstrated by narrower changes, preserved
features, fewer rejected rewrites and accurate acceptance claims.
