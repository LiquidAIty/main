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
    
    // Extract all OpenAI models from registry
    const openaiModels = Object.entries(MODEL_REGISTRY)
      .filter(([_, m]) => m.provider === 'openai')
      .map(([key, m]) => ({ key, label: m.label, id: m.id }));
    
    // Extract all OpenRouter models from registry
    const openrouterModels = Object.entries(MODEL_REGISTRY)
      .filter(([_, m]) => m.provider === 'openrouter')
      .map(([key, m]) => ({ key, label: m.label, id: m.id }));
    
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
