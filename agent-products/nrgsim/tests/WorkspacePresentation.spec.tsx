// @vitest-environment jsdom
// Entity: Building Workspace Verification
// Relationship: These DOM checks protect the single-Chat layout, shared inspector tab, model actions and pane-level failure isolation.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ModelWorkspace from '../ui/ModelWorkspace';
import ModelWorkspaceBoundary from '../ui/ModelWorkspaceBoundary';
import { modelingRequest, type WorkspaceState } from '../ui/contracts';

vi.mock('../ui/ModelViewport', () => ({ default: () => <div data-testid="viewport" /> }));
vi.mock('../ui/contracts', async (original) => ({
  ...await original<typeof import('../ui/contracts')>(),
  modelingRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

async function renderWorkspace() {
  const state: WorkspaceState = {
    projectId: 'building-project', activeModel: 'model-a', revision: 3, selection: null,
    models: [{ id: 'model-a', label: 'Office', savedAt: '2026-10-20' }], projection: null,
  };
  vi.mocked(modelingRequest).mockResolvedValue(state);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<ModelWorkspace projectId="building-project" agentBusy={false} />));
  return state;
}

it('has no top/bottom toolbar, extra composer, branding or instructional banners', async () => {
  await renderWorkspace();
  expect(host.querySelector('header, footer, textarea, [aria-label="Modeling request"], [aria-label="Modeling Card"]')).toBeNull();
  for (const text of ['NRGSIM', 'OpenStudio modeling', 'Ask agent', 'Choose a saved', 'Start with a real']) {
    expect(host.textContent).not.toContain(text);
  }
  const inspector = host.querySelector('[data-testid="nrgsim-inspector-drawer"]')!;
  expect(inspector.querySelector('[aria-label="Model name"]')).toBeNull();
  expect(inspector.textContent).toContain('New Building');
  expect(inspector.textContent).toContain('Save');
  expect(inspector.querySelector('[aria-label="Saved building model"]')).not.toBeNull();
});

it('uses the shared unlabeled inspector tab and preserves its standard dimensions', async () => {
  await renderWorkspace();
  act(() => (host.querySelector('[aria-label="Close drawer"]') as HTMLButtonElement).click());
  const tab = host.querySelector('[aria-label="Open inspector"]') as HTMLButtonElement;
  expect(tab.textContent).toBe('');
  expect(tab.style.width).toBe('22px');
  expect(tab.style.height).toBe('44px');
  expect(tab.closest('.nrgsim-controls')).toBeNull();
  act(() => tab.click());
  expect(host.querySelector('[data-testid="nrgsim-inspector-drawer"]')?.getAttribute('data-open')).toBe('true');
});

it('New Building creates an empty model through the same API without injecting a chat mission', async () => {
  await renderWorkspace();
  vi.mocked(modelingRequest).mockClear();
  const create = [...host.querySelectorAll('button')].find((button) => button.textContent === 'New Building')!;
  await act(async () => create.click());
  expect(modelingRequest).toHaveBeenCalledWith('building-project', 'new', {
    revision: 3, arguments: { label: 'New Building' },
  });
  expect(vi.mocked(modelingRequest).mock.calls.map((call) => call[1])).toEqual(['new', 'state', 'state']);
});

it('keeps Chat and navigation mounted when the building view throws', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const BrokenView = (): React.ReactElement => { throw new Error('renderer failed'); };
  act(() => root!.render(<>
    <button>Agents</button><textarea aria-label="Message" />
    <ModelWorkspaceBoundary><BrokenView /></ModelWorkspaceBoundary>
  </>));
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
  expect(host.querySelector('button')?.textContent).toBe('Agents');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('renderer failed');
});
