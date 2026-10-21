// Entity: Building Geometry
// Relationship: This file tests real MCP-produced OSM geometry in Three.js, including window holes and exact object selection.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildOpenStudioGroup } from './openStudioGeometry.ts';
import type { OpenStudioGeometry } from './openStudioGeometry.ts';

const path = process.env.OPENSTUDIO_GEOMETRY;
if (!path) throw new Error('Set OPENSTUDIO_GEOMETRY to geometry.json from the real Python/MCP acceptance run');
const model: OpenStudioGeometry = JSON.parse(readFileSync(path, 'utf8'));

test('every rendered mesh carries the exact accepted OSM identity and vertices', () => {
  const group = buildOpenStudioGroup(model, null);
  assert.equal(group.children.length, model.objects.length);
  for (const child of group.children) {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
    const source = model.objects.find(face => face.handle === mesh.userData.openStudio.handle)!;
    assert.ok(source);
    assert.equal(mesh.userData.openStudio.revision, model.revision);
    assert.equal(mesh.userData.openStudio.modelId, model.modelId);
    assert.equal(mesh.geometry.getAttribute('position').count, source.positions.length / 3);
  }
});

test('ray selection sees the real window and not opaque wall triangles across its opening', () => {
  const group = buildOpenStudioGroup(model, null);
  group.updateMatrixWorld(true);
  const window = model.objects.find(face => face.objectType === 'SubSurface')!;
  assert.ok(window);
  const center = new THREE.Vector3();
  for (const point of window.vertices) center.add(new THREE.Vector3(...point));
  center.divideScalar(window.vertices.length);
  const ray = new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, -10, 0)), new THREE.Vector3(0, 1, 0));
  const hits = ray.intersectObjects(group.children, true);
  assert.equal(hits[0]?.object.userData.openStudio.handle, window.handle);
  assert.ok(!hits.some(hit => hit.object.userData.openStudio.handle === window.parentHandle));
  const belowWindow = new THREE.Vector3(center.x, center.y - 10, 0.2);
  const wallHits = new THREE.Raycaster(belowWindow, new THREE.Vector3(0, 1, 0)).intersectObjects(group.children, true);
  assert.equal(wallHits[0]?.object.userData.openStudio.handle, window.parentHandle);
});

test('empty accepted geometry remains empty, and malformed transport is refused', () => {
  assert.equal(buildOpenStudioGroup({ ...model, objects: [], bounds: null }, null).children.length, 0);
  assert.throws(() => buildOpenStudioGroup({ ...model, objects: [model.objects[0], model.objects[0]] }, null));
  assert.throws(() => buildOpenStudioGroup({ ...model, objects: [{ ...model.objects[0], positions: [NaN, 0, 0] }] }, null));
});
