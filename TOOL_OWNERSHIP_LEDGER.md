# Tool Ownership Ledger

Status: Hermes integration reset in progress.

The former application-owned Card/Gateway execution stack and its loopback Card-tools plugin have
been deleted. This document no longer treats that implementation as a current owner.

## Preserved authorities

| Authority | Preserved responsibility |
| --- | --- |
| Saved Card records | Identity, prompt, provider/model/profile selection, skills, tool ON/OFF grants, enabled state, and topology |
| Python operation registry | Canonical application operation IDs, schemas, metadata, handlers, and publication eligibility |
| External MCP providers | Their own tools, authentication, schemas, and service lifecycle |
| Hermes | Profiles, sessions, model turns, tools/skills loading, Bot Mode, TUI, retries, task/dependency execution, and completion |
| PostgreSQL and AGE | Durable Card, conversation, Run, artifact, topology, and observation records |
| Engraphis, Graphiti, CBM | ThinkGraph, KnowGraph, and CodeGraph authority respectively |

## Current absence

There is no mounted LiquidAIty Card execution route, Main chat execution route, application terminal
owner, profile/session materializer, staged-turn registry, Card-tools loopback host, or startup runtime
reconciler. Saved grants and UI selections remain data, but they are not currently loaded into a Card
turn.

A later approved integration must apply each saved Card's selections through Hermes's supported
profile/session configuration and prove loaded tool/skill readback. It must not restore a second
execution owner, registry, queue, retry system, target-session resolver, or process supervisor.
