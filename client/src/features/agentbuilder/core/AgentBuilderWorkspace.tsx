import type { PointerEvent, ReactNode, RefObject } from 'react';

type AgentBuilderWorkspaceProps = {
  rail: ReactNode;
  workspaceShellRef: RefObject<HTMLDivElement | null>;
  workspaceView: string;
  surfaceName: string;
  chatPanelWidth: number;
  chatMinWidth: number;
  chat: ReactNode;
  splitterActive: boolean;
  onSplitterPointerEnter: () => void;
  onSplitterPointerLeave: () => void;
  onSplitterPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  companionMinWidth: number;
  companionContentMinWidth: number;
  companionOverlayWidth: number;
  companionViewportWidth: number;
  companionVisibleWidth: number;
  canvas: ReactNode;
  companion: ReactNode;
  drawer: ReactNode;
};

export default function AgentBuilderWorkspace({
  rail,
  workspaceShellRef,
  workspaceView,
  surfaceName,
  chatPanelWidth,
  chatMinWidth,
  chat,
  splitterActive,
  onSplitterPointerEnter,
  onSplitterPointerLeave,
  onSplitterPointerDown,
  companionMinWidth,
  companionContentMinWidth,
  companionOverlayWidth,
  companionViewportWidth,
  companionVisibleWidth,
  canvas,
  companion,
  drawer,
}: AgentBuilderWorkspaceProps) {
  const companionUnderMain = companionOverlayWidth > 0;
  return (
    <>
      <style>{`
        @keyframes builder-orb-float {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-0.5px) scale(1.015); }
        }
      `}</style>
      <div className="flex flex-1 overflow-hidden min-h-0 min-w-0">
        {rail}
        <div
          ref={workspaceShellRef}
          className="flex flex-1 overflow-hidden min-h-0 min-w-0"
          style={{ position: 'relative' }}
        >
          <div
            data-testid="workspace-large-region"
            data-surface={surfaceName}
            data-main-over-companion={companionUnderMain ? 'true' : undefined}
            className="h-full min-w-0 relative"
            style={
              workspaceView === 'chat'
                ? {
                    width: '100%',
                    minWidth: 0,
                    flex: '1 1 auto',
                  }
                : {
                    width: chatPanelWidth,
                    minWidth: Math.min(chatMinWidth, chatPanelWidth),
                    flex: '0 0 auto',
                    zIndex: 2,
                    background: '#1F1F1F',
                    boxShadow: companionUnderMain
                      ? '10px 0 28px rgba(0,0,0,0.28)'
                      : undefined,
                  }
            }
          >
            {chat}
          </div>
          {workspaceView !== 'chat' ? (
            <div
              data-testid="workspace-chat-resize-handle"
              aria-label="Resize chat panel"
              title="Drag to resize chat"
              onPointerEnter={onSplitterPointerEnter}
              onPointerLeave={onSplitterPointerLeave}
              onPointerDown={onSplitterPointerDown}
              style={{
                width: 10,
                height: '100%',
                cursor: 'col-resize',
                flexShrink: 0,
                position: 'relative',
                zIndex: companionUnderMain ? 3 : undefined,
                touchAction: 'none',
                userSelect: 'none',
                overflow: 'hidden',
                borderLeft: `1px solid ${
                  splitterActive
                    ? 'rgba(79,162,173,0.34)'
                    : 'rgba(79,162,173,0.18)'
                }`,
                borderRight: `1px solid ${
                  splitterActive
                    ? 'rgba(255,255,255,0.16)'
                    : 'rgba(255,255,255,0.06)'
                }`,
                boxShadow: splitterActive
                  ? 'inset 0 0 0 1px rgba(79,162,173,0.16), 0 0 10px rgba(79,162,173,0.12)'
                  : 'none',
                background:
                  'linear-gradient(90deg, rgba(79,162,173,0.05), rgba(255,255,255,0.09), rgba(79,162,173,0.05))',
                transition:
                  'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease',
              }}
            />
          ) : null}
          {workspaceView !== 'chat' ? (
            <div
              data-testid="workspace-companion-clip"
              data-companion-visible-viewport="true"
              data-companion-min-width={companionMinWidth}
              data-companion-overlay-width={companionOverlayWidth}
              data-companion-viewport-width={companionViewportWidth}
              data-companion-visible-width={companionVisibleWidth}
              className="h-full flex-1 min-w-0 relative"
              style={{ minWidth: 0, overflow: 'hidden', zIndex: 0 }}
            >
              <div
                data-testid="workspace-companion-content"
                className="h-full relative"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: companionViewportWidth,
                  minWidth: companionContentMinWidth,
                }}
              >
                {workspaceView === 'canvas' ? canvas : companion}
              </div>
            </div>
          ) : null}
          {drawer}
        </div>
      </div>
    </>
  );
}
