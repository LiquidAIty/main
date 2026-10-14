import React, { useEffect, useMemo, useState } from 'react';

import GlassInspectorSection from '../graph/GlassInspectorSection';
import { GRAPH_THEME, graphDrawerButtonStyle } from '../graph/graphVisualTokens';
import type {
  WorldSignalsInspectorBridge,
  WorldSignalsLayerDescriptor,
  WorldSignalsLayerState,
  WorldSignalsMarketsSnapshot,
} from './WorldSignalSurface';

/**
 * Canonical-Inspector content for the WorldSignals companion surface.
 * This is drawer CONTENT only — the one workspace RightGlassDrawer in
 * agentbuilder.tsx owns the drawer itself.
 */
export default function WorldSignalsInspectorPanel({
  section,
  bridge,
  layerState,
}: {
  section: 'markets' | 'layers';
  bridge: WorldSignalsInspectorBridge | null;
  layerState: WorldSignalsLayerState | null;
}): React.ReactElement {
  return section === 'markets' ? (
    <MarketsSection bridge={bridge} />
  ) : (
    <LayersSection bridge={bridge} layerState={layerState} />
  );
}

const POSITIVE = '#5BD6A2';
const NEGATIVE = '#E5A069';

function MarketsSection({
  bridge,
}: {
  bridge: WorldSignalsInspectorBridge | null;
}): React.ReactElement {
  const [snapshot, setSnapshot] = useState<WorldSignalsMarketsSnapshot | null>(null);
  const [observedAt, setObservedAt] = useState<Date | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return undefined;
    let cancelled = false;
    const read = () => {
      try {
        const next = bridge.getMarketsSnapshot();
        if (cancelled) return;
        setSnapshot(next);
        setObservedAt(new Date());
        setReadError(null);
      } catch (error) {
        if (cancelled) return;
        setReadError(
          error instanceof Error ? error.message : 'worldsignals_markets_unavailable',
        );
      }
    };
    read();
    const interval = window.setInterval(read, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [bridge]);

  if (!bridge) {
    return <Note text="WorldSignals is still loading — market data appears once the map is mounted." />;
  }
  if (readError) {
    return <Note tone="warn" text={`Market feed unavailable: ${readError}`} />;
  }
  if (!snapshot) {
    return <Note text="Reading live market data…" />;
  }
  if (snapshot.status === 'backend_offline') {
    return <Note tone="warn" text="WorldSignals backend is offline — no live market data." />;
  }
  if (snapshot.status === 'empty') {
    return <Note text="No market data received yet. The feed fills in shortly after backend start." />;
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <GlassInspectorSection
        title="Live markets"
        signal={`${snapshot.quotes.length} symbols`}
        testId="worldsignals-inspector-markets"
      >
        <div style={{ display: 'grid', gap: 2 }}>
          {snapshot.quotes.map((quote) => {
            const changeColor =
              quote.changePercent > 0 ? POSITIVE : quote.changePercent < 0 ? NEGATIVE : GRAPH_THEME.drawer.inputMuted;
            return (
              <div
                key={quote.symbol}
                data-testid={`worldsignals-market-row-${quote.symbol}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 10,
                  alignItems: 'baseline',
                  padding: '5px 4px',
                  borderBottom: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span
                  style={{
                    color: GRAPH_THEME.drawer.inputText,
                    fontSize: 11.5,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                  }}
                >
                  {quote.symbol}
                </span>
                <span style={{ color: GRAPH_THEME.drawer.inputText, fontSize: 12 }}>
                  {quote.price.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span style={{ color: changeColor, fontSize: 11, minWidth: 58, textAlign: 'right' }}>
                  {quote.changePercent > 0 ? '+' : ''}
                  {quote.changePercent.toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      </GlassInspectorSection>

      <div
        data-testid="worldsignals-markets-provenance"
        style={{ display: 'grid', gap: 3, padding: '2px 4px', fontSize: 10.5, color: GRAPH_THEME.drawer.inputMuted }}
      >
        <span>
          Provider: {snapshot.provider ?? 'unknown'}
          {snapshot.degraded ? ' — limited fallback feed' : ''}
        </span>
        {snapshot.lastUpdated ? <span>Backend refresh: {snapshot.lastUpdated}</span> : null}
        {observedAt ? <span>Read {observedAt.toLocaleTimeString()} · refreshes every 15s</span> : null}
      </div>
    </div>
  );
}

function LayersSection({
  bridge,
  layerState,
}: {
  bridge: WorldSignalsInspectorBridge | null;
  layerState: WorldSignalsLayerState | null;
}): React.ReactElement {
  const grouped = useMemo(() => {
    if (!layerState) return null;
    return {
      worldIntelligence: groupInOrder(layerState.layers.filter((layer) => !layer.specialist)),
      specialist: groupInOrder(layerState.layers.filter((layer) => layer.specialist)),
    };
  }, [layerState]);

  if (!bridge || !layerState || !grouped) {
    return <Note text="WorldSignals is still loading — layer controls appear once the map is mounted." />;
  }

  const enabled = new Set(layerState.enabledLayerIds);
  const countOn = (layers: WorldSignalsLayerDescriptor[]) =>
    layers.filter((layer) => enabled.has(layer.id)).length;
  const worldIntelLayers = layerState.layers.filter((layer) => !layer.specialist);
  const specialistLayers = layerState.layers.filter((layer) => layer.specialist);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <GlassInspectorSection
        title="World Intelligence"
        signal={`${countOn(worldIntelLayers)}/${worldIntelLayers.length} on`}
        testId="worldsignals-inspector-layers-world"
      >
        <LayerGroups groups={grouped.worldIntelligence} enabled={enabled} bridge={bridge} />
      </GlassInspectorSection>

      <GlassInspectorSection
        title="Specialist"
        signal={`${countOn(specialistLayers)}/${specialistLayers.length} on`}
        defaultOpen={false}
        testId="worldsignals-inspector-layers-specialist"
      >
        <div style={{ fontSize: 10.5, color: GRAPH_THEME.drawer.inputMuted, marginBottom: 2 }}>
          Off by default in the World Intelligence profile. Enable deliberately.
        </div>
        <LayerGroups groups={grouped.specialist} enabled={enabled} bridge={bridge} />
      </GlassInspectorSection>

      <button
        type="button"
        data-testid="worldsignals-layers-reset"
        onClick={() => bridge.resetLayersToWorldIntelligenceDefaults()}
        style={graphDrawerButtonStyle({
          padding: '7px 10px',
          fontSize: 11,
          color: GRAPH_THEME.drawer.inputText,
        })}
      >
        Reset to World Intelligence defaults
      </button>
    </div>
  );
}

type LayerGroup = { group: string; layers: WorldSignalsLayerDescriptor[] };

/** Presentation grouping only — descriptor order and ids come from WorldSignals. */
function groupInOrder(layers: WorldSignalsLayerDescriptor[]): LayerGroup[] {
  const groups: LayerGroup[] = [];
  for (const layer of layers) {
    const current = groups[groups.length - 1];
    if (current && current.group === layer.group) {
      current.layers.push(layer);
    } else {
      groups.push({ group: layer.group, layers: [layer] });
    }
  }
  return groups;
}

function LayerGroups({
  groups,
  enabled,
  bridge,
}: {
  groups: LayerGroup[];
  enabled: Set<string>;
  bridge: WorldSignalsInspectorBridge;
}): React.ReactElement {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {groups.map((group) => (
        <div key={group.group} style={{ display: 'grid', gap: 3 }}>
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: GRAPH_THEME.drawer.inputMuted,
            }}
          >
            {group.group}
          </div>
          {group.layers.map((layer) => (
            <label
              key={layer.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: GRAPH_THEME.drawer.inputText,
                cursor: layer.available ? 'pointer' : 'not-allowed',
                opacity: layer.available ? 1 : 0.45,
                padding: '1px 0',
              }}
            >
              <input
                type="checkbox"
                data-testid={`worldsignals-layer-toggle-${layer.id}`}
                checked={enabled.has(layer.id)}
                disabled={!layer.available}
                onChange={(event) => bridge.setLayerEnabled(layer.id, event.target.checked)}
                style={{ accentColor: GRAPH_THEME.accent.primary }}
              />
              <span>{layer.label}</span>
              {!layer.available ? (
                <span style={{ fontSize: 9.5, color: GRAPH_THEME.drawer.inputMuted }}>unavailable</span>
              ) : null}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function Note({ text, tone }: { text: string; tone?: 'warn' }): React.ReactElement {
  return (
    <div
      data-testid="worldsignals-inspector-note"
      style={{
        padding: '10px 4px',
        fontSize: 11.5,
        lineHeight: 1.5,
        color: tone === 'warn' ? NEGATIVE : GRAPH_THEME.drawer.inputMuted,
      }}
    >
      {text}
    </div>
  );
}
