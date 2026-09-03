import { Router } from 'express';

import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';

type Dependencies = {
  requestRails: typeof requestPythonRailsJson;
};

function requiredText(value: unknown, error: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(error);
  return text;
}

function inputStatus(error: unknown): number {
  return error instanceof Error && error.message.endsWith('_required') ? 400 : 502;
}

export function createTradingRouter(deps: Dependencies = {
  requestRails: requestPythonRailsJson,
}) {
  const router = Router();

  router.get('/readiness', async (_req, res) => {
    try {
      return res.json(await deps.requestRails('/trading/readiness', { method: 'GET' }));
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'trading_readiness_failed',
      });
    }
  });

  router.get('/state', async (req, res) => {
    try {
      const query = new URLSearchParams({
        projectId: requiredText(req.query.projectId, 'project_id_required'),
        deckId: requiredText(req.query.deckId, 'deck_id_required'),
        cardId: requiredText(req.query.cardId, 'card_id_required'),
      });
      return res.json(await deps.requestRails(`/trading/state?${query.toString()}`, {
        method: 'GET',
      }));
    } catch (error) {
      return res.status(inputStatus(error)).json({
        ok: false,
        error: error instanceof Error ? error.message : 'trading_state_failed',
      });
    }
  });

  router.post('/intervene', async (req, res) => {
    try {
      const action = requiredText(
        req.body?.action,
        'trading_intervention_action_required',
      ).toUpperCase();
      if (!['PAUSE', 'EXIT', 'FAIL_SAFE'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'trading_intervention_action_invalid' });
      }
      const body = {
        projectId: requiredText(req.body?.projectId, 'project_id_required'),
        deckId: requiredText(req.body?.deckId, 'deck_id_required'),
        cardId: requiredText(req.body?.cardId, 'card_id_required'),
        jobId: requiredText(req.body?.jobId, 'trading_job_id_required'),
        action,
        reason: requiredText(req.body?.reason, 'trading_intervention_reason_required'),
        actor: `authenticated-user:${requiredText(
          (req as any).userId,
          'authenticated_user_required',
        )}`,
      };
      return res.json(await deps.requestRails('/trading/intervene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
    } catch (error) {
      return res.status(inputStatus(error)).json({
        ok: false,
        error: error instanceof Error ? error.message : 'trading_intervention_failed',
      });
    }
  });

  return router;
}

export default createTradingRouter();
