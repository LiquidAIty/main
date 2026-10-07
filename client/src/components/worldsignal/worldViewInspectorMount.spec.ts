// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const application = vi.hoisted(() => ({
  create: vi.fn(),
  start: vi.fn(),
  destroy: vi.fn(),
  setPanelCollapsed: vi.fn(),
}));

vi.mock('../../../../worldsignal/gods-eye-view-main/src/app/directApplication.js', () => ({
  createWorldViewApplication: application.create,
}));

import { getActiveWorldViewMountCount, mountWorldView } from '../../../../worldsignal/gods-eye-view-main/src/app/mount.js';

const controlIds = [
  'left-panel-stack', 'right-context-rail', 'command-dock',
  'pp-toggles', 'top-center-actions', 'view-switcher',
];

const documentMarkup = `
  <nav id="top-center-actions"><button id="live-action">Action</button></nav>
  <nav id="view-switcher"><button>View</button></nav>
  <div id="pp-toggles"></div>
  <div id="command-dock"><div id="control-panel"></div><div id="location-bar"></div></div>
  <div id="left-panel-stack"><div id="data-panel"></div><div id="scene-panel"></div></div>
  <aside id="right-context-rail"><div id="global-context-panel"></div><div id="cctv-panel"></div></aside>
`;

let root: HTMLElement;
let host: HTMLElement;
let mounted: Awaited<ReturnType<typeof mountWorldView>> | null = null;

beforeEach(() => {
  application.start.mockReset().mockResolvedValue(undefined);
  application.destroy.mockReset().mockResolvedValue(undefined);
  application.setPanelCollapsed.mockReset();
  application.create.mockReset().mockImplementation(() => ({
    start: application.start,
    destroy: application.destroy,
    getState: () => ({}),
    getComponents: () => ({ controls: { styleManager: {
      setPanelCollapsed: application.setPanelCollapsed,
    } } }),
  }));
  root = document.createElement('section');
  host = document.createElement('div');
  document.body.append(root, host);
});

afterEach(async () => {
  await mounted?.destroy();
  mounted = null;
  root.remove();
  host.remove();
  document.head.querySelectorAll('link[data-worldview-runtime-font]').forEach((link) => link.remove());
});

describe('WorldView Inspector control attachment', () => {
  it('moves the original live controls, selects their existing panels, and restores them before teardown', async () => {
    // StyleManager portals Display into the right rail after the HTML loads.
    application.start.mockImplementationOnce(async () => {
      root.querySelector('#right-context-rail')?.append(root.querySelector('#pp-toggles')!);
    });
    mounted = await mountWorldView(root, {
      documentMarkup,
      scopedStyles: '#worldview-native-root { display: block; }',
    });
    expect(getActiveWorldViewMountCount()).toBe(1);
    const original = new Map(controlIds.map((id) => [id, root.querySelector(`#${id}`)]));
    expect(original.get('pp-toggles')?.parentElement?.id).toBe('right-context-rail');
    let clickCount = 0;
    original.get('top-center-actions')?.querySelector('button')
      ?.addEventListener('click', () => { clickCount += 1; });

    const attachment = mounted.attachInspectorControls(host);
    expect(controlIds.map((id) => host.querySelector(`#${id}`))).toEqual(
      controlIds.map((id) => original.get(id)),
    );
    expect(controlIds.every((id) => root.querySelector(`#${id}`) === null)).toBe(true);
    expect(host.dataset.activeTab).toBe('data');
    expect(application.setPanelCollapsed).toHaveBeenCalledWith('data-panel', false,
      { restore: true, persist: false, syncShare: false });

    expect(mounted.selectInspectorTab('view')).toBe(true);
    expect(host.dataset.activeTab).toBe('view');
    expect(application.setPanelCollapsed).toHaveBeenCalledWith('control-panel', false,
      { restore: true, persist: false, syncShare: false });
    expect(application.setPanelCollapsed).toHaveBeenCalledWith('pp-toggles', false,
      { restore: true, persist: false, syncShare: false });
    original.get('top-center-actions')?.querySelector('button')?.click();
    expect(clickCount).toBe(1);
    root.classList.add('cockpit-mode');
    await Promise.resolve();
    expect(host.classList.contains('cockpit-mode')).toBe(true);

    attachment.detach();
    expect(controlIds.map((id) => root.querySelector(`#${id}`))).toEqual(
      controlIds.map((id) => original.get(id)),
    );
    expect(host.childElementCount).toBe(0);
    expect(host.classList.contains('cockpit-mode')).toBe(false);
    mounted.attachInspectorControls(host);
    application.destroy.mockImplementationOnce(async () => {
      expect(controlIds.map((id) => root.querySelector(`#${id}`))).toEqual(
        controlIds.map((id) => original.get(id)),
      );
      expect(host.childElementCount).toBe(0);
    });
    await mounted.destroy();
    expect(getActiveWorldViewMountCount()).toBe(0);
    expect(application.destroy).toHaveBeenCalledTimes(1);
    mounted = null;
  });
});
