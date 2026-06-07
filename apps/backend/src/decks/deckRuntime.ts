import { DeckExecutionInput, DeckExecutionOutput, CardRunResult } from '../contracts/runtimeContracts';
import { runCardWithContract } from '../cards/runtime';

export async function executeDeck(input: DeckExecutionInput): Promise<DeckExecutionOutput> {
  const startedAt = new Date().toISOString();
  const cardResults: Record<string, CardRunResult> = {};

  try {
    for (const card of input.cards) {
      if (card.runtimeType === 'magentic_one') {
        const result = await runCardWithContract(card, {}, input.userInput, {
          deckId: input.deckId,
          allCards: input.cards,
          allEdges: input.edges,
          allTemplates: input.templates,
          previousOutput: input.userInput
        });
        cardResults[card.id] = result;
      }
    }

    return {
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      cardResults,
      finalOutput: Object.values(cardResults).pop()?.output || ''
    };
  } catch (error: any) {
    return {
      status: 'error',
      startedAt,
      endedAt: new Date().toISOString(),
      cardResults,
      error: error.message || 'Deck execution failed'
    };
  }
}
