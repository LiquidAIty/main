import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import scopedWorldViewStyles from 'virtual:worldview-native-css';
import inspectorOverrides from './worldviewInspector.css?raw';

import GodsEyeSurface, {
  type GodsEyeBridge,
  type GodsEyeCommandResult,
  type GodsEyeLayerState,
  type GodsEyeSelectionRef,
} from '../../components/worldsignal/GodsEyeSurface';
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
  inspectorContainer: HTMLElement | null;
};

const INSPECTOR_TABS = [
  { id: 'data', label: 'Data' },
  { id: 'explore', label: 'Explore' },
  { id: 'view', label: 'View' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'cameras', label: 'Cameras' },
  { id: 'selection', label: 'Selection' },
] as const;
type InspectorTab = typeof INSPECTOR_TABS[number]['id'];
const inspectorStyles = `${scopedWorldViewStyles.replaceAll('#worldview-native-root', '#worldview-inspector-controls')}\n${inspectorOverrides}`;

export default function WorldViewSurface({ projectId, cardId, onBridgeChange, inspectorContainer }: WorldViewSurfaceProps) {
  const bridgeRef = useRef<GodsEyeBridge | null>(null);
  const inspectorControlsRef = useRef<HTMLDivElement | null>(null);
  const inspectorAttachmentRef = useRef<{ detach: () => void } | null>(null);
  const satelliteViewRequestRef = useRef<string | null>(null);
  const currentProjectRef = useRef(projectId);
  const confirmedProjectRef = useRef<ProjectWorldviewState | null>(null);
  const nextProjectWriteRef = useRef(0);
  const ownedLayerWritesRef = useRef(new Map<string, {
    projectId: string;
    queued: boolean | null;
  }>());
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [layerState, setLayerState] = useState<GodsEyeLayerState | null>(null);
  const [selection, setSelection] = useState<GodsEyeSelectionRef | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [projectWorldview, setProjectWorldview] = useState<ProjectWorldviewState | null>(null);
  const [projectWorldviewLoading, setProjectWorldviewLoading] = useState(false);
  const [projectWorldviewError, setProjectWorldviewError] = useState<string | null>(null);
  const [layerApplyErrors, setLayerApplyErrors] = useState<Record<string, string>>({});
  const [layerPersistenceErrors, setLayerPersistenceErrors] = useState<Record<string, string>>({});
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('data');
  const [remoteActionCount, setRemoteActionCount] = useState(0);
  const [pendingLayers, setPendingLayers] = useState<Record<string, {
    requestId: string;
    enabled: boolean;
    phase: 'saving' | 'applying';
  }>>({});

  currentProjectRef.current = projectId;

  useEffect(() => {
    bridgeRef.current?.selectInspectorTab(inspectorTab);
  }, [inspectorTab]);

  useEffect(() => {
    inspectorAttachmentRef.current?.detach();
    inspectorAttachmentRef.current = null;
    if (!inspectorContainer || !sourceVersion) return;
    try {
      inspectorAttachmentRef.current = inspectorControlsRef.current
        ? bridgeRef.current?.attachInspectorControls(inspectorControlsRef.current) ?? null
        : null;
      bridgeRef.current?.selectInspectorTab(inspectorTab);
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'WorldView controls unavailable');
    }
    return () => {
      inspectorAttachmentRef.current?.detach();
      inspectorAttachmentRef.current = null;
    };
  }, [inspectorContainer, sourceVersion]);

  const navigate = (name: string, args: Record<string, unknown> = {}) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    void bridge.executeAction(name, args).then((result) => {
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
        setSurfaceError('error' in result && typeof result.error === 'string'
          ? result.error : 'WorldView navigation failed');
        return;
      }
      setSurfaceError(null);
    }).catch((error) => {
      setSurfaceError(error instanceof Error ? error.message : 'WorldView navigation failed');
    });
  };

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    satelliteViewRequestRef.current = null;
    confirmedProjectRef.current = null;
    ownedLayerWritesRef.current.clear();
    setProjectWorldview(null);
    setProjectWorldviewLoading(true);
    setProjectWorldviewError(null);
    setLayerApplyErrors({});
    setLayerPersistenceErrors({});
    setPendingLayers({});
    void loadProjectWorldview(projectId).then((state) => {
      if (!active || currentProjectRef.current !== projectId) return;
      if (confirmedProjectRef.current?.projectId === projectId) {
        setProjectWorldviewLoading(false);
        return;
      }
      confirmedProjectRef.current = state;
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
  const acceptCapability = (savedProjectId: string, capability: ProjectWorldviewState['capabilities'][number]) => {
    const current = confirmedProjectRef.current;
    if (!current || current.projectId !== savedProjectId
      || currentProjectRef.current !== savedProjectId) return;
    const next = {
      ...current,
      capabilities: [
        ...current.capabilities.filter((entry) => entry.capabilityId !== capability.capabilityId),
        capability,
      ],
    };
    confirmedProjectRef.current = next;
    setProjectWorldview(next);
    setLayerPersistenceErrors((current) => {
      const nextErrors = { ...current };
      delete nextErrors[capability.capabilityId];
      return nextErrors;
    });
  };
  const restoreConfirmedLayer = async (
    savedProjectId: string, layerId: string, previousEnabled: boolean,
  ) => {
    let confirmed = confirmedProjectRef.current;
    try {
      const refreshed = await loadProjectWorldview(savedProjectId);
      if (currentProjectRef.current !== savedProjectId) return;
      confirmed = refreshed;
      confirmedProjectRef.current = refreshed;
      setProjectWorldview(refreshed);
    } catch { /* Use the last confirmed read, never an optimistic local value. */ }
    if (currentProjectRef.current !== savedProjectId) return;
    const enabled = confirmed?.projectId === savedProjectId
      ? confirmed.capabilities.find((entry) => entry.capabilityId === layerId)?.enabled
        ?? confirmed.defaultEnabled
      : previousEnabled;
    const requestId = bridgeRef.current?.setLayerVisibility(layerId, enabled, {
      origin: 'restore',
    });
    if (requestId) {
      setPendingLayers((current) => ({
        ...current, [layerId]: { requestId, enabled, phase: 'applying' },
      }));
    } else {
      setLayerApplyErrors((current) => ({
        ...current, [layerId]: 'Project choice could not be restored to the globe.',
      }));
    }
  };
  const handleResult = (result: GodsEyeCommandResult) => {
    if (result.schemaVersion === 'gev.direct.layer-visibility.result.v1' && result.layerId) {
      if (result.requestId === satelliteViewRequestRef.current) {
        if (result.ok) {
          const requestId = bridgeRef.current?.setSatelliteParams({
            catalog: 'dense', showPoints: true, showOrbits: true,
          });
          satelliteViewRequestRef.current = requestId ?? null;
          if (!requestId) setSurfaceError('Satellite view is unavailable');
        } else {
          satelliteViewRequestRef.current = null;
          setSurfaceError(result.error || 'Satellite view could not be enabled');
        }
      }
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
      return;
    }
    if (result.schemaVersion === 'gev.direct.satellite-params.result.v1'
      && result.requestId === satelliteViewRequestRef.current) {
      satelliteViewRequestRef.current = null;
      if (result.ok) navigate('satellite_overview');
      else setSurfaceError(result.error || 'Satellite view could not be prepared');
      return;
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
        origin: 'restore',
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
            acceptCapability(projectId, body.capability);
          } else if (active && name === 'set_layer_visibility'
            && typeof result.layerId === 'string' && typeof result.enabled === 'boolean'
            && result.ok === true) {
            await restoreConfirmedLayer(projectId, result.layerId, !result.enabled);
            setLayerPersistenceErrors((current) => ({
              ...current,
              [result.layerId as string]: 'Could not save the layer choice. Project setting restored.',
            }));
          }
        } catch {
          if (active && name === 'set_layer_visibility'
            && typeof result.layerId === 'string' && typeof result.enabled === 'boolean'
            && result.ok === true) {
            await restoreConfirmedLayer(projectId, result.layerId, !result.enabled);
            setLayerPersistenceErrors((current) => ({
              ...current,
              [result.layerId as string]: 'Could not save the layer choice. Project setting restored.',
            }));
          }
        }
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
    if (!projectId || !sourceVersion) return;
    const existing = ownedLayerWritesRef.current.get(change.layerId);
    if (existing?.projectId === projectId) {
      existing.queued = change.enabled;
      return;
    }
    const job = { projectId, queued: null as boolean | null };
    ownedLayerWritesRef.current.set(change.layerId, job);
    const saveRequestId = `project-worldview-native-${++nextProjectWriteRef.current}`;
    setPendingLayers((current) => ({
      ...current,
      [change.layerId]: {
        requestId: saveRequestId, enabled: change.enabled, phase: 'saving',
      },
    }));
    void (async () => {
      let enabled = change.enabled;
      while (currentProjectRef.current === projectId) {
        try {
          if (confirmedProjectRef.current?.projectId !== projectId) {
            const state = await loadProjectWorldview(projectId);
            if (currentProjectRef.current !== projectId) break;
            confirmedProjectRef.current = state;
            setProjectWorldview(state);
            setProjectWorldviewLoading(false);
          }
          const capability = await setProjectWorldviewCapability(projectId, change.layerId, enabled);
          acceptCapability(projectId, capability);
          setLayerApplyErrors((current) => {
            const next = { ...current };
            delete next[change.layerId];
            return next;
          });
        } catch {
          if (job.queued === null) {
            await restoreConfirmedLayer(projectId, change.layerId, !enabled);
            setLayerPersistenceErrors((current) => ({
              ...current,
              [change.layerId]: 'Could not save the layer choice. Project setting restored.',
            }));
          }
        }
        const queued = job.queued;
        if (queued === null) break;
        enabled = queued;
        job.queued = null;
      }
      if (ownedLayerWritesRef.current.get(change.layerId) === job) {
        ownedLayerWritesRef.current.delete(change.layerId);
      }
      if (currentProjectRef.current === projectId) {
        setPendingLayers((current) => {
          if (current[change.layerId]?.requestId !== saveRequestId) return current;
          const next = { ...current };
          delete next[change.layerId];
          return next;
        });
      }
    })();
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
          satelliteViewRequestRef.current = null;
          inspectorAttachmentRef.current?.detach();
          inspectorAttachmentRef.current = null;
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
      {inspectorContainer ? createPortal(<>
        <style data-worldview-inspector-styles>{inspectorStyles}</style>
        <div style={styles.drawerBody}>
          <div role="tablist" aria-label="WorldView inspector" style={styles.tabs}>
            {INSPECTOR_TABS.map((tab) => <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={inspectorTab === tab.id}
              onClick={() => setInspectorTab(tab.id)}
              style={{ ...styles.tab, ...(inspectorTab === tab.id ? styles.tabSelected : {}) }}
            >{tab.label}</button>)}
          </div>
          <div role="group" aria-label="WorldView navigation" style={styles.navigation}>
            <button type="button" style={styles.action} disabled={!sourceVersion}
              onClick={() => navigate('adjust_camera_zoom', { direction: 'in', amount: 'little' })}
            >Zoom in</button>
            <button type="button" style={styles.action} disabled={!sourceVersion}
              onClick={() => navigate('adjust_camera_zoom', { direction: 'out', amount: 'little' })}
            >Zoom out</button>
            <button type="button" style={styles.action} disabled={!sourceVersion}
              onClick={() => navigate('zoom_to_globe')}
            >Overview</button>
            {inspectorTab === 'view' ? <button
              type="button"
              style={styles.action}
              disabled={!sourceVersion}
              onClick={() => {
                const requestId = bridgeRef.current?.setLayerVisibility('satellites', true, { origin: 'user' });
                if (requestId) satelliteViewRequestRef.current = requestId;
                else setSurfaceError('Satellite view is unavailable');
              }}
            >Satellite view</button> : null}
          </div>
          <div ref={inspectorControlsRef} id="worldview-inspector-controls" />
          {projectWorldviewLoading ? <div>Loading Project sources…</div> : null}
          {surfaceError ? <div role="alert" style={styles.error}>{surfaceError}</div> : null}
          {projectWorldviewError
            ? <div role="alert" style={styles.error}>Project WorldView: {projectWorldviewError}</div>
            : null}
          {Object.entries(layerApplyErrors).map(([layerId, error]) => (
            <small key={layerId} role="alert" style={styles.error}>{layerId}: {error}</small>
          ))}
          {Object.entries(layerPersistenceErrors).map(([layerId, error]) => (
            <small key={layerId} role="alert" style={styles.error}>{layerId}: {error}</small>
          ))}
          {inspectorTab === 'selection' ? <>
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
                >Focus</button>
              </> : <span>No selection.</span>}
            </div>
          </> : null}
        </div>
      </>, inspectorContainer) : null}
    </div>
  </section>;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', height: '100%', minHeight: 0, background: '#050b10', color: '#d9f7f2' },
  globePane: { position: 'relative', minWidth: 0, minHeight: 0 },
  action: { border: '1px solid rgba(114,215,199,.45)', borderRadius: 7, padding: '4px 9px', color: '#d9f7f2', background: 'rgba(5,11,16,.82)', cursor: 'pointer' },
  error: { color: '#f39b73' },
  drawerBody: { display: 'grid', gap: 12, fontSize: 12 },
  navigation: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tabs: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5 },
  tab: { border: '1px solid rgba(126,232,226,.16)', borderRadius: 8, padding: '7px 4px', color: '#9db9bd', background: 'rgba(8,20,26,.45)', cursor: 'pointer', fontSize: 11 },
  tabSelected: { border: '1px solid rgba(126,232,226,.55)', color: '#e4fbf7', background: 'rgba(35,111,119,.28)' },
  selection: { display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(114,215,199,.2)' },
  unavailable: { display: 'grid', placeContent: 'center', gap: 6, height: '100%', padding: 24, textAlign: 'center', color: '#78929c', background: '#050b10' },
};
