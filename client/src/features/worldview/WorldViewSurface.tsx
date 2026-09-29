import { useEffect, useRef, useState } from 'react';

import GodsEyeSurface, {
  type GodsEyeBridge,
  type GodsEyeCommandResult,
  type GodsEyeLayerState,
  type GodsEyeSelectionRef,
} from '../../components/worldsignal/GodsEyeSurface';
import RightGlassDrawer from '../../components/graph/RightGlassDrawer';
import {
  isCapability,
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
  const ownedLayerWritesRef = useRef(new Set<string>());
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [layerState, setLayerState] = useState<GodsEyeLayerState | null>(null);
  const [selection, setSelection] = useState<GodsEyeSelectionRef | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [projectWorldview, setProjectWorldview] = useState<ProjectWorldviewState | null>(null);
  const [projectWorldviewLoading, setProjectWorldviewLoading] = useState(false);
  const [projectWorldviewError, setProjectWorldviewError] = useState<string | null>(null);
  const [layerApplyErrors, setLayerApplyErrors] = useState<Record<string, string>>({});
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [remoteActionCount, setRemoteActionCount] = useState(0);
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
    if (!projectId || remoteActionCount > 0 || !sourceReady || !projectWorldview
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
      const requestId = bridgeRef.current?.setLayerVisibility(source.id, capability.enabled, {
        origin: 'programmatic',
      });
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
  }, [layerApplyErrors, layerState, pendingLayers, projectId, projectWorldview,
    remoteActionCount, sourceReady]);

  useEffect(() => {
    if (!projectId || !cardId || !sourceVersion) return undefined;
    let active = true;
    const controllers = new Set<AbortController>();
    const events = new EventSource(
      `/api/worldview/projects/${encodeURIComponent(projectId)}/actions/stream?cardId=${encodeURIComponent(cardId)}`,
    );
    events.addEventListener('action', (event) => {
      if (!active) return;
      let command: Record<string, unknown>;
      try {
        command = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
      } catch { return; }
      const requestId = typeof command.requestId === 'string' ? command.requestId : '';
      const name = typeof command.name === 'string' ? command.name : '';
      const args = command.arguments && typeof command.arguments === 'object'
        && !Array.isArray(command.arguments)
        ? command.arguments as Record<string, unknown> : {};
      if (!requestId || !name) return;
      const controller = new AbortController();
      controllers.add(controller);
      setRemoteActionCount((count) => count + 1);
      void (async () => {
        let result: Record<string, unknown>;
        try {
          const value = await bridgeRef.current?.executeAction(name, args, {
            disabledLayerIds: Array.isArray(command.disabledLayerIds)
              ? command.disabledLayerIds.filter((item): item is string => typeof item === 'string')
              : [],
            signal: controller.signal,
          });
          result = value && typeof value === 'object' && !Array.isArray(value)
            && typeof (value as Record<string, unknown>).ok === 'boolean'
            ? value as Record<string, unknown>
            : { ok: false, error: 'worldview_action_result_invalid' };
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : 'worldview_action_failed' };
        }
        if (!active || controller.signal.aborted) return;
        try {
          const response = await fetch(
            `/api/worldview/projects/${encodeURIComponent(projectId)}/actions/result`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cardId, requestId, result }),
              signal: controller.signal,
            },
          );
          const body = await response.json() as Record<string, unknown>;
          if (active && response.ok && body.ok === true && isCapability(body.capability)) {
            const capability = body.capability;
            setProjectWorldview((current) => {
              if (!current || current.projectId !== projectId) return current;
              return {
                ...current,
                capabilities: [
                  ...current.capabilities.filter(
                    (entry) => entry.capabilityId !== capability.capabilityId,
                  ),
                  capability,
                ],
              };
            });
          }
        } catch { /* The server times out this action without claiming success. */ }
      })().finally(() => {
        controllers.delete(controller);
        if (active) setRemoteActionCount((count) => Math.max(0, count - 1));
      });
    });
    events.onerror = () => {
      for (const controller of controllers) controller.abort('worldview_action_stream_lost');
    };
    return () => {
      active = false;
      events.close();
      for (const controller of controllers) controller.abort('worldview_mount_unavailable');
    };
  }, [cardId, projectId, sourceVersion]);

  const handleNativeVisibility = (change: { layerId: string; enabled: boolean }) => {
    if (!projectId || ownedLayerWritesRef.current.has(change.layerId)
      || !sourceVersion) return;
    const saveRequestId = `project-worldview-native-${++nextProjectWriteRef.current}`;
    ownedLayerWritesRef.current.add(change.layerId);
    setPendingLayers((current) => ({
      ...current,
      [change.layerId]: {
        requestId: saveRequestId, enabled: change.enabled, phase: 'saving',
      },
    }));
    void setProjectWorldviewCapability(projectId, change.layerId, change.enabled)
      .then((capability) => {
        if (currentProjectRef.current !== projectId) return;
        setProjectWorldview((current) => {
          if (!current || current.projectId !== projectId) return current;
          return {
            ...current,
            capabilities: [
              ...current.capabilities.filter((entry) => entry.capabilityId !== capability.capabilityId),
              capability,
            ],
          };
        });
      }).catch((error) => {
        if (currentProjectRef.current === projectId) {
          setProjectWorldviewError(
            error instanceof Error ? error.message : 'project_worldview_write_failed',
          );
        }
      }).finally(() => {
        ownedLayerWritesRef.current.delete(change.layerId);
        if (currentProjectRef.current === projectId) {
          setPendingLayers((current) => {
            if (current[change.layerId]?.requestId !== saveRequestId) return current;
            const next = { ...current };
            delete next[change.layerId];
            return next;
          });
        }
      });
  };

  if (!projectId || !cardId) {
    return <section style={styles.unavailable}>
      <strong>WorldView Card is not connected</strong>
      <span>The globe opens only from a saved Card presentation attachment.</span>
    </section>;
  }

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
        onLayerVisibilityChange={handleNativeVisibility}
        onCommandResult={handleResult}
        onError={(error) => setSurfaceError(`${error.code}: ${error.message}`)}
      />
      {surfaceError ? <div role="alert" style={styles.errorNotice}>{surfaceError}</div> : null}
      <RightGlassDrawer
        isOpen={sourcesOpen}
        onOpen={() => setSourcesOpen(true)}
        onClose={() => setSourcesOpen(false)}
        title="Inspector"
        collapsedLabel={null}
        openAriaLabel="Open inspector"
        dataTestId="worldview-data-sources"
        defaultWidth={360}
        minWidth={300}
        maxWidth={560}
      >
        <div style={styles.drawerBody}>
          {projectWorldviewLoading ? <div>Loading Project sources…</div> : null}
          {surfaceError ? <div role="alert" style={styles.error}>{surfaceError}</div> : null}
          {projectWorldviewError
            ? <div role="alert" style={styles.error}>Project WorldView: {projectWorldviewError}</div>
            : null}
          {Object.entries(layerApplyErrors).map(([layerId, error]) => (
            <small key={layerId} role="alert" style={styles.error}>
              {layerId}: {error}
            </small>
          ))}
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
  errorNotice: { position: 'absolute', left: 14, right: 44, bottom: 14, zIndex: 31, padding: '8px 10px', border: '1px solid rgba(243,155,115,.35)', borderRadius: 8, color: '#f39b73', background: 'rgba(5,11,16,.9)', fontSize: 11, pointerEvents: 'none' },
  drawerBody: { display: 'grid', gap: 12, fontSize: 12 },
  selection: { display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(114,215,199,.2)' },
  unavailable: { display: 'grid', placeContent: 'center', gap: 6, height: '100%', padding: 24, textAlign: 'center', color: '#78929c', background: '#050b10' },
};
