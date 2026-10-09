import { DEFAULT_PROJECT_DECK_ID } from '../deck/newProjectDeck';

export type BuilderTerminalCard = {
  id: string;
  title: string;
  runtime: {
    kind: string;
    profile?: string;
  };
};

export function builderTerminalBinding({
  canvasProjectId,
  conversationId,
  builderCard,
}: {
  canvasProjectId: string | null;
  conversationId: string;
  builderCard: BuilderTerminalCard | null | undefined;
}) {
  if (builderCard?.runtime.kind !== 'hermes' || !canvasProjectId) return null;
  return {
    key: `${canvasProjectId}:${builderCard.id}:${builderCard.runtime.profile}`,
    cardId: builderCard.id,
    identity: {
      projectId: canvasProjectId,
      deckId: DEFAULT_PROJECT_DECK_ID,
      cardId: builderCard.id,
      conversationId,
    },
  };
}
