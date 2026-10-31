# Turn Report — named graph links in chat

## Status
Presentation implementation complete for exact records in the current Project graph projection. Visual acceptance remains UNPROVEN: the existing Preview control timed out. No new research was run.

## Requested Delta and Preservation
Display Entity and Know references as clickable words instead of raw IDs/hashes. Preserve stored messages, user text, exact provider identities, Project scope, graph data/appearance, saved Cards, prompts, grants, tools, runtime, environment and unrelated dirty work.

## Tasks and Actual Changes
- T001: CBM CLI mapped MainProjectChatMessageBubble and its caller. Current source verified canonicalEntityLinks and exact Know focus. Coverage reported metadata_changed; direct source governed the change. No reindex.
- T002: canonicalEntityLinks.ts maps current Entity IDs and projected Know IDs/content hashes to canonical names or provider-supplied finding titles through the existing trie and focus targets. Ambiguous, stale, mismatched and unknown references are not guessed. No fetch, poller, store or new runtime.
- T003: MainProjectChat.tsx renders backticked exact references through the same named link path. Ordinary code stays code; original message text is unchanged.
- Added focused cases to the two existing specs. No test removed or weakened. Two production presentation files changed (+49/-12).

## Verification
- Source: existing graph selection callbacks retained. Existing Main/KnowGraph source prompts already keep IDs out of ordinary final answers and were not rewritten.
- Deterministic: 35 focused tests passed; client source and spec TypeScript checks exited successfully; focused git diff --check passed.
- Loaded: existing Vite Preview returned HTTP 200 and changed code for both presentation modules. No service restart.
- Live Agent: NOT RUN; no new model message or research.
- Persistence: no storage change or graph write.
- Visual: UNPROVEN. Existing Preview tab inspection timed out; app was not stopped and no tab intentionally closed.

## Boundaries / Remaining
Links resolve records supplied by the current authorized graph projection. Unknown IDs, protected URLs/citations, and older Knows absent from the bounded projection are not silently rewritten or guessed from nearby prose.
Main Bot-reply follow-up scope and automatic research remain unfinished, separately recorded in nextturn.md.
No Main/Bot route, Hermes, Python rails, prompt, model, grant, dependency, environment or database edit. No Git mutation.

## Documentation Coherence
Only affected source Relationship comments and the required turn/unfinished-work handoffs changed; no architecture expansion.

## Changed Source Snapshot
```text
243da28512abe939b6a18053e3c38f5df7f6e1cbc81c6386bf49a177ccd86a74  client/src/components/builder/canonicalEntityLinks.spec.ts
3c107298d843528371734f410afe09728de51c27954f3665277700b3f41ea013  client/src/components/builder/canonicalEntityLinks.ts
7daee2985cb2c388574583a5cc853646fa6e6b0803d279d64df640ca5ca05a3f  client/src/components/main/MainProjectChat.spec.tsx
ac8141c3de1a1679ed9d69cff2eedf02f10b12bf1704d131d00c4885e2aa491e  client/src/components/main/MainProjectChat.tsx
```
CHANGED_SNAPSHOT_SHA256: 2fb43e1f6d7d8fc2aca24ecb24f8a62d0292e04c1e91834f725767fa90a27135

Handoff-only edits: this turn.md replacement and nextturn.md pointers; excluded from the source snapshot.
