import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  mountCrucixRenderer,
  type CrucixRegion,
  type CrucixRenderer,
} from './crucixNativeRenderer';
import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
  graphGlassCardStyle,
  graphGlassPillStyle,
  graphPillButtonStyle,
} from '../graph/graphVisualTokens';
import TelescopeOverlay from '../skyview/TelescopeOverlay';
import type { WorldViewportMode } from '../skyview/types';

type WorldsignalHealth = {
  enabled: true;
  reachable: boolean;
  status: 'ok' | 'offline' | 'error';
  error?: string;
};

type WorldsignalData = {
  enabled: true;
  reachable: boolean;
  status: 'ok' | 'offline' | 'error';
  data?: any;
  error?: string;
};

type LayerStat = {
  label: string;
  value: string | number;
  detail: string;
  dotClass: string;
};

type LayerConfig = {
  id: string;
  label: string;
};

type WidgetId =
  | 'sensorGrid'
  | 'crossSignals'
  | 'openIntel'
  | 'signalCore'
  | 'macroMarkets'
  | 'riskGauges'
  | 'spaceWatch'
  | 'newsTicker'
  | 'opportunities'
  | 'sweepDelta';

type WidgetConfig = {
  id: WidgetId;
  label: string;
};

type WorldViewDataStatus = 'online' | 'offline' | 'loading' | 'error';

type WorldViewContextContract = {
  selectedRegion: CrucixRegion;
  selectedLayers: string[];
  selectedWidgetIds: WidgetId[];
  selectedSignalId: string | null;
  selectedSignalSummary: string | null;
  rendererMode: WorldViewportMode;
  dataStatus: WorldViewDataStatus;
  lastUpdatedAt: string | null;
};

const REGION_TABS: ReadonlyArray<{ id: CrucixRegion; label: string }> = [
  { id: 'world', label: 'WORLD' },
  { id: 'americas', label: 'AMERICAS' },
  { id: 'europe', label: 'EUROPE' },
  { id: 'middleEast', label: 'MIDDLE EAST' },
  { id: 'asiaPacific', label: 'ASIA PACIFIC' },
  { id: 'africa', label: 'AFRICA' },
] as const;

const WORLD_SIGNAL_LAYER_CONFIG: ReadonlyArray<LayerConfig> = [
  { id: 'worldNews', label: 'World News' },
  { id: 'openIntelligence', label: 'Open Intelligence' },
  { id: 'geopoliticalRisk', label: 'Geopolitical Risk' },
  { id: 'weather', label: 'Weather' },
  { id: 'fire', label: 'Fire' },
  { id: 'health', label: 'Health' },
  { id: 'air', label: 'Air' },
  { id: 'maritime', label: 'Maritime' },
  { id: 'supplyChain', label: 'Supply Chain' },
  { id: 'indexes', label: 'Indexes' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'energy', label: 'Energy' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'riskGauges', label: 'Risk Gauges' },
  { id: 'satellites', label: 'Satellites' },
  { id: 'spaceWatch', label: 'Space Watch' },
  { id: 'crossSourceSignals', label: 'Cross-Source Signals' },
  { id: 'sweepDelta', label: 'Sweep Delta' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'signalPriority', label: 'Signal Priority' },
  { id: 'radiation', label: 'Environmental Radiation' },
  { id: 'sdrReceivers', label: 'SDR Receivers' },
  { id: 'nuclearWatch', label: 'Nuclear / Energy Sites' },
] as const;

const WIDGET_CONFIG: ReadonlyArray<WidgetConfig> = [
  { id: 'sensorGrid', label: 'Sensor Grid' },
  { id: 'crossSignals', label: 'Cross-Source Signals' },
  { id: 'openIntel', label: 'Open Intelligence Stream' },
  { id: 'signalCore', label: 'Signal Core' },
  { id: 'macroMarkets', label: 'Macro + Markets' },
  { id: 'riskGauges', label: 'Risk Gauges' },
  { id: 'spaceWatch', label: 'Space Watch' },
  { id: 'newsTicker', label: 'News Ticker' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'sweepDelta', label: 'Sweep Delta' },
] as const;

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function compactErrorMessage(error: unknown): string {
  const raw = String(error ?? '').trim();
  return raw || 'unknown_error';
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dotClassForLabel(label: string): string {
  const v = label.toLowerCase();
  if (v.includes('air')) return 'air';
  if (v.includes('thermal') || v.includes('fire')) return 'thermal';
  if (v.includes('sdr')) return 'sdr';
  if (v.includes('maritime')) return 'maritime';
  if (v.includes('nuclear') || v.includes('energy')) return 'nuke';
  if (v.includes('risk')) return 'incident';
  if (v.includes('health')) return 'health';
  if (v.includes('news')) return 'news';
  if (v.includes('space') || v.includes('satellite')) return 'space';
  return 'osint';
}

const RendererMount = React.memo(function RendererMount({
  mountRef,
}: {
  mountRef: React.RefObject<HTMLDivElement | null>;
}) {
  return <div ref={mountRef} data-testid="worldsignal-three-scene" className="crx-map-view" />;
});

export default function WorldSignalSurface(): React.ReactElement {
  const mapViewportRef = useRef<HTMLElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<CrucixRenderer | null>(null);

  const [health, setHealth] = useState<WorldsignalHealth | null>(null);
  const [dataResponse, setDataResponse] = useState<WorldsignalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const [viewportMode, setViewportMode] = useState<WorldViewportMode>('globe');
  const [flightsVisible, setFlightsVisible] = useState(true);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [region, setRegion] = useState<CrucixRegion>('world');

  const [layersOpen, setLayersOpen] = useState(false);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [visibleLayerIds, setVisibleLayerIds] = useState<string[]>(
    WORLD_SIGNAL_LAYER_CONFIG.map((layer) => layer.id),
  );
  const [activeWidgetIds, setActiveWidgetIds] = useState<WidgetId[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [selectedSignalSummary, setSelectedSignalSummary] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    (async () => {
      if (!mountRef.current) return;
      try {
        const renderer = await mountCrucixRenderer(mountRef.current, null);
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.setFlatMode(viewportMode === 'flat');
        renderer.setFlightsVisible(flightsVisible);
        renderer.setRegion(region);
      } catch (error) {
        if (disposed) return;
        setRuntimeError(compactErrorMessage(error));
      }
    })();

    return () => {
      disposed = true;
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const healthController = new AbortController();
    const dataController = new AbortController();

    (async () => {
      setLoading(true);

      try {
        const healthRes = await fetch('/api/v2/worldsignal/health', {
          signal: healthController.signal,
        });
        const healthJson = (await healthRes.json().catch(() => null)) as WorldsignalHealth | null;
        if (!active) return;
        if (healthJson && typeof healthJson === 'object') {
          setHealth(healthJson);
        } else {
          setHealth({
            enabled: true,
            reachable: false,
            status: 'error',
            error: 'invalid_health_response',
          });
        }
      } catch (error) {
        if (!active) return;
        setHealth({
          enabled: true,
          reachable: false,
          status: 'offline',
          error: compactErrorMessage(error),
        });
      }

      try {
        const dataRes = await fetch('/api/v2/worldsignal/data', {
          signal: dataController.signal,
        });
        const dataJson = (await dataRes.json().catch(() => null)) as WorldsignalData | null;
        if (!active) return;
        if (dataJson && typeof dataJson === 'object') {
          setDataResponse(dataJson);
          if (dataJson.status === 'ok' && dataJson.reachable) {
            setLastUpdatedAt(new Date().toISOString());
          }
        } else {
          setDataResponse({
            enabled: true,
            reachable: false,
            status: 'error',
            error: 'invalid_data_response',
          });
        }
      } catch (error) {
        if (!active) return;
        setDataResponse({
          enabled: true,
          reachable: false,
          status: 'offline',
          error: compactErrorMessage(error),
        });
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      healthController.abort();
      dataController.abort();
    };
  }, []);

  const payload = useMemo(() => dataResponse?.data ?? null, [dataResponse]);

  useEffect(() => {
    rendererRef.current?.update(payload);
  }, [payload]);

  useEffect(() => {
    rendererRef.current?.setFlatMode(viewportMode === 'flat');
  }, [viewportMode]);

  useEffect(() => {
    rendererRef.current?.setFlightsVisible(flightsVisible);
  }, [flightsVisible]);

  useEffect(() => {
    rendererRef.current?.setRegion(region);
  }, [region]);

  const visibleLayerSet = useMemo(() => new Set(visibleLayerIds), [visibleLayerIds]);

  const layerStats = useMemo<LayerStat[]>(() => {
    const air = asArray(payload?.air);
    const thermal = asArray(payload?.thermal);
    const sdrZones = asArray(payload?.sdr?.zones);
    const chokepoints = asArray(payload?.chokepoints?.items ?? payload?.chokepoints);
    const nuclear = asArray(payload?.nuke);
    const acledEvents =
      toCount(payload?.acled?.totalEvents) || asArray(payload?.acled?.events).length;
    const healthAlerts = asArray(payload?.who).length;
    const news = asArray(payload?.news).length || asArray(payload?.newsFeed?.items).length;
    const osint = toCount(payload?.tg?.posts) || asArray(payload?.tg?.urgent).length;
    const space =
      toCount(payload?.space?.militarySats) || asArray(payload?.space?.stationPositions).length;

    return [
      {
        label: 'Air Activity',
        value: air.reduce((sum, row) => sum + toCount(row?.total), 0),
        detail: `${air.length} theaters`,
        dotClass: 'air',
      },
      {
        label: 'Thermal Spikes',
        value: thermal.reduce((sum, row) => sum + toCount(row?.det), 0).toLocaleString(),
        detail: `${thermal
          .reduce((sum, row) => sum + toCount(row?.night), 0)
          .toLocaleString()} night det.`,
        dotClass: 'thermal',
      },
      {
        label: 'SDR Receivers',
        value:
          toCount(payload?.sdr?.total) ||
          sdrZones.reduce((sum, row) => sum + toCount(row?.count), 0),
        detail: `${toCount(payload?.sdr?.online)} online`,
        dotClass: 'sdr',
      },
      { label: 'Maritime Watch', value: chokepoints.length, detail: 'chokepoints', dotClass: 'maritime' },
      { label: 'Nuclear / Energy Sites', value: nuclear.length, detail: 'monitors', dotClass: 'nuke' },
      {
        label: 'Geopolitical Risk',
        value: acledEvents,
        detail: `${toCount(payload?.acled?.totalFatalities).toLocaleString()} fatalities`,
        dotClass: 'incident',
      },
      { label: 'Health Watch', value: healthAlerts, detail: 'WHO alerts', dotClass: 'health' },
      { label: 'World News', value: news, detail: 'RSS geolocated', dotClass: 'news' },
      {
        label: 'Open Intelligence',
        value: osint,
        detail: `${asArray(payload?.tg?.urgent).length} urgent`,
        dotClass: 'osint',
      },
      { label: 'Space Watch', value: space, detail: 'tracked', dotClass: 'space' },
    ];
  }, [payload]);

  const crossSignals = useMemo(() => {
    const fromSignals = asArray<string>(payload?.tSignals);
    const items =
      fromSignals.length > 0
        ? fromSignals.slice(0, 10)
        : asArray<any>(payload?.tg?.urgent)
            .map((row) => String(row?.text || '').trim())
            .filter(Boolean)
            .slice(0, 10);

    if (!visibleLayerSet.has('crossSourceSignals') && !visibleLayerSet.has('signalPriority')) {
      return [] as string[];
    }
    return items;
  }, [payload, visibleLayerSet]);

  const openIntelStream = useMemo(() => {
    if (!visibleLayerSet.has('openIntelligence')) {
      return [] as Array<{ id: string; channel: string; text: string; views: number }>;
    }

    const urgent = asArray<any>(payload?.tg?.urgent);
    if (urgent.length > 0) {
      return urgent.slice(0, 18).map((row, index) => ({
        id: `u-${index}`,
        channel: String(row?.channel || 'OSINT'),
        text: String(row?.text || ''),
        views: toCount(row?.views),
      }));
    }

    return asArray<any>(payload?.newsFeed?.items)
      .slice(0, 18)
      .map((row, index) => ({
        id: `n-${index}`,
        channel: String(row?.source || 'Feed'),
        text: String(row?.headline || ''),
        views: 0,
      }));
  }, [payload, visibleLayerSet]);

  const newsTicker = useMemo(() => {
    if (!visibleLayerSet.has('worldNews'))
      return [] as Array<{ id: string; text: string; source: string }>;

    const news = asArray<any>(payload?.news);
    if (news.length > 0) {
      return news.slice(0, 20).map((item, index) => ({
        id: `news-${index}`,
        text: String(item?.title || 'News item'),
        source: String(item?.source || 'Feed'),
      }));
    }

    return asArray<any>(payload?.newsFeed?.items)
      .slice(0, 20)
      .map((item, index) => ({
        id: `feed-${index}`,
        text: String(item?.headline || 'Feed item'),
        source: String(item?.source || 'Feed'),
      }));
  }, [payload, visibleLayerSet]);

  const sourceHealthMeta = useMemo(() => {
    const meta = payload?.meta || {};
    return {
      queried: toCount(meta?.sourcesQueried),
      ok: toCount(meta?.sourcesOk),
      failed: toCount(meta?.sourcesFailed),
    };
  }, [payload]);

  const macroRows = useMemo(() => {
    const indexes = asArray<any>(payload?.markets?.indexes).slice(0, 3);
    const crypto = asArray<any>(payload?.markets?.crypto).slice(0, 3);
    const energy = asArray<any>(payload?.energy).slice(0, 3);
    return [...indexes, ...crypto, ...energy].map((row, index) => ({
      id: `macro-${index}`,
      label: String(row?.name || row?.symbol || 'Metric'),
      value: String(row?.price ?? row?.value ?? '--'),
    }));
  }, [payload]);

  const riskRows = useMemo(() => {
    const fred = asArray<any>(payload?.fred).slice(0, 6);
    return fred.map((row, index) => ({
      id: `risk-${index}`,
      label: String(row?.label || row?.id || 'Gauge'),
      value: String(row?.value ?? '--'),
    }));
  }, [payload]);

  const opportunities = useMemo(() => asArray<any>(payload?.ideas).slice(0, 8), [payload]);
  const sweepDeltaSummary = String(payload?.delta?.summary || 'No sweep delta available.');
  const isOnline = health?.reachable && health?.status === 'ok';
  const dataStatus: WorldViewDataStatus = loading
    ? 'loading'
    : runtimeError
      ? 'error'
      : isOnline
        ? 'online'
        : health?.status === 'error' || dataResponse?.status === 'error'
          ? 'error'
          : 'offline';

  const activeContextOpenWidgets = useMemo(() => {
    return activeWidgetIds.map(
      (id) => WIDGET_CONFIG.find((widget) => widget.id === id)?.label || id,
    );
  }, [activeWidgetIds]);

  const worldViewContext = useMemo<WorldViewContextContract>(
    () => ({
      selectedRegion: region,
      selectedLayers: visibleLayerIds,
      selectedWidgetIds: activeWidgetIds,
      selectedSignalId,
      selectedSignalSummary,
      rendererMode: viewportMode,
      dataStatus,
      lastUpdatedAt,
    }),
    [
      activeWidgetIds,
      dataStatus,
      lastUpdatedAt,
      region,
      selectedSignalId,
      selectedSignalSummary,
      viewportMode,
      visibleLayerIds,
    ],
  );

  const selectSignal = (signalId: string, summary: string | null) => {
    setSelectedSignalId(signalId);
    setSelectedSignalSummary(summary && summary.trim() ? summary.trim() : null);
  };

  const toggleLayer = (layerId: string) => {
    setVisibleLayerIds((prev) =>
      prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId],
    );
  };

  const toggleWidget = (widgetId: WidgetId) => {
    setActiveWidgetIds((prev) =>
      prev.includes(widgetId) ? prev.filter((id) => id !== widgetId) : [...prev, widgetId],
    );
  };

  const closeWidget = (widgetId: WidgetId) => {
    setActiveWidgetIds((prev) => prev.filter((id) => id !== widgetId));
  };

  const setWorldViewportMode = (nextMode: WorldViewportMode) => {
    setViewportMode(nextMode);
    setLayersOpen(false);
    setWidgetsOpen(false);
    if (nextMode !== 'telescope') return;
    setActiveWidgetIds([]);
  };

  const handleZoomIn = () => {
    if (controlsLocked) return;
    rendererRef.current?.zoom(1.4);
  };

  const handleZoomOut = () => {
    if (controlsLocked) return;
    rendererRef.current?.zoom(0.72);
  };

  const handleFitView = () => {
    if (controlsLocked) return;
    setRegion('world');
    rendererRef.current?.setRegion('world');
  };

  const handleToggleFlights = () => {
    if (controlsLocked) return;
    setFlightsVisible((prev) => !prev);
  };

  const handleToggleFullscreen = async () => {
    const node = mapViewportRef.current;
    if (!node) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await node.requestFullscreen?.();
  };

  const renderWidgetPanel = (widgetId: WidgetId): React.ReactNode => {
    if (widgetId === 'sensorGrid') {
      return (
        <div data-testid="worldsignal-sensor-grid" style={{ display: 'grid', gap: 6 }}>
          {layerStats.map((row) => (
            <div key={row.label} className="crx-layer-item">
              <div className="crx-layer-left">
                <span className={`crx-dot ${row.dotClass}`} />
                <div>
                  <div className="crx-layer-name">{row.label}</div>
                  <div className="crx-layer-sub">{row.detail}</div>
                </div>
              </div>
              <div className="crx-layer-value">{row.value}</div>
            </div>
          ))}
        </div>
      );
    }

    if (widgetId === 'crossSignals') {
      return (
        <div data-testid="worldsignal-right-signals" style={{ display: 'grid', gap: 6 }}>
          {crossSignals.length ? (
            crossSignals.map((text, index) => (
              <button
                key={`sig-${index}`}
                type="button"
                className="crx-signal-row"
                onClick={() => selectSignal(`signal-${index + 1}`, text)}
                style={{ textAlign: 'left' }}
              >
                <strong>{`Signal ${index + 1}`}</strong>
                <p>{text}</p>
              </button>
            ))
          ) : (
            <div className="crx-overlay-text">No active cross-source signals.</div>
          )}
        </div>
      );
    }

    if (widgetId === 'openIntel') {
      return (
        <div data-testid="worldsignal-right-osint" className="crx-feed">
          {openIntelStream.length ? (
            openIntelStream.map((item) => (
              <button
                key={item.id}
                type="button"
                className="crx-feed-card"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => selectSignal(item.id, item.text)}
              >
                <div className="crx-feed-head">
                  <span>{item.channel}</span>
                  <span>{item.views > 0 ? `${item.views.toLocaleString()} views` : 'feed'}</span>
                </div>
                <div className="crx-feed-text">{item.text}</div>
              </button>
            ))
          ) : (
            <div className="crx-overlay-text">No open intelligence items available.</div>
          )}
        </div>
      );
    }

    if (widgetId === 'signalCore') {
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="crx-pill">Health: {isOnline ? 'ok' : health?.status || 'offline'}</span>
            <span className="crx-pill">Data: {dataResponse?.status || 'unknown'}</span>
            <span className="crx-pill">
              Sources: {sourceHealthMeta.ok}/{sourceHealthMeta.queried}
            </span>
            <span className="crx-pill">Failed: {sourceHealthMeta.failed}</span>
          </div>
          <div className="crx-overlay-text">Core signal status and source bridge health.</div>
        </div>
      );
    }

    if (widgetId === 'macroMarkets') {
      return (
        <div style={{ display: 'grid', gap: 6 }}>
          {macroRows.length ? (
            macroRows.map((row) => (
              <div key={row.id} className="crx-layer-item">
                <div className="crx-layer-name">{row.label}</div>
                <div className="crx-layer-value" style={{ fontSize: 14 }}>
                  {row.value}
                </div>
              </div>
            ))
          ) : (
            <div className="crx-overlay-text">No macro/market rows available.</div>
          )}
        </div>
      );
    }

    if (widgetId === 'riskGauges') {
      return (
        <div style={{ display: 'grid', gap: 6 }}>
          {riskRows.length ? (
            riskRows.map((row) => (
              <div key={row.id} className="crx-layer-item">
                <div className="crx-layer-name">{row.label}</div>
                <div className="crx-layer-value" style={{ fontSize: 14 }}>
                  {row.value}
                </div>
              </div>
            ))
          ) : (
            <div className="crx-overlay-text">No risk gauges available.</div>
          )}
        </div>
      );
    }

    if (widgetId === 'spaceWatch') {
      return (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="crx-layer-item">
            <div className="crx-layer-name">Military Sats</div>
            <div className="crx-layer-value" style={{ fontSize: 14 }}>
              {toCount(payload?.space?.militarySats)}
            </div>
          </div>
          <div className="crx-layer-item">
            <div className="crx-layer-name">Station Positions</div>
            <div className="crx-layer-value" style={{ fontSize: 14 }}>
              {asArray(payload?.space?.stationPositions).length}
            </div>
          </div>
        </div>
      );
    }

    if (widgetId === 'newsTicker') {
      return (
        <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {newsTicker.length ? (
            newsTicker.map((item) => (
              <div key={item.id} className="crx-feed-card">
                <div className="crx-feed-head">
                  <span>{item.source}</span>
                </div>
                <div className="crx-feed-text">{item.text}</div>
              </div>
            ))
          ) : (
            <div className="crx-overlay-text">No news ticker items available.</div>
          )}
        </div>
      );
    }

    if (widgetId === 'opportunities') {
      return (
        <div style={{ display: 'grid', gap: 6 }}>
          {opportunities.length ? (
            opportunities.map((item, index) => (
              <div key={`opp-${index}`} className="crx-feed-card">
                <div className="crx-feed-head">
                  <span>{String(item?.type || 'Opportunity')}</span>
                </div>
                <div className="crx-feed-text">{String(item?.title || 'No title')}</div>
              </div>
            ))
          ) : (
            <div className="crx-overlay-text">No opportunities available.</div>
          )}
        </div>
      );
    }

    return <div className="crx-overlay-text">{sweepDeltaSummary}</div>;
  };

  return (
    <div data-testid="worldsignal-surface" className="crx-root">
      <style>{`
        .crx-root { height: 100%; width: 100%; background: #020408; color: #e8f4f0; font-family: 'Space Grotesk', system-ui, sans-serif; position: relative; overflow: hidden; }
        .crx-main { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 10px; gap: 10px; }
        .crx-region-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; width: fit-content; max-width: 100%; border-radius: 999px; padding: 6px; }
        .crx-region-btn { border: 1px solid rgba(167,176,186,0.24); background: rgba(11,14,18,0.64); color: #A7B0BA; font-family: 'IBM Plex Mono', monospace; font-size: 11px; line-height: 1.1; font-weight: 600; letter-spacing: 0.04em; padding: 7px 10px; border-radius: 999px; cursor: pointer; box-shadow: inset 0 1px 0 rgba(245,247,250,0.02); transition: border-color 120ms ease, background 120ms ease, color 120ms ease, box-shadow 120ms ease; }
        .crx-region-btn:hover { color: #F5F7FA; border-color: rgba(55,173,170,0.34); }
        .crx-region-btn.active { color: #F5F7FA; background: rgba(55,173,170,0.12); border-color: rgba(55,173,170,0.42); box-shadow: inset 0 1px 0 rgba(245,247,250,0.06), 0 0 0 1px rgba(55,173,170,0.18); }
        .crx-map { position: relative; flex: 1 1 auto; min-height: 0; border: 1px solid rgba(55,173,170,0.16); border-radius: 8px; background: radial-gradient(ellipse at center,rgba(4,12,20,1),rgba(2,4,8,1)); overflow: hidden; }
        .crx-map-view { position: absolute; inset: 0; transition: opacity 160ms ease; }
        .crx-map-view.telescope-muted { opacity: 0.12; pointer-events: none; filter: saturate(0.45) brightness(0.55); }
        .crx-map-controls { position: absolute; left: 12px; bottom: 12px; z-index: 9; display: flex; flex-direction: column; gap: 0; }
        .crx-ctrl { width: 34px; height: 34px; font-size: 16px; }
        .crx-glass-control-stack { border: 1px solid rgba(167,176,186,0.24); background: rgba(17,22,29,0.94); backdrop-filter: blur(14px) saturate(120%); -webkit-backdrop-filter: blur(14px) saturate(120%); }
        .crx-map-hint { position: absolute; top: 13px; right: 12px; z-index: 6; font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: rgba(167,176,186,0.78); letter-spacing: 0.03em; }
        .crx-top-controls { position: absolute; top: 12px; right: 12px; z-index: 20; display: flex; gap: 8px; transform: translateY(26px); }
        .crx-compact-btn { border-radius: 999px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.05em; font-weight: 600; cursor: pointer; }
        .crx-mode-switch { display: flex; gap: 4px; padding: 4px; border-radius: 999px; border: 1px solid rgba(167,176,186,0.24); background: rgba(17,22,29,0.94); box-shadow: 0 10px 24px rgba(0,0,0,0.16); }
        .crx-mode-btn { border: 1px solid transparent; background: transparent; color: #A7B0BA; border-radius: 999px; padding: 7px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.05em; font-weight: 600; cursor: pointer; }
        .crx-mode-btn.active { color: #F5F7FA; background: rgba(55,173,170,0.14); border-color: rgba(55,173,170,0.42); }
        .crx-compact-panel { position: absolute; top: 82px; right: 12px; width: 320px; max-height: 360px; overflow-y: auto; z-index: 9; padding: 10px; border-radius: 8px; }
        .crx-overlay { position: absolute; left: 14px; right: 14px; bottom: 14px; z-index: 7; border: 1px solid rgba(68,204,255,0.2); background: rgba(6,14,22,0.88); backdrop-filter: blur(12px); padding: 14px; }
        .crx-overlay-title { font-size: 16px; font-weight: 600; }
        .crx-overlay-text { font-size: 12px; color: #9db0bf; margin-top: 4px; }
        .crx-layer-item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px; margin-bottom: 4px; border: 1px solid rgba(167,176,186,0.14); border-radius: 7px; background: rgba(167,176,186,0.04); gap: 10px; cursor: pointer; }
        .crx-layer-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .crx-dot { width: 10px; height: 10px; border-radius: 999px; flex-shrink: 0; }
        .crx-dot.air { background: #64f0c8; box-shadow: 0 0 6px rgba(100,240,200,0.4); }
        .crx-dot.thermal { background: #ff5f63; box-shadow: 0 0 6px rgba(255,95,99,0.4); }
        .crx-dot.sdr { background: #44ccff; box-shadow: 0 0 6px rgba(68,204,255,0.4); }
        .crx-dot.maritime { background: #b388ff; box-shadow: 0 0 6px rgba(179,136,255,0.4); }
        .crx-dot.nuke { background: #ffe082; box-shadow: 0 0 6px rgba(255,224,130,0.4); }
        .crx-dot.incident { background: #ffb84c; box-shadow: 0 0 6px rgba(255,184,76,0.4); }
        .crx-dot.health { background: #69f0ae; box-shadow: 0 0 6px rgba(105,240,174,0.4); }
        .crx-dot.news { background: #81d4fa; box-shadow: 0 0 6px rgba(129,212,250,0.4); }
        .crx-dot.osint { background: #ffb74d; box-shadow: 0 0 6px rgba(255,183,77,0.4); }
        .crx-dot.space { background: #e0b0ff; box-shadow: 0 0 6px rgba(224,176,255,0.4); }
        .crx-layer-name { font-size: 12px; font-weight: 600; color: #d5e2e2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .crx-layer-sub { font-size: 10px; color: #6a8a82; }
        .crx-layer-value { font-family: 'IBM Plex Mono', monospace; color: #64f0c8; font-size: 20px; font-weight: 600; line-height: 1; }
        .crx-pill { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #9eb0bf; border: 1px solid rgba(100,240,200,0.12); padding: 4px 8px; }
        .crx-widget-stack { position: absolute; left: 58px; bottom: 72px; z-index: 10; display: grid; gap: 8px; max-width: min(460px, calc(100vw - 120px)); }
        .crx-widget-panel { border: 1px solid rgba(55,173,170,0.2); background: rgba(10,20,32,0.86); backdrop-filter: blur(14px); padding: 10px; border-radius: 8px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 30px rgba(0,0,0,0.24); }
        .crx-widget-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .crx-widget-title { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.1em; color: #6a8a82; text-transform: uppercase; }
        .crx-widget-close { border: 1px solid rgba(100,240,200,0.12); background: rgba(0,0,0,0.45); color: #9eb0bf; font-size: 12px; width: 24px; height: 24px; cursor: pointer; }
        .crx-feed { max-height: 260px; overflow-y: auto; padding-right: 4px; display: grid; gap: 6px; }
        .crx-feed-card { padding: 10px; border-left: 2px solid rgba(68,204,255,0.4); border: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.02); margin: 0; }
        .crx-feed-head { display: flex; justify-content: space-between; margin-bottom: 4px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #64f0c8; text-transform: uppercase; letter-spacing: 0.08em; gap: 10px; }
        .crx-feed-text { font-size: 11px; color: #c8d8d2; line-height: 1.4; }
        .crx-signal-row { padding: 10px; border-left: 2px solid rgba(100,240,200,0.2); background: rgba(255,255,255,0.02); margin: 0; border-top: none; border-right: none; border-bottom: none; }
        .crx-signal-row strong { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; display: block; margin-bottom: 4px; }
        .crx-signal-row p { font-size: 12px; line-height: 1.4; color: #c8d8d2; margin: 0; }
        .crx-context { position: absolute; left: 64px; right: 12px; bottom: 10px; z-index: 8; border: 1px solid rgba(167,176,186,0.16); border-radius: 999px; background: rgba(11,14,18,0.54); padding: 5px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: rgba(167,176,186,0.78); letter-spacing: 0.02em; display: flex; gap: 14px; flex-wrap: wrap; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
      `}</style>

      <div className="crx-main" data-testid="worldsignal-crucix-layout">
        {viewportMode !== 'telescope' ? (
          <div
            data-testid="worldsignal-region-tabs"
            className="crx-region-bar crx-glass-pill-group"
            style={graphGlassPillStyle({
              padding: 6,
              color: GRAPH_THEME.surface.mutedText,
            })}
          >
            {REGION_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`crx-region-btn ${tab.id === region ? 'active' : ''}`}
                onClick={() => setRegion(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        <section
          ref={(node) => {
            mapViewportRef.current = node;
          }}
          data-testid="worldsignal-globe-viewport"
          className="crx-map"
        >
          <div className={viewportMode === 'telescope' ? 'crx-map-view telescope-muted' : 'crx-map-view'}>
            <RendererMount mountRef={mountRef} />
          </div>

          {viewportMode !== 'telescope' ? (
            <div
              className="crx-map-controls crx-glass-control-stack"
              data-testid="worldsignal-map-controls"
              style={graphControlStackStyle}
            >
            <button
              type="button"
              className="crx-ctrl"
              aria-label="Zoom in"
              data-testid="worldsignal-control-zoom-in"
              onClick={handleZoomIn}
              style={graphControlButtonStyle({
                borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
              })}
            >
              +
            </button>
            <button
              type="button"
              className="crx-ctrl"
              aria-label="Zoom out"
              data-testid="worldsignal-control-zoom-out"
              onClick={handleZoomOut}
              style={graphControlButtonStyle({
                borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
              })}
            >
              -
            </button>
            <button
              type="button"
              className="crx-ctrl"
              aria-label="Fit view"
              data-testid="worldsignal-control-fit"
              onClick={handleFitView}
              style={graphControlButtonStyle({
                borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
              })}
            >
              ⤢
            </button>
            <button
              type="button"
              className="crx-ctrl"
              aria-label="Fullscreen"
              data-testid="worldsignal-control-fullscreen"
              onClick={() => {
                void handleToggleFullscreen();
              }}
              style={graphControlButtonStyle({
                borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
              })}
            >
              ⛶
            </button>
            <button
              type="button"
              className="crx-ctrl"
              aria-label={controlsLocked ? 'Unlock controls' : 'Lock controls'}
              data-testid="worldsignal-control-lock"
              onClick={() => setControlsLocked((prev) => !prev)}
              style={graphControlButtonStyle({
                borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
                color: controlsLocked ? GRAPH_THEME.accent.primary : GRAPH_THEME.controls.text,
              })}
            >
              {controlsLocked ? '🔒' : '🔓'}
            </button>
            <button
              type="button"
              className="crx-ctrl"
              title="Toggle flight overlay"
              data-testid="worldsignal-flight-toggle"
              onClick={handleToggleFlights}
              style={graphControlButtonStyle()}
            >
              ✈
            </button>
            </div>
          ) : null}

          <div className="crx-map-hint">
            {viewportMode === 'telescope'
              ? 'TELESCOPE · DRAG TO PAN · SCROLL TO ZOOM'
              : viewportMode === 'flat'
                ? 'SCROLL TO ZOOM · DRAG TO PAN'
                : 'DRAG TO ROTATE · SCROLL TO ZOOM'}
          </div>

          <div className="crx-top-controls">
            <div className="crx-mode-switch" data-testid="worldsignal-mode-switch">
              {(['globe', 'flat', 'telescope'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`crx-mode-btn ${viewportMode === mode ? 'active' : ''}`}
                  data-testid={`worldsignal-mode-${mode}`}
                  aria-pressed={viewportMode === mode}
                  onClick={() => setWorldViewportMode(mode)}
                >
                  {mode === 'globe' ? 'Globe' : mode === 'flat' ? 'Flat' : 'Telescope'}
                </button>
              ))}
            </div>
            {viewportMode !== 'telescope' ? (
              <>
                <button
                  type="button"
                  className="crx-compact-btn"
                  data-testid="worldsignal-layers-control-button"
                  style={graphPillButtonStyle({
                    padding: '7px 10px',
                    color: layersOpen ? GRAPH_THEME.surface.text : GRAPH_THEME.surface.mutedText,
                    border: `1px solid ${layersOpen ? GRAPH_THEME.accent.primaryBorder : GRAPH_THEME.controls.border}`,
                  })}
                  onClick={() => {
                    setLayersOpen((prev) => !prev);
                    setWidgetsOpen(false);
                  }}
                >
                  Layers
                </button>
                <button
                  type="button"
                  className="crx-compact-btn"
                  data-testid="worldsignal-widgets-control-button"
                  style={graphPillButtonStyle({
                    padding: '7px 10px',
                    color: widgetsOpen ? GRAPH_THEME.surface.text : GRAPH_THEME.surface.mutedText,
                    border: `1px solid ${widgetsOpen ? GRAPH_THEME.accent.primaryBorder : GRAPH_THEME.controls.border}`,
                  })}
                  onClick={() => {
                    setWidgetsOpen((prev) => !prev);
                    setLayersOpen(false);
                  }}
                >
                  Widgets
                </button>
              </>
            ) : null}
          </div>

          {viewportMode === 'telescope' ? (
            <TelescopeOverlay />
          ) : null}

          {viewportMode !== 'telescope' && layersOpen ? (
            <div
              className="crx-compact-panel"
              data-testid="worldsignal-layers-control-panel"
              style={graphGlassCardStyle()}
            >
              {WORLD_SIGNAL_LAYER_CONFIG.map((layer) => {
                const enabled = visibleLayerSet.has(layer.id);
                return (
                  <button
                    key={layer.id}
                    type="button"
                    className="crx-layer-item"
                    data-testid={`worldsignal-layer-toggle-${layer.id}`}
                    onClick={() => toggleLayer(layer.id)}
                  >
                    <div className="crx-layer-left">
                      <span className={`crx-dot ${dotClassForLabel(layer.label)}`} />
                      <span className="crx-layer-name">{layer.label}</span>
                    </div>
                    <span className="crx-layer-sub">{enabled ? 'ON' : 'OFF'}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {viewportMode !== 'telescope' && widgetsOpen ? (
            <div
              className="crx-compact-panel"
              data-testid="worldsignal-widgets-control-panel"
              style={graphGlassCardStyle()}
            >
              {WIDGET_CONFIG.map((widget) => {
                const enabled = activeWidgetIds.includes(widget.id);
                return (
                  <button
                    key={widget.id}
                    type="button"
                    className="crx-layer-item"
                    data-testid={`worldsignal-widget-toggle-${widget.id}`}
                    onClick={() => toggleWidget(widget.id)}
                  >
                    <span className="crx-layer-name">{widget.label}</span>
                    <span className="crx-layer-sub">{enabled ? 'OPEN' : 'CLOSED'}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {viewportMode !== 'telescope' && loading ? (
            <div className="crx-overlay" data-testid="worldsignal-loading">
              <div className="crx-overlay-title">Preparing World View</div>
              <div className="crx-overlay-text">Initializing source status and live signals.</div>
            </div>
          ) : null}

          {viewportMode !== 'telescope' && !loading && !isOnline ? (
            <div className="crx-overlay" data-testid="worldsignal-offline">
              <div className="crx-overlay-title">World view is offline</div>
              <div className="crx-overlay-text">Start the worldsignal sidecar to view signals.</div>
            </div>
          ) : null}

          {viewportMode !== 'telescope' && runtimeError ? (
            <div className="crx-overlay" data-testid="worldsignal-runtime-error">
              <div className="crx-overlay-title">Renderer runtime issue</div>
              <div className="crx-overlay-text">{runtimeError}</div>
            </div>
          ) : null}

          {viewportMode !== 'telescope' ? <div className="crx-widget-stack">
            {activeWidgetIds.map((widgetId) => {
              const widget = WIDGET_CONFIG.find((entry) => entry.id === widgetId);
              if (!widget) return null;
              return (
                <section
                  key={widget.id}
                  className="crx-widget-panel"
                  data-testid={`worldsignal-widget-${widget.id}`}
                >
                  <header className="crx-widget-head">
                    <div className="crx-widget-title">{widget.label}</div>
                    <button
                      type="button"
                      className="crx-widget-close"
                      data-testid={`worldsignal-widget-close-${widget.id}`}
                      onClick={() => closeWidget(widget.id)}
                    >
                      ×
                    </button>
                  </header>
                  {renderWidgetPanel(widget.id)}
                </section>
              );
            })}
          </div> : null}

          {viewportMode !== 'telescope' ? <div className="crx-context" data-testid="worldsignal-active-context">
            <span>open: {activeContextOpenWidgets.length ? activeContextOpenWidgets.join(', ') : 'none'}</span>
            <span>
              layers: {visibleLayerIds.length}/{WORLD_SIGNAL_LAYER_CONFIG.length}
            </span>
            <span>selected: {selectedSignalId || 'none'}</span>
            <span>mode: {worldViewContext.rendererMode}</span>
            <span>region: {worldViewContext.selectedRegion}</span>
          </div> : null}

          <div
            data-testid="worldsignal-context-contract"
            style={{ display: 'none' }}
            aria-hidden="true"
          >
            {JSON.stringify(worldViewContext)}
          </div>
        </section>
      </div>
    </div>
  );
}
