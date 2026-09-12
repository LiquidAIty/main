import { Router, type Response } from 'express';
import { getUserBySessionId } from '../auth/sessionStore';
import { getProjectCard } from '../services/agentBuilderStore';
import { getDeckDocument } from '../decks/store';
import { agentTerminalManager, requireAgentTerminalCard, type AgentTerminalOwner } from '../hermes/agentTerminal';
import { agentTerminalExecution } from '../hermes/agentTerminalExecution';

function dimensions(value: unknown): { cols: number; rows: number } {
  const { cols, rows } = (value || {}) as Record<string, unknown>;
  if (!Number.isInteger(cols) || Number(cols) < 2 || Number(cols) > 500
    || !Number.isInteger(rows) || Number(rows) < 1 || Number(rows) > 200) {
    throw new Error('agent_terminal_dimensions_invalid');
  }
  return { cols: Number(cols), rows: Number(rows) };
}

export function createAgentTerminalRouter(deps = {
  getUser: getUserBySessionId, getProject: getProjectCard, getDeck: getDeckDocument,
  manager: agentTerminalManager,
  execution: agentTerminalExecution,
}) {
  const router = Router();
  router.post('/internal/:sessionId/:operation', async (req, res) => {
    try {
      const owner = deps.manager.authorizeNative(req.params.sessionId, req.headers.authorization || '');
      if (!await deps.getProject(owner.projectId, owner.userId)) throw new Error('agent_terminal_project_access_denied');
      if (req.params.operation === 'finish') {
        res.json(await deps.execution.finish(req.params.sessionId, req.body));
        return;
      }
      if (req.params.operation === 'host') {
        res.json(await deps.execution.host(req.params.sessionId, req.body));
        return;
      }
      if (req.params.operation !== 'begin') throw new Error('agent_terminal_operation_invalid');
      const { deck } = await deps.getDeck(owner.projectId, owner.deckId);
      const card = deck?.nodes.find((entry) => entry.id === owner.cardId);
      if (!deck || !card) throw new Error('agent_terminal_card_not_found');
      const profile = requireAgentTerminalCard(card, deck);
      deps.manager.verifyConfiguration(owner, req.params.sessionId, card, deck);
      res.json(await deps.execution.begin(owner, req.params.sessionId, profile, req.body));
    } catch (error) { fail(res, error); }
  });
  router.use('/:projectId/:deckId/:cardId', async (req, res, next) => {
    try {
      const sid = req.cookies?.sid;
      const user = typeof sid === 'string' && sid ? await deps.getUser(sid) : null;
      if (!user) { res.status(401).json({ error: 'agent_terminal_existing_session_required' }); return; }
      const { projectId, deckId, cardId } = req.params;
      if (!await deps.getProject(projectId, user.id)) {
        res.status(403).json({ error: `agent_terminal_project_access_denied: local account ${user.id}` }); return;
      }
      const { deck } = await deps.getDeck(projectId, deckId);
      const card = deck?.nodes.find((entry) => entry.id === cardId);
      if (!deck || !card) { res.status(404).json({ error: 'agent_terminal_card_not_found' }); return; }
      requireAgentTerminalCard(card, deck);
      res.locals.agentTerminal = {
        owner: { userId: user.id, projectId, deckId, cardId } satisfies AgentTerminalOwner, card, deck,
      };
      next();
    } catch (error) { fail(res, error); }
  });
  const base = '/:projectId/:deckId/:cardId';
  router.post(`${base}/open`, (req, res) => {
    try {
      const { owner, card, deck } = res.locals.agentTerminal;
      const { cols, rows } = dimensions(req.body);
      res.json(deps.manager.open(owner, card, deck, cols, rows));
    } catch (error) { fail(res, error); }
  });
  router.get(`${base}/:sessionId/events`, (req, res) => {
    let unsubscribe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const { owner } = res.locals.agentTerminal;
      deps.manager.state(owner, req.params.sessionId);
      const after = Number(req.headers['last-event-id'] ?? req.query.after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) throw new Error('agent_terminal_cursor_invalid');
      res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      unsubscribe = deps.manager.subscribe(owner, req.params.sessionId, after, (event, data) => {
        if (res.writableEnded || res.destroyed) return;
        if ('sequence' in data) res.write(`id: ${data.sequence}\n`);
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (event === 'state' && 'status' in data && data.status !== 'running') res.end();
      });
      if (res.writableEnded) { unsubscribe(); return; }
      heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      req.on('close', () => { unsubscribe?.(); if (heartbeat) clearInterval(heartbeat); });
    } catch (error) {
      unsubscribe?.(); if (heartbeat) clearInterval(heartbeat);
      if (res.headersSent) res.end(); else fail(res, error);
    }
  });
  router.post(`${base}/:sessionId/input`, (req, res) => {
    try {
      const data = req.body?.data;
      if (typeof data !== 'string' || !data.length || Buffer.byteLength(data) > 64 * 1024) {
        throw new Error('agent_terminal_input_invalid');
      }
      const { owner, card, deck } = res.locals.agentTerminal;
      deps.manager.verifyConfiguration(owner, req.params.sessionId, card, deck);
      deps.manager.input(owner, req.params.sessionId, data);
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });
  router.post(`${base}/:sessionId/resize`, (req, res) => {
    try {
      const { cols, rows } = dimensions(req.body);
      res.json(deps.manager.resize(res.locals.agentTerminal.owner, req.params.sessionId, cols, rows));
    } catch (error) { fail(res, error); }
  });
  router.post(`${base}/:sessionId/stop`, (req, res) => {
    try {
      deps.manager.stop(res.locals.agentTerminal.owner, req.params.sessionId);
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });
  return router;
}

function fail(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  res.status(message.includes('not_found') ? 404 : 400).json({ error: message });
}

export default createAgentTerminalRouter();
