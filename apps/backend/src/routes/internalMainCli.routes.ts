import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';

import { mainCliBridge, mainCliBridgeToken, type MainCliBridgeEvent } from '../hermes/mainCliBridge';
import { bindHermesRootExecutionSession } from '../hermes/childExecutionContext';
import {
  handleHermesHostExecutionRequest,
  isHermesHostExecutionMethod,
  startHermesHostTeamMonitor,
} from '../hermes/hostExecutionLifecycle';
import { runHermesProfileDelegation } from '../hermes/profileDelegation';

const router = Router();

function authorized(value: unknown): boolean {
  const supplied = Buffer.from(String(value || '').replace(/^Bearer\s+/i, ''), 'utf8');
  const expected = Buffer.from(mainCliBridgeToken, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

router.use((req, res, next) => {
  if (!authorized(req.headers.authorization)) {
    return res.status(401).json({ ok: false, error: 'main_cli_bridge_authorization_required' });
  }
  return next();
});

router.get('/next', (_req, res) => {
  const turn = mainCliBridge.take();
  return turn ? res.json(turn) : res.status(204).end();
});

router.post('/events', (req, res) => {
  try {
    mainCliBridge.acceptEvent(req.body as MainCliBridgeEvent);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_cli_bridge_event_rejected',
    });
  }
});

router.post('/history', (req, res) => {
  try {
    mainCliBridge.acceptHistory(req.body);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_cli_history_rejected',
    });
  }
});

router.post('/execution/bind', (req, res) => {
  try {
    const requestId = String(req.body?.requestId || '');
    const runId = String(req.body?.runId || '');
    const executionContextId = String(req.body?.executionContextId || '');
    const sessionId = String(req.body?.sessionId || '');
    mainCliBridge.authorizeExecutionBinding({ requestId, runId, executionContextId });
    bindHermesRootExecutionSession(executionContextId, sessionId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_cli_execution_binding_rejected',
    });
  }
});

router.post('/execution', async (req, res) => {
  const method = req.body?.method;
  if (!isHermesHostExecutionMethod(method) && method !== 'session/delegate_profile') {
    return res.status(400).json({ ok: false, error: 'main_cli_execution_method_invalid' });
  }
  try {
    if (method === 'session/delegate_profile') {
      const params = req.body?.params && typeof req.body.params === 'object'
        ? req.body.params
        : {};
      const result = await runHermesProfileDelegation(
        mainCliBridge.profileDelegationAuthority(params),
        params,
      );
      return res.json({ ok: true, result });
    }
    const outcome = await handleHermesHostExecutionRequest({
      method,
      params: req.body?.params && typeof req.body.params === 'object'
        ? req.body.params
        : {},
    });
    res.json({ ok: true, result: outcome.result });
    if (outcome.nativeContext) {
      startHermesHostTeamMonitor({
        context: outcome.nativeContext,
        appendRetryAttempts: 900,
        appendTeamResult: async (delivery) => mainCliBridge.queueTeamResult(delivery),
      });
    }
    return undefined;
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_cli_execution_request_failed',
    });
  }
});

router.get('/team-results/next', (_req, res) => {
  const delivery = mainCliBridge.takeTeamResult();
  return delivery ? res.json(delivery) : res.status(204).end();
});

router.post('/team-results/ack', (req, res) => {
  try {
    mainCliBridge.acknowledgeTeamResult({
      deliveryId: String(req.body?.deliveryId || ''),
      delivered: req.body?.delivered === true,
      retry: req.body?.retry === true,
      error: String(req.body?.error || ''),
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_cli_team_delivery_rejected',
    });
  }
});

export default router;
