// Entity: Building Viewport
// Relationship: Pascal displays SDK-derived glTF and maps its original OpenStudio handles back to the host selection.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { GlbScene, Viewer, useViewer } from '@pascal-app/viewer';
import type { AnyNodeId } from '@pascal-app/core';
import { CameraControls } from '@react-three/drei';
import { Box3, type Object3D, Vector3 } from 'three';

type Props = {
  url: string;
  selection: string | null;
  handles: readonly string[];
  onSelect: (handle: string) => void;
};

export default function ModelViewport({ url, selection, handles, onSelect }: Props) {
  const camera = useRef<CameraControls | null>(null);
  const bounds = useRef(new Box3());
  const [error, setError] = useState('');
  const [roofHidden, setRoofHidden] = useState(false);
  const objects = useRef<ReadonlyMap<string, Object3D>>(new Map());
  const fit = useCallback((plan = false) => {
    if (!camera.current || bounds.current.isEmpty()) return;
    const center = bounds.current.getCenter(new Vector3());
    const distance = bounds.current.getSize(new Vector3()).length();
    void camera.current.setLookAt(
      center.x + (plan ? 0 : distance * 0.65), center.y + distance * (plan ? 1 : 0.65),
      center.z + (plan ? 0.01 : distance * 0.65), center.x, center.y, center.z, true,
    );
  }, []);
  const applyCutaway = useCallback(() => {
    for (const object of objects.current.values()) {
      object.visible = !(roofHidden && object.userData.surfaceType === 'RoofCeiling');
    }
  }, [roofHidden]);
  const bind = useCallback((map: ReadonlyMap<string, Object3D>) => {
    objects.current = map;
    const box = new Box3();
    for (const [id, object] of map) {
      if (!handles.includes(id)) {
        setError(`Display handle is absent from the active OpenStudio model: ${id}`);
        return;
      }
      object.updateWorldMatrix(true, true);
      box.union(new Box3().setFromObject(object));
    }
    bounds.current.copy(box);
    applyCutaway();
    fit();
  }, [handles, applyCutaway, fit]);
  useEffect(() => {
    useViewer.getState().setSelection({ selectedIds: selection ? [selection as AnyNodeId] : [] });
    return () => useViewer.getState().resetSelection();
  }, [selection, url]);
  useEffect(() => { applyCutaway(); }, [applyCutaway]);
  return <div className="nrgsim-viewport" data-testid="nrgsim-viewport">
    {error ? <p role="alert">{error}</p> : <Viewer selectionManager="custom"
      sceneReadyKey={url} maxFps={30} disablePostFx
      defaultRender={{ textures: false, colorPreset: 'clay' }}
      onRenderError={(cause) => setError(String(cause))}>
      <CameraControls makeDefault ref={(controls) => { camera.current = controls; fit(); }} />
      <Suspense fallback={null}>
        <GlbScene url={url} onObjectsChange={bind} onPick={(event) => {
          const handle = event.pick?.nodeId;
          if (event.type === 'hover') {
            useViewer.getState().setHoveredId((handle || null) as AnyNodeId | null);
          } else if (handle && handles.includes(handle)) onSelect(handle);
        }} />
      </Suspense>
    </Viewer>}
    <div className="nrgsim-view-controls">
      <button onClick={() => fit()}>Fit building</button>
      <button onClick={() => fit(true)}>Plan</button>
      <button aria-pressed={roofHidden} onClick={() => setRoofHidden(!roofHidden)}>Roof cutaway</button>
    </div>
    <span className="nrgsim-view-caption">OPENSTUDIO → PASCAL · Orbit / pan / zoom</span>
  </div>;
}
