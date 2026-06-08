import { DeckExecutionOutput, CardRunResult } from '../contracts/runtimeContracts';
import { runCardWithContract } from '../cards/runtime';

export async function executeDeck(document: any, templates: any[], options: any = {}): Promise<DeckExecutionOutput> {
  const startedAt = new Date().toISOString();
  const runId = `deck_run_${Math.random().toString(36).substring(2, 10)}`;
  const cardResults: Record<string, CardRunResult> = {};
  const steps: any[] = [];
  const events: any[] = [];

  try {
    const emitEvent = (event: any) => {
      const fullEvent = {
        id: `evt_${Math.random().toString(36).substring(2, 10)}`,
        at: new Date().toISOString(),
        ...event
      };
      events.push(fullEvent);
      if (options.onRuntimeEvent) {
        options.onRuntimeEvent(fullEvent);
      }
    };

    emitEvent({
      kind: 'run_started',
      text: `Deck ${document.name || 'run'} started.`,
      status: 'running'
    });

    for (const card of document.nodes) {
      if (card.runtimeType === 'magentic_one') {
        emitEvent({
          kind: 'step_started',
          cardId: card.id,
          text: `Starting card ${card.title || card.id}...`,
          progressText: `Starting card ${card.title || card.id}...`
        });

        const result = await runCardWithContract(card, {}, options.input || '', {
          deckId: document.id,
          projectId: options.projectId,
          allCards: document.nodes,
          allEdges: document.edges,
          allTemplates: templates,
          previousOutput: options.input || ''
        });
        cardResults[card.id] = result;
        steps.push({
          id: `step_${steps.length + 1}`,
          executionId: `${card.id}::single`,
          cardId: card.id,
          templateId: card.templateId,
          title: card.title,
          input: options.input || '',
          runtimeType: card.runtimeType,
          output: result.output,
          status: result.status,
          error: result.error,
          startedAt: result.startedAt,
          endedAt: result.endedAt
        });

        emitEvent({
          kind: result.status === 'error' ? 'step_failed' : 'step_completed',
          cardId: card.id,
          text: result.status === 'error' ? `Card ${card.title || card.id} failed.` : `Card ${card.title || card.id} completed.`,
          progressText: result.status === 'error' ? 'Failed.' : 'Completed.',
          outputSummary: result.output,
          error: result.error
        });
      }
    }

    emitEvent({
      kind: 'run_completed',
      text: 'Deck run finished successfully.',
      status: 'success'
    });

    return {
      id: runId,
      deckId: document.id,
      input: options.input || '',
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      cardResults,
      finalOutput: Object.values(cardResults).pop()?.output || '',
      steps,
      events,
      mission: {
        missionStatus: 'running',
        agentRunStatus: 'complete',
        resultSummary: null,
        needsUserInputReason: null,
        errorReason: null,
        missionRunId: options.missionRunId || null,
        missionAgentRunId: options.missionAgentRunId || null,
      }
    };
  } catch (error: any) {
    return {
      id: runId,
      deckId: document.id,
      input: options.input || '',
      status: 'error',
      startedAt,
      endedAt: new Date().toISOString(),
      cardResults,
      error: error.message || 'Deck execution failed',
      steps,
      events,
      mission: {
        missionStatus: 'failed',
        agentRunStatus: 'failed',
        resultSummary: null,
        needsUserInputReason: null,
        errorReason: error.message || 'Deck execution failed',
        missionRunId: options.missionRunId || null,
        missionAgentRunId: options.missionAgentRunId || null,
      }
    };
  }
}
