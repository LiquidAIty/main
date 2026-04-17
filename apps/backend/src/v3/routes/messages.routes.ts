// @graph entity: PlanRoute
// @graph role: planning-entrypoint
// @graph relates_to: PlanWiki, ThinkGraph
// @graph depends_on: Express, PlanWiki
// @graph feeds_to: PlanWiki
import { Router } from 'express';
import { saveMessage, getMessages, savePlanWiki, getPlanWiki } from '../messages/store';

const router = Router();

router.get('/:projectId/messages', async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit || '100'), 10);
    const messages = await getMessages(req.params.projectId, limit);
    return res.json({ ok: true, messages });
  } catch (err: any) {
    console.error('[MESSAGES] get failed:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'messages_get_failed' });
  }
});

router.post('/:projectId/messages', async (req, res) => {
  const { role, text, turnId } = req.body || {};
  
  if (!role || !text) {
    return res.status(400).json({ ok: false, error: 'role and text required' });
  }
  
  if (role !== 'user' && role !== 'assistant') {
    return res.status(400).json({ ok: false, error: 'role must be user or assistant' });
  }

  try {
    const message = await saveMessage(req.params.projectId, role, text, turnId || null);
    return res.json({ ok: true, message });
  } catch (err: any) {
    console.error('[MESSAGES] save failed:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'message_save_failed' });
  }
});

router.get('/:projectId/plan', async (req, res) => {
  try {
    const plan = await getPlanWiki(req.params.projectId);
    return res.json({ ok: true, plan });
  } catch (err: any) {
    console.error('[PLAN] get failed:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'plan_get_failed' });
  }
});

router.put('/:projectId/plan', async (req, res) => {
  const { anchor, whatChanged, openQuestions, sources, deltaSummary, status, turnId, lastUserMessage } = req.body || {};
  
  if (!anchor) {
    return res.status(400).json({ ok: false, error: 'anchor required' });
  }

  try {
    const plan = await savePlanWiki(req.params.projectId, {
      anchor: anchor || '',
      whatChanged: Array.isArray(whatChanged) ? whatChanged : [],
      openQuestions: Array.isArray(openQuestions) ? openQuestions : [],
      sources: Array.isArray(sources) ? sources : [],
      deltaSummary: deltaSummary || '',
      status: status || 'draft',
      turnId: turnId || null,
      lastUserMessage: lastUserMessage || '',
    });
    return res.json({ ok: true, plan });
  } catch (err: any) {
    console.error('[PLAN] save failed:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'plan_save_failed' });
  }
});

export default router;
