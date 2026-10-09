import { useLayoutEffect, useState, type RefObject } from 'react';

const NAVIGATION_INSET = 16;
type ViewRect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;

function visibleRect(pane: ViewRect, clip: ViewRect): ViewRect {
  const left = Math.max(pane.left, clip.left);
  const right = Math.min(pane.right, clip.right);
  const top = Math.max(pane.top, clip.top);
  const bottom = Math.min(pane.bottom, clip.bottom);
  return { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function navigationPlacement(pane: ViewRect, clip: ViewRect, drawer: ViewRect | null,
  control: ViewRect): { right: number; bottom: number } | null {
  const exposed = visibleRect(pane, clip);
  if (!exposed.width || !exposed.height || !control.width || !control.height) return null;
  const overlap = drawer ? visibleRect(exposed, drawer) : null;
  const areas = !overlap?.width || !overlap.height ? [exposed] : [
    { left: exposed.left, right: overlap.left, top: exposed.top, bottom: exposed.bottom },
    { left: overlap.right, right: exposed.right, top: exposed.top, bottom: exposed.bottom },
    { left: exposed.left, right: exposed.right, top: exposed.top, bottom: overlap.top },
    { left: exposed.left, right: exposed.right, top: overlap.bottom, bottom: exposed.bottom },
  ];
  const fits = areas.filter((area) => area.right - area.left >= control.width + NAVIGATION_INSET * 2
    && area.bottom - area.top >= control.height + NAVIGATION_INSET * 2);
  fits.sort((a, b) => (exposed.right - a.right) + (exposed.bottom - a.bottom)
    - (exposed.right - b.right) - (exposed.bottom - b.bottom));
  const target = fits[0];
  return target ? { right: pane.right - target.right + NAVIGATION_INSET,
    bottom: pane.bottom - target.bottom + NAVIGATION_INSET } : null;
}

export function useWorldViewNavigationPosition(paneRef: RefObject<HTMLDivElement | null>,
  inspectorContainer: HTMLElement | null, sourceVersion: string | null) {
  const [position, setPosition] = useState<{ right: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const controls = pane?.querySelector<HTMLElement>('[data-testid="graph-navigation-controls"]');
    if (!pane || !controls) return;
    const clip = pane.closest<HTMLElement>('[data-companion-visible-viewport="true"]');
    const drawer = inspectorContainer?.closest<HTMLElement>('[data-testid="workspace-inspector-drawer"]');
    const update = () => {
      const placement = navigationPlacement(pane.getBoundingClientRect(),
        clip?.getBoundingClientRect() ?? pane.getBoundingClientRect(),
        drawer?.dataset.open === 'true' ? drawer.getBoundingClientRect() : null,
        controls.getBoundingClientRect());
      setPosition((current) => current?.right === placement?.right
        && current?.bottom === placement?.bottom ? current : placement);
    };
    update();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    for (const element of [pane, clip, drawer, controls]) if (element) resize?.observe(element);
    const mutation = drawer && typeof MutationObserver === 'function'
      ? new MutationObserver(update) : null;
    if (drawer) mutation?.observe(drawer, { attributes: true, attributeFilter: ['data-open', 'style'] });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [inspectorContainer, paneRef, sourceVersion]);
  return position;
}
