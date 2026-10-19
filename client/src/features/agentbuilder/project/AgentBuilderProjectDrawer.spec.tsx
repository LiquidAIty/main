// @vitest-environment jsdom

/**
 * Entity: Projects
 * Relationship: This file verifies Project creation sends only identity fields and navigates only after exact persisted deck and revision readback.
 */

import React, { act } from 'react';
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
  const setProjectsError = vi.fn();
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
        setProjectsError={setProjectsError}
      />,
    );
  });
  return { host: container, refreshProjects, setProjectsError };
}

describe('AgentBuilderProjectDrawer Project creation', () => {
  it('uses one server-owned Project create request and never posts a client seed deck', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        ok: true,
        projectId: 'project-new',
        project: { id: 'project-new' },
        deck: { id: 'deck_builder' },
        meta: { deckRevision: 'revision-new' },
      }),
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
      }),
    }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/decks'))).toBe(false);
    expect(refreshProjects).toHaveBeenCalledWith('after-create', 'project-new');
  });

  it('does not navigate when Project creation lacks canonical deck readback', async () => {
    const refreshProjects = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, project: { id: 'project-new' } }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { host, setProjectsError } = renderDrawer(refreshProjects);

    act(() => {
      (host.querySelector('[data-testid="new-project-button"]') as HTMLButtonElement).click();
    });
    const input = host.querySelector('[data-testid="project-name-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'Unsettled Project');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (host.querySelector('[data-testid="create-project-submit"]') as HTMLButtonElement).click();
    });

    expect(refreshProjects).not.toHaveBeenCalled();
    expect(setProjectsError).toHaveBeenCalledWith(
      'Failed to create project: project_create_readback_invalid',
    );
  });
});
