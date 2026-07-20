---
name: card-workspace
description: Canonical card-first workspace paths. Cards own durable workspaces. Runs live beneath their card. One authority for TypeScript and Python.
version: 1.0.0
---

# Card Workspace Authority

## Rule

A card has a durable workspace. Runs live beneath that card.

## Canonical Path

```
<repo-root>/coder-workspace/cards/<card-id>/runs/<run-id>/
```

Derived from existing `resolveRepoRoot()` → `resolveCoderWorkspaceRoot()`. Card ID and run ID must each be one safe path segment (alphanumeric, no separators, no traversal).

## Migrating From Run-First

Old: `coder-workspace/returns/<run-id>/<card-id>/`
New: `coder-workspace/cards/<card-id>/runs/<run-id>/`

The old hierarchy inverted the owner. Cards own runs, not the reverse.

## Path Functions

### TypeScript

```typescript
// coder/workspaceRoot.ts additions

export function resolveCardWorkspace(cardId: string): string {
  // <workspace>/cards/<card-id>/
  return path.join(resolveCoderWorkspaceRoot(), 'cards', sanitizeId(cardId));
}

export function resolveCardRunDir(cardId: string, runId: string): string {
  // <workspace>/cards/<card-id>/runs/<run-id>/
  return path.join(resolveCardWorkspace(cardId), 'runs', sanitizeId(runId));
}

```

### Python

```python
# job_folder.py additions

def resolve_card_workspace(workspace_root: str, card_id: str) -> str:
    """<workspace>/cards/<card-id>/"""
    cid = str(card_id or '').strip()
    if not _valid_job_id(cid):
        raise ValueError(f"card_id_invalid: {card_id!r}")
    target = os.path.join(workspace_root, 'cards', cid)
    if not _within(workspace_root, target):
        raise ValueError(f"card_workspace_escapes: {target!r}")
    return target

def resolve_card_run_dir(workspace_root: str, card_id: str, run_id: str) -> str:
    """<workspace>/cards/<card-id>/runs/<run-id>/"""
    cw = resolve_card_workspace(workspace_root, card_id)
    if not _valid_job_id(run_id):
        raise ValueError(f"run_id_invalid: {run_id!r}")
    target = os.path.join(cw, 'runs', run_id)
    if not _within(workspace_root, target):
        raise ValueError(f"card_run_escapes: {target!r}")
    return target
```

## Safety

- Card ID and run ID validated via existing `_valid_job_id()` (alphanumeric, no separators)
- All paths contained within workspace via `_within()`
- Symlink escape detection via inherited `_safe_return_target()` logic
- One card cannot write to another card's directory (card_id is a fixed trusted segment)

## Migration

16 existing runs in `returns/<run-id>/<card-id>/` format. Migration plan:
1. Dry-run: enumerate existing → target mapping
2. Copy + hash verify
3. Readback verification
4. Atomically switch path resolver
5. Remove old migration reader (no permanent compatibility wrapper)
