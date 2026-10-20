// @vitest-environment jsdom
// Entity: Building Inspector Verification
// Relationship: These DOM tests verify bounded editable fields, units, shared-reference warnings, and preservation of an unsaved draft.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ObjectInspector from '../ui/ObjectInspector';
import type { ObjectProperties } from '../ui/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const light = { handle: 'light-handle', name: 'Office lights', type: 'LightsDefinition' };
function properties(value: number): ObjectProperties {
  return { ok: true, type: light.type, handle: light.handle, name: light.name,
    properties: { wattsperSpaceFloorArea: { value, type: 'OptionalFloat' } }, setters: ['setWattsperSpaceFloorArea'] };
}
function render(value = 10, object = light) {
  const onEdit = vi.fn(async () => true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<ObjectInspector object={object} properties={properties(value)}
    busy={false} onEdit={onEdit} onSelect={() => undefined} />));
  return { host, onEdit };
}

it('labels the engineering unit and makes shared-reference consequences visible', () => {
  const { host } = render();
  expect(host.textContent).toContain('W/m²');
  expect(host.textContent).toContain('every Lights object that references it');
  expect(host.querySelector('input[type=number]')?.getAttribute('aria-label')).toBe('Watts per Space Floor Area');
  expect((host.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
});

it('does not expose unsupported shared-material mutations as local edits', () => {
  const { host } = render(0.04, { handle: 'material', name: 'Shared insulation', type: 'StandardOpaqueMaterial' });
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).toContain('outside the first inspector slice');
});

it('keeps the user draft when new authoritative values arrive for the same object', () => {
  const { host, onEdit } = render();
  const number = host.querySelector('input[type=number]') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(number, '8');
    number.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(number.value).toBe('8');
  act(() => root!.render(<ObjectInspector object={light} properties={properties(7)}
    busy={false} onEdit={onEdit} onSelect={() => undefined} />));
  expect(number.value).toBe('8');
  expect(host.textContent).toContain('7 W/m²');
});
