/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Main Chat
 * Relationship: Streams admitted Hermes replies into Main Chat and persists actual provider rows through the existing Project conversation store.
 * Entity: Agent Messaging
 * Relationship: Projects saved enabled wires into profile rosters and routes an explicit @Name to that saved Card; Hermes performs inference and message_agent delivery.
 * Entity: Card Sessions
 * Relationship: Reuses Desktop's Gateway client to find, create when absent, and resume each profile's canonical Bot Chat, and forwards Stop to that conversation.
 * Entity: Card Activity
 * Relationship: Reads Hermes live-session counts and Main's canonical activity summary without querying application Runs or inferring subagent totals.
 * Entity: Voice
 * Relationship: Forwards browser audio and completed speech text to the addressed saved profile's Hermes audio endpoints.
 * Entity: Agent Input
 * Relationship: Projects Hermes-owned pending questions and approvals and returns explicit user responses to their original session and request.
 * Entity: Card Terminals
 * Relationship: Resolves the saved non-Main Card, refreshes its scoped profile access, and opens its canonical Bot Chat for the CLI viewer.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router, type Request, type Response } from 'express';
import { tsImport } from 'tsx/esm/api';
import { appendConversationReplyOnce, appendConversationTurn, getConversationMessages } from '../conversations/store';
import { createInternalMcpBearer } from '../services/mcp/internalMcpAuth';
import { exactStrings, objectRecord, projectCardAuthority, type ProjectCardBinding } from '../services/projectCardAuthority';
import { assertCardProfileOwner } from '../services/projectStore';
import { resolveRepoRoot } from '../services/workingDirectories';
import { requireOwnedProject } from './projectAccess';

const router = Router();
type Rpc = Record<string, any>;
let connected: ReturnType<typeof connectGateway> | undefined;

async function connectGateway() {
  const root = path.join(resolveRepoRoot(), 'HermesLatest');
  const home = path.join(root, '.hermes');
  const executable = (name: string) => path.join(root, '.venv', process.platform === 'win32' ? `Scripts/${name}.exe` : `bin/${name}`);
  const load = (file: string) => tsImport(pathToFileURL(path.join(root, file)).href, pathToFileURL(__filename).href);
  const [api, local, tickets] = await Promise.all([
    load('apps/desktop/src/api/client.ts'), load('apps/desktop/electron/local-gateway.ts'),
    load('apps/desktop/electron/local-gateway-python.ts'),
  ]);
  const backend = { command: executable('python'), args: ['-m', 'hermes_cli.main', 'gateway', 'ensure', '--json'], shell: false, env: { PYTHONPATH: root } };
  const descriptor = await local.ensureLocalGateway(() => local.runGatewayEnsure(backend, root, home));
  const resolveTicket = tickets.createGatewayTicketResolver(
    async () => ({ command: executable('python'), args: [], kind: 'python', shell: false, env: { PYTHONPATH: root } }), () => root,
  );
  local.configurePythonGatewayTicketClient(resolveTicket);
  const client = new api.HermesGateway();
  const ticket = await resolveTicket(descriptor.gatewayEndpoint, 'interactive');
  await client.connect(local.createLocalGatewayDials().prepare(descriptor.baseUrl, ticket, 0));
  const audio = async (profile: string, operation: 'transcribe' | 'speak', body: Rpc, signal: AbortSignal) => {
    const url = `${descriptor.baseUrl}/api/audio/${operation}?profile=${encodeURIComponent(profile)}`;
    const headers = await local.nativeGatewayHttpHeaders(descriptor, url, home, 'POST', body);
    const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal, redirect: 'error' });
    const result = await response.json() as Rpc;
    if (!response.ok || result.ok !== true) throw new Error(String(result.detail || result.error || `voice_${operation}_failed`)
      .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/g, '[provider endpoint]'));
    return result;
  };
  return { client, audio, startup: api.STARTUP_REQUEST_TIMEOUT_MS, submit: api.PROMPT_SUBMIT_REQUEST_TIMEOUT_MS,
    closeTickets: tickets.closeGatewayTicketBridges as () => void };
}

export function closeMainConnection(): void {
  const closing = connected;
  connected = undefined;
  void closing?.then(({ client, closeTickets }) => { client.close(); closeTickets(); }).catch(() => undefined);
}

async function gateway() {
  if (!connected) connected = connectGateway().catch(error => { connected = undefined; throw error; });
  const current = await connected;
  if (current.client.connectionState !== 'open') {
    closeMainConnection();
    throw new Error('main_gateway_disconnected');
  }
  return current;
}

async function requestForBot(profile: string, method: string, params: Rpc = {}) {
  const started = performance.now();
  try {
    const current = await gateway();
    return await current.client.request(method, { ...params, profile }, method === 'prompt.submit' ? current.submit : current.startup);
  } finally {
    const elapsedMs = Math.round(performance.now() - started);
    if (elapsedMs >= 1000) console.info('[card-rpc-timing]', { profile, method, elapsedMs });
  }
}

async function context(req: Request, res: Response, input = req.method === 'GET' ? req.query : req.body) {
  const access = await requireOwnedProject(req, res, String(input?.projectId || ''));
  if (!access) return null;
  const authority = await projectCardAuthority(access.projectId, String(input?.deckId || 'deck_builder'));
  const wired = (card: ProjectCardBinding) => {
    const ids = new Set<string>();
    for (const edge of authority.deck.edges) {
      if (edge.enabled === false || edge.edgeType === 'invalid') continue;
      if (![edge.source, edge.target].every(id => authority.cards.some(candidate => candidate.card.id === id))) continue;
      if (card === authority.main || edge.source === card.card.id || edge.target === card.card.id) {
        ids.add(edge.source); ids.add(edge.target);
      }
    }
    ids.delete(card.card.id);
    return authority.cards.filter(candidate => ids.has(candidate.card.id) && candidate.card.runtime.kind === 'hermes');
  };
  return { ...access, authority, wired, roster: wired(authority.main), deckId: authority.deck.id };
}

type Context = NonNullable<Awaited<ReturnType<typeof context>>>;
function addressedCard(scope: Context, message: string) {
  const address = /^@([^\s]+)(?:\s|$)/u.exec(message)?.[1];
  const matches = address ? scope.roster.filter(card => card.address?.toLowerCase() === address.toLowerCase()) : [scope.authority.main];
  if (matches.length !== 1) throw new Error('main_agent_address_unavailable');
  return matches[0];
}
const speaker = (card: ProjectCardBinding) => ({ kind: 'card' as const, cardId: card.card.id,
  label: card.title, profile: card.profile, address: card.address });

async function prepareProfiles(scope: Context, target: ProjectCardBinding) {
  await Promise.all([target, ...scope.wired(target)].map(async card => {
    await assertCardProfileOwner(card.profile, scope.ownerUserId);
    if (exactStrings(objectRecord(card.card.runtimeOptions).tools).length) {
      const value = createInternalMcpBearer({ kind: 'card-runtime', ownerUserId: scope.ownerUserId,
        projectId: scope.projectId, deckId: scope.deckId, profile: card.profile });
      const saved = await requestForBot(card.profile, 'mcp.servers.set_api_key', { name: 'liquidaity', value });
      if (!saved.ok) throw new Error('card_mcp_credential_refresh_failed');
    }
    const saved = await requestForBot(card.profile, 'profiles.configure', {
      name: card.profile, bot_mode_roster: scope.wired(card).map(peer => peer.profile),
    });
    if (!saved.ok || saved.confirm_required) throw new Error('card_roster_configuration_failed');
  }));
}

export async function findExistingCanonicalChat(profile: string): Promise<string | null> {
  const result = await requestForBot(profile, 'session.list', { title: 'Bot Chat', include_hidden: true, limit: 200 });
  const rows = result.sessions.filter((row: Rpc) => (row.root_title || row.title) === 'Bot Chat');
  if (rows.length > 1) throw new Error('card_conversation_ambiguous');
  return rows.length ? String(rows[0].resolved_id || rows[0].id) : null;
}

async function createCanonicalChat(profile: string): Promise<string> {
  const created = await requestForBot(profile, 'session.create', {
    title: 'Bot Chat', hidden: true, follow_profile_config: true,
  });
  await requestForBot(profile, 'session.title', { session_id: created.session_id, title: 'Bot Chat' });
  return String(created.stored_session_id);
}

async function openStoredBotChat(profile: string, sessionId: string): Promise<string> {
  const opened = await requestForBot(profile, 'session.resume', { session_id: sessionId, defer_history: true, omit_messages: true });
  return String(opened.session_id);
}

async function openBotCanonicalChat(profile: string): Promise<string> {
  // The exact native title lookup already resolves this profile's canonical Chat.
  // Enumerating every installed profile before each open adds no authority.
  const sessionId = await findExistingCanonicalChat(profile) ?? await createCanonicalChat(profile);
  return openStoredBotChat(profile, sessionId);
}

export async function prepareTerminalConversation(req: Request, res: Response) {
  const scope = await context(req, res, req.params);
  if (!scope) return null;
  const card = scope.authority.cards.find(item => item.card.id === req.params.cardId);
  if (!card || card === scope.authority.main || card.card.runtime.kind !== 'hermes') {
    res.status(400).json({ error: 'card_cli_unavailable' }); return null;
  }
  await prepareProfiles(scope, card);
  return { projectId: scope.projectId, deckId: scope.deckId, cardId: card.card.id,
    profile: card.profile, sessionId: await openBotCanonicalChat(card.profile) };
}

function failure(res: Response, error: unknown) {
  const code = error instanceof Error ? error.message : 'main_request_failed';
  if (!res.headersSent) res.status(503).json({ error: code });
  else if (!res.writableEnded && !res.destroyed) {
    res.write(`event: error\ndata: ${JSON.stringify({ code, message: code })}\n\n`); res.end();
  }
}

function projectInputRequests(scope: Context, card: ProjectCardBinding, snapshot: Rpc) {
  return (snapshot.prompts || []).filter((prompt: Rpc) => ['approval', 'clarify'].includes(prompt.kind)).map((prompt: Rpc) => ({
    projectId: scope.projectId, deckId: scope.deckId, cardId: card.card.id,
    address: card === scope.authority.main ? '' : card.address || card.title,
    sessionId: snapshot.session_id, requestId: prompt.prompt_id, kind: prompt.kind,
    question: prompt.question, command: prompt.command, description: prompt.description,
    choices: prompt.choices, multiSelect: prompt.multi_select === true,
  }));
}

router.post('/activity', async (req, res) => {
  try {
    const scope = await context(req, res);
    if (!scope) return;
    const profiles = await requestForBot(scope.authority.main.profile, 'profiles.list');
    const summary = profiles.profiles.find((row: Rpc) => row.name === scope.authority.main.profile)?.canonical_session;
    const cards = [scope.authority.main, ...scope.roster];
    const observed = await Promise.allSettled(cards.map(async card => {
      await assertCardProfileOwner(card.profile, scope.ownerUserId);
      const live = await requestForBot(card.profile, 'session.active_list');
      const working = live.sessions.filter((row: Rpc) => ['working', 'streaming'].includes(row.status));
      const inputRequests = (await Promise.all(live.sessions.filter((row: Rpc) => row.title === 'Bot Chat'
        && ['working', 'streaming', 'waiting'].includes(row.status)).map(async (row: Rpc) => {
        const snapshot = await requestForBot(card.profile, 'session.resume', { session_id: row.id, defer_history: true, omit_messages: true });
        return projectInputRequests(scope, card, snapshot);
      }))).flat();
      return { cardId: card.card.id, state: working.length ? 'running' : 'idle', activeCount: working.length, inputRequests };
    }));
    res.json({ ok: true, results: observed.flatMap(row => row.status === 'fulfilled' ? [row.value] : []),
      failedCardIds: observed.flatMap((row, index) => row.status === 'rejected' ? [cards[index].card.id] : []),
      mainCanonicalSession: summary ? { id: summary.id, resolvedId: summary.resolved_id || summary.id,
        lastActive: summary.last_active, messageCount: summary.message_count } : null });
  } catch (error) { failure(res, error); }
});

router.post('/respond', async (req, res) => {
  try {
    const scope = await context(req, res);
    if (!scope) return;
    const { cardId, sessionId, requestId, kind, answer } = req.body;
    const card = [scope.authority.main, ...scope.roster].find(item => item.card.id === cardId);
    if (!card || !['approval', 'clarify'].includes(kind) || typeof requestId !== 'string' || typeof answer !== 'string') {
      res.status(400).json({ error: 'agent_input_response_invalid' }); return;
    }
    await assertCardProfileOwner(card.profile, scope.ownerUserId);
    if (await findExistingCanonicalChat(card.profile) !== sessionId) {
      res.status(409).json({ error: 'main_session_changed' }); return;
    }
    const snapshot = await requestForBot(card.profile, 'session.resume', { session_id: sessionId, defer_history: true, omit_messages: true });
    const prompt = snapshot.prompts?.find((item: Rpc) => item.prompt_id === requestId && item.kind === kind);
    if (!prompt) { res.status(409).json({ error: 'agent_input_expired' }); return; }
    if (kind === 'approval' && !prompt.choices.includes(answer)) {
      res.status(400).json({ error: 'agent_input_choice_invalid' }); return;
    }
    const result = await requestForBot(card.profile, `${kind}.respond`, {
      session_id: sessionId, request_id: requestId, [kind === 'approval' ? 'choice' : 'answer']: answer,
    });
    res.json({ ok: true, result });
  } catch (error) { failure(res, error); }
});

async function refreshOpenBotChat(scope: Context, card: ProjectCardBinding, sessionId: string, after: number) {
  const history = await requestForBot(card.profile, 'session.history', { session_id: sessionId });
  for (const row of history.messages) {
    const text = row.display_content === undefined ? row.text : row.display_content;
    if (row.role !== 'assistant' || ['hidden', 'failed_turn'].includes(row.display_kind) || row.display_metadata?.model_only
      || typeof text !== 'string' || !text.trim() || !Number.isSafeInteger(row.row_id) || row.row_id <= after) continue;
    await appendConversationReplyOnce({ projectId: scope.projectId, conversationId: scope.projectId, message: {
      role: 'assistant', content: text, speaker: speaker(card), providerContinuationRef: sessionId,
      providerMessageId: `hermes:${card.profile}:row:${row.row_id}`,
    } });
  }
}

router.get('/history', async (req, res) => {
  try {
    const scope = await context(req, res);
    if (!scope) return;
    const { projectId, authority, roster } = scope;
    let stored = await getConversationMessages(projectId, projectId);
    const prefix = `hermes:${authority.main.profile}:row:`;
    const previous = stored.filter(row => row.providerMessageId?.startsWith(prefix)).pop();
    if (previous) {
      await assertCardProfileOwner(authority.main.profile, scope.ownerUserId);
      const sessionId = await findExistingCanonicalChat(authority.main.profile);
      if (!sessionId) throw new Error('main_conversation_unavailable');
      await refreshOpenBotChat(scope, authority.main, sessionId, Number(previous.providerMessageId!.slice(prefix.length)));
      stored = await getConversationMessages(projectId, projectId);
    }
    res.json({ sessionId: stored[stored.length - 1]?.providerContinuationRef || '',
      addressableAgents: roster.map(card => ({ cardId: card.card.id, title: card.title, address: card.address })),
      messages: stored.map(row => {
        const author = row.visibleActivities?.find(activity => activity.kind === 'conversation_speaker');
        const label = author?.status === 'card' && author.cardId !== authority.main.card.id ? `@${author.address || author.label} ` : '';
        return { messageId: row.messageId, role: row.role, text: label + row.content, status: row.status };
      }) });
  } catch (error) { failure(res, error); }
});

router.post('/chat', async (req, res) => {
  let detach = () => {};
  res.once('close', () => detach());
  try {
    const { message, clientMessageId: submissionId } = req.body;
    if (typeof message !== 'string' || !message.trim() || typeof submissionId !== 'string' || !submissionId) {
      res.status(400).json({ error: 'main_input_required' }); return;
    }
    if (req.body.dataAnchors?.length) { res.status(422).json({ error: 'main_data_anchor_transport_unavailable' }); return; }
    const scope = await context(req, res);
    if (!scope) return;
    const card = addressedCard(scope, message);
    await prepareProfiles(scope, card);
    const sessionId = await openBotCanonicalChat(card.profile);
    const history = await requestForBot(card.profile, 'session.history', { session_id: sessionId });
    const before = history.messages.reduce((id: number, row: Rpc) => Number.isSafeInteger(row.row_id) ? Math.max(id, row.row_id) : id, 0);
    const attachments = [];
    for (const image of req.body.images || []) {
      const attached = await requestForBot(card.profile, 'image.attach_bytes', { session_id: sessionId, content_base64: image.dataUrl, filename: image.name });
      attachments.push({ path: attached.path, mime: attached.mime });
    }
    if (res.destroyed) return;
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.flushHeaders();
    const send = (kind: string, data: Rpc) => res.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
    send('session', { projectId: scope.projectId, deckId: scope.deckId, cardId: card.card.id, sessionId });
    const prefix = card === scope.authority.main ? '' : `@${card.address} `;
    let started = false;
    let submission: Promise<Rpc>;
    const { client } = await gateway();
    const offEvent = client.onEvent((event: Rpc) => {
      if (event.profile !== card.profile || event.session_id !== sessionId) return;
      void submission.then(async receipt => {
        if (res.writableEnded || res.destroyed) return;
        const payload = event.payload || {};
        if (event.type === 'session.info' && payload.pending?.some((row: Rpc) => row.admission_id === receipt.admission_id && row.steering)) {
          send('done', { fullText: '' }); res.end(); return;
        }
        if (event.admission_id !== receipt.admission_id) return;
        if (event.type === 'message.delta' && typeof payload.text === 'string' && payload.text) {
          send('text', { text: (started ? '' : prefix) + payload.text }); started = true;
        }
        if (event.type !== 'message.complete') return;
        if (payload.error || payload.status === 'error') throw new Error(String(payload.error || payload.failure_reason || 'card_turn_failed'));
        const text = typeof payload.text === 'string' ? payload.text : '';
        await refreshOpenBotChat(scope, card, sessionId, before);
        send('done', { fullText: text ? prefix + text : '', speechText: text }); res.end();
      }).catch(error => failure(res, error));
    });
    const offState = client.onState((state: string) => {
      if (state === 'closed' || state === 'error') failure(res, new Error('main_gateway_disconnected'));
    });
    detach = () => { offEvent(); offState(); };
    submission = requestForBot(card.profile, 'prompt.submit', { session_id: sessionId, text: message,
      ...(req.body.voiceTurn === true ? { voice_turn: true } : {}),
      submission_id: submissionId, ...(attachments.length ? { attachments } : {}) }).then(async receipt => {
      if (receipt.admission_id) await appendConversationTurn({ projectId: scope.projectId, conversationId: scope.projectId, messages: [{
        messageId: submissionId, role: 'user', content: message, speaker: { kind: 'user', label: 'You' }, target: speaker(card),
        providerContinuationRef: sessionId, providerMessageId: `hermes:${card.profile}:admission:${receipt.admission_id}` }] });
      return receipt;
    });
    const receipt = await submission;
    if (receipt.voice_stopped || (receipt.status === 'terminal' && ['steering', 'steered'].includes(receipt.outcome))) {
      send('done', { fullText: '' }); res.end();
    }
  } catch (error) { detach(); failure(res, error); }
});

for (const operation of ['transcribe', 'speak'] as const) {
  router.post(`/voice/${operation}`, async (req, res) => {
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    try {
      const scope = await context(req, res);
      if (!scope) return;
      const card = operation === 'speak'
        ? [scope.authority.main, ...scope.roster].find(item => item.card.id === req.body.cardId)
        : addressedCard(scope, typeof req.body.message === 'string' ? req.body.message : '');
      if (!card) { res.status(403).json({ error: 'main_agent_address_unavailable' }); return; }
      await assertCardProfileOwner(card.profile, scope.ownerUserId);
      const body = operation === 'transcribe'
        ? { data_url: req.body.dataUrl, mime_type: req.body.mimeType }
        : { text: req.body.text };
      const result = await (await gateway()).audio(card.profile, operation, body, controller.signal);
      if (!res.destroyed) res.json(result);
    } catch (error) { if (!controller.signal.aborted) failure(res, error); }
  });
}

router.post('/stop', async (req, res) => {
  try {
    const scope = await context(req, res);
    if (!scope) return;
    for (const card of [scope.authority.main, ...scope.roster]) {
      if (await findExistingCanonicalChat(card.profile) !== req.body.sessionId) continue;
      await assertCardProfileOwner(card.profile, scope.ownerUserId);
      res.json({ ok: true, result: await requestForBot(card.profile, 'session.interrupt', { session_id: req.body.sessionId }) }); return;
    }
    res.status(409).json({ error: 'main_session_changed' });
  } catch (error) { failure(res, error); }
});

export default router;
