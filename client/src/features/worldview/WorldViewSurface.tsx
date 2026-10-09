import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import scopedWorldViewStyles from 'virtual:worldview-runtime-css';
import inspectorOverrides from './worldviewInspector.css?raw';

import GodsEyeSurface, { type GodsEyeBridge, type GodsEyeLayerState,
  type GodsEyeSelectionRef } from '../../components/worldsignals/GodsEyeSurface';
import { GraphNavigationControls } from '../../components/graph/GraphCanvasChrome';
import { useProjectWorldviewLayers } from './useProjectWorldviewLayers';
import { useWorldViewNavigationPosition } from './useWorldViewNavigationPosition';

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
const inspectorStyles = `${scopedWorldViewStyles.replaceAll('#worldview-gods-eye-root', '#worldview-inspector-controls')}\n${inspectorOverrides}`;

export default function WorldViewSurface({ projectId, cardId, onBridgeChange, inspectorContainer }: WorldViewSurfaceProps) {
  const bridgeRef = useRef<GodsEyeBridge | null>(null);
  const globePaneRef = useRef<HTMLDivElement | null>(null);
  const inspectorControlsRef = useRef<HTMLDivElement | null>(null);
  const inspectorAttachmentRef = useRef<{ detach: () => void } | null>(null);
  const satelliteViewRequestRef = useRef<string | null>(null);
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [layerState, setLayerState] = useState<GodsEyeLayerState | null>(null);
  const [selection, setSelection] = useState<GodsEyeSelectionRef | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('data');

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

  const { projectWorldviewLoading, projectWorldviewError, layerApplyErrors,
    layerPersistenceErrors, handleProviderVisibility, handleResult, resetPendingLayers,
  } = useProjectWorldviewLayers({ bridgeRef, satelliteViewRequestRef, projectId, cardId,
    sourceVersion, layerState, navigate, setSurfaceError });
  const navigationPosition = useWorldViewNavigationPosition(globePaneRef, inspectorContainer, sourceVersion);

  if (!projectId || !cardId) {
    return <section style={styles.unavailable}>
      <strong>WorldView Card is not connected</strong>
      <span>The globe opens only from a saved Card presentation attachment.</span>
    </section>;
  }

  return <section style={styles.root} aria-label="WorldView workspace">
    <div ref={globePaneRef} style={styles.globePane}>
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
          resetPendingLayers();
          onBridgeChange?.(null);
        }}
        onSelectionChange={setSelection}
        onLayerStateChange={setLayerState}
        onLayerVisibilityChange={handleProviderVisibility}
        onCommandResult={handleResult}
        onError={(error) => setSurfaceError(`${error.code}: ${error.message}`)}
      />
      {sourceVersion ? <GraphNavigationControls
        style={{ right: navigationPosition?.right, bottom: navigationPosition?.bottom,
          visibility: navigationPosition ? 'visible' : 'hidden' }}
        onZoomIn={() => navigate('adjust_camera_zoom', { direction: 'in', amount: 'little' })}
        onZoomOut={() => navigate('adjust_camera_zoom', { direction: 'out', amount: 'little' })}
        onFit={() => navigate('zoom_to_globe')}
      /> : null}
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
  tabs: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5 },
  tab: { border: '1px solid rgba(126,232,226,.16)', borderRadius: 8, padding: '7px 4px', color: '#9db9bd', background: 'rgba(8,20,26,.45)', cursor: 'pointer', fontSize: 11 },
  tabSelected: { border: '1px solid rgba(126,232,226,.55)', color: '#e4fbf7', background: 'rgba(35,111,119,.28)' },
  selection: { display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(114,215,199,.2)' },
  unavailable: { display: 'grid', placeContent: 'center', gap: 6, height: '100%', padding: 24, textAlign: 'center', color: '#78929c', background: '#050b10' },
};
