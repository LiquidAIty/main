// @vitest-environment jsdom
// Entity: Card Topology
// Relationship: Exercises the real canvas library's cached handle bounds and wire endpoints when a saved Card changes its bus-facing side.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionMode, ReactFlow, type Edge, type EdgeProps, type Node, type ReactFlowInstance } from '@xyflow/react';
import AgentCardNode from './AgentCardNode';
import MagenticBusNode from './MagenticBusNode';

const nodeTypes = { agentCard: AgentCardNode, magenticBus: MagenticBusNode };
const edgeTypes = { probe: ({ sourceX, sourcePosition }: EdgeProps) =>
  <path data-testid="wire" data-source-x={sourceX} data-source-side={sourcePosition} /> };

beforeEach(() => {
  // jsdom has no layout engine. Supply layout only; ReactFlow's Handle,
  // measurement cache, observer, update hook and edge projection are all real.
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1; });
  vi.stubGlobal('ResizeObserver', class {
    observe(target: Element) {
      queueMicrotask(() => this.callback([{ target }] as ResizeObserverEntry[], this as unknown as ResizeObserver));
    }
    unobserve() {}
    disconnect() {}
    constructor(private callback: ResizeObserverCallback) {}
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('react-flow__handle')) return Number.parseFloat(this.style.width) || 12;
    if (this.classList.contains('react-flow__node')) return this.dataset.id === 'bus' ? 26 : 124;
    return 1000;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('react-flow__handle')) return Number.parseFloat(this.style.height) || 12;
    if (this.classList.contains('react-flow__node')) return this.dataset.id === 'bus' ? 456 : 90;
    return 600;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const node = this.closest<HTMLElement>('.react-flow__node');
    const position = node?.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    let x = Number(position?.[1] || 0);
    let y = Number(position?.[2] || 0);
    if (node && this.classList.contains('react-flow__handle')) {
      x += this.dataset.handlepos === 'right' ? node.offsetWidth - this.offsetWidth / 2 : -this.offsetWidth / 2;
      y += (Number.parseFloat(this.style.top) || node.offsetHeight / 2) - this.offsetHeight / 2;
    }
    return { x, y, left: x, top: y, width: this.offsetWidth, height: this.offsetHeight,
      right: x + this.offsetWidth, bottom: y + this.offsetHeight, toJSON() {} };
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Card bus-facing geometry with real ReactFlow', () => {
  it('keeps both cached blue handles and the rendered wire on the visible side across repeated moves', async () => {
    let instance: ReactFlowInstance;
    const onInit = (value: ReactFlowInstance) => { instance = value; };
    const view = (x: number, orchestrator = false) => <ReactFlow<Node, Edge>
      width={1000} height={600} onInit={onInit} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose}
      nodes={[
        { id: 'card', type: 'agentCard', position: { x, y: 100 }, data: {
          id: 'card', kind: 'agent', title: 'Learner', templateId: 'assist', position: { x, y: 100 },
          busX: 140, runtime: { kind: 'hermes', mode: 'delegate', profile: 'learner' },
          runtimeOptions: { orchestrator },
        } },
        { id: 'bus', type: 'magenticBus', position: { x: 140, y: 0 }, data: {} },
      ]}
      edges={[{ id: 'wire', source: 'card', target: 'bus', targetHandle: 'bus-in-2', type: 'probe' }]}
    />;
    const { container, rerender, getByTestId } = render(view(300));
    const check = async (x: number, side: 'left' | 'right') => waitFor(() => {
      const card = instance.getInternalNode('card')!;
      for (const type of ['source', 'target'] as const) {
        const bounds = card.internals.handleBounds?.[type]?.find(handle => !handle.id);
        const handle = container.querySelector<HTMLElement>(`.react-flow__node[data-id="card"] .${type}`)!;
        expect(handle.dataset.handlepos).toBe(side);
        expect(bounds?.position).toBe(side);
        expect(bounds?.x).toBe(side === 'left' ? -6 : 118);
      }
      expect(getByTestId('wire').getAttribute('data-source-side')).toBe(side);
      expect(Number(getByTestId('wire').getAttribute('data-source-x'))).toBe(x + (side === 'right' ? 130 : -6));
    });
    await check(300, 'left');
    // Same mounted, same-sized Card; no synthetic resize notification on moves.
    const mountedCard = container.querySelector('.react-flow__node[data-id="card"]');
    rerender(view(-120));
    await check(-120, 'right');
    expect(container.querySelector('.react-flow__node[data-id="card"]')).toBe(mountedCard);
    rerender(view(300, true));
    await check(300, 'left');
    expect(instance!.getInternalNode('card')!.internals.handleBounds?.source?.map(handle => handle.id))
      .toEqual([null, 'card-control']);
    rerender(view(300, false));
    await waitFor(() => expect(instance!.getInternalNode('card')!.internals.handleBounds?.source?.map(handle => handle.id))
      .toEqual([null]));
  });
});
