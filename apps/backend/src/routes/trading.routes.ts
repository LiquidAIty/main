import { Router } from 'express';

import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';

type Dependencies = {
  requestRails: typeof requestPythonRailsJson;
};

const TRADING_TIMEFRAMES = new Set(['1Min', '5Min', '15Min', '1Hour', '1Day']);

function requiredText(value: unknown, error: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(error);
  return text;
}

function inputStatus(error: unknown): number {
  return error instanceof Error
    && (error.message.endsWith('_required') || error.message.endsWith('_invalid'))
    ? 400
    : 502;
}

function optionalText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function statePath(query: Record<string, unknown>): string {
  const timeframe = optionalText(query.timeframe) || '5Min';
  if (!TRADING_TIMEFRAMES.has(timeframe)) {
    throw new Error('trading_timeframe_invalid');
  }
  const params = new URLSearchParams({
    projectId: requiredText(query.projectId, 'project_id_required'),
    deckId: requiredText(query.deckId, 'deck_id_required'),
    cardId: requiredText(query.cardId, 'card_id_required'),
    timeframe,
  });
  const selectedJobId = optionalText(query.selectedJobId);
  if (selectedJobId) params.set('selectedJobId', selectedJobId);
  return `/trading/state?${params.toString()}`;
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
      return res.json(await deps.requestRails(statePath(req.query), {
        method: 'GET',
      }));
    } catch (error) {
      return res.status(inputStatus(error)).json({
        ok: false,
        error: error instanceof Error ? error.message : 'trading_state_failed',
      });
    }
  });

  router.get('/events', async (req, res) => {
    let path: string;
    try {
      path = statePath(req.query);
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'trading_events_input_invalid',
      });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write('retry: 5000\n\n');

    let closed = false;
    let reading = false;
    let lastSnapshot = '';
    const sendSnapshot = async () => {
      if (closed || reading) return;
      reading = true;
      try {
        const snapshot = await deps.requestRails(path, { method: 'GET' });
        const serialized = JSON.stringify(snapshot);
        if (!closed && serialized !== lastSnapshot) {
          lastSnapshot = serialized;
          res.write(`event: snapshot\ndata: ${serialized}\n\n`);
        }
      } catch (error) {
        if (!closed) {
          res.write(`event: transport_error\ndata: ${JSON.stringify({
            error: error instanceof Error ? error.message : 'trading_event_read_failed',
          })}\n\n`);
        }
      } finally {
        reading = false;
      }
    };
    const interval = setInterval(() => { void sendSnapshot(); }, 5_000);
    interval.unref?.();
    req.on('close', () => {
      closed = true;
      clearInterval(interval);
    });
    await sendSnapshot();
    return undefined;
  });

  router.post('/intervene', async (req, res) => {
    try {
      const action = requiredText(
        req.body?.action,
        'trading_intervention_action_required',
      ).toUpperCase();
      if (!['PAUSE', 'RESUME'].includes(action)) {
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

  router.post('/lifecycle/backtest', async (req, res) => {
    try {
      const body = {
        projectId: requiredText(req.body?.projectId, 'project_id_required'),
        deckId: requiredText(req.body?.deckId, 'deck_id_required'),
        cardId: requiredText(req.body?.cardId, 'card_id_required'),
        idempotencyKey: requiredText(
          req.body?.idempotencyKey,
          'trading_lifecycle_idempotency_key_required',
        ),
        actor: `authenticated-user:${requiredText(
          (req as any).userId,
          'authenticated_user_required',
        )}`,
      };
      return res.json(await deps.requestRails('/trading/lifecycle/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, { timeoutMs: 120_000 }));
    } catch (error) {
      return res.status(inputStatus(error)).json({
        ok: false,
        error: error instanceof Error ? error.message : 'trading_lifecycle_failed',
      });
    }
  });

  return router;
}

export default createTradingRouter();
