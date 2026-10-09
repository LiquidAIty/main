import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { getInternalProjectById } from '../services/projectStore';
import { hermesGateway, type HermesGatewayClient, type HermesGatewayEvent } from '../services/hermesGateway';
import { internalMcpAuthorization, internalMcpProcessSecretAuthorized, resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { isLoopbackSocketRequest } from '../security/requestAccess';
import { exactStrings, objectRecord, requireSavedSpecialistRuntime, sharedChatAuthority, type AddressableCard, type SavedSpecialistOperation, type SharedChatAuthority } from '../services/savedCardAuthority';
import { cardSession, type SessionBinding } from '../services/hermesCardSession';
import { failAcceptedSavedCardRun, finishSavedCardRun, hermesCallbackToolNames, hermesCardScriptDefinition, hermesDynamicToolDefinitions, interruptHermesSubmission, prepareSavedCardRun, submitHermesTurn, type PreparedCardRun } from '../services/savedCardRun';

const SPECIALIST_TARGETS: Record<SavedSpecialistOperation, string> = {
  'thinkgraph.reason': 'card_thinkgraph',
  'knowgraph.research': 'card_knowgraph',
};

export async function savedSpecialistRun(req: Request, res: Response) {
    if (!isLoopbackSocketRequest(req)
      || !internalMcpProcessSecretAuthorized(req.headers['x-liquidaity-internal-mcp-secret'])) {
      return res.status(403).json({ ok: false, error: 'saved_specialist_authorization_required' });
    }
    const body = objectRecord(req.body);
    const operation = String(body.operation || '') as SavedSpecialistOperation;
    const request = String(body.request || '');
    const projectId = String(body.projectId || '').trim();
    const deckId = String(body.deckId || '').trim();
    const conversationId = String(body.conversationId || '').trim();
    const sourceCardId = String(body.sourceCardId || '').trim();
    const sourceRunId = String(body.sourceRunId || '').trim();
    const dataAnchors = body.dataAnchors === undefined ? [] : body.dataAnchors;
    const allowedKeys = new Set([
      'operation', 'request', 'dataAnchors', 'projectId', 'deckId',
      'conversationId', 'sourceCardId', 'sourceRunId',
    ]);
    if (
      !(operation in SPECIALIST_TARGETS)
      || !request.trim()
      || request.length > 20_000
      || !projectId
      || !deckId
      || !conversationId
      || !sourceCardId
      || !sourceRunId
      || !Array.isArray(dataAnchors)
      || dataAnchors.length > 16
      || dataAnchors.some((value) => !Object.keys(objectRecord(value)).length)
      || Object.keys(body).some((key) => !allowedKeys.has(key))
    ) {
      return res.status(400).json({ ok: false, error: 'saved_specialist_request_invalid' });
    }

    let authority: SharedChatAuthority;
    let source: AddressableCard;
    let target: AddressableCard;
    let ownerUserId: string;
    try {
      const project = await getInternalProjectById(projectId);
      ownerUserId = String(project?.ownerUserId || '').trim();
      if (!ownerUserId) throw new Error('saved_specialist_project_unavailable');
      authority = await sharedChatAuthority(projectId, deckId);
      const sources = authority.cards.filter((card) => card.card.id === sourceCardId);
      const targets = authority.cards.filter(
        (card) => card.card.id === SPECIALIST_TARGETS[operation],
      );
      if (sources.length !== 1) throw new Error('saved_specialist_source_card_unavailable');
      if (targets.length !== 1) throw new Error('saved_specialist_target_card_unavailable');
      source = sources[0];
      target = targets[0];
      if (source.card.id === target.card.id) throw new Error('saved_specialist_self_call_rejected');
      requireSavedSpecialistRuntime(target);
      const sourceRead = objectRecord(await requestPythonRailsJson('/domain/runs/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          deckId,
          conversationId,
          runId: sourceRunId,
        }),
      }));
      const sourceRun = objectRecord(sourceRead.run);
      if (
        String(sourceRun.runId || '') !== sourceRunId
        || String(sourceRun.projectId || '') !== projectId
        || String(sourceRun.deckId || '') !== deckId
        || String(sourceRun.conversationId || '') !== conversationId
        || String(sourceRun.cardId || '') !== sourceCardId
        || String(sourceRun.state || '') !== 'running'
      ) {
        throw new Error('saved_specialist_source_run_unavailable');
      }
    } catch (error) {
      return res.status(409).json({
        ok: false,
        error: error instanceof Error ? error.message : 'saved_specialist_authority_unavailable',
      });
    }

    const childRunId = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const abortController = new AbortController();
    let client: HermesGatewayClient | null = null;
    let binding: SessionBinding | null = null;
    let run: PreparedCardRun | null = null;
    let runAccepted = false;
    let settlementAttempted = false;
    let submissionIssued = false;
    let interruptPromise: Promise<void> | null = null;
    let responseFinished = false;
    const interruptTarget = (): Promise<void> => {
      if (!client || !binding || !submissionIssued) return Promise.resolve();
      if (!interruptPromise) {
        interruptPromise = interruptHermesSubmission(client, binding, childRunId);
      }
      return interruptPromise;
    };
    const abortRequest = () => {
      if (!responseFinished && !res.writableEnded) {
        abortController.abort();
      }
    };
    req.once('aborted', abortRequest);
    res.once('close', abortRequest);

    const settle = async (
      result?: { text: string; event: HermesGatewayEvent; toolCalls: number },
      error?: unknown,
    ): Promise<void> => {
      if (!runAccepted || settlementAttempted) return;
      settlementAttempted = true;
      if (run && binding) {
        try {
          await finishSavedCardRun({ run, binding, result, error });
        } catch (settlementError) {
          await failAcceptedSavedCardRun(childRunId, settlementError);
          throw settlementError;
        }
      } else {
        await failAcceptedSavedCardRun(childRunId, error || new Error('saved_specialist_preparation_failed'), binding);
      }
    };

    try {
      run = await prepareSavedCardRun({
        projectId,
        deckId,
        conversationId,
        message: request,
        target,
        main: authority.main,
        priorMessages: [],
        dataAnchors,
        images: [],
        runId: childRunId,
        originatingRunId: sourceRunId,
        onAccepted: () => { runAccepted = true; },
      });
      if (abortController.signal.aborted) throw new Error('saved_specialist_cancelled');
      client = await hermesGateway();
      binding = await cardSession(client, target, {
        userId: ownerUserId,
        projectId,
        deckId,
        conversationId,
      });
      if (abortController.signal.aborted) throw new Error('saved_specialist_cancelled');
      const dynamicTools = hermesDynamicToolDefinitions(run.request.toolDefinitions);
      const cardScript = hermesCardScriptDefinition(run.request);
      const runtime = objectRecord(run.request.runtime);
      if (runtime.kind !== 'hermes' || runtime.mode !== 'delegate') {
        throw new Error('saved_specialist_runtime_identity_mismatch');
      }
      const toolAuthorization = internalMcpAuthorization({
        kind: 'card-runtime',
        projectId,
        deckId,
        conversationId,
        parentRunId: childRunId,
        callerCardId: target.card.id,
        callerRuntimeKind: 'hermes',
        callerRuntimeMode: 'delegate',
        grantedTools: exactStrings(run.request.enabledTools),
        presentedTools: hermesCallbackToolNames(dynamicTools, cardScript),
      });
      const result = await submitHermesTurn({
        client,
        binding,
        profile: target.profile,
        runRequest: run.request,
        text: String(run.request.message),
        submissionId: childRunId,
        dynamicTools,
        cardScript,
        toolEndpoint: resolveInternalMcpUrl(),
        toolAuthorization,
        signal: abortController.signal,
        interrupt: interruptTarget,
        onSubmissionIssued: () => { submissionIssued = true; },
        onEvent: () => undefined,
      });
      if (!result.text.trim()) throw new Error('hermes_empty_response');
      await settle(result);
      responseFinished = true;
      return res.json({
        ok: true,
        status: 'completed',
        operation,
        targetCardId: target.card.id,
        targetRunId: childRunId,
        targetCardRevisionId: target.cardRevisionId,
        result: result.text,
      });
    } catch (caught) {
      let error: unknown = caught;
      try {
        await settle(undefined, caught);
      } catch (settlementError) {
        error = settlementError;
      }
      if (!res.destroyed && !res.writableEnded) {
        responseFinished = true;
        return res.status(502).json({
          ok: false,
          status: 'failed',
          operation,
          targetCardId: target.card.id,
          targetRunId: childRunId,
          error: error instanceof Error ? error.message : 'saved_specialist_execution_failed',
        });
      }
      return undefined;
    } finally {
      responseFinished = true;
      req.off('aborted', abortRequest);
      res.off('close', abortRequest);
    }
}
