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

    const magenticCards = (document.nodes || []).filter((n: any) => n.runtimeType === 'magentic_one');
    const mainMagenticCard = magenticCards[0];

    console.log('[DEBUG-TRACE] executeDeck selected cards:', magenticCards.map((c:any) => c.id));
    console.log('[DEBUG-TRACE] execution method: direct Magentic-One run (ExecutionChain is deleted)');
    console.log('[DEBUG-TRACE] is looping all cards?:', false);
    console.log('[DEBUG-TRACE] are disconnected cards passed to context.allCards?:', true);
    console.log('[DEBUG-TRACE] exact card passed forward:', mainMagenticCard?.id);

    if (!mainMagenticCard) {
      throw new Error('deck_run_no_orchestrator_card');
    }

    if (mainMagenticCard) {
      emitEvent({
        kind: 'step_started',
        cardId: mainMagenticCard.id,
        text: `Starting orchestrator (${mainMagenticCard.title || mainMagenticCard.id})...`,
        progressText: `Starting AutoGen...`
      });

      const result = await runCardWithContract(mainMagenticCard, {}, options.input || '', {
        deckId: document.id,
        projectId: options.projectId,
        allCards: document.nodes, 
        allEdges: document.edges,
        allTemplates: templates,
        previousOutput: options.input || '',
        workspaceObjectContext: options.workspaceObjectContext,
      });

      cardResults[mainMagenticCard.id] = result;
      steps.push({
        id: `step_${steps.length + 1}`,
        executionId: `${mainMagenticCard.id}::single`,
        cardId: mainMagenticCard.id,
        templateId: mainMagenticCard.templateId,
        title: mainMagenticCard.title,
        input: options.input || '',
        runtimeType: mainMagenticCard.runtimeType,
        output: result.output,
        status: result.status,
        error: result.error,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        // Carry the real Magentic-One Task Ledger / Progress Ledger to the

        // reads step.magenticTrace.plan). Never fabricated here.
        magenticTrace: result.magenticTrace ?? null,
      });

      emitEvent({
        kind: result.status === 'error' ? 'step_failed' : 'step_completed',
        cardId: mainMagenticCard.id,
        text: result.status === 'error' ? `Orchestrator failed.` : `Orchestrator completed.`,
        progressText: result.status === 'error' ? 'Failed.' : 'Completed.',
        outputSummary: result.output,
        error: result.error
      });
    }

    const mainResult = cardResults[mainMagenticCard.id];

    if (!mainResult || mainResult.status === 'error') {
      const errorReason = mainResult?.error || 'card_run_failed';
      emitEvent({
        kind: 'run_failed',
        text: 'Deck run failed.',
        status: 'error',
        error: errorReason
      });
      return {
        id: runId,
        deckId: document.id,
        input: options.input || '',
        status: 'error',
        startedAt,
        endedAt: new Date().toISOString(),
        cardResults,
        error: errorReason,
        steps,
        events,
        mission: {
          missionStatus: 'failed',
          agentRunStatus: 'failed',
          resultSummary: null,
          needsUserInputReason: null,
          errorReason,
          missionRunId: options.missionRunId || null,
          missionAgentRunId: options.missionAgentRunId || null,
        }
      };
    }

    // An artifact-bearing Magentic-One run may have empty chat output: the run is
    // still a success when it carries the real Task Ledger artifact in
    // magenticTrace. Only a fully empty result (no output AND no artifact) fails.
    const finalOutput = mainResult.output;
    const hasTaskLedgerArtifact = Boolean(
      (mainResult as any)?.magenticTrace?.plan?.taskLedgerArtifact,
    );
    if (!finalOutput && !hasTaskLedgerArtifact) {
      throw new Error('deck_run_missing_final_output');
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
      finalOutput: finalOutput || '',
      steps,
      events,
      mission: {
        missionStatus: 'complete',
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
