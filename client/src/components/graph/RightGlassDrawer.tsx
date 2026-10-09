import React from "react";

import { GRAPH_THEME, graphDrawerButtonStyle, graphInspectorPanelStyle } from "./graphVisualTokens";
import useRightGlassDrawerLayout, {
  RIGHT_GLASS_DRAWER_KEYBOARD_STEP_PX,
} from "./useRightGlassDrawerLayout";

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
  const {
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
  } = useRightGlassDrawerLayout({
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
  });
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
              resizeDockedByKeyboard(event.key === "ArrowLeft"
                ? RIGHT_GLASS_DRAWER_KEYBOARD_STEP_PX
                : -RIGHT_GLASS_DRAWER_KEYBOARD_STEP_PX);
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
              const step = event.shiftKey
                ? RIGHT_GLASS_DRAWER_KEYBOARD_STEP_PX * 2
                : RIGHT_GLASS_DRAWER_KEYBOARD_STEP_PX;
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
              const step = event.shiftKey
                ? RIGHT_GLASS_DRAWER_KEYBOARD_STEP_PX * 2
                : RIGHT_GLASS_DRAWER_KEYBOARD_STEP_PX;
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
