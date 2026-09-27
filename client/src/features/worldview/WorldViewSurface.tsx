import { useRef, useState } from 'react';

import GodsEyeSurface, {
  type GodsEyeBridge,
  type GodsEyeCommandResult,
  type GodsEyeLayerState,
  type GodsEyeNativeAgentState,
  type GodsEyeSelectionRef,
} from '../../components/worldsignal/GodsEyeSurface';
import RightGlassDrawer from '../../components/graph/RightGlassDrawer';

const GLOBE_URL = import.meta.env.VITE_WORLDVIEW_GLOBE_URL || 'http://127.0.0.1:4174';

type WorldViewSurfaceProps = {
  projectId: string | null;
  cardId: string | null;
};

export default function WorldViewSurface({ projectId, cardId }: WorldViewSurfaceProps) {
  const bridgeRef = useRef<GodsEyeBridge | null>(null);
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [layerState, setLayerState] = useState<GodsEyeLayerState | null>(null);
  const [nativeAgentState, setNativeAgentState] = useState<GodsEyeNativeAgentState | null>(null);
  const [selection, setSelection] = useState<GodsEyeSelectionRef | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [pendingLayers, setPendingLayers] = useState<Record<string, { requestId: string; enabled: boolean }>>({});

  if (!projectId || !cardId) {
    return <section style={styles.unavailable}>
      <strong>WorldView Card is not connected</strong>
      <span>The globe opens only from a saved Card presentation attachment.</span>
    </section>;
  }

  const sourceReady = Boolean(sourceVersion && layerState?.sourceStateReady);
  const handleResult = (result: GodsEyeCommandResult) => {
    if (result.schemaVersion === 'gev.embed.layer-visibility.result.v1' && result.layerId) {
      setPendingLayers((current) => {
        if (current[result.layerId!]?.requestId !== result.requestId) return current;
        const next = { ...current };
        delete next[result.layerId!];
        return next;
      });
    }
    if (!result.ok) setSurfaceError(result.error || 'Native command failed');
    else setSurfaceError(null);
  };

  return <section style={styles.root} aria-label="WorldView workspace">
    <div style={styles.globePane}>
      <GodsEyeSurface
        ref={bridgeRef}
        embedUrl={GLOBE_URL}
        projectId={projectId}
        cardId={cardId}
        onReady={(version) => { setSourceVersion(version); setSurfaceError(null); }}
        onBridgeUnavailable={() => {
          setSourceVersion(null);
          setLayerState(null);
          setNativeAgentState(null);
          setSelection(null);
          setPendingLayers({});
        }}
        onNativeAgentState={setNativeAgentState}
        onSelectionChange={setSelection}
        onLayerStateChange={setLayerState}
        onCommandResult={handleResult}
        onError={(error) => setSurfaceError(`${error.code}: ${error.message}`)}
      />
      <div style={styles.statusBar}>
        <span style={styles.brand}>WORLDVIEW</span>
        <span>{sourceVersion ? `God’s Eye bridge ready · ${sourceVersion}` : 'God’s Eye bridge pending'}</span>
        <span>{sourceReady
          ? `${layerState?.enabledLayerIds.length || 0} native layers on`
          : 'source state pending'}</span>
        <span>{nativeAgentState
          ? `native voice control ${nativeAgentState.available ? (nativeAgentState.active ? 'active' : 'present · user-started') : 'missing'}`
          : 'native voice control state pending'}</span>
        <button type="button" onClick={() => setSourcesOpen(true)} style={styles.action}>
          Data Sources
        </button>
        {surfaceError ? <span role="alert" style={styles.error}>{surfaceError}</span> : null}
      </div>
      <RightGlassDrawer
        isOpen={sourcesOpen}
        onOpen={() => setSourcesOpen(true)}
        onClose={() => setSourcesOpen(false)}
        title="Data Sources"
        collapsedLabel={null}
        dataTestId="worldview-data-sources"
        defaultWidth={360}
        minWidth={300}
        maxWidth={560}
      >
        <div style={styles.drawerBody}>
          <div>Embed bridge: {sourceVersion ? 'Ready' : 'Pending'}</div>
          <div>Source state: {sourceReady ? 'Ready' : 'Pending'}</div>
          {sourceReady ? layerState?.sources.map((source) => (
            <div key={source.id} style={styles.sourceRow}>
              <label style={styles.sourceLabel}>
                <input
                  type="checkbox"
                  checked={source.enabled}
                  disabled={!sourceReady
                    || source.lifecycleState === 'enabling'
                    || source.lifecycleState === 'disabling'
                    || source.lifecycleUncertain
                    || Boolean(pendingLayers[source.id])}
                  onChange={() => {
                    const requestId = bridgeRef.current?.setLayerVisibility(source.id, !source.enabled);
                    if (requestId) {
                      setPendingLayers((current) => ({
                        ...current, [source.id]: { requestId, enabled: !source.enabled },
                      }));
                    } else setSurfaceError('God’s Eye bridge is not ready');
                  }}
                />
                <span>{source.name || source.id} · {source.enabled ? 'ON' : 'OFF'}</span>
              </label>
              <small>{source.provider || 'Provider unknown'} · {source.lifecycleState || 'Lifecycle unknown'}
                {source.lifecycleUncertain ? ' · lifecycle uncertain' : ''}
                {source.available === null ? ' · Not checked' : source.available ? '' : ' · Unavailable'}
                {source.loading ? ' · loading' : ''}
                {source.refreshing ? ' · refreshing' : ''}
                {source.feedState ? ` · ${source.feedState}` : ''}
                {source.count !== null ? ` · ${source.count} items` : ''}
                {source.lastRefreshAt ? ` · ${source.lastRefreshAt}` : ''}
                {source.error ? ` · ${source.error}` : ''}
              </small>
            </div>
          )) : <div>Waiting for native source readback.</div>}
          {sourceReady && layerState?.sources.length === 0 ? <div>No native data sources reported.</div> : null}
          <div style={styles.selection}>
            <strong>Selected entity</strong>
            {selection ? <>
              <span>{selection.label || selection.id} · {selection.type}</span>
              <button
                type="button"
                disabled={!selection.position || !sourceVersion}
                onClick={() => {
                  const requestId = bridgeRef.current?.focusSelection(selection);
                  if (!requestId) setSurfaceError('God’s Eye focus is unavailable');
                }}
                style={styles.action}
              >
                Focus
              </button>
            </> : <span>No native selection.</span>}
          </div>
        </div>
      </RightGlassDrawer>
    </div>
  </section>;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', height: '100%', minHeight: 0, background: '#050b10', color: '#d9f7f2' },
  globePane: { position: 'relative', minWidth: 0, minHeight: 0 },
  statusBar: { position: 'absolute', left: 14, right: 14, top: 12, display: 'flex', flexWrap: 'wrap', gap: 9, alignItems: 'center', padding: '7px 10px', border: '1px solid rgba(114,215,199,.2)', borderRadius: 999, background: 'rgba(5,11,16,.82)', backdropFilter: 'blur(12px)', color: '#7f9eaa', fontSize: 10 },
  brand: { color: '#d9f7f2', letterSpacing: '.18em', fontWeight: 800 },
  action: { border: '1px solid rgba(114,215,199,.45)', borderRadius: 7, padding: '4px 9px', color: '#d9f7f2', background: 'rgba(5,11,16,.82)', cursor: 'pointer' },
  error: { color: '#f39b73' },
  drawerBody: { display: 'grid', gap: 12, fontSize: 12 },
  sourceRow: { display: 'grid', gap: 4, padding: '10px 0', borderTop: '1px solid rgba(114,215,199,.2)' },
  sourceLabel: { display: 'flex', gap: 8, alignItems: 'center', color: '#d9f7f2' },
  selection: { display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(114,215,199,.2)' },
  unavailable: { display: 'grid', placeContent: 'center', gap: 6, height: '100%', padding: 24, textAlign: 'center', color: '#78929c', background: '#050b10' },
};
