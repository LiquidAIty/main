import type { ReactNode } from 'react';

type AgentBuilderChatPaneProps = {
  workspaceView: string;
  chatPanelWidth: number;
  minWidth: number;
  chatResizeHandleActive: boolean;
  children: ReactNode;
};

export default function AgentBuilderChatPane({
  workspaceView,
  chatPanelWidth,
  minWidth,
  chatResizeHandleActive,
  children,
}: AgentBuilderChatPaneProps) {
  return (
    <div
      data-testid="workspace-large-region"
      data-surface={workspaceView}
      className="h-full min-w-0 relative"
      style={{
        ...(workspaceView === 'chat'
          ? {
              width: '100%',
              minWidth: 0,
              flex: '1 1 auto',
            }
          : {
              width: chatPanelWidth,
              minWidth,
              flex: '0 0 auto',
              transition: chatResizeHandleActive
                ? undefined
                : 'width 180ms cubic-bezier(.22,.61,.36,1)',
            }),
      }}
    >
      {children}
    </div>
  );
}
