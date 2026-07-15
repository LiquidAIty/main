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
  top?: number;
  right?: number;
  bottom?: number;
  dockedHeight?: number | string;
  zIndex?: number;
  collapsedLabel?: string | null;
  openAriaLabel?: string;
  movable?: boolean;
};

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
  top = 48,
  right = 12,
  bottom = 12,
  dockedHeight,
  zIndex = 30,
  collapsedLabel,
  openAriaLabel,
  movable = false,
}: RightGlassDrawerProps): React.ReactElement {
  const [width, setWidth] = useState(defaultWidth);
  const [edgeAffordanceActive, setEdgeAffordanceActive] = useState(false);
  const widthRef = useRef(defaultWidth);
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const moveStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [docked, setDocked] = useState(true);
  const [floatPosition, setFloatPosition] = useState({ left: 24, top: 72 });
  const clampedWidth = useMemo(() => Math.max(minWidth, Math.min(maxWidth, width)), [maxWidth, minWidth, width]);

  useEffect(() => {
    setWidth(defaultWidth);
  }, [defaultWidth]);

  useEffect(() => {
    widthRef.current = clampedWidth;
  }, [clampedWidth]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      setWidth(Math.max(minWidth, Math.min(maxWidth, parsed)));
    } catch {
      // no-op
    }
  }, [maxWidth, minWidth, storageKey]);

  const persistWidth = (next: number) => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      // no-op
    }
  };

  const startResize = (clientX: number) => {
    setEdgeAffordanceActive(true);
    dragStartRef.current = { x: clientX, width: widthRef.current };
    const onMove = (event: MouseEvent) => {
      const drag = dragStartRef.current;
      if (!drag) return;
      const delta = drag.x - event.clientX;
      const next = Math.max(minWidth, Math.min(maxWidth, drag.width + delta));
      setWidth(next);
    };
    const onUp = () => {
      setEdgeAffordanceActive(false);
      const next = widthRef.current;
      persistWidth(next);
      dragStartRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startMove = (clientX: number, clientY: number) => {
    if (!movable || docked) return;
    moveStartRef.current = { x: clientX, y: clientY, left: floatPosition.left, top: floatPosition.top };
    const onMove = (event: MouseEvent) => {
      const drag = moveStartRef.current;
      const parent = panelRef.current?.parentElement?.getBoundingClientRect();
      if (!drag || !parent) return;
      const nextLeft = Math.max(8, Math.min(parent.width - clampedWidth - 8, drag.left + event.clientX - drag.x));
      const nextTop = Math.max(8, Math.min(parent.height - 96, drag.top + event.clientY - drag.y));
      setFloatPosition({ left: nextLeft, top: nextTop });
    };
    const onUp = () => {
      moveStartRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const detach = () => {
    const parent = panelRef.current?.parentElement?.getBoundingClientRect();
    setFloatPosition({
      left: Math.max(12, (parent?.width || window.innerWidth) - clampedWidth - 36),
      top: Math.max(12, top + 20),
    });
    setDocked(false);
  };

  return (
    <>
      {!isOpen && onOpen ? (
        <button
          type="button"
          aria-label={openAriaLabel || `Open ${title}`}
          onClick={onOpen}
          className="absolute transition-all duration-150 ease-out hover:opacity-100"
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
        data-testid={dataTestId}
        data-open={isOpen ? "true" : "false"}
        className="absolute transition-[width,opacity,transform] duration-180 ease-out"
        style={graphInspectorPanelStyle({
          top: docked ? (dockedHeight ? "auto" : top) : floatPosition.top,
          right: docked ? right : "auto",
          bottom: docked ? bottom : "auto",
          left: docked ? "auto" : floatPosition.left,
          height: docked ? (dockedHeight ?? "auto") : "min(68vh, 620px)",
          width: isOpen ? clampedWidth : 0,
          minWidth: 0,
          zIndex,
          position: "absolute",
          pointerEvents: isOpen ? "auto" : "none",
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? "translateX(0)" : "translateX(12px)",
          borderRadius: 18,
          overflow: "hidden",
        })}
        >
        <div
          aria-label="Resize drawer"
          title="Drag to resize drawer"
          onMouseEnter={() => setEdgeAffordanceActive(true)}
          onMouseLeave={() => setEdgeAffordanceActive(false)}
          onMouseDown={(event) => {
            event.preventDefault();
            startResize(event.clientX);
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
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div aria-hidden="true" style={{ height: 1, flex: '0 0 auto', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.42), rgba(255,255,255,.12), transparent)', boxShadow: '0 0 14px rgba(255,255,255,.08)' }} />
          <div
            className="flex items-center justify-between gap-2"
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              startMove(event.clientX, event.clientY);
            }}
            style={{
              padding: "10px 12px 10px 16px",
              borderBottom: '1px solid rgba(126,232,226,.12)',
              background: 'linear-gradient(110deg, rgba(255,255,255,.055), rgba(255,255,255,.018), transparent 68%)',
              cursor: movable && !docked ? 'move' : 'default',
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
              {movable ? (
                <button
                  type="button"
                  aria-label={docked ? "Detach panel" : "Dock panel"}
                  title={docked ? "Detach" : "Dock"}
                  onClick={docked ? detach : () => setDocked(true)}
                  style={graphDrawerButtonStyle({ padding: "6px", minWidth: 30, color: GRAPH_THEME.drawer.inputText })}
                >
                  <span aria-hidden="true" style={{ display: 'block', width: 11, height: 11, border: '1px solid currentColor', borderRadius: 3, boxShadow: docked ? '3px 0 0 -1px rgba(126,232,226,.5)' : 'none' }} />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Close drawer"
                onClick={onClose}
                style={graphDrawerButtonStyle({ padding: "6px 8px", minWidth: 32, color: GRAPH_THEME.drawer.inputText })}
              >
                ×
              </button>
            </div>
          </div>
          <div
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
      </aside>
    </>
  );
}
