// @vitest-environment jsdom
// Thin-renderer mechanics only (NOT product proof; nothing persisted): the
// Cytoscape surface must turn the RAW Python noun-and-verb projection into one
// element per returned node/edge, preserve every returned field verbatim, use
// NO visual-class vocabulary (every node is the same bubble, every edge the
// same labeled directed line — the only signal is capped-log mentionCount
// sizing), keep layout calm (no rerun on identical data, position-preserving
// diff on real change), and never invent data. Fixtures exercise renderer
// mechanics only.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const cyState = vi.hoisted(() => ({
  instances: [] as any[],
  reset() {
    this.instances = [];
  },
}));

vi.mock('cytoscape', () => {
  const factory: any = (options: any) => {
    const store: any[] = [];
    const makeEl = (def: any) => {
      const el: any = {
        def,
        id: () => String(def.data.id),
        remove: () => {
          const index = store.indexOf(el);
          if (index >= 0) store.splice(index, 1);
        },
        data: (next?: any) => {
          if (next !== undefined) {
            el.def = { ...el.def, data: next };
            return;
          }
          return el.def.data;
        },
      };
      return el;
    };
    const instance: any = {
      options,
      store,
      layouts: [] as any[],
      handlers: [] as any[],
      on: (event: string, selectorOrFn: any, maybeFn?: any) => {
        instance.handlers.push({
          event,
          selector: typeof selectorOrFn === 'string' ? selectorOrFn : undefined,
          fn: typeof selectorOrFn === 'function' ? selectorOrFn : maybeFn,
        });
      },
      elements: () => {
        const snapshot = [...store];
        return {
          length: snapshot.length,
          forEach: (fn: (el: any) => void) => snapshot.forEach(fn),
          remove: vi.fn(),
          removeClass: vi.fn(),
          addClass: vi.fn(),
          difference: () => ({ addClass: vi.fn() }),
        };
      },
      add: (defs: any) => {
        (Array.isArray(defs) ? defs : [defs]).forEach((def) => store.push(makeEl(def)));
      },
      getElementById: (id: string) => {
        const found = store.filter((el) => el.id() === String(id));
        return {
          length: found.length,
          data: (next: any) => found.forEach((el) => el.data(next)),
        };
      },
      layout: (layoutOptions: any) => {
        instance.layouts.push(layoutOptions);
        return { run: vi.fn() };
      },
      style: vi.fn((next: any) => {
        if (next) instance.options.style = next;
        return instance;
      }),
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

// Mirrors "ASTS may depend on SpaceX launch services" plus a repeated-mention
// entity and an unreferenced noun with zero mentions.
const PROJECTION: GraphProjectionV1 = {
  schemaVersion: 'thinkgraph.projection.v1',
  projectId: 'proj-1',
  nodes: [
    { id: 'asts', label: 'ASTS', title: 'AST SpaceMobile', type: 'Issuer', labels: ['Issuer', 'PublicCompany'], mentionCount: 3, lastMentionedAt: '2026-07-04T00:00:00Z', properties: { ticker: 'ASTS' }, provenanceCount: 3 },
    { id: 'spacex_launch_services', label: 'SpaceX launch services', mentionCount: 1, provenanceCount: 1 },
    { id: 'unreferenced', label: 'Unrelated older noun', mentionCount: 0, provenanceCount: 0 },
  ],
  edges: [
    {
      id: 'st_asts_depends_on_spacex',
      source: 'asts',
      target: 'spacex_launch_services',
      predicate: 'may depend on',
      mentionCount: 2,
      properties: { source: 'working project reasoning' },
      provenanceCount: 2,
    },
  ],
};

function styleFor(cy: any, selector: string): Record<string, unknown> | undefined {
  return cy.options.style.find((entry: any) => entry.selector === selector)?.style;
}

beforeEach(() => {
  cyState.reset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() { return undefined; }
      unobserve() { return undefined; }
      disconnect() { return undefined; }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KnowledgeGraphFramework — thin mechanical renderer, one noun-and-verb graph', () => {
  it('stays blank graph paper with no projection: nothing added, no layout, no fake nodes', async () => {
    const { getByTestId } = render(<KnowledgeGraphFramework projection={undefined} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));
    const cy = cyState.instances[0];
    expect(cy.store).toHaveLength(0);
    expect(cy.layouts).toHaveLength(0);
    expect(getByTestId('cytoscape-graph').getAttribute('data-node-count')).toBe('0');
  });

  it('defaults to connected current records and preserves their raw fields verbatim', async () => {
    render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances[0]?.store.length).toBe(3));
    const cy = cyState.instances[0];
    const defs = cy.store.map((el: any) => el.def);

    const asts = defs.find((d: any) => d.data.id === 'asts');
    expect(asts.group).toBe('nodes');
    expect(asts.data.label).toBe('ASTS');
    expect(asts.data.mentionCount).toBe(3);
    expect(asts.data.properties).toEqual({ ticker: 'ASTS' });
    expect(asts.position).toBeUndefined(); // Python never supplies coordinates

    const edge = defs.find((d: any) => d.data.id === 'st_asts_depends_on_spacex');
    expect(edge.group).toBe('edges');
    expect(edge.data.source).toBe('asts');
    expect(edge.data.target).toBe('spacex_launch_services');
    expect(edge.data.predicate).toBe('may depend on'); // full verb phrase, untouched
    expect(edge.data.mentionCount).toBe(2);
    expect(edge.data.properties).toEqual({ source: 'working project reasoning' });

    // Exactly one stable fCoSE run; automatic projection layout does not animate.
    expect(cy.layouts).toHaveLength(1);
    expect(cy.layouts[0].name).toBe('fcose');
    expect(cy.layouts[0].animate).toBe(false);
  });

  it('uses NO visual-class vocabulary at all: no classes on any element, one uniform stylesheet', async () => {
    render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances[0]?.store.length).toBe(3));
    const cy = cyState.instances[0];
    for (const def of cy.store.map((el: any) => el.def)) {
      expect(def.classes).toBeUndefined();
    }
    // The stylesheet itself has no per-entity/category/question/property
    // selectors — only base node/edge rules, selection, and the dim utility.
    const selectors = cy.options.style.map((entry: any) => entry.selector);
    expect(selectors).toEqual(['node', 'edge', 'node:selected', 'edge:selected', '.kgf-dim']);
  });

  it('sizes nodes with a capped logarithmic mapping over real mentionCount only', async () => {
    render(<KnowledgeGraphFramework projection={PROJECTION} />);
    fireEvent.click(screen.getByLabelText('Hide unconnected'));
    await waitFor(() => expect(cyState.instances[0]?.store.length).toBe(4));
    const cy = cyState.instances[0];
    const asts = cy.store.find((el: any) => el.id() === 'asts');
    const unreferenced = cy.store.find((el: any) => el.id() === 'unreferenced');
    // log2(3+1)=2, log2(0+1)=0 — mechanical, from the real integer field only.
    expect(asts.def.data.logMentions).toBeCloseTo(2, 5);
    expect(unreferenced.def.data.logMentions).toBe(0);
    expect(String(styleFor(cy, 'node')?.width)).toContain('mapData(logMentions');
    // Growth is capped — an absurd mention count never blows past the ceiling.
    render(<KnowledgeGraphFramework projection={{
      ...PROJECTION,
      nodes: [{ id: 'huge', label: 'Huge', mentionCount: 100_000, provenanceCount: 100_000 }],
      edges: [{ id: 'huge_self', source: 'huge', target: 'huge', predicate: 'references itself', mentionCount: 1 }],
    }} />);
    await waitFor(() => expect(cyState.instances.length).toBeGreaterThanOrEqual(1));
    const huge = cyState.instances[cyState.instances.length - 1].store.find((el: any) => el.id() === 'huge');
    expect(huge.def.data.logMentions).toBeLessThanOrEqual(6);
  });

  it('always shows a direction arrow (every verb phrase is directed subject->object) and keeps labels horizontal', async () => {
    render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));
    const cy = cyState.instances[0];
    expect(styleFor(cy, 'edge')?.['target-arrow-shape']).toBe('triangle');
    expect(styleFor(cy, 'edge')?.label).toBe('');
    fireEvent.click(screen.getByLabelText('Show relationship labels'));
    await waitFor(() => expect(styleFor(cy, 'edge')?.label).toBe('data(predicate)'));
    expect(styleFor(cy, 'edge')?.label).toBe('data(predicate)');
    expect(styleFor(cy, 'edge')?.['text-rotation']).toBe('none');
    expect(styleFor(cy, 'edge')?.['text-background-opacity']).toBeGreaterThan(0);
    expect(JSON.stringify(cy.options.style)).not.toContain('autorotate');
  });

  it('does not rerun layout or churn elements when an identical projection arrives as a new object', async () => {
    const { rerender } = render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances[0]?.layouts.length).toBe(1));
    const cy = cyState.instances[0];
    const elementRefsBefore = [...cy.store];

    const identicalClone: GraphProjectionV1 = JSON.parse(JSON.stringify(PROJECTION));
    rerender(<KnowledgeGraphFramework projection={identicalClone} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));

    expect(cy.layouts).toHaveLength(1); // no second layout run
    expect(cy.store).toEqual(elementRefsBefore); // same element instances, untouched
  });

  it('applies new real records as a diff: surviving elements keep identity, one bounded layout update', async () => {
    const { rerender } = render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances[0]?.layouts.length).toBe(1));
    const cy = cyState.instances[0];
    const survivorBefore = cy.store.find((el: any) => el.id() === 'asts');

    const grown: GraphProjectionV1 = {
      ...PROJECTION,
      nodes: [...PROJECTION.nodes, { id: 'rdw', label: 'RDW', mentionCount: 1, provenanceCount: 1 }],
      edges: [...PROJECTION.edges, { id: 'rdw_supports_asts', source: 'rdw', target: 'asts', predicate: 'supports', mentionCount: 1 }],
    };
    rerender(<KnowledgeGraphFramework projection={grown} />);
    await waitFor(() => expect(cy.store.length).toBe(5));

    const survivorAfter = cy.store.find((el: any) => el.id() === 'asts');
    expect(survivorAfter).toBe(survivorBefore); // not removed/re-added — position preserved
    expect(cy.layouts).toHaveLength(2); // exactly one additional bounded layout
  });

  it('removes elements that left the projection without inventing replacements', async () => {
    const { rerender } = render(<KnowledgeGraphFramework projection={PROJECTION} />);
    fireEvent.click(screen.getByLabelText('Hide unconnected'));
    await waitFor(() => expect(cyState.instances[0]?.store.length).toBe(4));
    const cy = cyState.instances[0];

    const shrunk: GraphProjectionV1 = {
      ...PROJECTION,
      nodes: PROJECTION.nodes.filter((n) => n.id !== 'unreferenced'),
    };
    rerender(<KnowledgeGraphFramework projection={shrunk} />);
    await waitFor(() => expect(cy.store.length).toBe(3));
    expect(cy.store.map((el: any) => el.id())).not.toContain('unreferenced');
  });

  it('skips an edge whose endpoint is missing without inventing a replacement node', async () => {
    const withGhostEdge: GraphProjectionV1 = {
      ...PROJECTION,
      edges: [
        ...PROJECTION.edges,
        { id: 'ghost_edge', source: 'asts', target: 'not_in_projection', predicate: 'points nowhere', mentionCount: 0 },
      ],
    };
    render(<KnowledgeGraphFramework projection={withGhostEdge} />);
    fireEvent.click(screen.getByLabelText('Hide unconnected'));
    await waitFor(() => expect(cyState.instances[0]?.store.length).toBe(4)); // ghost edge NOT added
    expect(cyState.instances[0].store.map((el: any) => el.id())).not.toContain('ghost_edge');
    expect(cyState.instances[0].store.map((el: any) => el.id())).not.toContain('not_in_projection');
  });

  it('selection and node dragging do not restart the settled layout', async () => {
    render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));
    const cy = cyState.instances[0];
    expect(cy.handlers.map((h: any) => h.event)).toEqual(['tap', 'tap', 'tap']);
    const layoutRunsBefore = cy.layouts.length;

    const nodeTap = cy.handlers.find((h: any) => h.selector === 'node');
    nodeTap.fn({ target: { closedNeighborhood: () => ({ length: 2 }), data: () => PROJECTION.nodes[0] } });
    const edgeTap = cy.handlers.find((h: any) => h.selector === 'edge');
    edgeTap.fn({ target: { union: () => ({ length: 3 }), connectedNodes: () => ({ length: 2 }) } });
    const blankTap = cy.handlers.find((h: any) => h.selector === undefined);
    blankTap.fn({ target: cy });

    expect(cy.layouts.length).toBe(layoutRunsBefore); // selection is never a layout trigger
    expect(cy.store.length).toBe(3); // and never a data change

    expect(cy.handlers.find((h: any) => h.event === 'dragfree')).toBeUndefined();
    expect(cy.layouts.length).toBe(layoutRunsBefore);
  });

  it('keeps the inspector docked beside the canvas and switches from overview to the selected record', async () => {
    render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));
    const cy = cyState.instances[0];

    // The inspector is a sibling panel, never an overlay or transient drawer.
    expect(screen.queryByTestId('knowledge-graph-node-inspector')).toBeNull();
    const overview = screen.getByTestId('knowledge-graph-node-drawer');
    expect(overview.getAttribute('data-open')).toBe('true');
    expect(overview.textContent).toContain('ThinkGraph overview');

    const nodeTap = cy.handlers.find((h: any) => h.selector === 'node');
    nodeTap.fn({ target: { closedNeighborhood: () => ({ length: 2 }), data: () => PROJECTION.nodes[0] } });

    const drawer = await screen.findByTestId('knowledge-graph-node-drawer');
    expect(drawer.getAttribute('data-open')).toBe('true');
    const lead = PROJECTION.nodes[0].title || PROJECTION.nodes[0].label;
    expect(drawer.textContent).toContain(lead);
    expect(drawer.textContent).toContain('Canonical ID');
    expect(within(drawer).queryByLabelText('Close drawer')).toBeNull();
  });

  it('shows only a compact linked-run provenance section for a selected, explicitly linked node', async () => {
    const onReference = vi.fn();
    render(
      <KnowledgeGraphFramework
        projection={PROJECTION}
        activeHermesReport={{
          reportId: 'hermes:req_1234abcd',
          status: 'updated',
          summary: 'Investigated the selected run.',
          reportMarkdown: '# Hermes report\n\nThe run is ready for review.',
          parentRunId: 'req_1234abcd',
          artifactRunId: 'req_1234abcd',
          focusNodeIds: ['run:42'],
          requestedOutcome: 'Inspect the selected run.',
          createdAt: '2026-07-13T00:00:00.000Z',
          updatedAt: '2026-07-13T00:01:00.000Z',
          revision: 2,
          linkedThinkGraphNodeIds: ['asts'],
          linkedKnowGraphRefs: [],
          linkedCodeGraphRefs: ['client/src/components/knowledge/KnowledgeGraphFramework.tsx'],
        }}
        onHermesReportReference={onReference}
      />,
    );
    const drawer = await screen.findByTestId('knowledge-graph-node-drawer');
    expect(drawer.getAttribute('data-open')).toBe('true');
    expect(within(drawer).queryByTestId('knowledge-graph-hermes-context')).toBeNull();
    const cy = cyState.instances[0];
    const nodeTap = cy.handlers.find((handler: any) => handler.selector === 'node');
    nodeTap.fn({ target: { closedNeighborhood: () => ({ length: 2 }), data: () => PROJECTION.nodes[0] } });
    const context = await within(drawer).findByTestId('knowledge-graph-hermes-context');
    expect(context.textContent).toContain('Linked run provenance');
    expect(context.textContent).not.toContain('Investigated the selected run.');
    fireEvent.click(within(context).getByRole('button', { name: /Linked run provenance/i }));
    expect(context.textContent).toContain('hermes:req_1234abcd');
    fireEvent.click(within(context).getByText('client/src/components/knowledge/KnowledgeGraphFramework.tsx'));
    expect(onReference).toHaveBeenCalledWith({ authority: 'codegraph', id: 'client/src/components/knowledge/KnowledgeGraphFramework.tsx' });
  });

  it('renders compact graph nav controls (zoom in/out, fit, center)', async () => {
    render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));
    const controls = screen.getByTestId('knowledge-graph-nav-controls');
    for (const label of ['Zoom in', 'Zoom out', 'Fit graph to view', 'Center view']) {
      expect(within(controls).getByLabelText(label)).toBeTruthy();
    }
  });

  it('reapplies elements after a StrictMode double-mount (destroyed instance must not keep the fingerprint)', async () => {
    render(
      <React.StrictMode>
        <KnowledgeGraphFramework projection={PROJECTION} />
      </React.StrictMode>,
    );
    await waitFor(() => expect(cyState.instances.length).toBeGreaterThanOrEqual(2));
    const lastCy = cyState.instances[cyState.instances.length - 1];
    await waitFor(() => expect(lastCy.store.length).toBe(3));
    expect(cyState.instances[0].destroy).toHaveBeenCalled();
  });

  it('destroys the Cytoscape instance on unmount', async () => {
    const { unmount } = render(<KnowledgeGraphFramework projection={PROJECTION} />);
    await waitFor(() => expect(cyState.instances).toHaveLength(1));
    unmount();
    expect(cyState.instances[0].destroy).toHaveBeenCalledTimes(1);
  });
});
