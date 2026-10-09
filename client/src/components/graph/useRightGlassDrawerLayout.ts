import { useEffect, useMemo, useRef, useState } from 'react';

export type DrawerLayout = 'docked' | 'floating';

type MoveStart = {
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
  detached: boolean;
};

const FLOATING_MAX_INITIAL_WIDTH = 380;
const FLOATING_MAX_INITIAL_HEIGHT = 420;
const FLOATING_MIN_HEIGHT = 260;
const DEFAULT_FLOAT_POSITION = { left: 24, top: 72 };
const DEFAULT_FLOAT_HEIGHT = 360;
const MOVE_THRESHOLD_PX = 8;
const DOCK_SNAP_PX = 36;
export const RIGHT_GLASS_DRAWER_KEYBOARD_STEP_PX = 16;

export default function useRightGlassDrawerLayout({
  isOpen,
  onClose,
  title,
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  resetWidthOnOpen,
  top,
  bottom,
  movable,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  storageKey?: string;
  resetWidthOnOpen: boolean;
  top: number;
  bottom: number;
  movable: boolean;
}) {
  const defaultDockWidth = Math.max(minWidth, Math.min(maxWidth, defaultWidth));
  const dockedMinWidth = movable ? defaultDockWidth : minWidth;
  const [width, setWidth] = useState(defaultDockWidth);
  const [edgeAffordanceActive, setEdgeAffordanceActive] = useState(false);
  const widthRef = useRef(defaultWidth);
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const moveStartRef = useRef<MoveStart | null>(null);
  const floatPositionRef = useRef(DEFAULT_FLOAT_POSITION);
  const cornerResizeStartRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const interactionCleanupRef = useRef<(() => void) | null>(null);
  const wasOpenRef = useRef(false);
  const [layout, setLayout] = useState<DrawerLayout>('docked');
  const [floatPosition, setFloatPosition] = useState(DEFAULT_FLOAT_POSITION);
  const [floatHeight, setFloatHeight] = useState(DEFAULT_FLOAT_HEIGHT);
  const clampedWidth = useMemo(
    () => Math.max(minWidth, Math.min(maxWidth, width)),
    [maxWidth, minWidth, width],
  );

  useEffect(() => {
    setWidth(defaultDockWidth);
    widthRef.current = defaultDockWidth;
  }, [defaultDockWidth]);
  useEffect(() => {
    if (isOpen && resetWidthOnOpen) {
      setWidth(defaultDockWidth);
      widthRef.current = defaultDockWidth;
    }
  }, [defaultDockWidth, isOpen, resetWidthOnOpen]);
  useEffect(() => { widthRef.current = clampedWidth; }, [clampedWidth]);
  useEffect(() => { floatPositionRef.current = floatPosition; }, [floatPosition]);
  useEffect(() => {
    if (isOpen && bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
  }, [isOpen, title]);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setLayout('docked');
      if (movable) {
        setWidth(defaultDockWidth);
        widthRef.current = defaultDockWidth;
        floatPositionRef.current = DEFAULT_FLOAT_POSITION;
        setFloatPosition(DEFAULT_FLOAT_POSITION);
        setFloatHeight(DEFAULT_FLOAT_HEIGHT);
      }
    }
    wasOpenRef.current = isOpen;
  }, [defaultDockWidth, isOpen, movable]);
  useEffect(() => {
    if (!storageKey || resetWidthOnOpen || movable) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      const next = Math.max(minWidth, Math.min(maxWidth, parsed));
      setWidth(next);
      widthRef.current = next;
    } catch {
      // no-op
    }
  }, [maxWidth, minWidth, movable, resetWidthOnOpen, storageKey]);
  useEffect(() => {
    if (!isOpen) {
      interactionCleanupRef.current?.();
      dragStartRef.current = null;
      moveStartRef.current = null;
      cornerResizeStartRef.current = null;
      setEdgeAffordanceActive(false);
    }
  }, [isOpen]);
  useEffect(() => () => interactionCleanupRef.current?.(), []);

  const persistWidth = (next: number) => {
    if (!storageKey) return;
    try { window.localStorage.setItem(storageKey, String(next)); } catch { /* no-op */ }
  };
  const updateWidth = (next: number, lowerBound = minWidth) => {
    const clamped = Math.max(lowerBound, Math.min(maxWidth, next));
    widthRef.current = clamped;
    setWidth(clamped);
    return clamped;
  };
  const installMouseInteraction = (
    onMove: (event: MouseEvent) => void,
    onUp: (event: MouseEvent) => void,
  ) => {
    interactionCleanupRef.current?.();
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (interactionCleanupRef.current === cleanup) interactionCleanupRef.current = null;
    };
    interactionCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return cleanup;
  };
  const dock = () => {
    setLayout('docked');
    if (movable) updateWidth(defaultDockWidth, defaultDockWidth);
  };
  const startResize = (clientX: number) => {
    setEdgeAffordanceActive(true);
    dragStartRef.current = { x: clientX, width: widthRef.current };
    const onMove = (event: MouseEvent) => {
      const drag = dragStartRef.current;
      if (!drag) return;
      updateWidth(drag.width + drag.x - event.clientX, dockedMinWidth);
    };
    let cleanup: () => void = () => {};
    const onUp = () => {
      setEdgeAffordanceActive(false);
      if (!movable) persistWidth(widthRef.current);
      dragStartRef.current = null;
      cleanup();
    };
    cleanup = installMouseInteraction(onMove, onUp);
  };
  const startMove = (clientX: number, clientY: number) => {
    if (!movable) return;
    const panel = panelRef.current;
    const parent = panel?.parentElement?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    if (!parent || !panelRect) return;
    moveStartRef.current = {
      x: clientX, y: clientY,
      left: layout === 'docked' ? panelRect.left - parent.left : floatPositionRef.current.left,
      top: layout === 'docked' ? panelRect.top - parent.top : floatPositionRef.current.top,
      width: panelRect.width || clampedWidth,
      height: panelRect.height || Math.max(FLOATING_MIN_HEIGHT, parent.height - top - bottom),
      detached: layout === 'floating',
    };
    const onMove = (event: MouseEvent) => {
      const drag = moveStartRef.current;
      const parent = panelRef.current?.parentElement?.getBoundingClientRect();
      if (!drag || !parent) return;
      if (!drag.detached) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < MOVE_THRESHOLD_PX) return;
        const compactWidth = Math.max(
          minWidth, Math.min(maxWidth, drag.width, FLOATING_MAX_INITIAL_WIDTH, parent.width - 16),
        );
        const compactHeight = Math.max(
          FLOATING_MIN_HEIGHT,
          Math.min(FLOATING_MAX_INITIAL_HEIGHT, drag.height, parent.height - 16),
        );
        const pointerOffsetX = Math.max(32, Math.min(compactWidth - 32, drag.x - (parent.left + drag.left)));
        const pointerOffsetY = Math.max(16, Math.min(48, drag.y - (parent.top + drag.top)));
        drag.left = event.clientX - parent.left - pointerOffsetX;
        drag.top = event.clientY - parent.top - pointerOffsetY;
        drag.x = event.clientX; drag.y = event.clientY;
        drag.width = compactWidth; drag.height = compactHeight; drag.detached = true;
        updateWidth(compactWidth);
        setFloatHeight(compactHeight);
        setLayout('floating');
      }
      const nextLeft = Math.max(8, Math.min(parent.width - drag.width - 8, drag.left + event.clientX - drag.x));
      const nextTop = Math.max(8, Math.min(parent.height - drag.height - 8, drag.top + event.clientY - drag.y));
      floatPositionRef.current = { left: nextLeft, top: nextTop };
      setFloatPosition(floatPositionRef.current);
    };
    const onUp = (event: MouseEvent) => {
      const drag = moveStartRef.current;
      const parent = panelRef.current?.parentElement?.getBoundingClientRect();
      if (drag?.detached && parent) {
        const panelRight = floatPositionRef.current.left + drag.width;
        const pointerNearWall = event.clientX - parent.left >= parent.width - DOCK_SNAP_PX;
        if (pointerNearWall || parent.width - panelRight <= DOCK_SNAP_PX) dock();
      }
      moveStartRef.current = null;
      cleanup();
    };
    let cleanup: () => void = () => {};
    cleanup = installMouseInteraction(onMove, onUp);
  };
  const startCornerResize = (clientX: number, clientY: number) => {
    if (!movable || layout !== 'floating') return;
    cornerResizeStartRef.current = {
      x: clientX, y: clientY, width: widthRef.current, height: floatHeight,
    };
    const onMove = (event: MouseEvent) => {
      const drag = cornerResizeStartRef.current;
      const parent = panelRef.current?.parentElement?.getBoundingClientRect();
      if (!drag || !parent) return;
      const widthLimit = Math.min(maxWidth, Math.max(minWidth, parent.width - floatPositionRef.current.left - 8));
      const heightLimit = Math.max(FLOATING_MIN_HEIGHT, parent.height - floatPositionRef.current.top - 8);
      updateWidth(Math.max(minWidth, Math.min(widthLimit, drag.width + event.clientX - drag.x)));
      setFloatHeight(Math.max(FLOATING_MIN_HEIGHT, Math.min(heightLimit, drag.height + event.clientY - drag.y)));
    };
    let cleanup: () => void = () => {};
    const onUp = () => { cornerResizeStartRef.current = null; cleanup(); };
    cleanup = installMouseInteraction(onMove, onUp);
  };
  const detachForKeyboard = () => {
    if (!movable || layout !== 'docked') return;
    const panel = panelRef.current;
    const parent = panel?.parentElement?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    if (!parent || !panelRect) return;
    const compactWidth = Math.max(
      minWidth,
      Math.min(maxWidth, panelRect.width || widthRef.current, FLOATING_MAX_INITIAL_WIDTH, parent.width - 16),
    );
    const compactHeight = Math.max(
      FLOATING_MIN_HEIGHT,
      Math.min(FLOATING_MAX_INITIAL_HEIGHT, panelRect.height || FLOATING_MAX_INITIAL_HEIGHT, parent.height - 16),
    );
    const nextPosition = {
      left: Math.max(8, parent.width - compactWidth - DOCK_SNAP_PX - 12),
      top: Math.max(8, Math.min(parent.height - compactHeight - 8, panelRect.top - parent.top)),
    };
    floatPositionRef.current = nextPosition;
    setFloatPosition(nextPosition);
    updateWidth(compactWidth);
    setFloatHeight(compactHeight);
    setLayout('floating');
  };
  const moveFloatingByKeyboard = (deltaX: number, deltaY: number) => {
    const parent = panelRef.current?.parentElement?.getBoundingClientRect();
    if (!parent || layout !== 'floating') return;
    const nextLeft = Math.max(8, Math.min(parent.width - widthRef.current - 8, floatPositionRef.current.left + deltaX));
    const nextTop = Math.max(8, Math.min(parent.height - floatHeight - 8, floatPositionRef.current.top + deltaY));
    if (deltaX > 0 && parent.width - (nextLeft + widthRef.current) <= DOCK_SNAP_PX) {
      dock(); return;
    }
    const nextPosition = { left: nextLeft, top: nextTop };
    floatPositionRef.current = nextPosition;
    setFloatPosition(nextPosition);
  };
  const resizeDockedByKeyboard = (delta: number) => {
    const next = updateWidth(widthRef.current + delta, dockedMinWidth);
    if (!movable) persistWidth(next);
  };
  const resizeFloatingByKeyboard = (deltaWidth: number, deltaHeight: number) => {
    const parent = panelRef.current?.parentElement?.getBoundingClientRect();
    if (!parent || layout !== 'floating') return;
    const widthLimit = Math.min(maxWidth, Math.max(minWidth, parent.width - floatPositionRef.current.left - 8));
    const heightLimit = Math.max(FLOATING_MIN_HEIGHT, parent.height - floatPositionRef.current.top - 8);
    updateWidth(Math.max(minWidth, Math.min(widthLimit, widthRef.current + deltaWidth)));
    setFloatHeight(Math.max(FLOATING_MIN_HEIGHT, Math.min(heightLimit, floatHeight + deltaHeight)));
  };
  const closeIntoDock = () => {
    interactionCleanupRef.current?.();
    dragStartRef.current = null;
    moveStartRef.current = null;
    cornerResizeStartRef.current = null;
    setEdgeAffordanceActive(false);
    dock();
    floatPositionRef.current = DEFAULT_FLOAT_POSITION;
    setFloatPosition(DEFAULT_FLOAT_POSITION);
    setFloatHeight(DEFAULT_FLOAT_HEIGHT);
    onClose();
  };

  return {
    bodyScrollRef,
    clampedWidth,
    closeIntoDock,
    detachForKeyboard,
    dockedMinWidth,
    edgeAffordanceActive,
    floatHeight,
    floatPosition,
    layout,
    moveFloatingByKeyboard,
    panelRef,
    resizeDockedByKeyboard,
    resizeFloatingByKeyboard,
    setEdgeAffordanceActive,
    startCornerResize,
    startMove,
    startResize,
  };
}
