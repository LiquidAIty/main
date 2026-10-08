let applicationRoot = null;

export function setApplicationRoot(root) {
  const previous = applicationRoot;
  applicationRoot = root || null;
  return () => {
    if (applicationRoot === root) applicationRoot = previous;
  };
}

export function getApplicationRoot() {
  return applicationRoot;
}

export function getApplicationViewport() {
  const rect = applicationRoot?.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }
  const width = Math.max(1, globalThis.window?.innerWidth || 1);
  const height = Math.max(1, globalThis.window?.innerHeight || 1);
  return { left: 0, top: 0, right: width, bottom: height, width, height };
}

/** The companion may cover the left side without changing the viewer size. */
export function getExposedApplicationViewport(root = applicationRoot) {
  const source = root?.getBoundingClientRect?.();
  if (!source || !(source.width > 0) || !(source.height > 0)) return null;
  const clip = root.closest?.('[data-companion-visible-viewport="true"]')
    ?.getBoundingClientRect?.();
  const left = clip ? Math.max(source.left, clip.left) : source.left;
  const right = clip ? Math.min(source.right, clip.right) : source.right;
  const top = clip ? Math.max(source.top, clip.top) : source.top;
  const bottom = clip ? Math.min(source.bottom, clip.bottom) : source.bottom;
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    sourceWidth: source.width,
    occludedLeft: Math.max(0, left - source.left),
  };
}

/** Rectangles available to an explicit orbital fit after the open Inspector is excluded. */
export function getSatelliteOverviewViewports(root = applicationRoot) {
  const exposed = getExposedApplicationViewport(root);
  if (!exposed || !(exposed.width > 0) || !(exposed.height > 0)) return [];
  const inspector = root?.ownerDocument?.querySelector?.(
    '[data-testid="workspace-inspector-drawer"][data-open="true"]',
  );
  const panel = inspector?.getBoundingClientRect?.();
  if (!panel || !(panel.width > 0) || !(panel.height > 0)) return [exposed];

  const overlap = {
    left: Math.max(exposed.left, panel.left),
    right: Math.min(exposed.right, panel.right),
    top: Math.max(exposed.top, panel.top),
    bottom: Math.min(exposed.bottom, panel.bottom),
  };
  if (overlap.right <= overlap.left || overlap.bottom <= overlap.top) return [exposed];

  return [
    { left: exposed.left, right: overlap.left, top: exposed.top, bottom: exposed.bottom },
    { left: overlap.right, right: exposed.right, top: exposed.top, bottom: exposed.bottom },
    { left: exposed.left, right: exposed.right, top: exposed.top, bottom: overlap.top },
    { left: exposed.left, right: exposed.right, top: overlap.bottom, bottom: exposed.bottom },
  ].map((candidate) => ({
    ...candidate,
    width: candidate.right - candidate.left,
    height: candidate.bottom - candidate.top,
  })).filter((candidate) => candidate.width > 0 && candidate.height > 0);
}

export function applicationViewportAtMost(maxWidth) {
  const limit = Number(maxWidth);
  return Number.isFinite(limit) && getApplicationViewport().width <= limit;
}

export function toApplicationRect(rect) {
  const viewport = getApplicationViewport();
  return {
    left: rect.left - viewport.left,
    top: rect.top - viewport.top,
    right: rect.right - viewport.left,
    bottom: rect.bottom - viewport.top,
    width: rect.width,
    height: rect.height,
  };
}

export function toApplicationPoint(clientX, clientY) {
  const viewport = getApplicationViewport();
  return { x: clientX - viewport.left, y: clientY - viewport.top };
}
