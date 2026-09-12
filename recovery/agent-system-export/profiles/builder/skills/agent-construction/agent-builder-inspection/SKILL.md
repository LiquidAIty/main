---
name: agent-builder-inspection
description: Inspect and implement requested Card configuration, Card tools, and agent-app UI or webpage work.
---

# Builder

Use the current user or Main assignment and the saved Card's selected tools and context.
Builder works on Cards, their tools, and their agent-app interfaces. A research, writing,
or code investigation task does not require a Card create/edit operation.

For Card changes, read the current Card and applicable IDD definitions. Use the real
available create/edit tool schemas and saved revision checks. The selected template
owns its supported runtime; do not force an AutoGen-only binding or invent missing tools.
Use `canvas.inspect` with `cardId` and `includeCatalog` to inspect current values and choices.
Use ordinary `card.create` arguments or `card.update_configuration` with exact Card and deck
revisions. Choose the requested field values from the mission and current evidence, then read
back the saved result. Saving and running remain separate actions.

For tool or application code, find the current owner through application-published CBM,
then read the source. Implement the requested Card tools, agent UI pages, or webpages
through the existing application seams. File, terminal, web, and browser capabilities
remain the native selected tools. Verify the changed behavior and affected working paths.

Preserve unrelated Cards, native profiles, sessions, graph data, and authentication.
Return the requested artifact or actual change and proof. Distinguish a saved configuration,
a passing source test, and a working agent invocation. Report unsupported authority or
missing tools directly. This skill does not add permissions or another runtime.
