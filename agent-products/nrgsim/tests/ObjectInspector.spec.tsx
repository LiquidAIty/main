// @vitest-environment jsdom
// Entity: Building Inspector Verification
// Relationship: These DOM checks verify selected-object inputs and exact edit requests; SDK tests separately verify engineering mutations.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ObjectInspector from '../ui/ObjectInspector';
import type { ConstructionEditor, ModelObject } from '../ui/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

const editor: ConstructionEditor = {
  surface: { handle: 'wall', name: 'South wall' },
  construction: { handle: 'assembly', name: 'External wall' },
  editable: true, isConstructionDefaulted: true, layerOrder: 'outside-to-inside',
  layers: [
    { index: 0, handle: 'brick', name: 'Brick', type: 'StandardOpaqueMaterial', editable: true,
      properties: {
        thickness: { value: 0.1, unit: 'm', minimum: 0, minimumInclusive: false },
        conductivity: { value: 0.72, unit: 'W/(m·K)' },
        density: { value: 1800, unit: 'kg/m³' },
        specificHeat: { value: 840, unit: 'J/(kg·K)' },
      } },
    { index: 1, handle: 'insulation', name: 'Insulation resistance', type: 'MasslessOpaqueMaterial', editable: true,
      properties: { thermalResistance: { value: 1.5, unit: 'm²·K/W', minimum: 0.001, minimumInclusive: true } } },
    { index: 2, handle: 'gap', name: 'Air space', type: 'AirGap', editable: true,
      properties: { thermalResistance: { value: 0.15, unit: 'm²·K/W', minimum: 0, minimumInclusive: false } } },
  ],
};
const wall: ModelObject = { handle: 'wall', name: 'South wall', type: 'Surface',
  surfaceType: 'Wall', outsideBoundaryCondition: 'Outdoors', construction: 'assembly',
  isConstructionDefaulted: true, constructionEditor: editor };
const objects: Record<string, ModelObject> = {
  wall, assembly: { handle: 'assembly', name: 'External wall', type: 'Construction', isOpaque: true },
};
function props(object = wall, modelObjects = objects) {
  return { object, objects: modelObjects,
    drawing: { mode: 'select' as const, name: 'Space 1', story: '', height: 3, thermalZone: '', snap: 0.5 },
    view: 'plan' as const, setView: vi.fn(), setDrawing: vi.fn(), busy: false,
    models: [], activeModel: 'model', onOpen: vi.fn(), onNew: vi.fn(), onSave: vi.fn(),
    author: vi.fn(async () => true) };
}
function render(properties = props()) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<ObjectInspector {...properties} />));
  return properties;
}
function change(label: string, value: string) {
  const input = host.querySelector('[aria-label="' + label + '"]') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
function choose(label: string, value: string) {
  const input = host.querySelector('[aria-label="' + label + '"]') as HTMLSelectElement;
  act(() => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); });
  return input;
}
function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === text)!;
  act(() => button.click());
  return button;
}
async function submit(input: HTMLElement) {
  await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

it('shows wall construction/opening inputs without geometry tools or diagnostic tabs', () => {
  render();
  expect(host.querySelector('nav')?.textContent).toBe('ConstructionOpenings');
  expect(host.querySelector('[aria-label="Thickness"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="View"]')).toBeNull();
  expect(host.querySelector('pre, code')).toBeNull();
  for (const text of ['Identity', 'Relationships', 'All properties', 'Handle', 'New Building']) {
    expect(host.textContent).not.toContain(text);
  }
});

it('retains every layer and uses resistance inputs for no-mass materials and air gaps', () => {
  render();
  expect([...host.querySelectorAll('.building-layer-list button')].map((item) => item.textContent))
    .toEqual(['1Brick', '2Insulation resistance', '3Air space']);
  click('2Insulation resistance');
  expect((host.querySelector('[aria-label="Thermal resistance"]') as HTMLInputElement).value).toBe('1.5');
  expect(host.querySelector('[aria-label="Thickness"]')).toBeNull();
  click('3Air space');
  expect((host.querySelector('[aria-label="Thermal resistance"]') as HTMLInputElement).value).toBe('0.15');
});

it('submits only the changed layer with expected construction and material identities', async () => {
  const properties = render();
  const thickness = change('Thickness', '0.12');
  expect((host.querySelector('[aria-label="Construction"]') as HTMLSelectElement).disabled).toBe(true);
  await submit(thickness);
  expect(properties.author).toHaveBeenCalledWith({
    operation: 'set_construction_layers', handle: 'wall', type: 'Surface', name: 'External wall local',
    expectedConstruction: 'assembly',
    edits: [{ index: 0, material_handle: 'brick', name: 'Brick local', properties: { thickness: 0.12 } }],
  });
});

it('keeps a failed edit draft rather than presenting it as saved', async () => {
  const properties = props(); properties.author.mockResolvedValue(false); render(properties);
  await submit(change('Thickness', '0.12'));
  expect((host.querySelector('[aria-label="Thickness"]') as HTMLInputElement).value).toBe('0.12');
  expect(host.textContent).toContain('Apply to this Surface');
});

it('preserves a draft but refuses applying it after its authoritative construction changes', async () => {
  const properties = render();
  change('Thickness', '0.12');
  const changed = { ...wall, constructionEditor: { ...editor, construction: { handle: 'other', name: 'Other wall' } } };
  act(() => root!.render(<ObjectInspector {...properties} object={changed} />));
  const thickness = host.querySelector('[aria-label="Thickness"]') as HTMLInputElement;
  expect(thickness.value).toBe('0.12');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Construction changed');
  await submit(thickness);
  expect(properties.author).not.toHaveBeenCalled();
});

it('refuses blank or zero thickness even when another layer is selected', async () => {
  const properties = render();
  change('Thickness', '');
  click('3Air space');
  await submit(host.querySelector('[aria-label="Thermal resistance"]')!);
  expect(properties.author).not.toHaveBeenCalled();
});

it('keeps a layer draft bound to its original Surface across selection changes', () => {
  const properties = render(); change('Thickness', '0.12');
  const other = { ...wall, handle: 'other', name: 'North wall',
    constructionEditor: { ...editor, surface: { handle: 'other', name: 'North wall' } } };
  act(() => root!.render(<ObjectInspector {...properties} object={other} />));
  expect((host.querySelector('[aria-label="Thickness"]') as HTMLInputElement).value).toBe('0.1');
  act(() => root!.render(<ObjectInspector {...properties} />));
  expect((host.querySelector('[aria-label="Thickness"]') as HTMLInputElement).value).toBe('0.12');
});

it('uses real Thermal Zone choices, does not invent setpoints, and assigns only the selected Space', async () => {
  const space: ModelObject = { handle: 'space', type: 'Space', name: 'Office', thermalZone: 'zone' };
  const modelObjects: Record<string, ModelObject> = { space,
    zone: { handle: 'zone', type: 'ThermalZone', name: 'Office zone', airLoop: 'existing-loop' },
    second: { handle: 'second', type: 'ThermalZone', name: 'Meeting zone' } };
  const properties = render(props(space, modelObjects)); click('HVAC');
  expect((host.querySelector('[aria-label="Heating setpoint"]') as HTMLInputElement).value).toBe('');
  expect((host.querySelector('[aria-label="Cooling setpoint"]') as HTMLInputElement).value).toBe('');
  expect(host.textContent).not.toContain('Add system to Thermal Zone');
  await submit(choose('Thermal Zone', 'second'));
  expect(properties.author).toHaveBeenCalledWith({
    operation: 'assign_thermal_zone', handle: 'space', type: 'Space', thermalZone: 'second',
  });
});

it('does not carry HVAC inputs into another selected Space', () => {
  const space: ModelObject = { handle: 'a', type: 'Space', name: 'A', thermalZone: 'zone' };
  const other: ModelObject = { ...space, handle: 'b', name: 'B', thermalZone: 'zone2' };
  const data = { a: space, b: other,
    zone: { handle: 'zone', type: 'ThermalZone', name: 'Zone A', heating: 20, cooling: 24 },
    zone2: { handle: 'zone2', type: 'ThermalZone', name: 'Zone B', heating: 18, cooling: 26 } };
  const properties = render(props(space, data)); click('HVAC'); change('Heating setpoint', '22');
  act(() => root!.render(<ObjectInspector {...properties} object={other} />));
  expect((host.querySelector('[aria-label="Heating setpoint"]') as HTMLInputElement).value).toBe('18');
});

it('starts missing schedule and activity inputs blank instead of silently assigning defaults', () => {
  const space: ModelObject = { handle: 'space', type: 'Space', name: 'Office' };
  render(props(space, { space }));
  expect((host.querySelector('[aria-label="Occupancy schedule"]') as HTMLSelectElement).value).toBe('');
  expect((host.querySelector('[aria-label="Activity level"]') as HTMLInputElement).value).toBe('');
});

it('does not carry inherited-load drafts between Spaces sharing a Space Type', () => {
  const first: ModelObject = { handle: 'a', name: 'A', type: 'Space', spaceType: 'office' };
  const second: ModelObject = { ...first, handle: 'b', name: 'B' };
  const data: Record<string, ModelObject> = { a: first, b: second,
    load: { handle: 'load', name: 'Office lighting', type: 'Lights', spaceType: 'office', definition: 'definition' },
    definition: { handle: 'definition', name: 'Office lighting definition', type: 'LightsDefinition', density: 10 } };
  const properties = render(props(first, data)); click('Lighting'); change('Lighting power density', '8');
  act(() => root!.render(<ObjectInspector {...properties} object={second} />));
  expect((host.querySelector('[aria-label="Lighting power density"]') as HTMLInputElement).value).toBe('10');
});

it('does not replace an existing activity schedule when only People density is edited', async () => {
  const space: ModelObject = { handle: 'space', name: 'Office', type: 'Space' };
  const data: Record<string, ModelObject> = { space,
    load: { handle: 'load', name: 'Occupants', type: 'People', space: 'space',
      definition: 'people', schedule: 'schedule', activityLevel: null },
    people: { handle: 'people', name: 'People density', type: 'PeopleDefinition', density: 0.1 },
    schedule: { handle: 'schedule', name: 'Office week', type: 'ScheduleRuleset' } };
  const properties = render(props(space, data));
  await submit(change('People per floor area', '0.08'));
  expect(properties.author).toHaveBeenCalledWith({ operation: 'set_space_load', handle: 'space', type: 'Space',
    kind: 'People', load: 'load', density: 0.08, schedule: 'schedule' });
});
