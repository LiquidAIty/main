// Entity: Run Ledger
// Relationship: This file returns authenticated latest Run metrics and status for one exact saved Card without exposing another Project's execution state.
import { Router, type Request } from 'express';
import { getOwnedProjectByReference } from '../services/projectStore';
import { requestPythonRailsJson } from '../services/pythonRailsClient';

const cardRunReadRoutes = Router();
function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function elapsedMilliseconds(run: Record<string, any>): number | null {
  const start = Date.parse(String(run.createdAt || ''));
  const end = Date.parse(String(run.finishedAt || ''));
  if (!Number.isFinite(start)) return null;
  return Math.max(0, (Number.isFinite(end) ? end : Date.now()) - start);
}

function runtimeMetrics(run: Record<string, any> | undefined, cardId: string) {
  if (!run) return null;
  return {
    cardId,
    runtimeMs: elapsedMilliseconds(run),
    totalTokens: finiteNumber(run.providerTotalTokens),
  };
}

async function cardRunStatus(
  latest: Record<string, any>,
  cardId: string,
): Promise<Record<string, any>> {
  return {
    cardId,
    runId: String(latest.runId || ''),
    state: String(latest.state || ''),
  };
}

export async function authorizeCardProject(req: Request, projectId: string): Promise<boolean> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) return false;
  const project = await getOwnedProjectByReference(projectId, userId);
  return Boolean(project && project.ownerUserId === userId);
}

cardRunReadRoutes.post('/runs/latest', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const rawCardIds = Array.isArray(req.body?.cardIds) ? req.body.cardIds : [];
  const cardIds: string[] = rawCardIds.map((value: unknown) => (
    typeof value === 'string' ? value.trim() : ''
  ));
  if (
    !projectId
    || !deckId
    || cardIds.length === 0
    || cardIds.length > 128
    || cardIds.some((cardId: string) => !cardId)
    || new Set(cardIds).size !== cardIds.length
  ) {
    return res.status(400).json({ ok: false, error: 'card_run_identity_incomplete' });
  }
  if (req.body?.inspectOnly !== true) {
    return res.status(400).json({ ok: false, error: 'card_run_status_must_be_inspect_only' });
  }
  try {
    if (!(await authorizeCardProject(req, projectId))) {
      return res.status(403).json({ ok: false, error: 'card_run_project_access_denied' });
    }
    const latest = objectRecord(await requestPythonRailsJson('/domain/runs/latest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, cardIds }),
    }));
    const requested = new Set(cardIds);
    const runsByCard = new Map<string, Record<string, any>>();
    for (const value of Array.isArray(latest.runs) ? latest.runs : []) {
      const run = objectRecord(value);
      const cardId = String(run.cardId || '').trim();
      if (requested.has(cardId) && !runsByCard.has(cardId)) runsByCard.set(cardId, run);
    }
    const observations = await Promise.allSettled(cardIds.map(async (cardId) => {
      const run = runsByCard.get(cardId);
      return run ? cardRunStatus(run, cardId) : null;
    }));
    return res.json({
      ok: true,
      results: observations.flatMap((observation) => (
        observation.status === 'fulfilled' && observation.value ? [observation.value] : []
      )),
      failedCardIds: observations.flatMap((observation, index) => (
        observation.status === 'rejected' ? [cardIds[index]] : []
      )),
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_run_read_failed',
    });
  }
});

cardRunReadRoutes.post('/runs/read', async (req, res) => {
  const action = String(req.body?.action || '').trim();
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const cardId = String(req.body?.cardId || '').trim();
  if (!projectId || !deckId || !cardId) {
    return res.status(400).json({ ok: false, error: 'card_run_identity_incomplete' });
  }
  if (!['metrics', 'status'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'card_run_read_action_required' });
  }
  if (req.body?.inspectOnly !== true) {
    return res.status(400).json({ ok: false, error: 'card_run_status_must_be_inspect_only' });
  }
  try {
    if (!(await authorizeCardProject(req, projectId))) {
      return res.status(403).json({ ok: false, error: 'card_run_project_access_denied' });
    }
    const history = objectRecord(await requestPythonRailsJson('/domain/runs/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, cardId, limit: 1 }),
    }));
    const runs = Array.isArray(history.runs) ? history.runs.map(objectRecord) : [];
    const latest = runs[0];
    if (action === 'metrics') {
      return res.json({ ok: true, result: runtimeMetrics(latest, cardId) });
    }
    if (!latest) return res.json({ ok: true, result: null });
    return res.json({ ok: true, result: await cardRunStatus(latest, cardId) });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_run_read_failed',
    });
  }
});

export default cardRunReadRoutes;
