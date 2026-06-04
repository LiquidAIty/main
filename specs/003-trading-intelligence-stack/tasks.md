# Tasks: LiquidAIty Trading Intelligence Stack

**Spec**: `specs/003-trading-intelligence-stack/spec.md`
**Last updated**: 2026-06-03

## Current Status

This task file is in reset.

The previous Stage 0 checklist that treated `launchMode.ts` as the solution is obsolete.
That file has been removed.

The current working order follows Spec Kit:

1. Rewrite the docs/specs so they match real code and current status
2. Finish `spec.md`
3. Finish `plan.md`
4. Finish `tasks.md`
5. Get explicit approval for the exact Stage 0 shell cleanup scope
6. Implement the approved cleanup
7. Start later backend/model stages after Stage 0 is accepted

## Immediate Cleanup Tasks

- [x] Remove `client/src/config/launchMode.ts`
- [x] Restore `client/src/pages/agentbuilder.tsx` to the pre-launch-mode git baseline
- [x] Update docs that incorrectly described launch flags as the long-term architecture
- [ ] Rewrite canonical docs/specs so they stop claiming features are already hidden/removed
- [ ] Decide which legacy feature cards remain on the saved board for reference
- [ ] Decide which legacy surfaces leave the active MVP shell next
- [ ] Rewrite Stage 0 in `spec.md` and `plan.md` as active UI reduction and trading-focused cleanup
- [ ] Approve the exact implementation slice before changing the builder shell again

## Deferred Product Cleanup

- [ ] `client/src/pages/tradingui.tsx` mock UI cleanup
- [ ] AgentBuilder shell reduction
- [ ] Inactive workbench removal from active default deck
- [ ] Inactive companion-surface removal from active shell
- [ ] Restore-path documentation for any feature intentionally taken out of the shell

## Implementation Rule

Do not treat this file as approval to jump into Stage 1 backend work.
Spec first, then cleanup, then implementation.
