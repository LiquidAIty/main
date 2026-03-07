import { Router } from 'express';
import { MODEL_REGISTRY } from '../llm/models.config';

const router = Router();

/**
 * GET /api/config/models
 * Returns configured models from env and registry for frontend dropdowns
 */
router.get('/models', async (_req, res) => {
  try {
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5-nano';
    const dedupe = (items: Array<{ key: string; label: string; id: string }>) => {
      const out = new Map<string, { key: string; label: string; id: string }>();
      items.forEach((item) => {
        const key = String(item.key || '').trim();
        if (!key) return;
        if (!out.has(key)) {
          out.set(key, item);
        }
      });
      return Array.from(out.values());
    };
    
    // Extract all OpenAI models from registry
    const openaiModelsRaw = Object.entries(MODEL_REGISTRY)
      .filter(([_, m]) => m.provider === 'openai')
      .map(([key, m]) => ({ key, label: m.label, id: m.id }));
    
    // Extract OpenRouter models and expose provider model ids directly as selectable keys.
    const openrouterModelsRaw = Object.entries(MODEL_REGISTRY)
      .filter(([_, m]) => m.provider === 'openrouter')
      .flatMap(([key, m]) => ([
        { key, label: m.label, id: m.id },
        { key: m.id, label: `${m.label} (Direct ID)`, id: m.id },
      ]));
    const openaiModels = dedupe(openaiModelsRaw);
    const openrouterModels = dedupe(openrouterModelsRaw);
    
    // Ensure default is in options (even if not in registry)
    if (!openaiModels.find(m => m.key === openaiDefault)) {
      openaiModels.unshift({ 
        key: openaiDefault, 
        label: `${openaiDefault} (default)`, 
        id: openaiDefault 
      });
    }
    
    return res.json({
      openai: {
        default: openaiDefault,
        options: openaiModels
      },
      openrouter: {
        options: openrouterModels
      }
    });
  } catch (err: any) {
    console.error('[CONFIG] Failed to list models:', err);
    return res.status(500).json({ 
      ok: false, 
      error: err?.message || 'Failed to list models' 
    });
  }
});

export default router;
