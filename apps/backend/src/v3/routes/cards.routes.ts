import { Router } from 'express';
import { resolveEffectiveAgent, runCardWithContract } from '../cards/runtime';
import type { AgentCardInstance, AgentTemplate, PromptTemplate } from '../types';

const router = Router();

router.post('/:projectId/cards/run', async (req, res) => {
  const { card, templates, promptTemplates, input } = req.body || {};
  if (!card || typeof card !== 'object') {
    return res.status(400).json({ ok: false, error: 'card_required' });
  }
  if (!Array.isArray(templates) || templates.length === 0) {
    return res.status(400).json({ ok: false, error: 'templates_required' });
  }

  try {
    const typedCard = card as AgentCardInstance;
    const typedTemplates = templates as AgentTemplate[];
    const typedPromptTemplates = Array.isArray(promptTemplates)
      ? (promptTemplates as PromptTemplate[])
      : [];
    const effectiveAgent = resolveEffectiveAgent(typedCard, typedTemplates);

    if (!effectiveAgent) {
      return res.status(400).json({ ok: false, error: 'template_not_found' });
    }

    const result = await runCardWithContract(typedCard, effectiveAgent, String(input || ''), {
      userInput: String(input || ''),
      promptTemplates: typedPromptTemplates,
    });

    return res.json({ ok: true, result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'card_run_failed' });
  }
});

export default router;
