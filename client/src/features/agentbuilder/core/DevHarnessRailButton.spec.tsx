// @vitest-environment jsdom
// Harness presence rail icon: lit ONLY when a real recent dev_probe telemetry
// event exists, dim otherwise (including backend-unreachable), opens the
// dashboard on click. Presence is never invented — it comes from the injected
// (test) event fetch.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DevHarnessRailButton, { latestProbeAgeMs } from './DevHarnessRailButton';

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

describe('DevHarnessRailButton', () => {
  it('lights up when a recent dev_probe event exists', async () => {
    const container = await render(
      <DevHarnessRailButton
        dimColor="#ccc"
        activeColor="#0af"
        fetchProbeEvents={vi.fn(async () => [
          { stage: 'dev_probe', timestamp: new Date(Date.now() - 60_000).toISOString() },
        ])}
      />,
    );
    const button = container.querySelector('[data-testid="rail-dev-harness-button"]')!;
    expect(button.getAttribute('data-plugged-in')).toBe('true');
    expect(button.getAttribute('title')).toContain('coding agent active');
  });

  it('stays dim with no probe activity or an unreachable backend', async () => {
    for (const fetcher of [vi.fn(async () => []), vi.fn(async () => null)]) {
      const container = await render(
        <DevHarnessRailButton dimColor="#ccc" activeColor="#0af" fetchProbeEvents={fetcher} />,
      );
      const button = container.querySelector('[data-testid="rail-dev-harness-button"]')!;
      expect(button.getAttribute('data-plugged-in')).toBe('false');
    }
  });

  it('opens the dashboard on click', async () => {
    const open = vi.fn();
    const container = await render(
      <DevHarnessRailButton
        dimColor="#ccc"
        activeColor="#0af"
        fetchProbeEvents={vi.fn(async () => [])}
        openDashboard={open}
      />,
    );
    await act(async () => {
      (container.querySelector('[data-testid="rail-dev-harness-button"]') as HTMLElement).click();
    });
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('latestProbeAgeMs', () => {
  it('returns the age of the newest dev_probe event, null when none', () => {
    const now = Date.parse('2026-07-10T06:10:00.000Z');
    expect(
      latestProbeAgeMs(
        [
          { stage: 'dev_probe', timestamp: '2026-07-10T06:00:00.000Z' },
          { stage: 'dev_probe', timestamp: '2026-07-10T06:09:00.000Z' },
          { stage: 'card_call', timestamp: '2026-07-10T06:09:30.000Z' },
        ],
        now,
      ),
    ).toBe(60_000);
    expect(latestProbeAgeMs([{ stage: 'card_call', timestamp: '2026-07-10T06:09:30.000Z' }], now)).toBeNull();
    expect(latestProbeAgeMs([], now)).toBeNull();
  });
});
