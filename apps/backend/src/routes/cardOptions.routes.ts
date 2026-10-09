import { Router } from 'express';
import { autoModelCandidates, listConfiguredModelOptions } from '../llm/models.config';
import { requestPythonRailsJson } from '../services/pythonRailsClient';

const cardOptionsRoutes = Router();
cardOptionsRoutes.get('/options', async (_req, res) => {
  try {
    const options = await requestPythonRailsJson('/card-editor/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: listConfiguredModelOptions(process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna'),
      }),
    }) as Record<string, unknown>;
    if (!Array.isArray(options?.fields) || !options.catalogs || typeof options.catalogs !== 'object') {
      throw new Error('runtime_options_invalid');
    }
    return res.json({
      ok: true,
      fields: options.fields,
      catalogs: options.catalogs,
      autoModelCandidates,
    });
  } catch {
    return res.status(503).json({ ok: false, error: 'runtime_options_unavailable' });
  }
});

export default cardOptionsRoutes;
