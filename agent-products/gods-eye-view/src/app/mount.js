import { setApplicationRoot } from './viewport.js';
import { configureRuntimeBaseUrl, runtimeUrl } from '../runtimeUrl.js';

const ROOT_ID = 'worldview-gods-eye-root';
const INSPECTOR_CONTROL_IDS = Object.freeze([
  'left-panel-stack',
  'right-context-rail',
  'command-dock',
  'pp-toggles',
  'top-center-actions',
  'view-switcher',
]);
const INSPECTOR_TABS = Object.freeze({
  data: ['data-panel'],
  explore: ['location-bar', 'global-context-panel'],
  view: ['control-panel', 'pp-toggles'],
  scenes: ['scene-panel'],
  cameras: ['cctv-panel'],
  selection: [],
});
const GODS_EYE_BODY_CLASSES = Object.freeze([
  'cockpit-mode',
  'ui-clean-view',
  'recording-mode',
  'scene-playback-mode',
]);
const FONT_LINKS = Object.freeze([
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round',
]);

let activeMount = null;
let lifecycleQueue = Promise.resolve();
let fontUsers = 0;

function installFonts() {
  fontUsers += 1;
  for (const href of FONT_LINKS) {
    if (document.head.querySelector(`link[data-worldview-gods-eye-font][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.worldviewGodsEyeFont = 'true';
    document.head.appendChild(link);
  }
  return () => {
    fontUsers = Math.max(0, fontUsers - 1);
    if (fontUsers === 0) {
      document.head.querySelectorAll('link[data-worldview-gods-eye-font]').forEach((link) => link.remove());
    }
  };
}

function godsEyeBodyFragment(documentMarkup) {
  const parsed = new DOMParser().parseFromString(String(documentMarkup || ''), 'text/html');
  parsed.querySelectorAll('script').forEach((script) => script.remove());
  const fragment = document.createDocumentFragment();
  for (const child of [...parsed.body.childNodes]) {
    fragment.appendChild(document.importNode(child, true));
  }
  for (const element of fragment.querySelectorAll?.('[src], [href], [data-logo-src]') || []) {
    for (const attribute of ['src', 'href', 'data-logo-src']) {
      const value = element.getAttribute(attribute);
      if (value?.startsWith('/') && !value.startsWith('//')) {
        element.setAttribute(attribute, runtimeUrl(value));
      }
    }
  }
  return fragment;
}

function installDocumentStateMirror(root) {
  const originalClassState = new Map(
    GODS_EYE_BODY_CLASSES.map((name) => [name, document.body.classList.contains(name)]),
  );
  const originalStyle = document.documentElement.dataset.gevStyle;
  const sync = () => {
    for (const name of GODS_EYE_BODY_CLASSES) {
      root.classList.toggle(name, document.body.classList.contains(name));
    }
    const style = document.documentElement.dataset.gevStyle;
    if (style) root.dataset.gevStyle = style;
    else delete root.dataset.gevStyle;
  };
  const bodyObserver = new MutationObserver(sync);
  const htmlObserver = new MutationObserver(sync);
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gev-style'] });
  sync();
  return () => {
    bodyObserver.disconnect();
    htmlObserver.disconnect();
    for (const [name, enabled] of originalClassState) {
      document.body.classList.toggle(name, enabled);
      root.classList.remove(name);
    }
    if (originalStyle === undefined) delete document.documentElement.dataset.gevStyle;
    else document.documentElement.dataset.gevStyle = originalStyle;
    delete root.dataset.gevStyle;
  };
}

function prepareRoot(root, { documentMarkup, scopedStyles }) {
  if (!root?.replaceChildren) throw new TypeError('A caller-owned WorldView root is required');
  if (!documentMarkup?.trim()) throw new Error('worldview_gods_eye_markup_required');
  if (!scopedStyles?.trim()) throw new Error('worldview_gods_eye_styles_required');
  if (root.id && root.id !== ROOT_ID) throw new Error('worldview_gods_eye_root_id_invalid');
  root.id = ROOT_ID;
  root.dataset.worldviewMounted = 'true';
  root.classList.add('supervised-embed');
  const style = document.createElement('style');
  style.dataset.worldviewGodsEyeStyles = 'true';
  style.textContent = scopedStyles;
  root.replaceChildren(style, godsEyeBodyFragment(documentMarkup));
  return () => {
    root.replaceChildren();
    root.classList.remove('supervised-embed');
    delete root.dataset.worldviewMounted;
  };
}

async function createMountedRuntime(root, config) {
  const cleanups = [];
  cleanups.push(configureRuntimeBaseUrl(config.runtimeBaseUrl || '/worldview-gods-eye/'));
  try {
    cleanups.push(prepareRoot(root, config));
    cleanups.push(setApplicationRoot(root));
    cleanups.push(installDocumentStateMirror(root));
    cleanups.push(installFonts());
    // Configure the God's Eye provider base before evaluating the controlled
    // fork. Several retained upstream modules own module-scope endpoint
    // constants; importing earlier would freeze them against LiquidAIty's
    // ordinary /api instead of the God's Eye provider proxy.
    const { createWorldViewApplication } = await import('./directApplication.js');
    const app = createWorldViewApplication({
      root,
      projectId: config.projectId,
      cardId: config.cardId,
      callbacks: config.callbacks,
      supervised: true,
      sourceVersion: config.sourceVersion || '0.1.1',
    });
    let destroyPromise = null;
    let inspectorAttachment = null;
    const handle = {
      root,
      app,
      get bridge() {
        return app.getComponents().tools?.bridge || null;
      },
      setLayerVisibility(...args) {
        return handle.bridge?.setLayerVisibility(...args) ?? null;
      },
      setSatelliteParams(...args) {
        return handle.bridge?.setSatelliteParams(...args) ?? null;
      },
      focusSelection(...args) {
        return handle.bridge?.focusSelection(...args) ?? null;
      },
      executeAction(...args) {
        if (!handle.bridge?.executeAction) {
          return Promise.reject(new Error('worldview_action_unavailable'));
        }
        return handle.bridge.executeAction(...args);
      },
      prepareRunImages() {
        if (!handle.bridge?.prepareRunImages) {
          return Promise.reject(new Error('worldview_turn_context_unavailable'));
        }
        return handle.bridge.prepareRunImages();
      },
      getState: app.getState,
      getComponents: app.getComponents,
      attachInspectorControls(host) {
        if (!(host instanceof HTMLElement) || !host.isConnected
          || host.ownerDocument !== root.ownerDocument) {
          throw new TypeError('A mounted WorldView Inspector control host is required');
        }
        inspectorAttachment?.detach();
        const controls = INSPECTOR_CONTROL_IDS.map((id) => {
          const element = root.querySelector(`#${id}`);
          if (!element?.parentNode) throw new Error(`worldview_inspector_control_missing:${id}`);
          return element;
        });
        const syncPresentation = () => {
          host.classList.toggle('supervised-embed', root.classList.contains('supervised-embed'));
          for (const name of GODS_EYE_BODY_CLASSES) {
            host.classList.toggle(name, root.classList.contains(name));
          }
          if (root.dataset.gevStyle) host.dataset.gevStyle = root.dataset.gevStyle;
          else delete host.dataset.gevStyle;
        };
        const presentationObserver = new MutationObserver(syncPresentation);
        presentationObserver.observe(root, {
          attributes: true, attributeFilter: ['class', 'data-gev-style'],
        });
        syncPresentation();
        const records = controls.map((element) => {
          const anchor = root.ownerDocument.createComment(`worldview-inspector:${element.id}`);
          element.parentNode.insertBefore(anchor, element);
          host.appendChild(element);
          return { anchor, element };
        });
        const styleManager = app.getComponents().controls?.styleManager;
        const attachment = {
          select(tab) {
            if (!Object.hasOwn(INSPECTOR_TABS, tab)) return false;
            host.dataset.activeTab = tab;
            for (const id of INSPECTOR_TABS[tab]) {
              styleManager?.setPanelCollapsed(id, false, {
                restore: true, persist: false, syncShare: false,
              });
            }
            return true;
          },
          detach() {
            for (const { anchor, element } of records) anchor.replaceWith(element);
            presentationObserver.disconnect();
            host.classList.remove('supervised-embed');
            host.classList.remove(...GODS_EYE_BODY_CLASSES);
            delete host.dataset.gevStyle;
            delete host.dataset.activeTab;
            if (inspectorAttachment === attachment) inspectorAttachment = null;
          },
        };
        inspectorAttachment = attachment;
        attachment.select('data');
        return attachment;
      },
      selectInspectorTab(tab) {
        return inspectorAttachment?.select(tab) ?? false;
      },
      destroy() {
        inspectorAttachment?.detach();
        destroyPromise ||= Promise.resolve(app.destroy()).finally(() => {
          while (cleanups.length) cleanups.pop()?.();
          if (activeMount === handle) activeMount = null;
        });
        return destroyPromise;
      },
    };
    return handle;
  } catch (error) {
    while (cleanups.length) cleanups.pop()?.();
    throw error;
  }
}

/**
 * Mount exactly one God's Eye runtime into a caller-owned element. A replacement
 * is serialized behind full teardown so WebGL, voice and module globals never
 * overlap across React/project remounts.
 */
export function mountWorldView(root, config = {}) {
  const operation = lifecycleQueue.then(async () => {
    if (activeMount) await activeMount.destroy();
    const handle = await createMountedRuntime(root, config);
    activeMount = handle;
    try {
      await handle.app.start();
      return handle;
    } catch (error) {
      config.callbacks?.onError?.({
        code: 'worldview_gods_eye_start_failed',
        message: error?.message || String(error),
      });
      await handle.destroy().catch(() => {});
      throw error;
    }
  });
  lifecycleQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function getActiveWorldViewMountCount() {
  return activeMount ? 1 : 0;
}
