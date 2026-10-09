import { Router } from 'express';
import { resolveScriptToolDefinitions } from '../cards/toolCatalogProjection';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { loadLiveToolCatalog, scriptPaletteFingerprint } from './builderIdd.routes';

const cardScriptRoutes = Router();
cardScriptRoutes.post('/script/validate', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const selectedToolIds: string[] = Array.isArray(body.selectedTools)
      ? body.selectedTools.map((value: unknown) => String(value))
      : [];
    const catalog = await loadLiveToolCatalog();
    const references = resolveScriptToolDefinitions(catalog, { selectedIds: selectedToolIds });
    const referenceIds = new Set(references.map((reference) => reference.canonicalId));
    const defaultAgentTools = selectedToolIds
      .filter((canonicalId) => referenceIds.has(canonicalId));
    const paletteFingerprint = scriptPaletteFingerprint(references);
    const script = await requestPythonRailsJson('/card-script/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: body.script,
        selectedTools: references.map((reference) => reference.canonicalId),
        defaultAgentTools,
        paletteFingerprint,
      }),
    });
    return res.json({ ok: true, script, references, paletteFingerprint });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_script_validation_failed',
    });
  }
});

export default cardScriptRoutes;
