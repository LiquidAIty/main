// @vitest-environment jsdom
// Hermes console: honest empty state, real activity rows, blocked-entry
// emphasis, and an honest unreachable-backend state. No invented activity —
// everything rendered comes from the injected (test) fetch result.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HermesConsole, {
  type HermesActivityEntry,
  type HermesActivityFetchResult,
} from './HermesConsole';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLElement[] = [];

async function render(node: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

function fetcher(result: HermesActivityFetchResult) {
  return vi.fn(async () => result);
}

const ENTRIES: HermesActivityEntry[] = [
  {
    id: 'hermes:run_47:1',
    timestamp: '2026-07-08T14:23:00+00:00',
    type: 'review_complete',
    summary: 'Run run_47: verdict=blocked — 3/4 proven, blocker: empty_graph',
    runId: 'run_47',
  },
  {
    id: 'hermes:run_47:2',
    timestamp: '2026-07-08T14:23:00+00:00',
    type: 'thinkgraph_write_planned',
    summary: 'ThinkGraph write plan ready: 3 node(s), 3 edge(s)',
    runId: 'run_47',
  },
  {
    id: 'hermes:run_47:3',
    timestamp: '2026-07-08T14:24:00+00:00',
    type: 'pattern_detected',
    summary: 'Pattern graph_readback_gate: 2 occurrence(s)',
    detail: 'graph readback returned 0 nodes',
    runId: 'run_47',
  },
];

async function expand(host: HTMLElement): Promise<void> {
  const toggle = host.querySelector('[data-testid="hermes-console-toggle"]') as HTMLButtonElement;
  await act(async () => {
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('HermesConsole', () => {
  it('renders the honest empty state collapsed and expanded', async () => {
    const host = await render(<HermesConsole fetchActivity={fetcher({ ok: true, activity: [] })} />);
    expect(host.querySelector('[data-testid="hermes-console-latest"]')?.textContent).toBe(
      'Hermes has not reviewed a run yet.',
    );
    await expand(host);
    expect(host.querySelector('[data-testid="hermes-console-empty"]')?.textContent).toBe(
      'Hermes has not reviewed a run yet.',
    );
    expect(host.querySelectorAll('[data-testid="hermes-console-row"]')).toHaveLength(0);
  });

  it('collapses to the latest real entry and expands to the full feed with detail', async () => {
    const host = await render(
      <HermesConsole fetchActivity={fetcher({ ok: true, activity: ENTRIES })} />,
    );
    const latest = host.querySelector('[data-testid="hermes-console-latest"]');
    expect(latest?.textContent).toContain('[14:24] Pattern graph_readback_gate: 2 occurrence(s)');

    await expand(host);
    const rows = Array.from(host.querySelectorAll('[data-testid="hermes-console-row"]'));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('verdict=blocked — 3/4 proven');
    expect(rows[1].textContent).toContain('ThinkGraph write plan ready');
    expect(rows[2].textContent).toContain('graph readback returned 0 nodes'); // detail line
  });

  it('renders a blocked review entry with the blocked emphasis', async () => {
    const blocked: HermesActivityEntry = {
      id: 'hermes:blocked:1',
      timestamp: '2026-07-08T14:30:00+00:00',
      type: 'blocked',
      summary: 'Hermes review blocked: PYTHON_AUTOGEN_RAILS_UNAVAILABLE',
    };
    const host = await render(
      <HermesConsole fetchActivity={fetcher({ ok: true, activity: [blocked] })} />,
    );
    await expand(host);
    const row = host.querySelector('[data-testid="hermes-console-row"]');
    expect(row?.textContent).toContain('Hermes review blocked: PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
    expect(row?.getAttribute('data-entry-type')).toBe('blocked');
  });

  it('reports an unreachable activity backend honestly instead of inventing a feed', async () => {
    const host = await render(
      <HermesConsole fetchActivity={fetcher({ ok: false, error: 'hermes_activity_unreachable' })} />,
    );
    expect(host.querySelector('[data-testid="hermes-console-latest"]')?.textContent).toBe(
      'Hermes activity unavailable: hermes_activity_unreachable',
    );
    await expand(host);
    expect(host.querySelector('[data-testid="hermes-console-error"]')?.textContent).toBe(
      'Hermes activity unavailable: hermes_activity_unreachable',
    );
    expect(host.querySelectorAll('[data-testid="hermes-console-row"]')).toHaveLength(0);
  });
});
