// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: IDD
// Relationship: This file supplies configured model choices to IDD materialization and returns validated runtime fields and catalogs for Card editing.

import { Router } from 'express';
import { listConfiguredModelOptions } from '../llm/models.config';
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
    });
  } catch {
    return res.status(503).json({ ok: false, error: 'runtime_options_unavailable' });
  }
});

export default cardOptionsRoutes;
