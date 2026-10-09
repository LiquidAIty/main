---
name: agent-builder-inspection
description: Configure Cards and build agent-facing product surfaces.
version: 1.0.0
author: Jeremiah, Hermes Agent
license: Apache-2.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [agents, cards, product-ui]
    category: autonomous-ai-agents
    related_skills: [hermes-agent]
---

# Agent Builder Inspection Skill

Use the saved Builder Card to configure Cards and build the agent-facing applications,
pages, and interfaces requested by the user or Main. This skill guides work through
Builder's granted tools; it does not add permissions, choose a different Card, or create
another execution path.

## When to Use

Use this skill when the current assignment asks Builder to:

- inspect or update a saved Card;
- create a new Card from an existing template;
- connect Cards through the saved Canvas;
- inspect repository ownership before a bounded implementation;
- build an agent-facing page, application, or interface in the configured Project folder.

Do not use Card create or update operations for ordinary research, analysis, or writing.

## Prerequisites

- The active saved Card is Builder and the current Project is authorized.
- The selected Hermes profile has its required provider authentication; Card creation does not copy user credentials.
- The required operation is present in Builder's granted tool surface.
- Card changes use `canvas.inspect`, `card.create`, `card.update_configuration`, or
  `canvas.upsert_wire` as appropriate.
- Repository work uses the granted Codebase Memory MCP tools before `read_file`, `patch`,
  or `terminal` work.
- File changes remain inside the Project code folder selected by the user.

## How to Run

1. Read the current mission and supplied references.
2. Inspect only the Card, Canvas, repository, or Project folder required by that mission.
3. Choose the smallest granted operation that completes the requested change.
4. Apply the change once with exact identity and revision fields.
5. Read back and verify the changed owner before reporting completion.

## Quick Reference

| Need | Use |
| --- | --- |
| Inspect a Card or Canvas | `canvas.inspect` |
| Create one saved Card | `card.create` |
| Update one saved Card | `card.update_configuration` |
| Add or update one saved wire | `canvas.upsert_wire` |
| Locate code ownership | granted Codebase Memory MCP tools |
| Read or edit Project files | `read_file` and `patch` |
| Run a bounded command | `terminal` |

## Procedure

### Card configuration

Inspect the exact Card and applicable Input Data Dictionary choices first. Preserve its
stable Card ID, current revision, profile binding, prompt, model, grants, and topology unless
the mission explicitly changes them. A new Card requires one explicit, unused, stable Hermes
profile name; never derive authority from the display title. Supply every required create or
update argument and the current revision. Saving a Card and running it are separate actions.

### Repository and interface work

Use repository structure to identify the current owner before editing. Keep work inside the
configured Project code folder. Prefer the existing component, route, provider, and build
boundaries over a new framework or runtime. Use Builder's selected `file`, `terminal`, `web`,
`browser`, `vision`, and `code_execution` toolsets only when the mission requires them.

### Verification

Verify the smallest real boundary that changed: saved Card readback, Canvas relationship,
source behavior, typecheck, build, or loaded interface. Distinguish those proof levels in the
result. Never report a passing source check as a working Card invocation or visible product.

## Pitfalls

- Do not infer an operation from vague prose when exact Card identity or revision is absent.
- Do not broaden Builder's saved grants, Project access, or file boundary.
- Do not edit application source to compensate for a missing runtime capability without first
  proving the actual owner and gap.
- Do not create a second profile, session owner, tool catalog, graph, or execution engine.
- Do not treat a saved configuration, accepted request, or queued turn as completed execution.

## Verification

Return the exact target, operation, readback, and proof performed. If a required tool,
revision, profile, or Project folder is unavailable, report that limitation without inventing
a substitute path.
