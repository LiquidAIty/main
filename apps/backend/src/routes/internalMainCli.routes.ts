import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';

import { mainCliBridge, mainCliBridgeToken, type MainCliBridgeEvent } from '../hermes/mainCliBridge';

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

export default router;
