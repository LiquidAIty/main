// Entity: Building Geometry
// Relationship: Pointer gestures propose footprints; committed geometry and selection are projected from OpenStudio.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlbScene, Viewer, useViewer } from '@pascal-app/viewer';
import type { AnyNodeId } from '@pascal-app/core';
import { CameraControls } from '@react-three/drei';
import { Box3, type Object3D, Vector3 } from 'three';
import { GraphPaperBackground } from '../../../client/src/components/graph/GraphCanvasChrome';
import type { DrawingSettings, ModelObject, Point } from './contracts';

type Props = {
  url: string | null;
  objects: Readonly<Record<string, ModelObject>>;
  selection: string | null;
  view: 'plan' | '3d';
  drawing: DrawingSettings;
  busy: boolean;
  onSelect: (handle: string) => void;
  onDraw: (points: Point[]) => Promise<boolean>;
  onCancel: () => void;
};

export function geometryHandles(objects: Props['objects'], selection: string | null): string[] {
  const chosen = selection ? objects[selection] : undefined;
  const spaceIds = new Set(Object.values(objects).filter((object) => object.type === 'Space'
    && (!chosen || chosen.type === 'Building' || object.handle === chosen.handle
      || object.buildingStory === chosen.handle)).map((object) => object.handle));
  const surfaceIds = new Set(Object.values(objects).filter((object) => object.type === 'Surface'
    && (spaceIds.has(object.space || '') || object.handle === chosen?.handle)).map((object) => object.handle));
  return [...surfaceIds, ...Object.values(objects).filter((object) => object.type === 'SubSurface'
    && (surfaceIds.has(object.surface || '') || object.handle === chosen?.handle)).map((object) => object.handle)];
}

function ThreeBuilding({ url, handles, focus, onSelect }: {
  url: string; handles: string[]; focus: string | null; onSelect: Props['onSelect'];
}) {
  const camera = useRef<CameraControls | null>(null);
  const objects = useRef<ReadonlyMap<string, Object3D>>(new Map());
  const fitted = useRef('');
  const [error, setError] = useState('');
  const handlesRef = useRef(handles);
  handlesRef.current = handles;
  const focusKey = focus || 'building';
  const fit = useCallback(() => {
    if (!camera.current || fitted.current === focusKey) return;
    const bounds = new Box3();
    for (const [handle, object] of objects.current) {
      if (!handlesRef.current.includes(handle)) continue;
      object.updateWorldMatrix(true, true);
      bounds.union(new Box3().setFromObject(object));
    }
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const extent = Math.max(bounds.getSize(new Vector3()).length(), 1);
    void camera.current.setLookAt(center.x + extent, center.y + extent, center.z + extent,
      center.x, center.y, center.z, false);
    void camera.current.fitToBox(bounds, true, { paddingTop: 2, paddingBottom: 2, paddingLeft: 2, paddingRight: 2 });
    fitted.current = focusKey;
  }, [focusKey]);
  const bind = useCallback((map: ReadonlyMap<string, Object3D>) => {
    objects.current = map;
    for (const [handle, object] of map) object.visible = handlesRef.current.includes(handle);
    fit();
  }, [fit]);
  const bindCamera = useCallback((control: CameraControls | null) => { camera.current = control; fit(); }, [fit]);
  useEffect(() => {
    for (const [handle, object] of objects.current) object.visible = handles.includes(handle);
    fit();
  }, [handles, fit]);
  useEffect(() => {
    useViewer.getState().setSelection({ selectedIds: [] });
    return () => useViewer.getState().resetSelection();
  }, []);
  if (error) return <p role="alert">{error}</p>;
  return <Viewer transparent selectionManager="custom" disablePostFx maxFps={40}
    sceneReadyKey={url} defaultRender={{ textures: false, colorPreset: 'clay' }}
    onRenderError={(cause) => setError(String(cause))}>
    <CameraControls makeDefault ref={bindCamera} />
    <Suspense fallback={null}>
      <GlbScene url={url} onObjectsChange={bind} onPick={(event) => {
        const handle = event.pick?.nodeId;
        if (event.type === 'hover') useViewer.getState().setHoveredId((handle || null) as AnyNodeId | null);
        else if (handle && handlesRef.current.includes(handle)) onSelect(handle);
      }} />
    </Suspense>
  </Viewer>;
}

export default function ModelViewport({ url, objects, selection, view, drawing, busy, onSelect, onDraw, onCancel }: Props) {
  const surface = useRef<SVGSVGElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [scale, setScale] = useState(16);
  const [offset, setOffset] = useState({ x: 80, y: 300 });
  const drag = useRef<{ x: number; y: number; origin: typeof offset } | null>(null);
  const handles = useMemo(() => geometryHandles(objects, selection), [objects, selection]);
  const spaces = Object.values(objects).filter((object) =>
    object.type === 'Space' && (!drawing.story || object.buildingStory === drawing.story));
  useEffect(() => { setPoints([]); setCursor(null); }, [drawing.mode, drawing.story]);
  const pointAt = (clientX: number, clientY: number): Point => {
    const rect = surface.current!.getBoundingClientRect();
    const snap = Math.max(drawing.snap, 0.01);
    return [Math.round((clientX - rect.left - offset.x) / scale / snap) * snap,
      Math.round(-(clientY - rect.top - offset.y) / scale / snap) * snap];
  };
  const finish = async (polygon: Point[]) => {
    if (busy || polygon.length < 3) return;
    if (await onDraw(polygon)) { setPoints([]); setCursor(null); }
  };
  const outline = (polygon: readonly Point[]) =>
    polygon.map(([x, y]) => `${offset.x + x * scale},${offset.y - y * scale}`).join(' ');
  const preview: Point[] = drawing.mode === 'rectangle' && points.length && cursor
    ? [points[0], [cursor[0], points[0][1]], cursor, [points[0][0], cursor[1]]]
    : [...points, ...(cursor ? [cursor] : [])];
  return <div className="nrgsim-viewport" data-testid="nrgsim-viewport">
    <GraphPaperBackground viewport={{ x: offset.x, y: offset.y, zoom: scale / 24 }} />
    {view === '3d' && url && drawing.mode === 'select'
      ? <ThreeBuilding url={url} handles={handles} focus={selection} onSelect={onSelect} />
      : <svg ref={surface} className="nrgsim-plan" aria-label="Building drawing canvas" tabIndex={0}
        style={{ cursor: drawing.mode === 'select' ? 'default' : 'crosshair' }}
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left, y = event.clientY - rect.top;
          const next = Math.max(2, Math.min(160, scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
          setOffset({ x: x - (x - offset.x) * next / scale, y: y - (y - offset.y) * next / scale });
          setScale(next);
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          event.currentTarget.focus();
          if (event.button === 1 || event.button === 2 || event.altKey) {
            drag.current = { x: event.clientX, y: event.clientY, origin: offset };
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
          if (event.button !== 0 || drawing.mode === 'select' || busy || !drawing.story) return;
          const point = pointAt(event.clientX, event.clientY);
          if (drawing.mode === 'rectangle' && points.length) {
            if (point[0] !== points[0][0] && point[1] !== points[0][1])
              void finish([points[0], [point[0], points[0][1]], point, [points[0][0], point[1]]]);
          } else if (points.length >= 3 && Math.hypot(point[0] - points[0][0], point[1] - points[0][1]) < drawing.snap / 2) {
            void finish(points);
          } else if (!points.some(([x, y]) => x === point[0] && y === point[1])) {
            setPoints([...points, point]);
          }
        }}
        onPointerMove={(event) => {
          if (drag.current) setOffset({ x: drag.current.origin.x + event.clientX - drag.current.x,
            y: drag.current.origin.y + event.clientY - drag.current.y });
          else if (drawing.mode !== 'select') setCursor(pointAt(event.clientX, event.clientY));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setPoints([]); setCursor(null); onCancel(); }
          if (event.key === 'Backspace') { event.preventDefault(); setPoints(points.slice(0, -1)); }
          if (event.key === 'Enter' && drawing.mode === 'polygon') void finish(points);
        }}>
        {spaces.flatMap((space) => (space.floors || []).map((floor, index) =>
          <polygon key={`${space.handle}:${index}`} points={outline(floor.map(([x, y]) => [x, y]))}
            data-object-handle={space.handle} className={selection === space.handle ? 'nrgsim-space selected' : 'nrgsim-space'}
            onPointerDown={(event) => {
              if (drawing.mode !== 'select' || event.button !== 0) return;
              event.stopPropagation(); onSelect(space.handle);
            }}><title>{space.name}</title></polygon>))}
        {preview.length > 1 && <polyline points={outline(drawing.mode === 'rectangle' ? [...preview, preview[0]] : preview)}
          className="nrgsim-sketch" />}
        {points.map((point, index) => <circle key={index} cx={offset.x + point[0] * scale}
          cy={offset.y - point[1] * scale} r={index === 0 ? 5 : 3} className="nrgsim-sketch-point" />)}
      </svg>}
  </div>;
}
