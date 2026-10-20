// @vitest-environment jsdom
// Entity: Building Navigation Verification
// Relationship: These tests prove that navigation follows supplied parent handles and keeps selection bound to the original object.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ObjectTree, { buildObjectTree } from '../ui/ObjectTree';
import type { ModelObject } from '../ui/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const objects: ModelObject[] = [
  { handle: 'building', type: 'Building', name: 'Office' },
  { handle: 'story', type: 'BuildingStory', name: 'Story 1' },
  { handle: 'space', type: 'Space', name: 'Office space', buildingStory: 'story', thermalZone: 'zone' },
  { handle: 'zone', type: 'ThermalZone', name: 'Office zone' },
  { handle: 'surface', type: 'Surface', name: 'South wall', space: 'space' },
  { handle: 'window', type: 'SubSurface', name: 'Window', surface: 'surface' },
  { handle: 'material', type: 'StandardOpaqueMaterial', category: 'Material', name: 'Insulation' },
];

it('nests Building / Building Story / Space / Surface / SubSurface using references', () => {
  const tree = buildObjectTree(objects);
  const building = tree.find((item) => item.key === 'building')!;
  const story = building.children[0];
  const space = story.children[0];
  const surface = space.children[0];
  expect([building.key, story.key, space.key, surface.key, surface.children[0].key])
    .toEqual(['building', 'story', 'space', 'surface', 'window']);
  expect(tree).toHaveLength(1);
  expect(JSON.stringify(tree)).not.toContain('"key":"zone"');
  expect(JSON.stringify(tree)).not.toContain('"key":"material"');
  expect(objects[2].thermalZone).toBe('zone');
});

it('keeps unassigned geometry reachable rather than inferring a relationship from names', () => {
  const tree = buildObjectTree(objects.map((object) => object.handle === 'space'
    ? { ...object, buildingStory: null } : object));
  const building = tree.find((item) => item.key === 'building')!;
  expect(building.children.some((item) => item.key === 'space')).toBe(true);
  expect(building.children.find((item) => item.key === 'story')?.children).toEqual([]);
});

it('opens the selected object ancestry and returns the unchanged object handle', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const onSelect = vi.fn();
  try {
    act(() => root.render(<ObjectTree objects={objects} selection="window" onSelect={onSelect} />));
    const selected = host.querySelector('[aria-current="true"]') as HTMLButtonElement;
    expect(selected.textContent).toBe('Window');
    let ancestor = selected.parentElement;
    while (ancestor) {
      if (ancestor instanceof HTMLDetailsElement) expect(ancestor.open).toBe(true);
      ancestor = ancestor.parentElement;
    }
    act(() => selected.click());
    expect(onSelect).toHaveBeenCalledWith('window');
  } finally {
    act(() => root.unmount());
  }
});
