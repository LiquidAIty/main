# LiquidAIty — Repo-Eating Convention

**Date**: 2026-06-03
**Status**: Authoritative

---

## Rule

External repos placed at the repo root are **audit candidates**.

They either:
- **Ship** — audited, adapted, tested, approved, promoted into `apps/`, `services/`, or `packages/`
- **Get deleted** — if not useful after audit

**There are no candidate holding folders.**
**There is no intake queue.**
**Stale external code does not live in the repo.**

---

## How It Works

1. User places external repo at the repo root (e.g., `quant-mind-master/`)
2. Agent audits it **in place** and writes findings to `docs/` (e.g., `docs/quant-mind-audit.md`)
3. User reviews the audit and decides: **promote** or **delete**
4. If promoted: code is adapted, tested, approved, then moved into `apps/`, `services/`, or `packages/`
5. If deleted: folder is removed from repo root; audit doc stays for reference

---

## Currently Planned External Repos

| Repo | Planned Drop Location | Purpose | Status |
|---|---|---|---|
| `quant-mind-master/` | Repo root (not yet unzipped) | Finance-aware knowledge models → KnowGraph import layer | Pending spec completion |

> QuantMind will be placed at the repo root **after** current spec and cleanup work is done.
> Audit will be done in place. Audit output: `docs/quant-mind-audit.md`.

---

## What the QuantMind Audit Covers

Once placed at the repo root, the audit will answer:

- What typed/Pydantic knowledge objects exist? (`BaseKnowledge`, `Paper`, `News`, `Factor`, `Thesis`, etc.)
- Is `GraphKnowledge` implemented or a placeholder?
- Are citations, confidence, tags, disclaimers, source paths, and `embedding_text` fields useful?
- Does any code call hosted LLMQuant Data APIs that cannot run locally?
- Can useful parts run without hosted services?
- What dependencies would be introduced?
- How would useful objects map to the existing Neo4j KnowGraph import?
- Which parts should be adapted, deferred, or rejected?

**Audit output**: `docs/quant-mind-audit.md`

---

## Existing External Code at Root

| Folder | Status | Notes |
|---|---|---|
| `data-formulator-main/` | Present — not part of the active MVP shell | Microsoft Data Formulator. Not working in current integration. Delete or promote only if useful for trading/EDGAR/WorldSignals data transforms. |
| `Understand-Anything-main/` | Present | Understand Anything reference. Not part of the active MVP shell by default. |
| `telescope/` | Present | Telescope/citizen science UI experiment. Hidden in MVP. |
| `worldsignal/` | Present | WorldSignals / Crucix sidecar. **Preserved and active.** |
| `localcoder/` | Present | Local coder workspace. Hidden in MVP. |
| `gamecanvas/`, `motioncanvas/`, `spatialcanvas/`, `videocanvas/` | Present | Canvas experiments. Not wired to MVP surfaces. |
