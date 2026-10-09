import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { GodsEyeBridge, GodsEyeCommandResult, GodsEyeLayerState } from '../../components/worldsignals/GodsEyeSurface';
import { isCapability, loadProjectWorldview, setProjectWorldviewCapability,
  type ProjectWorldviewState } from './projectWorldview';

type LayerErrors = Record<string, string>;
type PendingLayers = Record<string, { requestId: string; enabled: boolean; phase: 'saving' | 'applying' }>;

type ProjectWorldviewLayersOptions = {
  bridgeRef: RefObject<GodsEyeBridge | null>; satelliteViewRequestRef: RefObject<string | null>;
  projectId: string | null; cardId: string | null; sourceVersion: string | null;
  layerState: GodsEyeLayerState | null;
  navigate: (name: string, args?: Record<string, unknown>) => void;
  setSurfaceError: Dispatch<SetStateAction<string | null>>;
};

export function useProjectWorldviewLayers({ bridgeRef, satelliteViewRequestRef, projectId, cardId,
  sourceVersion, layerState, navigate, setSurfaceError }: ProjectWorldviewLayersOptions) {
  const currentProjectRef = useRef(projectId);
  const confirmedProjectRef = useRef<ProjectWorldviewState | null>(null);
  const nextProjectWriteRef = useRef(0);
  const ownedLayerWritesRef = useRef(new Map<string, { projectId: string; queued: boolean | null }>());
  const [projectWorldview, setProjectWorldview] = useState<ProjectWorldviewState | null>(null);
  const [projectWorldviewLoading, setProjectWorldviewLoading] = useState(false);
  const [projectWorldviewError, setProjectWorldviewError] = useState<string | null>(null);
  const [layerApplyErrors, setLayerApplyErrors] = useState<LayerErrors>({});
  const [layerPersistenceErrors, setLayerPersistenceErrors] = useState<LayerErrors>({});
  const [remoteActionCount, setRemoteActionCount] = useState(0);
  const [pendingLayers, setPendingLayers] = useState<PendingLayers>({});
  currentProjectRef.current = projectId;
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
  }, [projectId, satelliteViewRequestRef]);

  const acceptCapability = (savedProjectId: string,
    capability: ProjectWorldviewState['capabilities'][number]) => {
    const current = confirmedProjectRef.current;
    if (!current || current.projectId !== savedProjectId
      || currentProjectRef.current !== savedProjectId) return;
    const next = { ...current, capabilities: [
      ...current.capabilities.filter((entry) => entry.capabilityId !== capability.capabilityId),
      capability,
    ] };
    confirmedProjectRef.current = next;
    setProjectWorldview(next);
    setLayerPersistenceErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
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
    const requestId = bridgeRef.current?.setLayerVisibility(layerId, enabled, { origin: 'restore' });
    if (requestId) setPendingLayers((current) => ({
      ...current, [layerId]: { requestId, enabled, phase: 'applying' },
    }));
    else setLayerApplyErrors((current) => ({
      ...current, [layerId]: 'Project choice could not be restored to the globe.',
    }));
  };
  const restoreFailedSave = async (
    savedProjectId: string, layerId: string, previousEnabled: boolean,
  ) => {
    await restoreConfirmedLayer(savedProjectId, layerId, previousEnabled);
    setLayerPersistenceErrors((current) => ({
      ...current, [layerId]: 'Could not save the layer choice. Project setting restored.',
    }));
  };
  const restoreActionLayer = async (savedProjectId: string, result: Record<string, unknown>) => {
    if (typeof result.layerId === 'string' && typeof result.enabled === 'boolean' && result.ok === true) {
      await restoreFailedSave(savedProjectId, result.layerId, !result.enabled);
    }
  };

  const handleResult = (result: GodsEyeCommandResult) => {
    if (result.schemaVersion === 'gev.direct.layer-visibility.result.v1' && result.layerId) {
      if (result.requestId === satelliteViewRequestRef.current) {
        if (result.ok) {
          const requestId = bridgeRef.current?.setSatelliteParams({
            catalog: 'core', showPoints: true, showOrbits: true,
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
    const sourceReady = Boolean(sourceVersion && layerState?.sourceStateReady);
    if (!projectId || remoteActionCount > 0 || !sourceReady || !projectWorldview
      || projectWorldview.projectId !== projectId || !layerState) return;
    const sourcesById = new Map(layerState.sources.map((source) => [source.id, source]));
    const requests: PendingLayers = {};
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
  }, [bridgeRef, layerApplyErrors, layerState, pendingLayers, projectId, projectWorldview,
    remoteActionCount, sourceVersion]);

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
          } else if (active && name === 'set_layer_visibility') {
            await restoreActionLayer(projectId, result);
          }
        } catch {
          if (active && name === 'set_layer_visibility') await restoreActionLayer(projectId, result);
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

  const handleProviderVisibility = (change: { layerId: string; enabled: boolean }) => {
    if (!projectId || !sourceVersion) return;
    const existing = ownedLayerWritesRef.current.get(change.layerId);
    if (existing?.projectId === projectId) {
      existing.queued = change.enabled;
      return;
    }
    const job = { projectId, queued: null as boolean | null };
    ownedLayerWritesRef.current.set(change.layerId, job);
    const saveRequestId = `project-worldview-runtime-${++nextProjectWriteRef.current}`;
    setPendingLayers((current) => ({
      ...current,
      [change.layerId]: { requestId: saveRequestId, enabled: change.enabled, phase: 'saving' },
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
          if (job.queued === null) await restoreFailedSave(projectId, change.layerId, !enabled);
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

  return { projectWorldviewLoading, projectWorldviewError, layerApplyErrors,
    layerPersistenceErrors, handleProviderVisibility, handleResult,
    resetPendingLayers: () => setPendingLayers({}) };
}
