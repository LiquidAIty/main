import React, { useEffect, useMemo, useRef, useState } from "react";

import { GRAPH_THEME, graphDrawerButtonStyle, graphInspectorPanelStyle } from "./graphVisualTokens";

type RightGlassDrawerProps = {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  onOpen?: () => void;
  children: React.ReactNode;
  dataTestId?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string;
  resetWidthOnOpen?: boolean;
  top?: number;
  right?: number;
  bottom?: number;
  dockedHeight?: number | string;
  zIndex?: number;
  collapsedLabel?: string | null;
  openAriaLabel?: string;
  movable?: boolean;
};

type DrawerLayout = "docked" | "floating";

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
const KEYBOARD_STEP_PX = 16;

export default function RightGlassDrawer({
  isOpen,
  title,
  onClose,
  onOpen,
  children,
  dataTestId,
  defaultWidth = 420,
  minWidth = 320,
  maxWidth = 720,
  storageKey,
  resetWidthOnOpen = false,
  top = 48,
  right = 12,
  bottom = 12,
  dockedHeight,
  zIndex = 30,
  collapsedLabel,
  openAriaLabel,
  movable = false,
}: RightGlassDrawerProps): React.ReactElement {
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
  const [layout, setLayout] = useState<DrawerLayout>("docked");
  const [floatPosition, setFloatPosition] = useState(DEFAULT_FLOAT_POSITION);
  const [floatHeight, setFloatHeight] = useState(DEFAULT_FLOAT_HEIGHT);
  const clampedWidth = useMemo(() => Math.max(minWidth, Math.min(maxWidth, width)), [maxWidth, minWidth, width]);

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

  useEffect(() => {
    widthRef.current = clampedWidth;
  }, [clampedWidth]);

  useEffect(() => {
    floatPositionRef.current = floatPosition;
  }, [floatPosition]);

  useEffect(() => {
    if (isOpen && bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
  }, [isOpen, title]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setLayout("docked");
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
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      // no-op
    }
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
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (interactionCleanupRef.current === cleanup) interactionCleanupRef.current = null;
    };
    interactionCleanupRef.current = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return cleanup;
  };

  const dock = () => {
    setLayout("docked");
    if (movable) updateWidth(defaultDockWidth, defaultDockWidth);
  };

  const startResize = (clientX: number) => {
    setEdgeAffordanceActive(true);
    dragStartRef.current = { x: clientX, width: widthRef.current };
    const onMove = (event: MouseEvent) => {
      const drag = dragStartRef.current;
      if (!drag) return;
      const delta = drag.x - event.clientX;
      const next = Math.max(dockedMinWidth, Math.min(maxWidth, drag.width + delta));
      updateWidth(next, dockedMinWidth);
    };
    let cleanup: () => void = () => {};
    const onUp = () => {
      setEdgeAffordanceActive(false);
      const next = widthRef.current;
      if (!movable) persistWidth(next);
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
      x: clientX,
      y: clientY,
      left: layout === "docked" ? panelRect.left - parent.left : floatPositionRef.current.left,
      top: layout === "docked" ? panelRect.top - parent.top : floatPositionRef.current.top,
      width: panelRect.width || clampedWidth,
      height: panelRect.height || Math.max(FLOATING_MIN_HEIGHT, parent.height - top - bottom),
      detached: layout === "floating",
    };
    const onMove = (event: MouseEvent) => {
      const drag = moveStartRef.current;
      const parent = panelRef.current?.parentElement?.getBoundingClientRect();
      if (!drag || !parent) return;

      if (!drag.detached) {
        const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
        if (distance < MOVE_THRESHOLD_PX) return;

        const compactWidth = Math.max(
          minWidth,
          Math.min(maxWidth, drag.width, FLOATING_MAX_INITIAL_WIDTH, parent.width - 16),
        );
        const compactHeight = Math.max(
          FLOATING_MIN_HEIGHT,
          Math.min(FLOATING_MAX_INITIAL_HEIGHT, drag.height, parent.height - 16),
        );
        const pointerOffsetX = Math.max(32, Math.min(compactWidth - 32, drag.x - (parent.left + drag.left)));
        const pointerOffsetY = Math.max(16, Math.min(48, drag.y - (parent.top + drag.top)));
        drag.left = event.clientX - parent.left - pointerOffsetX;
        drag.top = event.clientY - parent.top - pointerOffsetY;
        drag.x = event.clientX;
        drag.y = event.clientY;
        drag.width = compactWidth;
        drag.height = compactHeight;
        drag.detached = true;
        updateWidth(compactWidth);
        setFloatHeight(compactHeight);
        setLayout("floating");
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
        if (pointerNearWall || parent.width - panelRight <= DOCK_SNAP_PX) {
          dock();
        }
      }
      moveStartRef.current = null;
      cleanup();
    };
    let cleanup: () => void = () => {};
    cleanup = installMouseInteraction(onMove, onUp);
  };

  const startCornerResize = (clientX: number, clientY: number) => {
    if (!movable || layout !== "floating") return;
    cornerResizeStartRef.current = {
      x: clientX,
      y: clientY,
      width: widthRef.current,
      height: floatHeight,
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
    const onUp = () => {
      cornerResizeStartRef.current = null;
      cleanup();
    };
    cleanup = installMouseInteraction(onMove, onUp);
  };

  const detachForKeyboard = () => {
    if (!movable || layout !== "docked") return;
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
    setLayout("floating");
  };

  const moveFloatingByKeyboard = (deltaX: number, deltaY: number) => {
    const parent = panelRef.current?.parentElement?.getBoundingClientRect();
    if (!parent || layout !== "floating") return;
    const nextLeft = Math.max(8, Math.min(parent.width - widthRef.current - 8, floatPositionRef.current.left + deltaX));
    const nextTop = Math.max(8, Math.min(parent.height - floatHeight - 8, floatPositionRef.current.top + deltaY));
    if (deltaX > 0 && parent.width - (nextLeft + widthRef.current) <= DOCK_SNAP_PX) {
      dock();
      return;
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
    if (!parent || layout !== "floating") return;
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

  return (
    <>
      {!isOpen && onOpen ? (
        <button
          type="button"
          aria-label={openAriaLabel || `Open ${title}`}
          onClick={onOpen}
          className="absolute transition-[opacity,background-color,border-color] duration-150 ease-out hover:opacity-100"
          style={{
            top: "50%",
            right: 0,
            transform: "translateY(-50%)",
            width: collapsedLabel === null ? 22 : 28,
            height: collapsedLabel === null ? 44 : 96,
            border: "1px solid rgba(55, 173, 170, 0.55)",
            borderRight: "none",
            borderTopLeftRadius: collapsedLabel === null ? 12 : 10,
            borderBottomLeftRadius: collapsedLabel === null ? 12 : 10,
            cursor: "pointer",
            zIndex,
            background: "linear-gradient(145deg, rgba(16, 31, 39, 0.68), rgba(7, 13, 19, 0.42))",
            color: GRAPH_THEME.drawer.inputMuted,
            opacity: 1,
            backdropFilter: "blur(18px) saturate(135%)",
            WebkitBackdropFilter: "blur(18px) saturate(135%)",
            boxShadow: "0 0 18px rgba(45, 212, 191, 0.16), inset 0 0 0 1px rgba(255,255,255,.035)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {collapsedLabel === null ? (
            <span aria-hidden="true" style={{ width: 5, height: 18, borderRadius: 99, background: "rgba(151, 244, 236, .72)", boxShadow: "0 0 10px rgba(55, 173, 170, .52)" }} />
          ) : (
            <span
              style={{
                writingMode: "vertical-rl",
                textOrientation: "mixed",
                transform: "rotate(180deg)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(190, 255, 250, 0.92)",
                whiteSpace: "nowrap",
              }}
            >
              {collapsedLabel ?? title}
            </span>
          )}
        </button>
      ) : null}

      <aside
        ref={panelRef}
        aria-label={title || openAriaLabel || "Drawer"}
        aria-hidden={!isOpen}
        data-testid={dataTestId}
        data-open={isOpen ? "true" : "false"}
        data-layout={layout}
        className="absolute transition-[width,opacity,transform] duration-180 ease-out"
        style={graphInspectorPanelStyle({
          top: layout === "floating" ? floatPosition.top : (dockedHeight ? "auto" : top),
          right: layout === "floating" ? "auto" : (movable ? 0 : right),
          bottom: layout === "floating" ? "auto" : bottom,
          left: layout === "floating" ? floatPosition.left : "auto",
          height: layout === "floating" ? floatHeight : (dockedHeight ?? "auto"),
          width: isOpen ? clampedWidth : 0,
          minWidth: 0,
          zIndex,
          position: "absolute",
          pointerEvents: isOpen ? "auto" : "none",
          visibility: isOpen ? "visible" : "hidden",
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? "translateX(0)" : "translateX(12px)",
          borderRadius: layout === "docked" && movable ? "18px 0 0 18px" : 18,
          overflow: "hidden",
        })}
        >
        {layout === "docked" ? (
          <div
            aria-label="Resize drawer"
            aria-orientation="vertical"
            aria-valuemin={dockedMinWidth}
            aria-valuemax={maxWidth}
            aria-valuenow={clampedWidth}
            role="separator"
            tabIndex={isOpen ? 0 : -1}
            title="Drag to resize drawer"
            onMouseEnter={() => setEdgeAffordanceActive(true)}
            onMouseLeave={() => setEdgeAffordanceActive(false)}
            onMouseDown={(event) => {
              event.preventDefault();
              startResize(event.clientX);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              resizeDockedByKeyboard(event.key === "ArrowLeft" ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX);
            }}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 8,
              cursor: "col-resize",
              zIndex: 3,
              borderRight: `1px solid ${edgeAffordanceActive ? GRAPH_THEME.accent.primaryBorder : GRAPH_THEME.drawer.sectionBorder}`,
              boxShadow: edgeAffordanceActive
                ? "inset 0 0 0 1px rgba(55,173,170,0.14), 0 0 8px rgba(55,173,170,0.1)"
                : "none",
              background: edgeAffordanceActive
                ? "linear-gradient(90deg, rgba(55,173,170,0.2), rgba(55,173,170,0.02))"
                : "linear-gradient(90deg, rgba(167,176,186,0.14), rgba(167,176,186,0.01))",
              transition: "border-color 120ms ease, box-shadow 120ms ease, background 120ms ease",
            }}
          />
        ) : null}
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div aria-hidden="true" style={{ height: 1, flex: '0 0 auto', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.42), rgba(255,255,255,.12), transparent)', boxShadow: '0 0 14px rgba(255,255,255,.08)' }} />
          <div
            aria-label={movable ? "Move panel" : undefined}
            aria-roledescription={movable ? "movable panel header" : undefined}
            role={movable ? "button" : undefined}
            tabIndex={movable && isOpen ? 0 : undefined}
            className="flex items-center justify-between gap-2"
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              startMove(event.clientX, event.clientY);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget && (event.target as HTMLElement).closest("button")) return;
              if (event.key === "Escape") {
                event.preventDefault();
                closeIntoDock();
                return;
              }
              if (layout === "docked") {
                if (event.key !== "ArrowLeft") return;
                event.preventDefault();
                detachForKeyboard();
                return;
              }
              const step = event.shiftKey ? KEYBOARD_STEP_PX * 2 : KEYBOARD_STEP_PX;
              const direction = ({
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              } as Record<string, [number, number]>)[event.key];
              if (!direction) return;
              event.preventDefault();
              moveFloatingByKeyboard(direction[0], direction[1]);
            }}
            style={{
              padding: "10px 12px 10px 16px",
              borderBottom: '1px solid rgba(126,232,226,.12)',
              background: 'linear-gradient(110deg, rgba(255,255,255,.055), rgba(255,255,255,.018), transparent 68%)',
              cursor: movable ? (layout === "docked" ? 'grab' : 'move') : 'default',
            }}
          >
            <div
              style={{
                color: GRAPH_THEME.drawer.inputText,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {title}
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                type="button"
                aria-label="Close drawer"
                title="Close"
                onClick={closeIntoDock}
                style={graphDrawerButtonStyle({ padding: "6px 8px", minWidth: 32, color: GRAPH_THEME.drawer.inputText })}
              >
                ×
              </button>
            </div>
          </div>
          <div
            ref={bodyScrollRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
            style={{
              padding: "12px",
              color: GRAPH_THEME.drawer.inputMuted,
              background: "transparent",
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(126,232,226,.28) transparent",
            }}
          >
            {children}
          </div>
        </div>
        {movable && layout === "floating" ? (
          <div
            aria-label="Resize floating panel"
            aria-roledescription="resize handle"
            role="button"
            tabIndex={isOpen ? 0 : -1}
            title="Drag to expand panel"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              startCornerResize(event.clientX, event.clientY);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? KEYBOARD_STEP_PX * 2 : KEYBOARD_STEP_PX;
              const direction = ({
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              } as Record<string, [number, number]>)[event.key];
              if (!direction) return;
              event.preventDefault();
              resizeFloatingByKeyboard(direction[0], direction[1]);
            }}
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 18,
              height: 18,
              zIndex: 4,
              cursor: 'nwse-resize',
              background: 'linear-gradient(135deg, transparent 48%, rgba(126,232,226,.35) 50%, rgba(126,232,226,.08) 72%, transparent 74%)',
            }}
          />
        ) : null}
      </aside>
    </>
  );
}
