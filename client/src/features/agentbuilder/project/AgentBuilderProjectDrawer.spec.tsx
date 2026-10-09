// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentBuilderProjectDrawer from './AgentBuilderProjectDrawer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function renderDrawer(refreshProjects = vi.fn(async () => undefined)) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AgentBuilderProjectDrawer
        activeProject=""
        colors={{
          bg: '#000', border: '#222', neutral: '#999', panel: '#111',
          primary: '#0af', text: '#fff', warn: '#f66',
        }}
        open
        projects={[]}
        projectsApi="/api/projects"
        projectsError={null}
        onClose={() => undefined}
        refreshProjects={refreshProjects}
        setActiveProjectWithUrl={() => undefined}
        setProjectsError={() => undefined}
      />,
    );
  });
  return { host: container, refreshProjects };
}

describe('AgentBuilderProjectDrawer Project creation', () => {
  it('uses the one server-owned Project create request and never posts INITIAL_DECK', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true, project: { id: 'project-new' } }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { host, refreshProjects } = renderDrawer();

    act(() => {
      (host.querySelector('[data-testid="new-project-button"]') as HTMLButtonElement).click();
    });
    const input = host.querySelector('[data-testid="project-name-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'Research Room');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (host.querySelector('[data-testid="create-project-submit"]') as HTMLButtonElement).click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        name: 'Research Room',
        code: 'research-room',
        project_type: 'agent',
      }),
    }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/decks'))).toBe(false);
    expect(refreshProjects).toHaveBeenCalledWith('after-create', 'project-new');
  });
});
