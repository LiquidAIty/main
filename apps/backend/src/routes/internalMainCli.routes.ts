import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';

import { mainCliBridge, mainCliBridgeToken, type MainCliBridgeEvent } from '../hermes/mainCliBridge';
import { bindHermesRootExecutionSession } from '../hermes/childExecutionContext';
import {
  handleHermesHostExecutionRequest,
  isHermesHostExecutionMethod,
  startHermesHostTeamMonitor,
} from '../hermes/hostExecutionLifecycle';
import { runHermesProfileDelegation } from '../hermes/profileDelegation';
import { builderTerminalSessionManager } from '../hermes/builderTerminal';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import { cancelHermesRun } from '../hermes/mainAdapter';

function authorized(value: unknown, token: string): boolean {
  const supplied = Buffer.from(String(value || '').replace(/^Bearer\s+/i, ''), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function nativeCliRoutes(resolveDelivery: (req: Request) => {
  bridge: typeof mainCliBridge; token: string; ownerCardId: string;
} | null) {
const router = Router({ mergeParams: true });
router.use((req, res, next) => {
  const delivery = resolveDelivery(req);
  if (!delivery || !authorized(req.headers.authorization, delivery.token)) {
    return res.status(401).json({ ok: false, error: 'main_cli_bridge_authorization_required' });
  }
  res.locals.cliBridge = delivery.bridge;
  res.locals.ownerCardId = delivery.ownerCardId;
  return next();
});

router.get('/next', (_req, res) => {
  const turn = (res.locals.cliBridge as typeof mainCliBridge).take();
  return turn ? res.json(turn) : res.status(204).end();
});

router.post('/events', (req, res) => {
  try {
    (res.locals.cliBridge as typeof mainCliBridge).acceptEvent(req.body as MainCliBridgeEvent);
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
    (res.locals.cliBridge as typeof mainCliBridge).acceptHistory(req.body);
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
    (res.locals.cliBridge as typeof mainCliBridge).authorizeExecutionBinding({ requestId, runId, executionContextId });
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
        (res.locals.cliBridge as typeof mainCliBridge).profileDelegationAuthority(params),
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
        appendTeamResult: async (delivery) => (res.locals.cliBridge as typeof mainCliBridge).queueTeamResult(delivery),
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

// Observe the already-authorized child after its parent's foreground turn ends.
// The stored lineage is the authority; this route cannot start or restart a Run.
router.post('/profile-run', async (req, res) => {
  const { projectId, deckId, conversationId, parentRunId, runId, action } = req.body || {};
  if (![projectId, deckId, conversationId, parentRunId, runId].every((value) => typeof value === 'string' && value.trim())
    || !['read', 'stop'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'profile_run_identity_required' });
  }
  try {
    const response = await requestPythonRailsJson('/domain/runs/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, conversationId, runId: parentRunId, includeTerminal: true }),
    }) as any;
    const parent = response?.run;
    const child = parent?.terminal?.children?.find((item: any) => item.runId === runId && item.parentRunId === parentRunId);
    if (parent?.runId !== parentRunId || parent?.cardId !== res.locals.ownerCardId || parent?.projectId !== projectId
      || parent?.deckId !== deckId || parent?.conversationId !== conversationId || !child) {
      return res.status(403).json({ ok: false, error: 'profile_run_parent_mismatch' });
    }
    if (action === 'stop' && ['pending', 'running'].includes(child.state)) {
      if (child.runtimeKind !== 'hermes') throw new Error('profile_run_runtime_unsupported');
      const terminal = builderTerminalSessionManager.list()
        .find((item) => item.ownerCardId === child.cardId && item.projectId === projectId && item.deckId === deckId);
      const session = terminal ? builderTerminalSessionManager.get(terminal.id) : null;
      if (session && session.delivery && session.delivery.bridge.status().runId === runId) {
        session.delivery.bridge.requestCancel(runId);
        session.write('\x03');
      } else {
        cancelHermesRun(child.runtimeProfile, runId);
      }
    }
    return res.json({ ok: true, result: { projectId, deckId, conversationId, parentRunId,
      runId, cardId: child.cardId, state: child.state,
      // Full output remains in the child Run and the lower reader.
      excerpt: typeof child.result === 'string' ? child.result.slice(0, 1200) : '',
      error: child.errorSummary || null } });
  } catch {
    return res.status(502).json({ ok: false, error: 'profile_run_observation_failed' });
  }
});

router.get('/team-results/next', (_req, res) => {
  const delivery = (res.locals.cliBridge as typeof mainCliBridge).takeTeamResult();
  return delivery ? res.json(delivery) : res.status(204).end();
});

router.post('/team-results/ack', (req, res) => {
  try {
    (res.locals.cliBridge as typeof mainCliBridge).acknowledgeTeamResult({
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

return router;
}

export const builderCliRoutes = nativeCliRoutes((req) => {
  const session = builderTerminalSessionManager.get(String(req.params.sessionId || ''));
  return session?.isLive() && session.delivery ? { ...session.delivery, ownerCardId: session.info.ownerCardId } : null;
});

export default nativeCliRoutes(() => ({ bridge: mainCliBridge, token: mainCliBridgeToken, ownerCardId: 'card_main_chat' }));
