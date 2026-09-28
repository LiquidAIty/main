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

export function toApplicationPoint(clientX, clientY) {
  const viewport = getApplicationViewport();
  return { x: clientX - viewport.left, y: clientY - viewport.top };
}
