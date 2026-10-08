/**
 * Embeddable entry for the WorldSignals application.
 *
 * A host application (LiquidAIty's Vite/React shell) mounts the real app —
 * same components, stores, hooks, MapLibre map and panels — directly into one
 * of its own DOM containers. There is no iframe and no second page.
 *
 * The app owns its own React root because it runs a different React major than
 * the current host (19 vs 18). Two roots in one document is the boundary that
 * makes that safe: nothing crosses except this typed handle.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setApiBase, setAssetBase, setEmbedded } from '@/lib/api';
import { ThemeProvider } from '@/lib/ThemeContext';
import { I18nProvider } from '@/i18n';
import {
  emitReady,
  invokeAppCommand,
  registerHostListeners,
  setInitialEnabledLayerIds,
  type WorldSignalsFlyToInput,
  type WorldSignalsInspectorSection,
  type WorldSignalsLayerStateRef,
  type WorldSignalsMarketsSnapshot,
  type WorldSignalsSelectionRef,
} from '@/embed/hostBridge';
import Dashboard from '@/app/page';
import '@/app/globals.css';

export type {
  WorldSignalsFlyToInput,
  WorldSignalsInspectorSection,
  WorldSignalsLayerStateRef,
  WorldSignalsMarketsSnapshot,
  WorldSignalsSelectionRef,
};

export interface WorldSignalsHostError {
  code: string;
  message: string;
}

export interface WorldSignalsMountOptions {
  /** Base the app prefixes onto every `/api/...` call. May be a path or origin. */
  apiBaseUrl: string;
  /** Where the host serves this bundle's own static files (public/). */
  assetBaseUrl?: string;
  projectId?: string;
  /**
   * Complete enabled-layer set to restore (host-persisted embedded choices).
   * Applied over the world-intelligence defaults; unknown ids are ignored.
   */
  initialEnabledLayerIds?: string[];
  onReady?: () => void;
  onSelectionChange?: (selection: WorldSignalsSelectionRef | null) => void;
  /** A vendor control (Markets, Layers) asks the host to open an Inspector section. */
  onInspectorSectionRequest?: (section: WorldSignalsInspectorSection) => void;
  /** Layer enable/disable changed — fires once on mount with the initial state. */
  onLayerStateChange?: (state: WorldSignalsLayerStateRef) => void;
  onError?: (error: WorldSignalsHostError) => void;
}

export interface WorldSignalsMountHandle {
  flyTo(input: WorldSignalsFlyToInput): void;
  getLayerState(): WorldSignalsLayerStateRef;
  setLayerEnabled(layerId: string, enabled: boolean): void;
  resetLayersToWorldIntelligenceDefaults(): void;
  getMarketsSnapshot(): WorldSignalsMarketsSnapshot;
  unmount(): void;
}

export function mountWorldSignals(
  container: HTMLElement,
  options: WorldSignalsMountOptions,
): WorldSignalsMountHandle {
  setApiBase(options.apiBaseUrl);
  setAssetBase(options.assetBaseUrl ?? '');
  setEmbedded(true);
  setInitialEnabledLayerIds(options.initialEnabledLayerIds ?? null);

  const releaseHost = registerHostListeners({
    onReady: options.onReady,
    onSelectionChange: options.onSelectionChange,
    onInspectorSectionRequest: options.onInspectorSectionRequest,
    onLayerStateChange: options.onLayerStateChange,
  });

  let root: Root | null = createRoot(container, {
    onUncaughtError: (error: unknown) => {
      options.onError?.({
        code: 'worldsignals_render_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  root.render(
    <React.StrictMode>
      <I18nProvider>
        <ThemeProvider>
          <Dashboard />
        </ThemeProvider>
      </I18nProvider>
    </React.StrictMode>,
  );

  return {
    flyTo(input) {
      invokeAppCommand('flyTo', input);
    },
    getLayerState() {
      return invokeAppCommand('getLayerState');
    },
    setLayerEnabled(layerId, enabled) {
      invokeAppCommand('setLayerEnabled', layerId, enabled);
    },
    resetLayersToWorldIntelligenceDefaults() {
      invokeAppCommand('resetLayersToWorldIntelligenceDefaults');
    },
    getMarketsSnapshot() {
      return invokeAppCommand('getMarketsSnapshot');
    },
    unmount() {
      releaseHost();
      setInitialEnabledLayerIds(null);
      root?.unmount();
      root = null;
    },
  };
}

// The host loads this bundle as a plain ES module; keep a named export surface.
export { emitReady };
