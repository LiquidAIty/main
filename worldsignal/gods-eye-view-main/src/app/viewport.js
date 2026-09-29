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

/** Shift projection only: the geographic camera position and orientation stay put. */
export function getExposedPerspectiveXOffset(frustum, exposed, baseOffset = 0) {
  if (!frustum || !exposed || !(exposed.sourceWidth > 0)
    || !Number.isFinite(frustum.xOffset)) return null;
  const offCenter = frustum.offCenterFrustum;
  const nearWidth = offCenter?.right - offCenter?.left;
  if (!(nearWidth > 0) || !Number.isFinite(nearWidth)) return null;
  return baseOffset - (exposed.occludedLeft * nearWidth)
    / (2 * exposed.sourceWidth);
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
