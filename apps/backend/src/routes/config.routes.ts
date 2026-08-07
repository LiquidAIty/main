import { Router } from 'express';
import { MODEL_REGISTRY } from '../llm/models.config';

const router = Router();

/**
 * GET /api/config/models
 * Return the configured provider/model registry for card selectors.
 */
router.get('/models', (_req, res) => {
  try {
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
    const dedupe = (items: Array<{ key: string; label: string; id: string }>) => {
      const byKey = new Map<string, { key: string; label: string; id: string }>();
      for (const item of items) {
        const key = String(item.key || '').trim();
        if (key && !byKey.has(key)) byKey.set(key, item);
      }
      return [...byKey.values()];
    };

    const openaiModels = dedupe(
      Object.entries(MODEL_REGISTRY)
        .filter(([, model]) => model.provider === 'openai')
        .map(([key, model]) => ({ key, label: model.label, id: model.id })),
    );
    const openrouterModels = dedupe(
      Object.entries(MODEL_REGISTRY)
        .filter(([, model]) => model.provider === 'openrouter')
        .flatMap(([key, model]) => [
          { key, label: model.label, id: model.id },
          { key: model.id, label: `${model.label} (Direct ID)`, id: model.id },
        ]),
    );

    if (!openaiModels.some((model) => model.key === openaiDefault)) {
      openaiModels.unshift({
        key: openaiDefault,
        label: `${openaiDefault} (default)`,
        id: openaiDefault,
      });
    }

    return res.json({
      openai: { default: openaiDefault, options: openaiModels },
      openrouter: { options: openrouterModels },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to list models',
    });
  }
});

export default router;
