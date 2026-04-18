import React, { useEffect, useMemo, useRef, useState } from "react";

import { GRAPH_THEME, graphCompanionPanelStyle, graphDrawerButtonStyle } from "./graphVisualTokens";

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
  zIndex?: number;
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
  zIndex = 30,
}: RightGlassDrawerProps): React.ReactElement {
  const [width, setWidth] = useState(defaultWidth);
  const widthRef = useRef(defaultWidth);
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
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
    dragStartRef.current = { x: clientX, width: widthRef.current };
    const onMove = (event: MouseEvent) => {
      const drag = dragStartRef.current;
      if (!drag) return;
      const delta = drag.x - event.clientX;
      const next = Math.max(minWidth, Math.min(maxWidth, drag.width + delta));
      setWidth(next);
    };
    const onUp = () => {
      const next = widthRef.current;
      persistWidth(next);
      dragStartRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <>
      {!isOpen && onOpen ? (
        <button
          type="button"
          aria-label={`Open ${title}`}
          onClick={onOpen}
          className="absolute transition-opacity duration-150 ease-out hover:opacity-100"
          style={{
            top: "50%",
            right,
            transform: "translate(100%, -50%)",
            width: 10,
            height: 76,
            border: `1px solid ${GRAPH_THEME.drawer.panelBorder}`,
            borderLeft: "none",
            borderTopRightRadius: 7,
            borderBottomRightRadius: 7,
            cursor: "pointer",
            zIndex,
            background: "linear-gradient(90deg, rgba(10,12,16,0.82), rgba(22,26,32,0.94))",
            color: "rgba(255,255,255,0.55)",
            opacity: 0.86,
          }}
        >
          <span className="sr-only">{title}</span>
        </button>
      ) : null}
      <aside
        data-testid={dataTestId}
        data-open={isOpen ? "true" : "false"}
        className="absolute transition-[width,opacity,transform] duration-180 ease-out"
        style={graphCompanionPanelStyle({
          top,
          right,
          bottom,
          width: isOpen ? clampedWidth : 0,
          minWidth: 0,
          zIndex,
          position: "absolute",
          pointerEvents: isOpen ? "auto" : "none",
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? "translateX(0)" : "translateX(12px)",
          borderRadius: 12,
          border: `1px solid ${GRAPH_THEME.drawer.panelBorder}`,
          boxShadow: `${GRAPH_THEME.drawer.panelShadow}, ${GRAPH_THEME.drawer.panelInset}`,
          overflow: "hidden",
        })}
      >
        <div
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
            background: "linear-gradient(90deg, rgba(79,162,173,0.16), rgba(79,162,173,0.01))",
          }}
        />
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div
            className="flex items-center justify-between gap-2"
            style={{
              padding: "10px 12px 10px 16px",
              borderBottom: `1px solid ${GRAPH_THEME.drawer.tabRailBorder}`,
              background: "rgba(7,9,12,0.78)",
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
            <button
              type="button"
              aria-label="Close drawer"
              onClick={onClose}
              style={graphDrawerButtonStyle({
                padding: "6px 8px",
                minWidth: 32,
                color: GRAPH_THEME.drawer.inputText,
              })}
            >
              x
            </button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-auto"
            style={{
              padding: "12px",
              color: GRAPH_THEME.drawer.inputMuted,
              background: "transparent",
            }}
          >
            {children}
          </div>
        </div>
      </aside>
    </>
  );
}
