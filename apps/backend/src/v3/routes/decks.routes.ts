import { Router, type Response } from 'express';
import { getDeckDocument, saveDeckDocument, saveDeckRun } from '../decks/store';
import { executeDeck } from '../runtime/deckRuntime';
import type { AgentTemplate, DeckDocument, PromptTemplate } from '../types';

const router = Router();

function writeStreamChunk(res: Response, chunk: unknown) {
  res.write(`${JSON.stringify(chunk)}\n`);
}

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
  if (!document || typeof document !== 'object') {
    return res.status(400).json({ ok: false, error: 'document_required' });
  }

  try {
    const result = await saveDeckDocument(
      req.params.projectId,
      req.params.deckId,
      document as DeckDocument,
      { expectedRevision: typeof expectedRevision === 'string' ? expectedRevision : null },
    );
    return res.json({ ok: true, deck: result.deck, meta: result.meta });
  } catch (err: any) {
    const status =
      err?.message === 'project_not_found'
        ? 404
        : err?.message === 'deck_conflict'
          ? 409
          : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_save_failed' });
  }
});

router.post('/:projectId/decks/run', async (req, res) => {
  const deckId = String(req.body?.deckId || req.body?.document?.id || '').trim();
  const templates = Array.isArray(req.body?.templates)
    ? (req.body.templates as AgentTemplate[])
    : [];
  const promptTemplates = Array.isArray(req.body?.promptTemplates)
    ? (req.body.promptTemplates as PromptTemplate[])
    : [];
  const useStream =
    String(req.query.stream || req.body?.stream || '').trim() === '1' ||
    req.body?.stream === true;

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

    if (useStream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
    }

    const run = await executeDeck(deck, templates, {
      input: String(req.body?.input || ''),
      promptTemplates: promptTemplates.length > 0 ? promptTemplates : deck.promptTemplates,
      projectId: req.params.projectId,
      onRuntimeEvent: useStream
        ? (event) => {
            writeStreamChunk(res, { kind: 'event', event });
          }
        : undefined,
    });

    const persistedRun = await saveDeckRun(req.params.projectId, deckId, run);
    const payload = {
      ok: true,
      deck,
      run,
      meta: persistedRun.meta || deckMeta,
    };
    if (useStream) {
      writeStreamChunk(res, { kind: 'result', ...payload });
      return res.end();
    }
    return res.json(payload);
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    if (useStream) {
      writeStreamChunk(res, { kind: 'error', error: err?.message || 'deck_run_failed' });
      return res.status(status).end();
    }
    return res.status(status).json({ ok: false, error: err?.message || 'deck_run_failed' });
  }
});

export default router;
