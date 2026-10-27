// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Building Modeling
// Relationship: Transports explicit modeling requests after resolving the authenticated user's owned Project; the browser supplies no files, commands or provider authority.
import { Router } from 'express';
import { Agent } from 'undici';
import { requireOwnedProject } from './projectAccess';
import { PythonRailsHttpError, requestPythonRailsJson } from '../services/pythonRailsClient';

const router = Router();
// A native simulation may be silent while executing. Abort, headers and body
// deadlines agree; the global dispatcher and unrelated routes stay unchanged.
const modelingTransport = { timeoutMs: 930_000, dispatcher: new Agent({ headersTimeout: 930_000, bodyTimeout: 930_000 }) };
router.get('/projects/:projectId/runs/:runId/report', async (req, res) => {
  const owned = await requireOwnedProject(req, res, String(req.params.projectId));
  if (!owned) return;
  const caseId = req.query.caseId;
  if (typeof caseId !== 'string') { res.status(400).json({ error: 'case_required' }); return; }
  try {
    const result = await requestPythonRailsJson(`/nrgsim/projects/${encodeURIComponent(owned.projectId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'report', caseId, runId: String(req.params.runId) }),
    }, modelingTransport);
    if (!result || typeof result !== 'object' || !('html' in result) || typeof result.html !== 'string') throw new Error('report_unavailable');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('html').send(result.html);
  } catch (error) {
    res.status(error instanceof PythonRailsHttpError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'report_unavailable' });
  }
});
router.post('/projects/:projectId', async (req, res) => {
  const owned = await requireOwnedProject(req, res, String(req.params.projectId));
  if (!owned) return;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'modeling_request_required' });
    return;
  }
  try {
    const result = await requestPythonRailsJson(`/nrgsim/projects/${encodeURIComponent(owned.projectId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body),
    }, modelingTransport);
    res.json(result);
  } catch (error) {
    res.status(error instanceof PythonRailsHttpError ? error.status : 502).json({
      error: error instanceof Error ? error.message : 'modeling_unavailable',
    });
  }
});
export default router;
