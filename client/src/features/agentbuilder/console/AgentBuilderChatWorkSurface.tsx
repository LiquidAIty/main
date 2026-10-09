import type { ComponentProps } from 'react';

import SharedCardChat from './SharedCardChat';
import CardTerminalPanel from './CardTerminalPanel';
import SharedChatTerminalSplit from './SharedChatTerminalSplit';
import { DEFAULT_PROJECT_DECK_ID } from '../deck/newProjectDeck';

type BuilderTerminalCard = {
  id: string;
  title: string;
  runtime: {
    kind: string;
    profile?: string;
  };
};

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
  return (
    <div data-testid="large-surface-chat" style={{ height: '100%' }}>
      <SharedChatTerminalSplit
        storageKey={`liquidaity.main.agent-builder.split.v1:${activeProject}`}
        chat={(
          <div style={{ height: '100%', minHeight: 0 }}>
            <SharedCardChat {...sharedChatProps} />
          </div>
        )}
        terminal={builderCard?.runtime.kind === 'hermes' && canvasProjectId ? (
          <div
            data-testid="under-chat-card-work-surface"
            data-card-id={builderCard.id}
            style={{ height: '100%', minHeight: 0 }}
          >
            <CardTerminalPanel
              key={`${canvasProjectId}:${builderCard.id}:${builderCard.runtime.profile}`}
              identity={{
                projectId: canvasProjectId,
                deckId: DEFAULT_PROJECT_DECK_ID,
                cardId: builderCard.id,
                conversationId,
              }}
            />
          </div>
        ) : null}
        workSurfaceLabel={builderCard?.title || 'Builder'}
      />
    </div>
  );
}
