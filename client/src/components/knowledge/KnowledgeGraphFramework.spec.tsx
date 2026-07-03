// @vitest-environment jsdom
// Thin-renderer mechanics only (NOT product proof; nothing persisted): the
// Cytoscape surface must turn the RAW Python projection into one element per
// returned node/edge, preserve every returned field, use Python-assigned visual
// classes verbatim, stay blank without a projection, and never invent data.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const cyState = vi.hoisted(() => ({
  instances: [] as any[],
  reset() {
    this.instances = [];
  },
}));

vi.mock('cytoscape', () => {
  const factory: any = (options: any) => {
    const instance: any = {
      options,
      added: [] as any[],
      layouts: [] as any[],
      handlers: [] as any[],
      on: (event: string, selectorOrFn: any, maybeFn?: any) => {
        instance.handlers.push({ event, selector: typeof selectorOrFn === 'string' ? selectorOrFn : undefined });
      },
      elements: () => ({
        remove: vi.fn(),
        removeClass: vi.fn(),
        addClass: vi.fn(),
        difference: () => ({ addClass: vi.fn() }),
        length: instance.added.length,
      }),
      add: (elements: any[]) => {
        instance.added.push(...elements);
      },
      layout: (options: any) => {
        instance.layouts.push(options);
        return { run: vi.fn() };
      },
      batch: (cb: () => void) => cb(),
      resize: vi.fn(),
      fit: vi.fn(),
      destroy: vi.fn(),
    };
    cyState.instances.push(instance);
    return instance;
  };
  factory.use = vi.fn();
  return { default: factory };
});
vi.mock('cytoscape-fcose', () => ({ default: {} }));

import KnowledgeGraphFramework, { type GraphProjectionV1 } from './KnowledgeGraphFramework';

const PROJECTION: GraphProjectionV1 = {
  schemaVersion: 'thinkgraph.projection.v1',
  projectId: 'proj-1',
  nodes: [
    {
      id: 'hyp_a',
      label: 'Hypothesis A',
      kind: 'resource',
      sourceRef: 'tg:msg_1',
      provenance: { correlationId: 'tg:msg_1' },
      visual: { nodeClass: 'resource' },
    },
    {
      id: 'stmt_1',
      label: 'A depends_on B',
      kind: 'statement',
      provenance: { review: 'provisional' },
      visual: { nodeClass: 'statement' },
    },
  ],
  edges: [
    {
      id: 'stmt_1|subj',
      source: 'hyp_a',
      target: 'stmt_1',
      label: 'depends_on',
      predicate: 'depends_on',
      visual: { edgeClass: 'semantic_relation', directed: true },
    },
  ],
};

beforeEach(() => {
  cyState.reset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KnowledgeGraphFramework — thin mechanical renderer', () => {
  it('stays blank graph paper with no projection: nothing added, no layout, no fake nodes', async () => {
    const { getByTestId } = render(<KnowledgeGraphFramework projection={undefined} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));
    const cy = cyState.instances[0];
    expect(cy.added).toHaveLength(0);
    expect(cy.layouts).toHaveLength(0);
    expect(getByTestId('cytoscape-graph').getAttribute('data-node-count')).toBe('0');
  });

  it('creates exactly one element per returned node/edge, preserving raw fields and Python visual classes', async () => {
    render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances[0]?.added.length).toBe(3));
    const cy = cyState.instances[0];

    const nodeA = cy.added.find((e: any) => e.data.id === 'hyp_a');
    expect(nodeA.group).toBe('nodes');
    expect(nodeA.classes).toBe('resource'); // Python-assigned, used verbatim
    expect(nodeA.data.label).toBe('Hypothesis A');
    expect(nodeA.data.kind).toBe('resource');
    expect(nodeA.data.sourceRef).toBe('tg:msg_1');
    expect(nodeA.data.provenance).toEqual({ correlationId: 'tg:msg_1' });
    expect(nodeA.position).toBeUndefined(); // no invented coordinates

    const edge = cy.added.find((e: any) => e.data.id === 'stmt_1|subj');
    expect(edge.group).toBe('edges');
    expect(edge.classes).toBe('semantic_relation');
    expect(edge.data.source).toBe('hyp_a');
    expect(edge.data.target).toBe('stmt_1');
    expect(edge.data.predicate).toBe('depends_on');
    expect(edge.data.directed).toBe(true);

    // fCoSE only because Python supplied no complete positions.
    expect(cy.layouts).toHaveLength(1);
    expect(cy.layouts[0].name).toBe('fcose');
  });

  it('uses preset layout when Python supplies complete positions', async () => {
    const positioned: GraphProjectionV1 = {
      ...PROJECTION,
      nodes: PROJECTION.nodes.map((n, i) => ({
        ...n,
        visual: { ...n.visual, x: i * 10, y: i * 20 },
      })),
    };
    render(<KnowledgeGraphFramework projection={positioned} />);
    await waitFor(() => expect(cyState.instances[0]?.layouts.length).toBe(1));
    expect(cyState.instances[0].layouts[0].name).toBe('preset');
    const nodeA = cyState.instances[0].added.find((e: any) => e.data.id === 'hyp_a');
    expect(nodeA.position).toEqual({ x: 0, y: 0 });
  });

  it('registers only display-selection handlers and destroys the instance on unmount', async () => {
    const { unmount } = render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));
    const cy = cyState.instances[0];
    expect(cy.handlers.map((h: any) => h.event)).toEqual(['tap', 'tap', 'tap']);
    unmount();
    expect(cy.destroy).toHaveBeenCalledTimes(1);
  });
});
