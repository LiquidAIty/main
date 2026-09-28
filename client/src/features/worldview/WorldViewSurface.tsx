import { useEffect, useRef, useState } from 'react';

import GodsEyeSurface, {
  type GodsEyeBridge,
  type GodsEyeCommandResult,
  type GodsEyeLayerState,
  type GodsEyeSelectionRef,
} from '../../components/worldsignal/GodsEyeSurface';
import RightGlassDrawer from '../../components/graph/RightGlassDrawer';
import {
  loadProjectWorldview,
  setProjectWorldviewCapability,
  type ProjectWorldviewState,
} from './projectWorldview';

type WorldViewSurfaceProps = {
  projectId: string | null;
  cardId: string | null;
  onBridgeChange?: (bridge: GodsEyeBridge | null) => void;
};

export default function WorldViewSurface({ projectId, cardId, onBridgeChange }: WorldViewSurfaceProps) {
  const bridgeRef = useRef<GodsEyeBridge | null>(null);
  const currentProjectRef = useRef(projectId);
  const nextProjectWriteRef = useRef(0);
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [layerState, setLayerState] = useState<GodsEyeLayerState | null>(null);
  const [selection, setSelection] = useState<GodsEyeSelectionRef | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [projectWorldview, setProjectWorldview] = useState<ProjectWorldviewState | null>(null);
  const [projectWorldviewLoading, setProjectWorldviewLoading] = useState(false);
  const [projectWorldviewError, setProjectWorldviewError] = useState<string | null>(null);
  const [layerApplyErrors, setLayerApplyErrors] = useState<Record<string, string>>({});
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [pendingLayers, setPendingLayers] = useState<Record<string, {
    requestId: string;
    enabled: boolean;
    phase: 'saving' | 'applying';
  }>>({});

  currentProjectRef.current = projectId;

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setProjectWorldview(null);
    setProjectWorldviewLoading(true);
    setProjectWorldviewError(null);
    setLayerApplyErrors({});
    setPendingLayers({});
    void loadProjectWorldview(projectId).then((state) => {
      if (!active || currentProjectRef.current !== projectId) return;
      setProjectWorldview(state);
      setProjectWorldviewLoading(false);
    }).catch((error) => {
      if (!active || currentProjectRef.current !== projectId) return;
      setProjectWorldviewLoading(false);
      setProjectWorldviewError(error instanceof Error ? error.message : 'project_worldview_load_failed');
    });
    return () => { active = false; };
  }, [projectId]);

  const sourceReady = Boolean(sourceVersion && layerState?.sourceStateReady);
  const handleResult = (result: GodsEyeCommandResult) => {
    if (result.schemaVersion === 'gev.direct.layer-visibility.result.v1' && result.layerId) {
      setPendingLayers((current) => {
        if (current[result.layerId!]?.requestId !== result.requestId) return current;
        const next = { ...current };
        delete next[result.layerId!];
        return next;
      });
      setLayerApplyErrors((current) => {
        const next = { ...current };
        if (result.ok) delete next[result.layerId!];
        else next[result.layerId!] = result.error || 'Layer update failed';
        return next;
      });
    }
    if (!result.ok) setSurfaceError(result.error || 'WorldView command failed');
    else setSurfaceError(null);
  };

  useEffect(() => {
    if (!projectId || !sourceReady || !projectWorldview
      || projectWorldview.projectId !== projectId || !layerState) return;
    const sourcesById = new Map(layerState.sources.map((source) => [source.id, source]));
    const requests: Record<string, {
      requestId: string;
      enabled: boolean;
      phase: 'applying';
    }> = {};
    const resolvedErrors: string[] = [];
    for (const capability of projectWorldview.capabilities) {
      const source = sourcesById.get(capability.capabilityId);
      if (!source) continue;
      if (source.enabled === capability.enabled) {
        if (layerApplyErrors[source.id]) resolvedErrors.push(source.id);
        continue;
      }
      if (pendingLayers[source.id] || layerApplyErrors[source.id]) continue;
      const requestId = bridgeRef.current?.setLayerVisibility(source.id, capability.enabled);
      if (requestId) {
        requests[source.id] = { requestId, enabled: capability.enabled, phase: 'applying' };
      } else {
        setLayerApplyErrors((current) => ({
          ...current,
          [source.id]: 'Project setting is saved, but the map layer is not ready.',
        }));
      }
    }
    if (Object.keys(requests).length > 0) {
      setPendingLayers((current) => ({ ...current, ...requests }));
    }
    if (resolvedErrors.length > 0) {
      setLayerApplyErrors((current) => {
        const next = { ...current };
        for (const sourceId of resolvedErrors) delete next[sourceId];
        return next;
      });
    }
  }, [layerApplyErrors, layerState, pendingLayers, projectId, projectWorldview, sourceReady]);

  const handleSourceToggle = async (
    source: GodsEyeLayerState['sources'][number],
    currentEnabled: boolean,
  ) => {
    if (!projectId || pendingLayers[source.id]) return;
    const enabled = !currentEnabled;
    const saveRequestId = `project-worldview-${++nextProjectWriteRef.current}`;
    setProjectWorldviewError(null);
    setLayerApplyErrors((current) => {
      const next = { ...current };
      delete next[source.id];
      return next;
    });
    setPendingLayers((current) => ({
      ...current,
      [source.id]: { requestId: saveRequestId, enabled, phase: 'saving' },
    }));
    try {
      const capability = await setProjectWorldviewCapability(projectId, source.id, enabled);
      if (currentProjectRef.current !== projectId) return;
      setProjectWorldview((current) => {
        if (!current || current.projectId !== projectId) return current;
        const capabilities = current.capabilities.filter(
          (entry) => entry.capabilityId !== capability.capabilityId,
        );
        capabilities.push(capability);
        return { ...current, capabilities };
      });
      const requestId = enabled
        ? bridgeRef.current?.setLayerVisibility(source.id, true, {
          exitIncompatibleContext: true,
        })
        : bridgeRef.current?.setLayerVisibility(source.id, false);
      if (!requestId) {
        setPendingLayers((current) => {
          if (current[source.id]?.requestId !== saveRequestId) return current;
          const next = { ...current };
          delete next[source.id];
          return next;
        });
        setLayerApplyErrors((current) => ({
          ...current,
          [source.id]: 'Project setting is saved, but the map layer is not ready.',
        }));
        return;
      }
      setPendingLayers((current) => {
        if (current[source.id]?.requestId !== saveRequestId) return current;
        return {
          ...current,
          [source.id]: { requestId, enabled, phase: 'applying' },
        };
      });
    } catch (error) {
      if (currentProjectRef.current !== projectId) return;
      setPendingLayers((current) => {
        if (current[source.id]?.requestId !== saveRequestId) return current;
        const next = { ...current };
        delete next[source.id];
        return next;
      });
      setProjectWorldviewError(error instanceof Error ? error.message : 'project_worldview_write_failed');
    }
  };

  if (!projectId || !cardId) {
    return <section style={styles.unavailable}>
      <strong>WorldView Card is not connected</strong>
      <span>The globe opens only from a saved Card presentation attachment.</span>
    </section>;
  }

  const projectCapabilitiesById = new Map(
    projectWorldview?.capabilities.map((capability) => [capability.capabilityId, capability]),
  );

  return <section style={styles.root} aria-label="WorldView workspace">
    <div style={styles.globePane}>
      <GodsEyeSurface
        ref={bridgeRef}
        projectId={projectId}
        cardId={cardId}
        onReady={(version) => {
          setSourceVersion(version);
          setSurfaceError(null);
          onBridgeChange?.(bridgeRef.current);
        }}
        onBridgeUnavailable={() => {
          setSourceVersion(null);
          setLayerState(null);
          setSelection(null);
          setPendingLayers({});
          onBridgeChange?.(null);
        }}
        onSelectionChange={setSelection}
        onLayerStateChange={setLayerState}
        onCommandResult={handleResult}
        onError={(error) => setSurfaceError(`${error.code}: ${error.message}`)}
      />
      {surfaceError ? <div role="alert" style={styles.errorNotice}>{surfaceError}</div> : null}
      <RightGlassDrawer
        isOpen={sourcesOpen}
        onOpen={() => setSourcesOpen(true)}
        onClose={() => setSourcesOpen(false)}
        title="Data Sources"
        collapsedLabel={null}
        openAriaLabel="Open inspector"
        dataTestId="worldview-data-sources"
        defaultWidth={360}
        minWidth={300}
        maxWidth={560}
      >
        <div style={styles.drawerBody}>
          <div>WorldView runtime: {sourceVersion ? `Ready · ${sourceVersion}` : 'Connecting'}</div>
          <div>Project WorldView: {projectWorldviewLoading
            ? 'Loading'
            : projectWorldview
              ? 'Ready'
              : 'Unavailable'}</div>
          <div>Source state: {sourceReady ? 'Ready' : 'Pending'}</div>
          <div>{sourceReady
            ? `${layerState?.enabledLayerIds.length || 0} layers on`
            : 'Layer state pending'}</div>
          {surfaceError ? <div role="alert" style={styles.error}>{surfaceError}</div> : null}
          {projectWorldviewError
            ? <div role="alert" style={styles.error}>Project WorldView: {projectWorldviewError}</div>
            : null}
          {sourceReady ? layerState?.sources.map((source) => {
            const projectCapability = projectCapabilitiesById.get(source.id);
            const enabled = projectCapability?.enabled ?? source.enabled;
            return <div key={source.id} style={styles.sourceRow}>
              <label style={styles.sourceLabel}>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!sourceReady
                    || projectWorldviewLoading
                    || !projectWorldview
                    || Boolean(pendingLayers[source.id])}
                  onChange={() => { void handleSourceToggle(source, enabled); }}
                />
                <span>{source.name || source.id} · {enabled ? 'ON' : 'OFF'}</span>
              </label>
              <small>{source.provider || 'Provider unknown'} · globe layer {source.lifecycleState || 'state unknown'}
                {source.lifecycleUncertain ? ' · lifecycle uncertain' : ''}
                {source.available === null ? ' · Not checked' : source.available ? '' : ' · Unavailable'}
                {source.loading ? ' · loading' : ''}
                {source.refreshing ? ' · refreshing' : ''}
                {source.feedState ? ` · ${source.feedState}` : ''}
                {source.count !== null ? ` · ${source.count} items` : ''}
                {source.lastRefreshAt ? ` · ${source.lastRefreshAt}` : ''}
                {source.error ? ` · ${source.error}` : ''}
              </small>
              {pendingLayers[source.id] ? (
                <small style={styles.pending}>
                  {pendingLayers[source.id].phase === 'saving'
                    ? 'Saving Project setting…'
                    : `Applying Project ${pendingLayers[source.id].enabled ? 'ON' : 'OFF'} to globe…`}
                </small>
              ) : null}
              {layerApplyErrors[source.id]
                ? <small role="alert" style={styles.error}>
                  {enabled ? 'ON saved' : 'OFF saved'} · globe layer: {layerApplyErrors[source.id]}
                </small>
                : null}
            </div>;
          }) : <div>Waiting for source status.</div>}
          {sourceReady && layerState?.sources.length === 0 ? <div>No data sources reported.</div> : null}
          <div style={styles.selection}>
            <strong>Selected entity</strong>
            {selection ? <>
              <span>{selection.label || selection.id} · {selection.type}</span>
              <button
                type="button"
                disabled={!selection.position || !sourceVersion}
                onClick={() => {
                  const requestId = bridgeRef.current?.focusSelection(selection);
                  if (!requestId) setSurfaceError('WorldView focus is unavailable');
                }}
                style={styles.action}
              >
                Focus
              </button>
            </> : <span>No selection.</span>}
          </div>
        </div>
      </RightGlassDrawer>
    </div>
  </section>;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', height: '100%', minHeight: 0, background: '#050b10', color: '#d9f7f2' },
  globePane: { position: 'relative', minWidth: 0, minHeight: 0 },
  action: { border: '1px solid rgba(114,215,199,.45)', borderRadius: 7, padding: '4px 9px', color: '#d9f7f2', background: 'rgba(5,11,16,.82)', cursor: 'pointer' },
  error: { color: '#f39b73' },
  pending: { color: '#91cfc7' },
  errorNotice: { position: 'absolute', left: 14, right: 44, bottom: 14, zIndex: 31, padding: '8px 10px', border: '1px solid rgba(243,155,115,.35)', borderRadius: 8, color: '#f39b73', background: 'rgba(5,11,16,.9)', fontSize: 11, pointerEvents: 'none' },
  drawerBody: { display: 'grid', gap: 12, fontSize: 12 },
  sourceRow: { display: 'grid', gap: 4, padding: '10px 0', borderTop: '1px solid rgba(114,215,199,.2)' },
  sourceLabel: { display: 'flex', gap: 8, alignItems: 'center', color: '#d9f7f2' },
  selection: { display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(114,215,199,.2)' },
  unavailable: { display: 'grid', placeContent: 'center', gap: 6, height: '100%', padding: 24, textAlign: 'center', color: '#78929c', background: '#050b10' },
};
