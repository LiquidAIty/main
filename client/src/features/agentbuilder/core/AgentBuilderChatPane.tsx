import type { ReactNode } from 'react';

type AgentBuilderChatPaneProps = {
  workspaceView: string;
  surfaceName: string;
  chatPanelWidth: number;
  minWidth: number;
  children: ReactNode;
};

export default function AgentBuilderChatPane({
  workspaceView,
  surfaceName,
  chatPanelWidth,
  minWidth,
  children,
}: AgentBuilderChatPaneProps) {
  return (
    <div
      data-testid="workspace-large-region"
      data-surface={surfaceName}
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
            }),
      }}
    >
      {children}
    </div>
  );
}
