import { Router } from 'express';
import { listConfiguredModelOptions } from '../llm/models.config';

const router = Router();

/**
 * GET /api/config/models
 * Return the configured provider/model registry for card selectors.
 */
router.get('/models', (_req, res) => {
  try {
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
    const models = listConfiguredModelOptions(openaiDefault);
    const optionsFor = (provider: 'openai' | 'openrouter') => models
      .filter((model) => model.provider === provider)
      .map((model) => ({
        key: model.key,
        label: model.label,
        id: model.providerModelId,
      }));

    return res.json({
      openai: { default: openaiDefault, options: optionsFor('openai') },
      openrouter: { options: optionsFor('openrouter') },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to list models',
    });
  }
});

export default router;
