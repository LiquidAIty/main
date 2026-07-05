import { Router, type Response } from 'express';
import {
  deleteDeckDocument,
  getDeckDocument,
  getV3ProjectBlob,
  saveDeckDocument,
  saveDeckRun,
} from '../decks/store';
import { executeDeck } from '../decks/deckRuntime';
import { isSingleAssistRunDocument, runSingleAssistCardAsDeckRun } from '../cards/runtime';
import type {
  AgentTemplate,
  DeckDocument,
  DeckRun,
  DeckRunResponse,
  MissionAgentRunStatus,
  MissionRunStatus,
  MissionSpec,
  PromptTemplate,
} from '../types';

const router = Router();

function writeStreamChunk(res: Response, chunk: unknown) {
  res.write(`${JSON.stringify(chunk)}\n`);
}

router.get('/:projectId/decks', async (req, res) => {
  try {
    const blob = await getV3ProjectBlob(req.params.projectId);
    const decks = Object.keys(blob.decks).map((deckId) => ({
      id: deckId,
      name: blob.decks[deckId]?.name || deckId,
      meta: blob.meta.decks[deckId] || null,
      latestRunId: blob.deckRuns[deckId]?.[0]?.id || null,
    }));
    return res.json({ ok: true, decks });
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_list_failed' });
  }
});

router.post('/:projectId/decks', async (req, res) => {
  const document = req.body?.document;
  const requestedDeckId = String(req.body?.deckId || document?.id || '').trim();
  if (!document || typeof document !== 'object') {
    return res.status(400).json({ ok: false, error: 'document_required' });
  }
  if (!requestedDeckId) {
    return res.status(400).json({ ok: false, error: 'deck_id_required' });
  }

  try {
    const result = await saveDeckDocument(
      req.params.projectId,
      requestedDeckId,
      document as DeckDocument,
      { expectedRevision: typeof req.body?.expectedRevision === 'string' ? req.body.expectedRevision : null },
    );
    return res.json({ ok: true, deck: result.deck, meta: result.meta });
  } catch (err: any) {
    const status =
      err?.message === 'project_not_found'
        ? 404
        : err?.message === 'deck_conflict'
          ? 409
          : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_create_failed' });
  }
});

router.get('/:projectId/decks/:deckId', async (req, res) => {
  try {
    const result = await getDeckDocument(req.params.projectId, req.params.deckId);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_load_failed' });
  }
});

router.put('/:projectId/decks/:deckId', async (req, res) => {
  const { document, expectedRevision } = req.body || {};
  const integrity = req.body?.integrity && typeof req.body.integrity === 'object'
    ? req.body.integrity
    : null;
  if (!document || typeof document !== 'object') {
    return res.status(400).json({ ok: false, error: 'document_required' });
  }

  try {
    const result = await saveDeckDocument(
      req.params.projectId,
      req.params.deckId,
      document as DeckDocument,
      {
        expectedRevision: typeof expectedRevision === 'string' ? expectedRevision : null,
        reason: typeof integrity?.reason === 'string' ? integrity.reason : null,
        removedNodeIds: Array.isArray(integrity?.removedNodeIds)
          ? (integrity.removedNodeIds as string[])
          : [],
      },
    );
    return res.json({ ok: true, deck: result.deck, meta: result.meta });
  } catch (err: any) {
    const status =
      err?.message === 'project_not_found'
        ? 404
        : err?.message === 'deck_conflict'
          ? 409
          : String(err?.message || '').startsWith('deck_integrity_')
            ? 409
          : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_save_failed' });
  }
});

router.delete('/:projectId/decks/:deckId', async (req, res) => {
  try {
    const result = await deleteDeckDocument(req.params.projectId, req.params.deckId);
    if (!result.deleted) {
      return res.status(404).json({ ok: false, error: 'deck_not_found' });
    }
    return res.json({ ok: true, deleted: req.params.deckId });
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_delete_failed' });
  }
});

router.post('/:projectId/decks/:deckId/run', async (req, res) => {
  const deckId = String(req.params.deckId || req.body?.deckId || req.body?.document?.id || '').trim();
  const templates = Array.isArray(req.body?.templates)
    ? (req.body.templates as AgentTemplate[])
    : [];
  const promptTemplates = Array.isArray(req.body?.promptTemplates)
    ? (req.body.promptTemplates as PromptTemplate[])
    : [];
  const useStream =
    String(req.query.stream || req.body?.stream || '').trim() === '1' ||
    req.body?.stream === true;
  const missionSpec =
    req.body?.missionSpec && typeof req.body.missionSpec === 'object'
      ? (req.body.missionSpec as MissionSpec)
      : undefined;
  const missionRunId = String(req.body?.missionRunId || '').trim() || undefined;
  const missionAgentRunId = String(req.body?.missionAgentRunId || '').trim() || undefined;
  const baseMissionMeta = {
    missionRunId: missionRunId || null,
    missionAgentRunId: missionAgentRunId || null,
  };

  if (!deckId) {
    return res.status(400).json({ ok: false, error: 'deck_id_required' });
  }
  if (templates.length === 0) {
    return res.status(400).json({ ok: false, error: 'templates_required' });
  }

  try {
    let deck: DeckDocument | null = null;
    let deckMeta: {
      deckRevision: string | null;
      deckSavedAt: string | null;
    } | null = null;

    if (req.body?.document && typeof req.body.document === 'object') {
      const loaded = await getDeckDocument(req.params.projectId, deckId);
      deck = req.body.document as DeckDocument;
      deckMeta = loaded.meta;
    } else {
      const loaded = await getDeckDocument(req.params.projectId, deckId);
      deck = loaded.deck;
      deckMeta = loaded.meta;
    }

    if (!deck) {
      return res.status(404).json({ ok: false, error: 'deck_not_found' });
    }
    console.log('[DEBUG-TRACE] POST /run received deck:', deckId);
    console.log('[DEBUG-TRACE] user input:', req.body?.input);
    console.log('[DEBUG-TRACE] templates count:', templates.length);
    console.log('[DEBUG-TRACE] promptTemplates count:', promptTemplates.length);
    console.log('[DEBUG-TRACE] document node count:', deck?.nodes?.length);
    console.log('[DEBUG-TRACE] document edge count:', deck?.edges?.length);
    const bodyStr = JSON.stringify(req.body || {});
    console.log('[DEBUG-TRACE] Request body contains prompt?:', bodyStr.includes('prompt'));
    console.log('[DEBUG-TRACE] Request body contains promptPart?:', bodyStr.includes('promptPart'));
    console.log('[DEBUG-TRACE] Request body contains systemPrompt?:', bodyStr.includes('systemPrompt'));

    if (useStream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
    }

    // Single Assist: a posted selection with no Mag One orchestrator and exactly
    // one top-level card runs through the ONE canonical configured-card executor
    // (runConfiguredCard — the same core the MCP card.run_assistant_agent path
    // uses), never through the Mag One team runtime. Structural detection only;
    // runnability is enforced inside runConfiguredCard itself.
    const singleAssist = isSingleAssistRunDocument(deck);
    const run = (singleAssist.ok
      ? await runSingleAssistCardAsDeckRun({
          projectId: req.params.projectId,
          deckId,
          cardId: singleAssist.cardId,
          input: String(req.body?.input || ''),
        })
      : await executeDeck(deck, templates, {
          input: String(req.body?.input || ''),
          promptTemplates: promptTemplates.length > 0 ? promptTemplates : deck.promptTemplates,
          projectId: req.params.projectId,
          workspaceContext: req.body?.workspaceContext,
          workspaceObjectContext: req.body?.workspaceObjectContext,
          // Structured Run Task approval gate (no magic userText command).
          runApproved: req.body?.runApproved === true,
          missionSpec,
          missionRunId,
          missionAgentRunId,
          onRuntimeEvent: useStream
            ? (event: any) => {
                writeStreamChunk(res, { kind: 'event', event });
              }
            : undefined,
        })) as unknown as DeckRun;

    const persistedRun = await saveDeckRun(req.params.projectId, deckId, run);
    const missionStatus =
      (run.mission?.missionStatus ||
        (missionSpec?.runState as MissionRunStatus | undefined) ||
        null) as MissionRunStatus | null;
    const agentRunStatus =
      (run.mission?.agentRunStatus ||
        (run.status === 'success'
          ? 'complete'
          : run.status === 'running'
            ? 'running'
            : run.status === 'skipped'
              ? 'skipped'
              : 'failed')) as MissionAgentRunStatus;
    const payload: DeckRunResponse = {
      ok: true,
      deck,
      run,
      meta: persistedRun.meta || deckMeta,
      missionRunId: run.mission?.missionRunId || baseMissionMeta.missionRunId,
      missionAgentRunId: run.mission?.missionAgentRunId || baseMissionMeta.missionAgentRunId,
      missionStatus,
      agentRunStatus,
      resultSummary: run.mission?.resultSummary || null,
      needsUserInputReason: run.mission?.needsUserInputReason || null,
      errorReason: run.mission?.errorReason || null,
    };
    if (useStream) {
      writeStreamChunk(res, { kind: 'result', ...payload });
      return res.end();
    }
    return res.json(payload);
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    if (useStream) {
      writeStreamChunk(res, {
        kind: 'error',
        error: err?.message || 'deck_run_failed',
        ...baseMissionMeta,
        missionStatus: 'failed' as MissionRunStatus,
        agentRunStatus: 'failed' as MissionAgentRunStatus,
        errorReason: err?.message || 'deck_run_failed',
      });
      return res.status(status).end();
    }
    return res.status(status).json({
      ok: false,
      error: err?.message || 'deck_run_failed',
      ...baseMissionMeta,
      missionStatus: 'failed' as MissionRunStatus,
      agentRunStatus: 'failed' as MissionAgentRunStatus,
      errorReason: err?.message || 'deck_run_failed',
    } satisfies DeckRunResponse);
  }
});

export default router;
