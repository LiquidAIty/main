import { randomUUID } from 'node:crypto';

import { hermesGateway } from './hermesGateway';
import { internalMcpAuthorization, resolveInternalMcpUrl } from './mcp/internalMcpAuth';
import { requestPythonRailsJson } from './pythonRailsClient';
import {
  exactStrings,
  objectRecord,
  requireSavedSpecialistRuntime,
  sharedChatAuthority,
} from './savedCardAuthority';
import { cardSession, type SessionBinding } from './hermesCardSession';
import {
  failAcceptedSavedCardRun,
  finishSavedCardRun,
  hermesCallbackToolNames,
  hermesCardScriptDefinition,
  hermesDynamicToolDefinitions,
  prepareSavedCardRun,
  submitHermesTurn,
  type PreparedCardRun,
} from './savedCardRun';
import {
  publishThinkGraphRevisionEvent,
  type ThinkGraphCompletedPairFailure,
} from './thinkGraphRevisionEvents';

function thinkGraphCardAssignment(preparation: Record<string, any>): string {
  const schema = objectRecord(preparation.enrichmentSchema);
  const prompt = String(preparation.enrichmentPrompt || '').trim();
  const input = objectRecord(preparation.enrichmentInput);
  if (!Object.keys(schema).length || !prompt || !Object.keys(input).length) {
    throw new Error('thinkgraph_prepare_extraction_contract_invalid');
  }
  return [
    'Run the supplied Engraphis structured extraction contract for this completed User/Main pair.',
    'Use the saved ThinkGraph Card instructions and configured model. Do not call tools.',
    'Return only one JSON object that validates against OUTPUT_SCHEMA. Do not wrap it in prose.',
    '',
    'OUTPUT_SCHEMA:',
    JSON.stringify(schema),
    '',
    'EXTRACTION_PROMPT:',
    prompt,
    '',
    'EXTRACTION_INPUT:',
    JSON.stringify(input),
  ].join('\n');
}

export async function processCompletedMainPairWithThinkGraph(args: {
  userId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  mainCardId: string;
  originatingRunId: string;
  mainHermesSessionId: string;
  userMessage: string;
  mainResponse: string;
}): Promise<void> {
  let stage: ThinkGraphCompletedPairFailure['stage'] = 'prepare';
  const completedPair = {
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    runId: args.originatingRunId,
    cardId: args.mainCardId,
    hermesSessionId: args.mainHermesSessionId,
    completedAt: new Date().toISOString(),
    userMessage: args.userMessage,
    mainResponse: args.mainResponse,
  };
  const childRunId = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  let childAccepted = false;
  let childSettlementAttempted = false;
  let childRun: PreparedCardRun | null = null;
  let binding: SessionBinding | null = null;
  try {
    const preparation = objectRecord(await requestPythonRailsJson(
      '/thinkgraph/completed-pair/prepare',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(completedPair),
      },
    ));
    if (
      preparation.revisionChanged !== false
      || !String(preparation.preparation?.status || '').trim()
    ) {
      throw new Error('thinkgraph_prepare_mutated_graph');
    }
    if (
      preparation.structuredExtractionRequired === false
      && preparation.intakeOperation === 'noop'
    ) return;
    if (
      preparation.structuredExtractionRequired !== true
      || preparation.intakeOperation !== 'pending'
      || String(preparation.pairReference || '') === ''
    ) {
      throw new Error('thinkgraph_prepare_intake_contract_invalid');
    }

    stage = 'thinkgraph_card';
    const authority = await sharedChatAuthority(args.projectId, args.deckId);
    if (authority.main.card.id !== args.mainCardId) {
      throw new Error('thinkgraph_originating_main_identity_changed');
    }
    const targets = authority.cards.filter(
      (card) => card.card.id === 'card_thinkgraph',
    );
    if (targets.length !== 1) throw new Error(
      targets.length ? 'thinkgraph_saved_card_ambiguous' : 'thinkgraph_saved_card_unavailable',
    );
    const target = targets[0];
    requireSavedSpecialistRuntime(target);
    childRun = await prepareSavedCardRun({
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      message: thinkGraphCardAssignment(preparation),
      target,
      main: authority.main,
      priorMessages: [],
      dataAnchors: [],
      images: [],
      runId: childRunId,
      originatingRunId: args.originatingRunId,
      senderCardId: args.mainCardId,
      onAccepted: () => { childAccepted = true; },
    });
    const client = await hermesGateway();
    binding = await cardSession(client, target, {
      userId: args.userId,
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
    });
    const dynamicTools = hermesDynamicToolDefinitions(childRun.request.toolDefinitions);
    const cardScript = hermesCardScriptDefinition(childRun.request);
    const toolAuthorization = internalMcpAuthorization({
      kind: 'card-runtime',
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      parentRunId: childRunId,
      callerCardId: target.card.id,
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: exactStrings(childRun.request.enabledTools),
      presentedTools: hermesCallbackToolNames(dynamicTools, cardScript),
    });
    const result = await submitHermesTurn({
      client,
      binding,
      profile: target.profile,
      runRequest: childRun.request,
      text: String(childRun.request.message),
      submissionId: childRunId,
      dynamicTools,
      cardScript,
      toolEndpoint: resolveInternalMcpUrl(),
      toolAuthorization,
      onEvent: () => undefined,
    });
    if (!result.text.trim()) throw new Error('thinkgraph_card_empty_response');
    childSettlementAttempted = true;
    await finishSavedCardRun({ run: childRun, binding, result });

    stage = 'settle';
    const settled = objectRecord(await requestPythonRailsJson(
      '/thinkgraph/completed-pair/settle',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...completedPair,
          pairReference: String(preparation.pairReference),
          structuredOutput: result.text,
          cardRun: {
            runId: childRunId,
            cardId: target.card.id,
            revisionId: target.cardRevisionId,
            profile: target.profile,
            hermesSessionId: binding.sessionId,
            resolvedProvider: String(binding.info.provider || ''),
            resolvedModel: String(binding.info.model || ''),
          },
        }),
      },
    ));
    if (settled.revisionChanged === true) {
      publishThinkGraphRevisionEvent('thinkgraph_revision', {
        projectId: args.projectId,
        deckId: args.deckId,
        conversationId: args.conversationId,
        originatingRunId: args.originatingRunId,
        stage: 'settled',
        revision: String(settled.revision || ''),
        changedNodeIds: exactStrings(settled.changedNodeIds),
        changedEdgeIds: exactStrings(settled.changedEdgeIds),
        affectedNodeIds: exactStrings(settled.affectedNodeIds),
      });
    }
  } catch (error) {
    if (childAccepted && !childSettlementAttempted) {
      childSettlementAttempted = true;
      if (childRun && binding) {
        await finishSavedCardRun({ run: childRun, binding, error }).catch(() => undefined);
      } else {
        await failAcceptedSavedCardRun(childRunId, error, binding).catch(() => undefined);
      }
    }
    publishThinkGraphRevisionEvent('thinkgraph_error', {
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      originatingRunId: args.originatingRunId,
      stage,
      error: error instanceof Error ? error.message : 'thinkgraph_completed_pair_failed',
    });
  }
}
