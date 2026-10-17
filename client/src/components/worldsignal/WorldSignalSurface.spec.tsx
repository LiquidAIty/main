/**
 * Entity: WorldSignals
 * Relationship: Proves the host publishes a bridge only after product readiness and fences stale callbacks while remounting and destroying exact Project generations.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WorldSignalSurface, {
  type WorldSignalsInspectorBridge,
  type WorldSignalsLayerState,
} from './WorldSignalSurface';

type MountOptions = {
  projectId?: string;
  onReady?: () => void;
  onError?: (error: { code: string; message: string }) => void;
  onLayerStateChange?: (state: WorldSignalsLayerState) => void;
};

function layerState(profileVersion: number): WorldSignalsLayerState {
  return {
    profileId: 'world-intelligence',
    profileVersion,
    layers: [],
    enabledLayerIds: [],
  };
}

describe('WorldSignals mounted generation', () => {
  const mounts: Array<{
    options: MountOptions;
    unmount: ReturnType<typeof vi.fn>;
  }> = [];

  beforeEach(() => {
    mounts.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      enabled: true,
      status: 'ok',
      backend: { reachable: true, url: 'http://127.0.0.1:8000' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const module = {
      mountWorldSignals: vi.fn((_container: HTMLElement, options: MountOptions) => {
        const unmount = vi.fn();
        mounts.push({ options, unmount });
        return {
          getLayerState: () => layerState(1),
          setLayerEnabled: vi.fn(),
          resetLayersToWorldIntelligenceDefaults: vi.fn(),
          getMarketsSnapshot: () => ({
            status: 'empty' as const,
            provider: null,
            degraded: false,
            quotes: [],
            lastUpdated: null,
          }),
          flyTo: vi.fn(),
          unmount,
        };
      }),
    };
    (window as unknown as { __worldSignalsEmbed?: unknown }).__worldSignalsEmbed = module;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('waits for onReady, then destroys and fences the old Project mount', async () => {
    const bridges: Array<WorldSignalsInspectorBridge | null> = [];
    const layers: Array<WorldSignalsLayerState | null> = [];
    const { rerender, getByTestId } = render(
      <WorldSignalSurface
        projectId="project-a"
        cardId="card-worldsignals"
        onBridgeChange={(bridge) => bridges.push(bridge)}
        onLayerStateChange={(state) => layers.push(state)}
      />,
    );
    await waitFor(() => expect(mounts).toHaveLength(1));
    expect(mounts[0].options.projectId).toBe('project-a');
    expect(getByTestId('worldsignals-mount').getAttribute('data-ready')).toBe('false');
    expect(bridges.filter(Boolean)).toHaveLength(0);

    act(() => { mounts[0].options.onReady?.(); });
    expect(getByTestId('worldsignals-mount').getAttribute('data-ready')).toBe('true');
    expect(bridges.filter(Boolean)).toHaveLength(1);

    rerender(
      <WorldSignalSurface
        projectId="project-b"
        cardId="card-worldsignals"
        onBridgeChange={(bridge) => bridges.push(bridge)}
        onLayerStateChange={(state) => layers.push(state)}
      />,
    );
    await waitFor(() => expect(mounts).toHaveLength(2));
    expect(mounts[0].unmount).toHaveBeenCalledTimes(1);
    expect(mounts[1].options.projectId).toBe('project-b');
    expect(bridges.at(-1)).toBeNull();

    act(() => {
      mounts[0].options.onReady?.();
      mounts[0].options.onLayerStateChange?.(layerState(99));
    });
    expect(bridges.at(-1)).toBeNull();
    expect(layers.some((state) => state?.profileVersion === 99)).toBe(false);

    act(() => {
      mounts[1].options.onReady?.();
      mounts[1].options.onLayerStateChange?.(layerState(2));
    });
    expect(bridges.at(-1)).not.toBeNull();
    expect(layers.at(-1)?.profileVersion).toBe(2);
  });
});
