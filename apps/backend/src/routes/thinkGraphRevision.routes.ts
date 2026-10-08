import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { getOwnedProjectByReference } from '../services/projectStore';
import { hermesGateway } from '../services/hermesGateway';
import { internalMcpAuthorization, resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import {
  exactStrings,
  objectRecord,
  requireSpecialistConfiguration,
  sharedChatAuthority,
  type AddressableCard,
  type SharedChatAuthority,
} from '../services/savedCardAuthority';
import { cardSession, type SessionBinding } from '../services/hermesCardSession';
import {
  failAcceptedSavedCardRun,
  finishSavedCardRun,
  hermesDynamicToolDefinitions,
  prepareSavedCardRun,
  submitHermesTurn,
  type PreparedCardRun,
} from '../services/savedCardRun';

export const thinkGraphRevisionRoutes = Router();

async function authorizeProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<string | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'main_owner_authentication_required' });
    return null;
  }
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'main_project_access_denied' });
    return null;
  }
  return userId;
}

type ThinkGraphRevisionEvent = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: 'settled';
  revision: string;
  changedNodeIds: string[];
  changedEdgeIds: string[];
  affectedNodeIds: string[];
  newMainSubjects: Array<Record<string, unknown>>;
};

type ThinkGraphLifecycleFailure = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: 'prepare' | 'thinkgraph_card' | 'settle';
  error: string;
};


const thinkGraphStreams = new Map<string, Set<Response>>();

function thinkGraphStreamKey(
  projectId: string,
  deckId: string,
  conversationId: string,
): string {
  return JSON.stringify([projectId, deckId, conversationId]);
}

function publishThinkGraphEvent(
  eventName: 'thinkgraph_revision' | 'thinkgraph_error',
  payload: ThinkGraphRevisionEvent | ThinkGraphLifecycleFailure,
): void {
  const key = thinkGraphStreamKey(
    payload.projectId,
    payload.deckId,
    payload.conversationId,
  );
  const listeners = thinkGraphStreams.get(key);
  if (!listeners?.size) return;
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of [...listeners]) {
    if (response.destroyed || response.writableEnded) {
      listeners.delete(response);
      continue;
    }
    response.write(frame);
  }
  if (!listeners.size) thinkGraphStreams.delete(key);
}

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

export async function runCompletedPairThinkGraphLifecycle(args: {
  userId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  authority: SharedChatAuthority;
  main: AddressableCard;
  originatingRunId: string;
  mainSessionId: string;
  userMessage: string;
  mainResponse: string;
}): Promise<void> {
  let stage: ThinkGraphLifecycleFailure['stage'] = 'prepare';
  const completedPair = {
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    runId: args.originatingRunId,
    cardId: args.main.card.id,
    hermesSessionId: args.mainSessionId,
    completedAt: new Date().toISOString(),
    userMessage: args.userMessage,
    mainResponse: args.mainResponse,
    mainSubjects: [],
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
    const targets = args.authority.cards.filter(
      (card) => card.card.id === 'card_thinkgraph',
    );
    if (targets.length !== 1) throw new Error(
      targets.length ? 'thinkgraph_saved_card_ambiguous' : 'thinkgraph_saved_card_unavailable',
    );
    const target = targets[0];
    requireSpecialistConfiguration('thinkgraph.reason', target);
    childRun = await prepareSavedCardRun({
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      message: thinkGraphCardAssignment(preparation),
      target,
      main: args.main,
      priorMessages: [],
      dataAnchors: [],
      images: [],
      runId: childRunId,
      originatingRunId: args.originatingRunId,
      senderCardId: args.main.card.id,
      onAccepted: () => { childAccepted = true; },
    });
    const client = await hermesGateway();
    binding = await cardSession(client, args.authority, target, {
      userId: args.userId,
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
    });
    const dynamicTools = hermesDynamicToolDefinitions(childRun.request.toolDefinitions);
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
      presentedTools: dynamicTools.map((tool) => tool.canonical_name),
    });
    const result = await submitHermesTurn({
      client,
      binding,
      profile: target.profile,
      text: String(childRun.request.message),
      submissionId: childRunId,
      dynamicTools,
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
            resolvedModel: String(
              binding.info.model
              || objectRecord(childRun.request.provider).providerModelId
              || '',
            ),
          },
        }),
      },
    ));
    if (settled.revisionChanged === true) {
      publishThinkGraphEvent('thinkgraph_revision', {
        projectId: args.projectId,
        deckId: args.deckId,
        conversationId: args.conversationId,
        originatingRunId: args.originatingRunId,
        stage: 'settled',
        revision: String(settled.revision || ''),
        changedNodeIds: exactStrings(settled.changedNodeIds),
        changedEdgeIds: exactStrings(settled.changedEdgeIds),
        affectedNodeIds: exactStrings(settled.affectedNodeIds),
        newMainSubjects: Array.isArray(settled.newMainSubjects)
          ? settled.newMainSubjects.map(objectRecord)
          : [],
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
    publishThinkGraphEvent('thinkgraph_error', {
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      originatingRunId: args.originatingRunId,
      stage,
      error: error instanceof Error ? error.message : 'thinkgraph_lifecycle_failed',
    });
  }
}


thinkGraphRevisionRoutes.get('/revisions', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || '').trim();
  if (!projectId || !deckId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'thinkgraph_stream_scope_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    await sharedChatAuthority(projectId, deckId);
  } catch {
    return res.status(409).json({ ok: false, error: 'thinkgraph_stream_deck_unavailable' });
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': ThinkGraph revisions connected\n\n');
  const key = thinkGraphStreamKey(projectId, deckId, conversationId);
  const listeners = thinkGraphStreams.get(key) || new Set<Response>();
  listeners.add(res);
  thinkGraphStreams.set(key, listeners);
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    listeners.delete(res);
    if (!listeners.size) thinkGraphStreams.delete(key);
  });
  return undefined;
});


export default thinkGraphRevisionRoutes;
