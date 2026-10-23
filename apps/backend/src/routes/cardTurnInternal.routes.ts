// Entity: Card Invocation
// Relationship: This file provides the process-authenticated preparation bridge for one exact non-Magnetic saved Card, model, profile, Script, and presented-tool contract.
// Entity: Run Ledger
// Relationship: This file verifies the exact pending or running Run identity before applying start or terminal settlement and bounded Hermes usage.

import { Router, type Request } from 'express';

import { hermesProfileModelSelection } from '../hermes/profileMaterialization';
import {
  finishCardRun,
  hermesUsageFields,
  prepareCardRun,
  readCardRun,
  startCardRun,
} from '../services/cardRunLifecycle';
import { internalMcpProcessSecretAuthorized } from '../services/mcp/internalMcpAuth';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import {
  projectCardAuthority,
  type ProjectCardBinding,
  type ProjectCardAuthority,
} from '../services/projectCardAuthority';

const router = Router();

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function exactStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
}

function processAuthorized(req: Request): boolean {
  return internalMcpProcessSecretAuthorized(req.headers['x-liquidaity-internal-mcp-secret']);
}

function exactTarget(
  authority: ProjectCardAuthority,
  cardId: string,
  profile: string,
): ProjectCardBinding {
  const matches = authority.cards.filter((candidate) => (
    candidate.card.id === cardId
    && candidate.profile.toLowerCase() === profile.toLowerCase()
    && candidate.card.runtime.kind === 'hermes'
  ));
  if (matches.length !== 1) throw new Error('card_turn_target_unavailable');
  return matches[0];
}

router.post('/', async (req, res) => {
  if (!processAuthorized(req)) {
    return res.status(403).json({ ok: false, error: 'internal_card_turn_authorization_required' });
  }
  const action = String(req.body?.action || '').trim();
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  const cardId = String(req.body?.cardId || '').trim();
  const profile = String(req.body?.profile || '').trim();
  if (!projectId || !deckId || !conversationId || !cardId || !profile) {
    return res.status(400).json({ ok: false, error: 'card_turn_context_required' });
  }
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    const target = exactTarget(authority, cardId, profile);
    const senderProfile = String(req.body?.senderProfile || '').trim().toLowerCase();
    const senderMatches = senderProfile
      ? authority.cards.filter((candidate) => candidate.profile.toLowerCase() === senderProfile)
      : [];
    if (senderProfile && senderMatches.length !== 1) throw new Error('card_turn_sender_unavailable');
    if (action === 'start_magnetic') {
      if (
        target.card.runtime.mode !== 'magentic_one'
        || senderMatches.length !== 1
        || senderMatches[0].card.id !== authority.main.card.id
      ) throw new Error('magnetic_bot_delivery_unauthorized');
      const runId = String(req.body?.runId || '').trim();
      const originatingRunId = String(req.body?.originatingRunId || '').trim();
      const message = String(req.body?.message || '').trim();
      const notification = record(req.body?.notification);
      if (!runId || !originatingRunId || !message || !Object.keys(notification).length) {
        throw new Error('magnetic_bot_delivery_incomplete');
      }
      await readCardRun({
        projectId,
        deckId,
        runId: originatingRunId,
        cardId: senderMatches[0].card.id,
        profile: senderMatches[0].profile,
      });
      const started = record(await requestPythonRailsJson('/magnetic/taskgraph/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          deckId,
          conversationId,
          callerCardId: senderMatches[0].card.id,
          originatingRunId,
          runId,
          input: message,
          dataAnchors: [],
          notification,
        }),
      }, { timeoutMs: 180_000 }));
      if (
        started.ok !== true
        || String(started.runId || '') !== runId
        || !String(started.hermesRootId || '').trim()
      ) throw new Error(String(started.error || 'magnetic_bot_delivery_start_failed'));
      return res.json(started);
    }
    if (target.card.runtime.mode === 'magentic_one') {
      throw new Error('card_turn_target_unavailable');
    }
    if (action === 'prepare') {
      const originatingRunId = String(req.body?.originatingRunId || '').trim();
      if (originatingRunId) {
        const parentCard = senderMatches[0] || target;
        await readCardRun({
          projectId,
          deckId,
          runId: originatingRunId,
          cardId: parentCard.card.id,
          profile: parentCard.profile,
        });
      }
      const run = await prepareCardRun({
        projectId,
        deckId,
        conversationId,
        message: String(req.body?.message || ''),
        target,
        dataAnchors: [],
        images: Array.isArray(req.body?.images) ? req.body.images : [],
        runId: String(req.body?.runId || ''),
        senderCardId: senderMatches[0]?.card.id,
        originatingRunId,
      });
      const runtimeOptions = record(run.request.runtimeOptions);
      const scriptPresentation = record(run.request.scriptPresentation);
      const cardScript = scriptPresentation.mode === 'script'
        ? record(run.request.cardScript)
        : null;
      if (scriptPresentation.mode === 'script' && !Object.keys(cardScript || {}).length) {
        throw new Error('card_script_runtime_contract_missing');
      }
      const model = hermesProfileModelSelection(record(run.request.provider));
      return res.json({
        ok: true,
        runId: run.runId,
        cardId,
        profile,
        message: String(run.request.message || ''),
        model,
        cardScript,
        mcpToolSelection: runtimeOptions.autoTools === true || scriptPresentation.mode === 'script'
          ? { liquidaity: exactStrings(run.request.presentedTools) }
          : null,
      });
    }
    const runId = String(req.body?.runId || '').trim();
    if (!runId) throw new Error('run_id_required');
    if (action === 'start') {
      const run = await readCardRun({ projectId, deckId, runId, cardId, profile });
      if (String(run.state || '') !== 'pending') throw new Error('card_turn_run_not_pending');
      await startCardRun({
        runId,
        submissionId: String(req.body?.submissionId || runId),
        hermesSessionRef: String(req.body?.hermesSessionRef || ''),
      });
      return res.json({ ok: true, runId, state: 'running' });
    }
    if (action === 'finish') {
      const run = await readCardRun({ projectId, deckId, runId, cardId, profile });
      if (String(run.state || '') !== 'running') throw new Error('card_turn_run_not_running');
      const state = String(req.body?.state || '').trim();
      const provider = String(req.body?.provider || '').trim();
      const model = String(req.body?.model || '').trim();
      await finishCardRun({
        runId,
        state,
        finalResult: req.body?.finalResult,
        errorCode: req.body?.errorCode,
        errorSummary: req.body?.errorSummary,
        hermesSessionRef: String(req.body?.hermesSessionRef || ''),
        providerTurnRef: String(req.body?.providerTurnRef || runId),
        effectiveProvider: provider,
        provider,
        model,
        toolCallCount: Number.isFinite(req.body?.toolCallCount)
          ? Number(req.body.toolCallCount)
          : undefined,
        ...hermesUsageFields(req.body?.usage),
      });
      return res.json({ ok: true, runId, state });
    }
    return res.status(400).json({ ok: false, error: 'card_turn_action_unsupported' });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_turn_failed',
    });
  }
});

export default router;
