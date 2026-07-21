import type { MouseEvent, ReactNode, RefObject } from 'react';

type AgentBuilderWorkspaceProps = {
  rail: ReactNode;
  workspaceShellRef: RefObject<HTMLDivElement | null>;
  workspaceView: string;
  surfaceName: string;
  chatPanelWidth: number;
  chatMinWidth: number;
  chat: ReactNode;
  splitterActive: boolean;
  onSplitterMouseEnter: () => void;
  onSplitterMouseLeave: () => void;
  onSplitterMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  canvasMinWidth: number;
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
  onSplitterMouseEnter,
  onSplitterMouseLeave,
  onSplitterMouseDown,
  canvasMinWidth,
  canvas,
  companion,
  drawer,
}: AgentBuilderWorkspaceProps) {
  return (
    <>
      <style>{`
        @keyframes builder-orb-float {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-0.5px) scale(1.015); }
        }
      `}</style>
      <div className="flex flex-1 overflow-hidden min-h-0">
        {rail}
        <div
          ref={workspaceShellRef}
          className="flex flex-1 overflow-hidden min-h-0"
          style={{ position: 'relative' }}
        >
          <div
            data-testid="workspace-large-region"
            data-surface={surfaceName}
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
                    minWidth: chatMinWidth,
                    flex: '0 0 auto',
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
              onMouseEnter={onSplitterMouseEnter}
              onMouseLeave={onSplitterMouseLeave}
              onMouseDown={onSplitterMouseDown}
              style={{
                width: 10,
                height: '100%',
                cursor: 'col-resize',
                flexShrink: 0,
                position: 'relative',
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
          {workspaceView === 'canvas' ? (
            <div
              data-testid="workspace-canvas-region"
              className="h-full flex-1 min-w-0 relative"
              style={{ minWidth: canvasMinWidth }}
            >
              {canvas}
            </div>
          ) : null}
          {companion}
          {drawer}
        </div>
      </div>
    </>
  );
}
