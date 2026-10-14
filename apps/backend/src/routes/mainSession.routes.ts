import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  appendSharedConversationReplyOnce,
  appendSharedConversationTurn,
  getConversationMessages,
  listConversations,
  type ConversationMessage,
  type SharedChatParticipant,
} from '../conversations/store';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { getOwnedProjectByReference } from '../services/projectStore';
import {
  sharedChatAuthority,
  type AddressableCard,
  type SharedChatAuthority,
} from '../services/savedCardAuthority';
import {
  hermesGateway,
  type HermesGatewayClient,
  type HermesGatewayEvent,
} from '../services/hermesGateway';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import {
  internalMcpAuthorization,
  resolveInternalMcpUrl,
} from '../services/mcp/internalMcpAuth';
import { readToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import { resolveProductChatWorkingDirectory } from '../services/workingDirectories';
import {
  materializeSavedCardProfile,
  savedCardBotRoster,
} from '../hermes/profileMaterialization';

export const mainSessionRoutes = Router();

const MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_PARTICIPANT: SharedChatParticipant = { kind: 'user', label: 'You' };

export type SessionBinding = {
  sessionId: string;
  storedSessionId: string;
  info: Record<string, unknown>;
  botModeRoster: string[];
  profileCapabilityFingerprint: string;
};

// Hermes Desktop treats (profile, exact title) as the session registry. Keep
// the list/create critical section single-flight without caching any session id.
const sessionBindingTails = new Map<string, Promise<void>>();

async function withSessionBindingLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionBindingTails.get(key) || Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => completion);
  sessionBindingTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (sessionBindingTails.get(key) === tail) sessionBindingTails.delete(key);
  }
}

type PreparedRun = {
  runId: string;
  cardId: string;
  request: Record<string, unknown>;
  prepared: Record<string, any>;
};

type DynamicToolDefinition = {
  type: 'function';
  name: string;
  canonical_name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function exactStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
}

function dynamicToolDefinitions(value: unknown): DynamicToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const seenNames = new Set<string>();
  return value.map(record).map((definition, index) => {
    const canonicalName = String(definition.canonicalId || '').trim();
    const publications = exactStrings(definition.publications);
    const inputSchema = record(definition.inputSchema);
    if (
      !canonicalName
      || definition.available !== true
      || !publications.some((item) => item === 'card-runtime' || item === 'external-mcp')
      || !Object.keys(inputSchema).length
    ) {
      throw new Error(`dynamic_tool_contract_unavailable:${canonicalName || index}`);
    }
    const stem = canonicalName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 72)
      || `tool_${index + 1}`;
    const suffix = createHash('sha256').update(canonicalName).digest('hex').slice(0, 10);
    const name = `card__${stem}__${suffix}`;
    if (seenNames.has(name)) throw new Error(`dynamic_tool_name_collision:${canonicalName}`);
    seenNames.add(name);
    return {
      type: 'function' as const,
      name,
      canonical_name: canonicalName,
      description: String(definition.description || ''),
      input_schema: inputSchema,
    };
  });
}

async function authorizeProject(req: Request, res: Response, projectId: string): Promise<string | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'main_owner_authentication_required' });
    return null;
  }
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'main_project_access_denied' });
    return null;
  }
  return userId;
}

function participant(card: AddressableCard): SharedChatParticipant {
  return {
    kind: 'card',
    label: card.title,
    cardId: card.card.id,
    profile: card.profile,
    ...(card.address ? { address: card.address } : {}),
  };
}

function participantFromMessage(
  message: ConversationMessage,
  kind: 'shared_chat_speaker' | 'shared_chat_target',
): SharedChatParticipant | null {
  const activity = message.visibleActivities?.find((item) => item.kind === kind);
  if (!activity?.label) return null;
  return {
    kind: activity.status === 'user' ? 'user' : 'card',
    label: activity.label,
    ...(activity.cardId ? { cardId: activity.cardId } : {}),
    ...(activity.profile ? { profile: activity.profile } : {}),
    ...(activity.address ? { address: activity.address } : {}),
  };
}

function sharedMessage(message: ConversationMessage) {
  const speaker = participantFromMessage(message, 'shared_chat_speaker')
    || (message.role === 'user' ? USER_PARTICIPANT : null);
  if (!speaker || (message.role !== 'user' && message.role !== 'assistant')) return null;
  const target = participantFromMessage(message, 'shared_chat_target');
  return {
    messageId: message.messageId,
    seq: message.seq,
    role: message.role,
    text: message.content,
    speaker,
    ...(target ? { target } : {}),
  };
}

function sessionRows(value: unknown): Array<Record<string, any>> {
  const rows = record(value).sessions;
  if (!Array.isArray(rows)) throw new Error('hermes_session_list_invalid');
  return rows.map(record);
}

function sessionResult(
  value: unknown,
  botModeRoster: string[],
  profileCapabilityFingerprint: string,
): SessionBinding {
  const result = record(value);
  const sessionId = String(result.session_id || '').trim();
  const storedSessionId = String(result.stored_session_id || result.session_key || '').trim();
  if (!sessionId || !storedSessionId) throw new Error('hermes_session_binding_invalid');
  return {
    sessionId,
    storedSessionId,
    info: record(result.info),
    botModeRoster: [...botModeRoster],
    profileCapabilityFingerprint,
  };
}

export async function cardSession(
  client: HermesGatewayClient,
  authority: SharedChatAuthority,
): Promise<SessionBinding> {
  const card = authority.main;
  const title = 'Bot Chat';
  const profile = card.profile;
  return withSessionBindingLock(JSON.stringify([profile, title]), async () => {
    const roster = savedCardBotRoster(authority.deck, card.card);
    const profileState = record(await materializeSavedCardProfile(
      (method, params = {}) => client.request(method, params),
      card.card,
      roster,
    ));
    const profileModel = record(profileState.model);
    const profileCapabilityFingerprint = String(
      profileState.capability_fingerprint || '',
    ).trim();
    if (!profileCapabilityFingerprint) {
      throw new Error('hermes_profile_capability_fingerprint_missing');
    }
    const completeBinding = (binding: SessionBinding): SessionBinding => ({
      ...binding,
      info: {
        provider: String(profileModel.provider || ''),
        model: String(profileModel.default || ''),
        ...binding.info,
      },
    });
    const listExactSession = async () => sessionRows(await client.request('session.list', {
      profile,
      title,
      include_hidden: true,
      limit: 200,
    }));
    const resumeExactSession = async (row: Record<string, any>) => {
      const stored = String(row.resolved_id || row.id || '').trim();
      if (!stored) throw new Error('hermes_session_binding_invalid');
      return completeBinding(sessionResult(await client.request('session.resume', {
        session_id: stored,
        profile,
        omit_messages: true,
        close_on_disconnect: false,
        bot_mode_roster: roster,
      }), roster, profileCapabilityFingerprint));
    };
    const listed = await listExactSession();
    if (listed.length > 1) throw new Error('hermes_session_binding_ambiguous');
    if (listed.length === 1) return resumeExactSession(listed[0]);
    try {
      return completeBinding(sessionResult(await client.request('session.create', {
        profile,
        title,
        cwd: resolveProductChatWorkingDirectory(),
        source: 'desktop',
        hidden: true,
        close_on_disconnect: false,
        follow_profile_config: true,
        bot_mode_roster: roster,
      }), roster, profileCapabilityFingerprint));
    } catch (createError) {
      const adopted = await listExactSession();
      if (adopted.length === 1) return resumeExactSession(adopted[0]);
      throw createError;
    }
  });
}

async function ensureSavedCardTurnModel(args: {
  client: HermesGatewayClient;
  binding: SessionBinding;
  profile: string;
  runRequest: Record<string, unknown>;
}): Promise<void> {
  const provider = record(args.runRequest.provider);
  const desiredModel = String(provider.providerModelId || '').trim();
  const liveProvider = String(args.binding.info.provider || '').trim();
  if (!desiredModel || !liveProvider) throw new Error('hermes_session_model_binding_invalid');
  if (String(args.binding.info.model || '').trim() !== desiredModel) {
    const changed = record(await args.client.request('config.set', {
      profile: args.profile,
      session_id: args.binding.sessionId,
      key: 'model',
      value: `${desiredModel} --provider ${liveProvider} --session`,
      scope: 'session',
      confirm_expensive_model: false,
    }));
    if (
      String(changed.key || '') !== 'model'
      || String(changed.value || '') !== desiredModel
      || String(changed.scope || '') !== 'session'
      || changed.deferred === true
      || changed.confirm_required === true
    ) throw new Error('hermes_session_model_apply_failed');
  }
  const activated = record(await args.client.request('session.activate', {
    profile: args.profile,
    session_id: args.binding.sessionId,
    omit_messages: true,
    bot_mode_roster: args.binding.botModeRoster,
  }));
  const info = record(activated.info);
  const mismatches = [
    ...(String(activated.session_id || '') === args.binding.sessionId ? [] : ['live_session_id']),
    ...(String(activated.stored_session_id || activated.session_key || '')
      === args.binding.storedSessionId ? [] : ['stored_session_id']),
    ...(activated.messages_omitted === true ? [] : ['messages_omitted']),
    ...(String(info.provider || '') === liveProvider ? [] : ['provider']),
    ...(String(info.model || '') === desiredModel ? [] : ['model']),
  ];
  if (mismatches.length) {
    throw new Error(`hermes_session_model_readback_mismatch:${mismatches.join(',')}`);
  }
  args.binding.info = info;
}

async function prepareRun(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  message: string;
  target: AddressableCard;
  dataAnchors: unknown[];
  images: unknown[];
  runId?: string;
  originatingRunId?: string;
  senderCardId?: string;
  onAccepted?(runId: string): void;
}): Promise<PreparedRun> {
  const runId = args.runId || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const toolCatalog = await readToolCatalog();
  const payload = {
    projectId: args.projectId,
    deckId: args.deckId,
    cardId: args.target.card.id,
    runId,
    correlationId: runId,
    acceptedAt: new Date().toISOString(),
    conversationId: args.conversationId,
    dataAnchors: args.dataAnchors,
    images: args.images,
    discoveredTools: toolCatalog.tools,
    discoveredToolCatalogState: toolCatalog.state,
    unavailableToolCatalogFamilies: toolCatalog.unavailableFamilies,
    discoveredToolFailures: toolCatalog.toolFailures,
    ...(args.originatingRunId ? { originatingRunId: args.originatingRunId } : {}),
    ...(args.senderCardId ? { senderCardId: args.senderCardId } : {}),
  };
  const prepared = record(await requestPythonRailsJson(
    '/domain/runs/begin',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, assignment: args.message }),
    },
  ));
  args.onAccepted?.(runId);
  const transport = record(prepared.hermesTransport);
  const request = record(transport.request);
  if (
    String(prepared.runId || '') !== runId
    || String(transport.cardIdentity?.cardId || '') !== args.target.card.id
    || String(request.runtime?.profile || '') !== args.target.profile
    || !String(request.message || '').trim()
  ) {
    throw new Error('saved_card_preparation_identity_mismatch');
  }
  return { runId, cardId: args.target.card.id, request, prepared };
}

async function attachImages(
  client: HermesGatewayClient,
  binding: SessionBinding,
  profile: string,
  images: unknown,
): Promise<void> {
  if (!Array.isArray(images)) return;
  for (const [index, raw] of images.entries()) {
    const image = record(raw);
    const dataUrl = String(image.dataUrl || '').trim();
    if (!dataUrl) continue;
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) throw new Error('attachment_image_invalid');
    await client.request('image.attach_bytes', {
      session_id: binding.sessionId,
      profile,
      content_base64: match[2],
      filename: String(image.name || `attachment-${index + 1}.png`),
    });
  }
}

function writeSse(res: Response, eventName: string, payload: Record<string, unknown>): boolean {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  return true;
}

async function submitTurn(args: {
  client: HermesGatewayClient;
  binding: SessionBinding;
  profile: string;
  text: string;
  submissionId: string;
  dynamicTools: DynamicToolDefinition[];
  toolEndpoint: string;
  toolAuthorization: string;
  onEvent(event: HermesGatewayEvent): void;
  signal?: AbortSignal;
  interrupt?(): Promise<void>;
  onSubmissionIssued?(): void;
}): Promise<{ text: string; event: HermesGatewayEvent; toolCalls: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let interruptionStarted = false;
    let toolCalls = 0;
    let submitStatus = '';
    let ownTurnStarted = false;
    let submitRequested = false;
    let submitSettled = false;
    let pendingInterruptError: Error | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let detach: () => void = () => undefined;
    const onAbort = () => fail(new Error('hermes_turn_cancelled'), true);
    const finish = (error?: Error, value?: { text: string; event: HermesGatewayEvent }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detach();
      args.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve({ ...value!, toolCalls });
    };
    const beginInterrupt = (error: Error) => {
      if (settled) return;
      if (!args.interrupt) {
        finish(error);
        return;
      }
      if (interruptionStarted) return;
      interruptionStarted = true;
      void args.interrupt().then(
        () => finish(error),
        (interruptError) => finish(new Error(
          `hermes_target_interrupt_failed:${interruptError instanceof Error
            ? interruptError.message
          : String(interruptError)}`,
        )),
      );
    };
    const fail = (error: Error, interrupt: boolean) => {
      if (settled) return;
      if (!interrupt || !args.interrupt) {
        finish(error);
        return;
      }
      if (submitRequested && !submitSettled) {
        pendingInterruptError ||= error;
        return;
      }
      beginInterrupt(error);
    };
    detach = args.client.onEvent((event) => {
      if (event.session_id !== args.binding.sessionId) return;
      const eventSubmissionId = String(event.payload?.submission_id || '');
      if (event.type === 'prompt.submission.started') {
        if (eventSubmissionId !== args.submissionId) return;
        ownTurnStarted = true;
      }
      if (!ownTurnStarted) return;
      if (eventSubmissionId && eventSubmissionId !== args.submissionId) return;
      args.onEvent(event);
      if (event.type === 'tool.start') toolCalls += 1;
      if (event.type === 'error') {
        fail(new Error(String(event.payload?.message || 'hermes_turn_failed')), false);
        return;
      }
      if (event.type !== 'message.complete') return;
      const status = String(event.payload?.status || 'complete');
      const text = String(event.payload?.text || '');
      if (['error', 'failed'].includes(status)) {
        fail(new Error(String(event.payload?.error || text || 'hermes_turn_failed')), false);
        return;
      }
      finish(undefined, { text, event });
    });
    timer = setTimeout(() => fail(new Error('hermes_turn_timeout'), true), 30 * 60_000);
    timer.unref?.();
    args.signal?.addEventListener('abort', onAbort, { once: true });
    if (args.signal?.aborted) {
      onAbort();
      return;
    }
    submitRequested = true;
    void args.client.request<Record<string, unknown>>('prompt.submit', {
      session_id: args.binding.sessionId,
      profile: args.profile,
      text: args.text,
      queued: true,
      submission_id: args.submissionId,
      bot_mode_roster: args.binding.botModeRoster,
      expected_profile_capability_fingerprint: args.binding.profileCapabilityFingerprint,
      ...(args.dynamicTools.length ? {
        dynamic_tools: args.dynamicTools,
        tool_endpoint: args.toolEndpoint,
        tool_authorization: args.toolAuthorization,
      } : {}),
    }).then((submitted) => {
      submitSettled = true;
      args.onSubmissionIssued?.();
      if (pendingInterruptError) {
        beginInterrupt(pendingInterruptError);
        return;
      }
      submitStatus = String(submitted.status || 'streaming');
      if (!['streaming', 'queued'].includes(submitStatus)) {
        fail(new Error(`hermes_submit_status_unsupported:${submitStatus || 'missing'}`), true);
      }
    }).catch((error) => {
      submitSettled = true;
      args.onSubmissionIssued?.();
      beginInterrupt(
        pendingInterruptError
        || (error instanceof Error ? error : new Error(String(error))),
      );
    });
  });
}

function usageFields(event: HermesGatewayEvent): Record<string, number | null> {
  const usage = record(event.payload?.usage);
  const number = (...values: unknown[]): number | null => {
    const value = values.find((item) => typeof item === 'number' && Number.isFinite(item));
    return typeof value === 'number' ? value : null;
  };
  return {
    providerInputTokens: number(usage.input, usage.prompt, usage.input_tokens),
    providerOutputTokens: number(usage.output, usage.completion, usage.output_tokens),
    providerCachedTokens: number(usage.cached, usage.cached_tokens),
    providerReasoningTokens: number(usage.reasoning, usage.reasoning_tokens),
    totalCostUsd: number(usage.cost_usd, usage.total_cost_usd),
  };
}

async function finishRun(args: {
  run: PreparedRun;
  binding: SessionBinding;
  result?: { text: string; event: HermesGatewayEvent; toolCalls: number };
  error?: unknown;
}): Promise<void> {
  const provider = record(args.binding.info);
  const runtimeOptions = record(args.run.request.runtimeOptions);
  const requestedProvider = record(args.run.request.provider);
  const usage = args.result ? usageFields(args.result.event) : {};
  await requestPythonRailsJson('/domain/runs/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: args.run.runId,
      state: args.error ? 'failed' : 'completed',
      finalResult: args.result?.text,
      errorCode: args.error ? 'hermes_turn_failed' : undefined,
      errorSummary: args.error instanceof Error ? args.error.message : args.error ? String(args.error) : undefined,
      hermesSessionRef: args.binding.storedSessionId,
      providerTurnRef: args.result?.event.payload?.submission_id,
      effectiveProvider: String(provider.provider || requestedProvider.provider || ''),
      providerApiMode: String(runtimeOptions.openaiRuntime || ''),
      model: String(provider.model || requestedProvider.providerModelId || ''),
      provider: String(provider.provider || requestedProvider.provider || ''),
      toolCallCount: args.result?.toolCalls ?? 0,
      ...usage,
    }),
  });
}

mainSessionRoutes.post('/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'main').trim();
  const message = String(req.body?.message || '');
  const clientMessageId = String(req.body?.clientMessageId || '').trim();
  const clientReplyMessageId = String(req.body?.clientReplyMessageId || '').trim();
  if (!projectId || !conversationId || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'project_conversation_message_required' });
  }
  if (
    !MESSAGE_ID_PATTERN.test(clientMessageId)
    || !MESSAGE_ID_PATTERN.test(clientReplyMessageId)
    || clientMessageId === clientReplyMessageId
  ) {
    return res.status(400).json({ ok: false, error: 'shared_chat_message_identity_invalid' });
  }
  let userId: string | null;
  try {
    userId = await authorizeProject(req, res, projectId);
  } catch {
    return res.status(503).json({ ok: false, error: 'main_project_authority_unavailable' });
  }
  if (!userId) return undefined;

  let authority: SharedChatAuthority;
  let target: AddressableCard;
  try {
    authority = await sharedChatAuthority(projectId, deckId);
    target = authority.main;
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'shared_chat_authority_unavailable',
    });
  }

  try {
    await appendSharedConversationTurn({
      projectId,
      conversationId,
      messages: [{
        messageId: clientMessageId,
        role: 'user',
        content: message,
        speaker: USER_PARTICIPANT,
        target: participant(target),
      }],
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_message_persist_failed',
    });
  }

  let run: PreparedRun;
  try {
    run = await prepareRun({
      projectId,
      deckId,
      conversationId,
      message,
      target,
      dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'saved_card_preparation_failed',
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const identity = {
    projectId,
    deckId,
    conversationId,
    cardId: target.card.id,
    runId: run.runId,
    participant: participant(target),
    userMessageId: clientMessageId,
    assistantMessageId: clientReplyMessageId,
  };
  writeSse(res, 'run', { ...identity, state: 'preparing' });

  let binding: SessionBinding | null = null;
  try {
    const client = await hermesGateway();
    binding = await cardSession(client, authority);
    await ensureSavedCardTurnModel({
      client,
      binding,
      profile: target.profile,
      runRequest: run.request,
    });
    await attachImages(client, binding, target.profile, run.request.images);
    const dynamicTools = dynamicToolDefinitions(run.request.toolDefinitions);
    const runtime = record(run.request.runtime);
    const runtimeMode = String(runtime.mode || '').trim();
    if (!['main', 'delegate', 'magentic_one'].includes(runtimeMode)) {
      throw new Error('dynamic_tool_runtime_mode_invalid');
    }
    const toolAuthorization = internalMcpAuthorization({
      kind: 'card-runtime',
      projectId,
      deckId,
      conversationId,
      parentRunId: run.runId,
      callerCardId: target.card.id,
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: runtimeMode as 'main' | 'delegate' | 'magentic_one',
      grantedTools: exactStrings(run.request.enabledTools),
      presentedTools: dynamicTools.map((tool) => tool.canonical_name),
    });
    writeSse(res, 'session', {
      ...identity,
      sessionId: binding.sessionId,
      storedSessionId: binding.storedSessionId,
      configuration: {
        profile: target.profile,
        unavailableTools: exactStrings(run.request.unavailableTools),
      },
    });
    writeSse(res, 'run', { ...identity, state: 'running' });
    const result = await submitTurn({
      client,
      binding,
      profile: target.profile,
      text: String(run.request.message),
      submissionId: run.runId,
      dynamicTools,
      toolEndpoint: resolveInternalMcpUrl(),
      toolAuthorization,
      onEvent: (event) => {
        if (event.type === 'message.delta') {
          writeSse(res, 'text', { ...identity, text: String(event.payload?.text || '') });
        } else if (event.type.includes('reasoning')) {
          writeSse(res, 'reasoning', { ...identity, event });
        } else if (event.type === 'tool.start') {
          writeSse(res, 'tool_start', { ...identity, event });
        } else if (event.type === 'tool.complete') {
          writeSse(res, 'tool_result', { ...identity, event });
        }
      },
    });
    if (!result.text.trim()) throw new Error('hermes_empty_response');
    await finishRun({ run, binding, result });
    await appendSharedConversationReplyOnce({
      projectId,
      conversationId,
      message: {
        messageId: clientReplyMessageId,
        role: 'assistant',
        content: result.text,
        speaker: participant(target),
        target: USER_PARTICIPANT,
        providerContinuationRef: binding.storedSessionId,
        providerMessageId: `run:${run.runId}`,
      },
    });
    writeSse(res, 'done', { ...identity, fullText: result.text });
  } catch (error) {
    if (binding) await finishRun({ run, binding, error }).catch(() => undefined);
    writeSse(res, 'error', {
      ...identity,
      code: error instanceof Error ? error.message : 'hermes_turn_failed',
      message: error instanceof Error ? error.message : 'The Hermes turn failed.',
      correlationId: run.runId,
      route: '/api/main/session/chat',
      status: 502,
    });
  } finally {
    writeSse(res, 'end', identity);
    res.end();
  }
  return undefined;
});

mainSessionRoutes.post('/voice/start', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'main').trim();
  const ttsRequested = req.body?.tts !== false;
  if (!projectId || !deckId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'voice_scope_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;

  let client: HermesGatewayClient;
  let binding: SessionBinding;
  let target: AddressableCard;
  let status: Record<string, any>;
  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    target = authority.main;
    client = await hermesGateway();
    binding = await cardSession(client, authority);
    status = record(await client.request('voice.toggle', {
      action: 'status',
      profile: target.profile,
      session_id: binding.sessionId,
    }, 60_000));
    if (status.available === false || status.stt_available === false) {
      return res.status(503).json({ ok: false, error: 'hermes_voice_unavailable' });
    }
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'voice_start_failed',
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  const identity = {
    projectId,
    deckId,
    conversationId,
    cardId: target.card.id,
    sessionId: binding.sessionId,
  };
  const detach = client.onEvent((event) => {
    if (event.session_id !== binding.sessionId) return;
    if (event.type === 'voice.status') {
      writeSse(res, 'status', { ...identity, event });
    } else if (event.type === 'voice.transcript') {
      writeSse(res, 'transcript', { ...identity, event });
    } else if (event.type === 'voice.interrupted') {
      writeSse(res, 'status', {
        ...identity,
        event: { ...event, payload: { state: 'interrupted' } },
      });
    }
  });
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    detach();
    void client.request('voice.toggle', {
      action: 'off',
      profile: target.profile,
      session_id: binding.sessionId,
    }, 60_000).catch(() => undefined);
  };
  req.once('aborted', cleanup);
  res.once('close', cleanup);

  try {
    let voiceState = record(await client.request('voice.toggle', {
      action: 'on',
      profile: target.profile,
      session_id: binding.sessionId,
    }, 60_000));
    if (ttsRequested && voiceState.tts !== true) {
      voiceState = record(await client.request('voice.toggle', {
        action: 'tts',
        profile: target.profile,
        session_id: binding.sessionId,
      }, 60_000));
    }
    const recording = record(await client.request('voice.record', {
      action: 'start',
      profile: target.profile,
      session_id: binding.sessionId,
    }, 60_000));
    if (recording.status !== 'recording') throw new Error('voice_capture_busy');
    writeSse(res, 'ready', {
      ...identity,
      state: {
        enabled: voiceState.enabled === true,
        tts: voiceState.tts === true,
        available: status.available === true,
        audioAvailable: status.audio_available === true,
        sttAvailable: status.stt_available === true,
        details: String(status.details || ''),
        recordStatus: recording.status,
      },
    });
  } catch (error) {
    writeSse(res, 'error', {
      ...identity,
      error: error instanceof Error ? error.message : 'voice_start_failed',
    });
    res.end();
  }
  return undefined;
});

mainSessionRoutes.post('/voice/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'main').trim();
  const cancel = req.body?.cancel === true;
  if (!projectId || !deckId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'voice_scope_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    const target = authority.main;
    const client = await hermesGateway();
    const binding = await cardSession(client, authority);
    const result = record(await client.request(
      cancel ? 'voice.toggle' : 'voice.record',
      cancel
        ? { action: 'off', profile: target.profile, session_id: binding.sessionId }
        : { action: 'stop', profile: target.profile, session_id: binding.sessionId },
      60_000,
    ));
    return res.json({ ok: true, state: String(result.status || (cancel ? 'off' : 'stopped')) });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'voice_stop_failed',
    });
  }
});

mainSessionRoutes.get('/history', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || 'main').trim();
  if (!projectId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'project_conversation_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    const messages = (await getConversationMessages(projectId, conversationId))
      .map(sharedMessage)
      .filter((message): message is NonNullable<ReturnType<typeof sharedMessage>> => message !== null);
    return res.json({
      ok: true,
      mainCardId: authority.main.card.id,
      addressableAgents: authority.cards
        .filter((card) => card.card.id !== authority.main.card.id)
        .map((card) => ({
          cardId: card.card.id,
          cardRevisionId: card.cardRevisionId,
          profile: card.profile,
          title: card.title,
          address: card.address || '',
          aliases: card.aliases,
        })),
      messages,
      runtimeEvents: [],
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_history_read_failed',
    });
  }
});

mainSessionRoutes.get('/conversations', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'project_id_required' });
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  return res.json({ ok: true, conversations: await listConversations(projectId) });
});

mainSessionRoutes.post('/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  const expectedRunId = String(req.body?.expectedRunId || '').trim();
  if (!projectId || !deckId || !conversationId || !expectedRunId) {
    return res.status(400).json({ ok: false, error: 'project_conversation_and_expected_run_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    const target = authority.main;
    const client = await hermesGateway();
    const storedRows = sessionRows(await client.request('session.list', {
      profile: target.profile,
      title: 'Bot Chat',
      include_hidden: true,
      limit: 200,
    }));
    if (storedRows.length !== 1) {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    const storedSessionId = String(storedRows[0].resolved_id || storedRows[0].id || '').trim();
    const active = record(await client.request('session.active_list', { profile: target.profile })).sessions;
    const sessions = Array.isArray(active) ? active.map(record) : [];
    const activeMatches = sessions.filter((item) => (
      String(item.session_key || '').trim() === storedSessionId
    ));
    if (activeMatches.length !== 1) {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    const sessionId = String(activeMatches[0].id || '').trim();
    if (!sessionId) return res.status(409).json({ ok: false, error: 'no_active_turn' });
    const interrupted = record(await client.request('session.interrupt', {
      session_id: sessionId,
      expected_submission_id: expectedRunId,
    }));
    if (interrupted.status !== 'interrupted') {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    return res.json({ ok: true, runId: expectedRunId, state: 'stopping' });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_run_stop_failed',
    });
  }
});

export default mainSessionRoutes;
