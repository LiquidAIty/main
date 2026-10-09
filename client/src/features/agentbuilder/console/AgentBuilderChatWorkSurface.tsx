import type { ComponentProps } from 'react';

import SharedCardChat from './SharedCardChat';
import CardTerminalPanel from './CardTerminalPanel';
import SharedChatTerminalSplit from './SharedChatTerminalSplit';
import {
  builderTerminalBinding,
  type BuilderTerminalCard,
} from './agentBuilderChatWorkSurfacePolicy';

export default function AgentBuilderChatWorkSurface({
  activeProject,
  canvasProjectId,
  conversationId,
  builderCard,
  sharedChatProps,
}: {
  activeProject: string;
  canvasProjectId: string | null;
  conversationId: string;
  builderCard: BuilderTerminalCard | null | undefined;
  sharedChatProps: ComponentProps<typeof SharedCardChat>;
}) {
  const terminalBinding = builderTerminalBinding({
    canvasProjectId,
    conversationId,
    builderCard,
  });
  return (
    <div data-testid="large-surface-chat" style={{ height: '100%' }}>
      <SharedChatTerminalSplit
        storageKey={`liquidaity.main.agent-builder.split.v1:${activeProject}`}
        chat={(
          <div style={{ height: '100%', minHeight: 0 }}>
            <SharedCardChat {...sharedChatProps} />
          </div>
        )}
        terminal={terminalBinding ? (
          <div
            data-testid="under-chat-card-work-surface"
            data-card-id={terminalBinding.cardId}
            style={{ height: '100%', minHeight: 0 }}
          >
            <CardTerminalPanel
              key={terminalBinding.key}
              identity={terminalBinding.identity}
            />
          </div>
        ) : null}
        workSurfaceLabel={builderCard?.title || 'Builder'}
      />
    </div>
  );
}
