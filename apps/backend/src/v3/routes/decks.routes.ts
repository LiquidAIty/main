import { Router } from 'express';
import { getDeckDocument, saveDeckDocument, saveDeckRun } from '../decks/store';
import { executeDeck } from '../runtime/deckRuntime';
import type { AgentTemplate, DeckDocument, PromptTemplate } from '../types';

const router = Router();

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
  const { document } = req.body || {};
  if (!document || typeof document !== 'object') {
    return res.status(400).json({ ok: false, error: 'document_required' });
  }

  try {
    const deck = await saveDeckDocument(
      req.params.projectId,
      req.params.deckId,
      document as DeckDocument,
    );
    return res.json({ ok: true, deck });
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
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

  if (!deckId) {
    return res.status(400).json({ ok: false, error: 'deck_id_required' });
  }
  if (templates.length === 0) {
    return res.status(400).json({ ok: false, error: 'templates_required' });
  }

  try {
    let deck: DeckDocument | null = null;

    if (req.body?.document && typeof req.body.document === 'object') {
      deck = await saveDeckDocument(req.params.projectId, deckId, req.body.document as DeckDocument);
    } else {
      const loaded = await getDeckDocument(req.params.projectId, deckId);
      deck = loaded.deck;
    }

    if (!deck) {
      return res.status(404).json({ ok: false, error: 'deck_not_found' });
    }

    const run = await executeDeck(deck, templates, {
      input: String(req.body?.input || ''),
      promptTemplates: promptTemplates.length > 0 ? promptTemplates : deck.promptTemplates,
    });

    await saveDeckRun(req.params.projectId, deckId, run);
    return res.json({ ok: true, deck, run });
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_run_failed' });
  }
});

export default router;
