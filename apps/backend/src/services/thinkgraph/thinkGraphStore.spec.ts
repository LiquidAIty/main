// Thin TypeScript contract coverage. Engraphis storage, idempotency, recall,
// scope isolation, and bi-temporal behavior are proved in Python adapter tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const python = vi.hoisted(() => ({
  applyPatch: vi.fn(),
  fetchScope: vi.fn(),
}));

vi.mock('../autogen/autogenOrchestratorClient', () => ({
  applyThinkGraphPatchOnPython: python.applyPatch,
  fetchThinkGraphScope: python.fetchScope,
}));

import {
  applyThinkGraphPatch,
  getThinkGraphView,
  readThinkGraphScope,
  validateThinkGraphPatch,
  type ThinkGraphPatchAuthority,
} from './thinkGraphStore';

const AUTHORITY: ThinkGraphPatchAuthority = {
  projectId: 'project-1',
  cardId: 'card-thinkgraph',
  correlationId: 'correlation-1',
  conversationId: 'conversation-1',
};

const PATCH = {
  resources: [
    { id: 'goal:one', label: 'Build the graph', kind: 'Goal', properties: { state: 'active' } },
    { id: 'decision:one', label: 'Use Engraphis', kind: 'Decision' },
  ],
  statements: [
    { id: 'edge:one', subject: 'goal:one', predicateTerm: 'selects', object: 'decision:one' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  python.fetchScope.mockResolvedValue({ nodes: [], edges: [] });
  python.applyPatch.mockResolvedValue({
    ok: true,
    status: 'applied',
    correlationId: AUTHORITY.correlationId,
    storedResourceIds: ['goal:one', 'decision:one'],
    storedStatementIds: ['edge:one'],
    relationCount: 0,
  });
});

describe('validateThinkGraphPatch — bounded structural transport only', () => {
  it('requires complete trusted authority', () => {
    for (const key of ['projectId', 'cardId', 'correlationId', 'conversationId'] as const) {
      expect(validateThinkGraphPatch({ ...AUTHORITY, [key]: '' }, PATCH)).toBe(`patch_authority_${key}_missing`);
    }
  });

  it('accepts free-form compact kinds and predicates without classifying content', () => {
    expect(validateThinkGraphPatch(AUTHORITY, PATCH)).toBeNull();
    expect(validateThinkGraphPatch(AUTHORITY, {
      resources: [{ id: 'x', label: 'EvidenceGaps_Unknown_Confirmed_gap', kind: 'literally_anything' }],
    })).toBeNull();
  });

  it('rejects malformed or unbounded transport shapes', () => {
    expect(validateThinkGraphPatch(AUTHORITY, { relations: [{ a: 'x', b: 'x' }] })).toContain('self_pair');
    expect(validateThinkGraphPatch(AUTHORITY, { resources: [{ id: 'x', label: ' ' }] })).toContain('label_required');
    expect(validateThinkGraphPatch(AUTHORITY, {
      resources: Array.from({ length: 41 }, (_, index) => ({ id: `r${index}`, label: `R${index}` })),
    })).toBe('patch_too_many_resources');
    expect(validateThinkGraphPatch(AUTHORITY, {
      resources: [{ id: 'x', label: 'X', properties: { nested: { no: true } } as never }],
    })).toContain('value_must_be_scalar');
  });
});

describe('Engraphis Python-rails transport', () => {
  it('passes an accepted patch through unchanged and returns the Python result', async () => {
    await expect(applyThinkGraphPatch(AUTHORITY, PATCH)).resolves.toMatchObject({ ok: true, status: 'applied' });
    expect(python.applyPatch).toHaveBeenCalledWith(AUTHORITY, PATCH);
  });

  it('fails validation before crossing the transport boundary', async () => {
    const result = await applyThinkGraphPatch({ ...AUTHORITY, projectId: '' }, PATCH);
    expect(result).toEqual({ ok: false, error: 'patch_authority_projectId_missing' });
    expect(python.applyPatch).not.toHaveBeenCalled();
  });

  it('reads project scope from Python, clamps limits, and rejects invalid responses', async () => {
    const view = { nodes: [{ id: 'goal:one' }], edges: [] };
    python.fetchScope.mockResolvedValueOnce(view);
    await expect(getThinkGraphView({ projectId: ' project-1 ', limit: 9000 })).resolves.toBe(view);
    expect(python.fetchScope).toHaveBeenCalledWith('project-1', 2000);

    python.fetchScope.mockResolvedValueOnce({ wrong: true });
    await expect(getThinkGraphView({ projectId: 'project-1' })).rejects.toThrow('thinkgraph_engraphis_scope_invalid');
  });

  it('keeps card reads bounded more tightly and returns an honest empty scope without a project', async () => {
    await readThinkGraphScope({ projectId: 'project-1', limit: 9000 });
    expect(python.fetchScope).toHaveBeenCalledWith('project-1', 500);
    await expect(getThinkGraphView({ projectId: ' ' })).resolves.toEqual({ nodes: [], edges: [] });
  });
});
