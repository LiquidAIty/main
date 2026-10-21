// Entity: Building Geometry
// Relationship: This file turns Python's read-only OpenStudio geometry projection into selectable Three.js meshes.
import * as THREE from 'three';

export type OpenStudioFace = {
  handle: string;
  name: string;
  objectType: 'Surface' | 'SubSurface' | 'ShadingSurface';
  surfaceType: string;
  parentHandle: string;
  spaceHandle: string;
  positions: number[];
  vertices: [number, number, number][];
  grossArea: number;
  netArea: number;
};

export type OpenStudioGeometry = {
  modelId: string;
  name?: string;
  revision: string;
  units: 'm';
  site?: { latitude: number; longitude: number; timeZone: number; northAxis: number };
  spaces?: { handle: string; name: string; floorArea: number; volume: number; thermalZoneHandle: string | null }[];
  objects: OpenStudioFace[];
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
};

export type OpenStudioSelection = Pick<OpenStudioFace, 'handle' | 'name' | 'objectType' | 'parentHandle' | 'spaceHandle'> & {
  modelId: string;
  revision: string;
};

export function buildOpenStudioGroup(model: OpenStudioGeometry, selectedHandle: string | null): THREE.Group {
  if (model.units !== 'm' || !model.modelId || !model.revision) throw new Error('Invalid OpenStudio geometry identity or units');
  const handles = new Set<string>();
  // Validate before allocating GPU resources so a bad payload cannot leave a partial model visible.
  for (const face of model.objects) {
    if (!face.handle || handles.has(face.handle) || face.positions.length < 9 || face.positions.length % 9 !== 0
      || face.positions.some(value => !Number.isFinite(value))) throw new Error(`Invalid OpenStudio face: ${face.handle}`);
    handles.add(face.handle);
  }
  const group = new THREE.Group();
  for (const face of model.objects) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(face.positions, 3));
    geometry.computeVertexNormals();
    const opening = face.objectType === 'SubSurface';
    const selected = selectedHandle === face.handle || selectedHandle === face.spaceHandle || selectedHandle === model.modelId;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: opening ? '#3b75ff' : face.surfaceType === 'RoofCeiling' ? '#a68b66' : '#c99a45',
      roughness: 0.56, side: THREE.DoubleSide,
      transparent: opening, opacity: opening ? 0.55 : 1, depthWrite: !opening,
      emissive: selected ? '#4FA2AD' : '#000000', emissiveIntensity: selected ? 0.24 : 0,
    }));
    mesh.name = face.name;
    mesh.userData.openStudio = {
      modelId: model.modelId, revision: model.revision,
      handle: face.handle, name: face.name, objectType: face.objectType,
      parentHandle: face.parentHandle, spaceHandle: face.spaceHandle,
    } satisfies OpenStudioSelection;
    group.add(mesh);
  }
  return group;
}
