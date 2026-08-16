import { Router } from 'express';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import type { OpenClaudeRunRequest } from '../coder/openclaude/contracts';
import { openClaudeRuntimeService } from '../coder/openclaude/runtime/service';
import { localCoderService } from '../coder/localcoder/service';
import {
  hermesConsoleSessionManager,
  openClaudeConsoleSessionManager,
  type ConsoleMode,
} from '../coder/openclaude/console/consoleSession';
import { runConfiguredCard } from '../cards/runtime';
import { resolveRepoRoot } from '../coder/workspaceRoot';
import {
  describeConnectedAgents,
  runMagOne,
} from '../coder/openclaude/mcp/mainAgentFlow';
import {
  deriveHermesSessionKey,
  resolveMainHermesRuntimeConfig,
  resolveHermesCardRuntimeConfig,
  requestHermesCodexAccount,
  startHermesTurn,
  type HermesSessionEvent,
  type HermesTurnHandle,
} from '../hermes/mainAdapter';
import {
  beginConversationRun,
  cancelConversationRun,
  completeConversationRun,
  failConversationRun,
  getConversationMessages,
  listConversations,
  markConversationRunRunning,
} from '../conversations/store';
import { formatHarnessTrace, logHarnessTrace, redactTrace } from '../services/harnessTrace';
// The app's one canonical Agent Canvas deck id, defined once on the deck store.
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveExternalIdentityMainGrant } from '../auth/externalIdentityGrantStore';
import {
  createInputDataFileOnPython,
  approveInputDataFileOnPython,
  fetchInputDataFile,
  requestPythonRailsJson,
  reviseInputDataFileOnPython,
} from '../services/autogen/autogenOrchestratorClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import {
  indexToolCatalogReferences,
  searchToolCatalogReferences,
  type ToolCatalogReference,
} from '../cards/toolCatalogProjection';
import { listConfiguredModelOptions } from '../llm/models.config';
import { parseCoderJobContext } from '../contracts/coderContracts';

const router = Router();

router.get('/input-data-dictionary/card-editor', async (_req, res) => {
  try {
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
    const materialized = await requestPythonRailsJson('/idd/card-editor/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: listConfiguredModelOptions(openaiDefault) }),
    }) as Record<string, unknown>;
    if (
      !materialized?.dictionary
      || !Array.isArray(materialized.fields)
      || !materialized.catalogs
      || typeof materialized.catalogs !== 'object'
    ) {
      throw new Error('input_data_dictionary_card_editor_invalid');
    }
    return res.json({ ok: true, ...materialized });
  } catch {
    return res.status(503).json({
      ok: false,
      error: 'input_data_dictionary_card_editor_unavailable',
      fields: [],
      catalogs: { 'configured-models': [] },
    });
  }
});

router.get('/input-data-dictionary/tools', async (req, res) => {
  try {
    const canonicalMcpTools = await listPythonAgentMcpCatalog();
    const privateRuntimeManifest = await requestPythonRailsJson('/tools/manifest', {
      method: 'GET',
    }) as { tools?: unknown };
    if (!Array.isArray(privateRuntimeManifest?.tools)) {
      throw new Error('python_runtime_tool_manifest_invalid');
    }
    const materialized = await requestPythonRailsJson('/idd/tools/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: [
          ...canonicalMcpTools,
          ...privateRuntimeManifest.tools,
        ],
      }),
    }) as { references?: unknown };
    if (!Array.isArray(materialized?.references)) {
      throw new Error('input_data_dictionary_tool_catalog_invalid');
    }
    const catalog = indexToolCatalogReferences(
      materialized.references as ToolCatalogReference[],
    );
    const selectedIds = Array.isArray(req.query.selectedIds)
      ? req.query.selectedIds.map(String)
      : typeof req.query.selectedIds === 'string'
        ? req.query.selectedIds.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    return res.json({
      ok: true,
      ...searchToolCatalogReferences(catalog, {
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        namespace: typeof req.query.namespace === 'string' ? req.query.namespace : undefined,
        selectedIds,
        offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      }),
    });
  } catch {
    return res.status(503).json({
      ok: false,
      error: 'input_data_dictionary_tool_catalog_unavailable',
      references: [],
      selectedKnownReferences: [],
      unresolvedSelectedIds: [],
      namespaces: [],
      total: 0,
      offset: 0,
      limit: 0,
      hasMore: false,
    });
  }
});

// ── Main MCP bridge (SDK-free) ─────────────────────────────────────────────
// Internal JSON endpoints that run the proven MCP handlers server-side, where
// the backend already owns deck state + the Python transport. These import NO
// MCP SDK (mainAgentFlow.ts is SDK-free), so they are safe in the Nx serve
// graph. The separate MCP host process (which DOES use the SDK) bridges MCP tool
// / resource calls to these endpoints — single authority, no duplicated state.
router.post('/mcp-bridge/external_main_context', async (req, res) => {
  const issuer = String(req.body?.issuer || '').trim();
  const subject = String(req.body?.subject || '').trim();
  if (!issuer || !subject) {
    return res.status(400).json({ ok: false, error: 'verified_issuer_and_subject_required' });
  }
  try {
    const grant = await resolveExternalIdentityMainGrant(issuer, subject);
    if (!grant) return res.status(403).json({ ok: false, error: 'external_identity_grant_required' });

    const conversationId = `external-mcp:${grant.grantId}`;
    const parentRunId = `external-main:${grant.grantId}`;
    const mainCardId = await resolveMainChatCardId(grant.projectId, BUILDER_DECK_ID);
    if (!mainCardId) {
      return res.status(409).json({ ok: false, error: 'persisted_main_chat_unavailable' });
    }
    return res.json({
      ok: true,
      context: {
        projectId: grant.projectId,
        projectName: grant.projectName,
        deckId: BUILDER_DECK_ID,
        conversationId,
        parentRunId,
        mainCardId,
      },
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'external_main_context_failed',
    });
  }
});

router.post('/mcp-bridge/describe_connected_agents', async (req, res) => {
  try {
    // Blank deckId defaults to the ONE canonical Agent Canvas deck — the same
    // convention run_configured_card already follows. A present-but-wrong
    // deckId still fails honestly (no silent correction).
    const result = await describeConnectedAgents({
      projectId: String(req.body?.projectId || ''),
      deckId: String(req.body?.deckId || BUILDER_DECK_ID),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'describe_connected_agents_failed' });
  }
});

router.post('/mcp-bridge/coder_status', async (_req, res) => {
  const sessions = openClaudeConsoleSessionManager.list();
  const liveSessions = sessions.filter(
    (session) => session.state === 'starting' || session.state === 'running',
  );
  return res.json({
    ok: true,
    state: liveSessions.length > 0 ? 'running' : 'idle',
    running: liveSessions.length > 0,
    liveSessions,
    recentSessions: sessions.slice(-10),
    authority: 'openclaude_console_session_manager',
  });
});

router.post('/mcp-bridge/run_mag_one', async (req, res) => {
  try {
    const idfId = String(req.body?.idfId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID);
    const result = await runMagOne({
      ...(req.body || {}),
      idfId,
      projectId: String(req.body?.projectId || ''),
      deckId,
    });
    return res.json({
      ok: result.status !== 'failed',
      result: {
        status: result.status,
        runId: result.runId,
        idfId: result.idfId,
        conversationId: result.conversationId,
        connectedParticipants: result.connectedParticipants,
        failure: result.failure,
      },
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_mag_one_failed' });
  }
});

async function resolveCodingCard(projectId: string, deckId: string, cardId: string): Promise<any> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = (deck?.nodes || []).find((node: any) => String(node?.id || '') === cardId);
  if (!card) throw new Error(`coder_card_not_found:${cardId}`);
  const system = card.runtimeType === 'assistant_agent' && card.runtimeBinding === 'local_coder';
  if (!system) throw new Error(`coder_card_runtime_unsupported:${cardId}`);
  return card;
}

router.post('/mcp-bridge/coder_stop', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
    const cardId = String(req.body?.cardId || '').trim();
    await resolveCodingCard(projectId, deckId, cardId);
    const session = openClaudeConsoleSessionManager.findRunningForCard(cardId);
    if (!session) return res.status(409).json({ ok: false, error: 'openclaude_card_no_active_session' });
    const stopped = session.stop();
    return res.status(stopped ? 200 : 409).json({ ok: stopped, cardId, session: session.info });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/mcp-bridge/coder_steer', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
    const cardId = String(req.body?.cardId || '').trim();
    const input = String(req.body?.input || '').trim();
    if (!input) return res.status(400).json({ ok: false, error: 'steer_input_required' });
    await resolveCodingCard(projectId, deckId, cardId);
    const session = openClaudeConsoleSessionManager.findRunningForCard(cardId);
    if (!session) return res.status(409).json({ ok: false, error: 'openclaude_card_no_active_session' });
    if (!session.info.interactiveSupported || session.info.transportMode !== 'pty') {
      return res.status(409).json({ ok: false, error: 'openclaude_card_steer_unsupported_noninteractive' });
    }
    const delivered = session.submitLine(input);
    return res.status(delivered ? 200 : 409).json({ ok: delivered, cardId, session: session.info });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// run_configured_card: thin transport for the card.run_assistant_agent MCP tool.
// Saved card identity/prompt/model/tools only — runConfiguredCard structurally
// rejects every extra key, so no browser/MCP-supplied override can reach the run.
router.post('/mcp-bridge/run_configured_card', async (req, res) => {
  const body = req.body || {};
  const projectId = String(body.projectId || '').trim();
  const deckId = String(body.deckId || BUILDER_DECK_ID).trim();
  const cardId = String(body.cardId || '').trim();
  const correlationId = String(body.correlationId || '').trim();
  const conversationId = String(body.conversationId || '').trim() || 'main';
  const parentRunId = String(body.parentRunId || '').trim();
  const input = String(body.input || '').trim();
  if (!projectId || !deckId || !cardId || !correlationId || !input) {
    return res.status(400).json({ ok: false, error: 'card_run_args_incomplete' });
  }

  try {
    await beginConversationRun({
      runId: correlationId,
      projectId,
      deckId,
      cardId,
      conversationId,
      runtime: 'configured_card',
      sessionId: `configured:${deckId}:${cardId}:${conversationId}`,
      userContent: input,
    });
  } catch {
    return res.status(503).json({
      ok: false,
      error: 'conversation_persistence_unavailable',
      correlationId,
    });
  }

  try {
    // conversationId is a structural reference to the real live conversation
    // (the Harness injects it server-side for doorway calls). Card-specific authority is minted inside
    // runConfiguredCard itself — never accepted from the caller.
    const result = await runConfiguredCard({
      projectId,
      deckId,
      cardId,
      correlationId,
      input,
      conversationId,
      parentRunId,
    });
    try {
      if (
        result.runtime
        && result.provider
        && result.modelKey
        && result.providerModelId
      ) {
        await markConversationRunRunning({
          runId: correlationId,
          invokingCardId: result.cardId,
          runtime: result.runtime,
          provider: result.provider,
          modelKey: result.modelKey,
          providerModelId: result.providerModelId,
          accessMode: result.accessMode || '',
          idfId: result.nativeRunResult?.idfId || '',
          idfVersion: result.idfVersion || 1,
          idfContentSha256: result.idfContentSha256 || '',
        });
      }
      if (result.status === 'completed') {
        await completeConversationRun({
          runId: correlationId,
          assistantContent: result.output,
          usage: result.usage,
          transport: result.transport || undefined,
        });
      } else if (result.status !== 'submitted') {
        await failConversationRun(
          correlationId,
          result.error || `configured_card_${result.status}`,
          result.error || result.status,
        );
      }
    } catch {
      await failConversationRun(
        correlationId,
        'configured_card_persistence_failed',
        'configured card result could not be persisted',
      ).catch(() => undefined);
      return res.status(503).json({
        ok: false,
        error: 'configured_card_persistence_failed',
        correlationId,
      });
    }
    return res.json({
      ok: result.status === 'completed' || result.status === 'submitted',
      result,
    });
  } catch (error) {
    await failConversationRun(
      correlationId,
      'run_configured_card_failed',
      error instanceof Error ? error.message : 'run_configured_card_failed',
    ).catch(() => undefined);
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_configured_card_failed' });
  }
});

// ── Persistent repo-owned Hermes Main bridge (BuilderChat -> ACP) ───────────
// One stable native Hermes conversation per saved Main card and product
// conversation. OpenClaude remains the separate Coder/terminal runtime.
const activeHermesTurns = new Map<string, HermesTurnHandle>();

function codexTransportResult(value: Record<string, unknown>): Record<string, any> {
  const result = value.result;
  return result && typeof result === 'object' ? result as Record<string, any> : {};
}

router.get('/main/codex-account', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '').trim();
    if (!projectId) {
      return res.status(400).json({ ok: false, error: 'projectId_required' });
    }
    const runtimeConfig = await resolveMainHermesRuntimeConfig(projectId);
    if (!runtimeConfig) {
      return res.status(424).json({ ok: false, error: 'main_hermes_card_not_runnable' });
    }
    if (runtimeConfig.accessMode !== 'chatgpt-account') {
      return res.json({
        ok: true,
        accessMode: runtimeConfig.accessMode,
        account: null,
        rateLimits: null,
        notifications: [],
      });
    }
    const accountEnvelope = await requestHermesCodexAccount(
      runtimeConfig.profile,
      'account/read',
      { refreshToken: false },
    );
    const accountResponse = codexTransportResult(accountEnvelope);
    const account = accountResponse.account && typeof accountResponse.account === 'object'
      ? accountResponse.account as Record<string, unknown>
      : null;
    if (account && account.type !== 'chatgpt') {
      return res.status(409).json({ ok: false, error: 'codex_chatgpt_account_required' });
    }
    const rateEnvelope = account
      ? await requestHermesCodexAccount(runtimeConfig.profile, 'account/rateLimits/read')
      : null;
    return res.json({
      ok: true,
      accessMode: runtimeConfig.accessMode,
      account,
      requiresOpenaiAuth: Boolean(accountResponse.requiresOpenaiAuth),
      rateLimits: rateEnvelope ? codexTransportResult(rateEnvelope) : null,
      notifications: [
        ...(Array.isArray(accountEnvelope.notifications) ? accountEnvelope.notifications : []),
        ...(Array.isArray(rateEnvelope?.notifications) ? rateEnvelope.notifications : []),
      ],
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'codex_account_read_failed',
    });
  }
});

router.post('/main/codex-account', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const action = String(req.body?.action || '').trim();
    if (!projectId || !['login', 'logout'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'projectId_and_valid_action_required' });
    }
    const runtimeConfig = await resolveMainHermesRuntimeConfig(projectId);
    if (!runtimeConfig) {
      return res.status(424).json({ ok: false, error: 'main_hermes_card_not_runnable' });
    }
    if (runtimeConfig.accessMode !== 'chatgpt-account') {
      return res.status(409).json({ ok: false, error: 'main_chatgpt_account_mode_required' });
    }
    if (action === 'logout') {
      const envelope = await requestHermesCodexAccount(runtimeConfig.profile, 'account/logout');
      return res.json({ ok: true, action, ...codexTransportResult(envelope) });
    }

    const currentEnvelope = await requestHermesCodexAccount(runtimeConfig.profile, 'account/read');
    const current = codexTransportResult(currentEnvelope);
    if (current.account?.type === 'chatgpt') {
      return res.json({ ok: true, action, alreadyAuthenticated: true, account: current.account });
    }
    const loginType = String(req.body?.loginType || 'chatgpt').trim();
    if (!['chatgpt', 'chatgptDeviceCode'].includes(loginType)) {
      return res.status(400).json({ ok: false, error: 'codex_login_type_not_allowed' });
    }
    const envelope = await requestHermesCodexAccount(
      runtimeConfig.profile,
      'account/login/start',
      { type: loginType },
    );
    return res.json({
      ok: true,
      action,
      ...codexTransportResult(envelope),
      notifications: Array.isArray(envelope.notifications) ? envelope.notifications : [],
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'codex_account_action_failed',
    });
  }
});

router.post('/main/session/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '');
  const conversationId = String(req.body?.conversationId || 'default');
  const message = String(req.body?.message || '');
  const workingDirectory = String(req.body?.workingDirectory || '').trim() || undefined;
  if (!projectId || !message) {
    return res.status(400).json({ ok: false, error: 'projectId_and_message_required' });
  }
  const runtimeConfig = await resolveMainHermesRuntimeConfig(projectId);
  if (!runtimeConfig) {
    return res.status(424).json({ ok: false, error: 'main_hermes_card_not_runnable' });
  }
  const sessionId = deriveHermesSessionKey(projectId, conversationId, runtimeConfig.cardId);
  // One correlation id per turn for the concise backend trace. This does NOT change
  // the SSE stream or browser behavior — it only makes the real Harness events
  // (already flowing to the browser) legible in the backend dev terminal.
  const correlationId = `req_${randomUUID().slice(0, 8)}`;
  try {
    await beginConversationRun({
      runId: correlationId,
      projectId,
      deckId: BUILDER_DECK_ID,
      cardId: runtimeConfig.cardId,
      conversationId,
      runtime: 'hermes',
      sessionId,
      userContent: message,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'conversation_run_begin_failed';
    logHarnessTrace(
      `[harness] request rejected corr=${correlationId} reason=${redactTrace(reason)}`,
    );
    return res.status(503).json({
      ok: false,
      error: 'conversation_persistence_unavailable',
      correlationId,
    });
  }
  let idf;
  try {
    idf = (await createInputDataFileOnPython({
      projectId,
      deckId: BUILDER_DECK_ID,
      conversationId,
      runId: correlationId,
      originatingCardId: runtimeConfig.cardId,
      systemText: runtimeConfig.prompt,
      userText: message,
      cardContext: {
        ...runtimeConfig,
        runtimeType: 'main_chat',
      },
    })).idf;
  } catch {
    await failConversationRun(
      correlationId,
      'idf_persistence_failed',
      'canonical input persistence failed before runtime launch',
    ).catch(() => undefined);
    return res.status(503).json({
      ok: false,
      error: 'idf_persistence_failed',
      correlationId,
    });
  }
  const idfRuntimeConfig = idf.cardContext as typeof runtimeConfig;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const writeSse = (eventName: string, payload: unknown): boolean => {
    if (res.destroyed || res.writableEnded) return false;
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logHarnessTrace(`[harness] sse write skipped corr=${correlationId} reason=${redactTrace(reason)}`);
      return false;
    }
  };
  writeSse('session', { sessionId });
  logHarnessTrace(`[hermes] request received ${`corr=${correlationId}`} project=${projectId} profile=${idfRuntimeConfig.profile}`);
  let turnFinished = false;
  let runCancelled = false;
  let terminalDoneEvent: Extract<HermesSessionEvent, { kind: 'done' }> | null = null;
  try {
    const handle = await startHermesTurn({
      ...idfRuntimeConfig,
      prompt: idf.systemText,
      sessionKey: sessionId,
      projectId,
      conversationId,
      parentRunId: correlationId,
      message: idf.modelInputMarkdown,
      workingDirectory,
    }, async (event) => {
      if (turnFinished) return;
      if (event.kind === 'done') {
        terminalDoneEvent = event;
        return;
      }
      // Backend trace of the REAL event (only when it carries lifecycle signal),
      // then the unchanged SSE forward to the browser.
      const traceLine = formatHarnessTrace(event, correlationId);
      if (traceLine) logHarnessTrace(traceLine);
      writeSse(event.kind, event);
    });
    try {
      await markConversationRunRunning({
        runId: correlationId,
        invokingCardId: handle.resolved.cardId,
        runtime: 'hermes',
        provider: handle.resolved.provider,
        modelKey: handle.resolved.modelKey,
        providerModelId: handle.resolved.providerModelId,
        accessMode: idfRuntimeConfig.accessMode,
        idfId: idf.idfId,
        idfVersion: idf.version,
        idfContentSha256: idf.contentSha256,
      });
    } catch (error) {
      handle.cancel();
      throw new Error(
        `harness_run_persistence_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    activeHermesTurns.set(sessionId, handle);
    req.on('close', () => {
      if (turnFinished) return;
      runCancelled = true;
      handle.cancel();
      activeHermesTurns.delete(sessionId);
      void cancelConversationRun(correlationId).catch((error) => {
        logHarnessTrace(
          `[harness] run cancellation persistence failed corr=${correlationId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
        );
      });
    });
    const { finalText, usage, transport } = await handle.done;
    try {
      await completeConversationRun({
        runId: correlationId,
        assistantContent: String(finalText || ''),
        usage,
        transport,
      });
    } catch (error) {
      throw new Error(
        `harness_run_persistence_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const doneEvent = terminalDoneEvent || { kind: 'done', fullText: finalText, usage };
    const doneTrace = formatHarnessTrace(doneEvent, correlationId);
    if (doneTrace) logHarnessTrace(doneTrace);
    writeSse('done', doneEvent);
    turnFinished = true;
    logHarnessTrace(
      `[harness] request completed corr=${correlationId} providerUsage=${usage.usageAvailable ? `${usage.providerInputTokens}in/${usage.providerOutputTokens}out (${usage.usageSource})` : 'unavailable'} cost=${usage.totalCostUsd ?? 'unavailable'} contextBreakdown=${usage.contextBreakdownJson ? 'present' : 'unavailable'}`,
    );
  } catch (error) {
    turnFinished = true;
    const reason = error instanceof Error ? error.message : 'hermes_turn_failed';
    if (!runCancelled) {
      await failConversationRun(
        correlationId,
        reason.startsWith('harness_run_persistence_failed')
          ? 'harness_run_persistence_failed'
          : 'harness_turn_failed',
        reason,
      ).catch((persistenceError) => {
        logHarnessTrace(
          `[harness] failure persistence failed corr=${correlationId} reason=${redactTrace(persistenceError instanceof Error ? persistenceError.message : String(persistenceError))}`,
        );
      });
    }
    logHarnessTrace(`[harness] request failed corr=${correlationId} reason=${redactTrace(reason)}`);
    writeSse('error', {
      code: reason.startsWith('harness_run_persistence_failed')
        ? 'harness_run_persistence_failed'
        : 'harness_turn_failed',
      message: reason.startsWith('harness_run_persistence_failed')
        ? 'The model finished, but its durable run record could not be completed.'
        : 'The chat run failed. Check the correlation ID in the backend logs.',
      correlationId,
      route: '/api/coder/main/session/chat',
      status: 502,
    });
  } finally {
    turnFinished = true;
    activeHermesTurns.delete(sessionId);
    writeSse('end', {});
    if (!res.destroyed && !res.writableEnded) res.end();
  }
  return undefined;
});

router.post('/main/session/answer', async (req, res) => {
  const projectId = String(req.body?.projectId || '');
  const runtimeConfig = await resolveMainHermesRuntimeConfig(projectId);
  if (!runtimeConfig) return res.status(404).json({ ok: false, error: 'main_hermes_card_not_runnable' });
  const sessionId = deriveHermesSessionKey(
    projectId,
    String(req.body?.conversationId || 'default'),
    runtimeConfig.cardId,
  );
  const handle = activeHermesTurns.get(sessionId);
  if (!handle) return res.status(404).json({ ok: false, error: 'no_active_turn' });
  handle.answer(String(req.body?.promptId || ''), String(req.body?.reply || ''));
  return res.json({ ok: true });
});

// Load the durable project-scoped transcript for a conversation so a reload
// restores the same chat. A valid conversation with no messages returns an
// empty transcript. A persistence failure remains a visible typed failure.
router.get('/main/session/history', async (req, res) => {
  const projectId = String(req.query?.projectId || '');
  const conversationId = String(req.query?.conversationId || 'default');
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId_required', messages: [] });
  }
  try {
    const stored = await getConversationMessages(projectId, conversationId);
    const messages = stored
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }));
    return res.json({ ok: true, messages });
  } catch (error) {
    logHarnessTrace(
      `[harness] history read failed project=${projectId} conversation=${conversationId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
    );
    return res.status(500).json({
      ok: false,
      error: 'conversation_history_read_failed',
      messages: [],
    });
  }
});

router.get('/main/session/conversations', async (req, res) => {
  const projectId = String(req.query?.projectId || '');
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId_required', conversations: [] });
  }
  try {
    const conversations = (await listConversations(projectId))
      .filter((conversation) => !conversation.archivedAt)
      .map((conversation) => ({
        conversationId: conversation.conversationId,
        title: conversation.title || conversation.conversationId,
        updatedAt: conversation.updatedAt,
      }));
    return res.json({ ok: true, conversations });
  } catch {
    return res.json({ ok: true, conversations: [] });
  }
});

const CONSOLE_MODES: ConsoleMode[] = ['interactive', 'print', 'task', 'shell'];

function parseConsoleMode(value: unknown): ConsoleMode {
  return CONSOLE_MODES.includes(value as ConsoleMode) ? (value as ConsoleMode) : 'interactive';
}

router.get('/openclaude/terminal/launch', (req, res) => {
  const launch = openClaudeRuntimeService.getTerminalLaunch({
    mode: 'terminal',
    modelKey: typeof req.query.modelKey === 'string' ? req.query.modelKey : undefined,
    provider: typeof req.query.provider === 'string' ? (req.query.provider as OpenClaudeRunRequest['provider']) : undefined,
    providerModelId:
      typeof req.query.providerModelId === 'string' ? req.query.providerModelId : undefined,
  });
  const statusCode = launch.ok ? 200 : 400;
  return res.status(statusCode).json({ ok: launch.ok, launch });
});

// ── Native terminal transports ─────────────────────────────────────────────
// Route plumbing is shared, while Coder and installed Hermes keep separate
// process managers and session namespaces.
type ConsoleRouteManager =
  | typeof openClaudeConsoleSessionManager
  | typeof hermesConsoleSessionManager;

function mountConsoleSessionRoutes(
  prefix: string,
  manager: ConsoleRouteManager,
): void {
  router.post(`${prefix}/sessions`, (req, res) => {
    const started = manager.start({
      targetRoot: typeof req.body?.targetRoot === 'string' ? req.body.targetRoot : undefined,
      mode: parseConsoleMode(req.body?.mode),
      model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
      prompt: typeof req.body?.prompt === 'string' ? req.body.prompt : undefined,
    });
    if (!started.ok) {
      return res.status(424).json({ ok: false, error: started.error, missing: started.missing });
    }
    const info = started.session.info;
    return res.status(info.state === 'failed' ? 502 : 200).json({
      ok: info.state !== 'failed',
      session: info,
    });
  });

  router.get(`${prefix}/sessions`, (_req, res) => {
    return res.json({ ok: true, sessions: manager.list() });
  });

  router.get(`${prefix}/sessions/:id`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    return res.json({ ok: true, session: session.info, transcript: session.transcript() });
  });

  router.get(`${prefix}/sessions/:id/stream`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: info\ndata: ${JSON.stringify(session.info)}\n\n`);
    const unsubscribe = session.subscribe((event) => {
      if (event.kind === 'chunk') {
        res.write(`event: chunk\ndata: ${JSON.stringify(event.chunk)}\n\n`);
      } else {
        res.write(`event: lifecycle\ndata: ${JSON.stringify(event.info)}\n\n`);
      }
    });
    req.on('close', () => {
      unsubscribe();
      res.end();
    });
    return undefined;
  });

  router.post(`${prefix}/sessions/:id/input`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const data = typeof req.body?.data === 'string' ? req.body.data : '';
    const delivered = session.write(data);
    return res.status(delivered ? 200 : 409).json({
      ok: delivered,
      delivered,
      interactiveSupported: session.info.interactiveSupported,
    });
  });

  router.post(`${prefix}/sessions/:id/resize`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const cols = Number(req.body?.cols);
    const rows = Number(req.body?.rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
      return res.status(400).json({ ok: false, error: 'console_resize_invalid_dimensions' });
    }
    const resized = session.resize(Math.floor(cols), Math.floor(rows));
    return res.status(resized ? 200 : 409).json({
      ok: resized,
      resized,
      transportMode: session.info.transportMode,
    });
  });

  router.post(`${prefix}/sessions/:id/stop`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const stopped = session.stop();
    return res.json({ ok: true, stopped, session: session.info });
  });
}

mountConsoleSessionRoutes('/openclaude/console', openClaudeConsoleSessionManager);
mountConsoleSessionRoutes('/hermes/console', hermesConsoleSessionManager);


/** Resolve the saved Main Chat card from the live deck by binding, never title. */
async function resolveMainChatCardId(projectId: string, deckId: string): Promise<string | null> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = (deck?.nodes || []).find(
    (node: any) =>
      String((node?.runtimeOptions as any)?.binding ?? node?.runtimeBinding ?? '') === 'main_chat',
  );
  return card ? String(card.id) : null;
}

router.get('/localcoder/status', async (req, res) => {
  const repoPath = typeof req.query.repoPath === 'string' ? req.query.repoPath : undefined;
  const inspection = await localCoderService.inspect(repoPath);
  return res.status(inspection.ready ? 200 : 424).json({
    ok: inspection.ready,
    inspection,
  });
});

function unavailableUsage() {
  return {
    providerInputTokens: null,
    providerOutputTokens: null,
    totalCostUsd: null,
    usageAvailable: false,
    usageSource: 'coder_report_only',
    contextBreakdownJson: '',
  };
}

async function resolveCoderIdfCardContext(projectId: string, cardId: string) {
  const card = await resolveCodingCard(projectId, BUILDER_DECK_ID, cardId);
  const config = resolveHermesCardRuntimeConfig(card, []);
  return { ...config, runtimeType: 'assistant_agent' };
}

router.post('/idf/coder/drafts', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const cardId = String(req.body?.cardId || '').trim();
    const conversationId = String(req.body?.conversationId || 'coder-review').trim();
    if (!projectId || !cardId) {
      return res.status(400).json({ ok: false, error: 'projectId_and_cardId_required' });
    }
    const jobContext = parseCoderJobContext(req.body?.jobContext);
    const cardContext = await resolveCoderIdfCardContext(projectId, cardId);
    const runId = `coder_${randomUUID()}`;
    const result = await createInputDataFileOnPython({
      projectId,
      deckId: BUILDER_DECK_ID,
      conversationId,
      runId,
      originatingCardId: cardId,
      systemText: cardContext.prompt,
      userText: jobContext.objective,
      cardContext,
      purpose: 'coding_job',
      approvalStatus: 'draft',
      jobContext,
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ ok: false, error: 'invalid_coder_job_context', issues: error.issues });
    }
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'idf_draft_failed' });
  }
});

router.post('/idf/coder/:idfId/revisions', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const idfId = String(req.params.idfId || '').trim();
    const existing = (await fetchInputDataFile({ projectId, idfId })).idf;
    const jobContext = parseCoderJobContext(req.body?.jobContext);
    const cardContext = await resolveCoderIdfCardContext(projectId, existing.originatingCardId);
    const result = await reviseInputDataFileOnPython({
      idfId,
      projectId,
      expectedVersion: Number(req.body?.expectedVersion),
      expectedSha256: String(req.body?.expectedSha256 || ''),
      jobContext,
      cardContext,
      systemText: cardContext.prompt,
      userText: jobContext.objective,
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ ok: false, error: 'invalid_coder_job_context', issues: error.issues });
    }
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'idf_revision_failed' });
  }
});

router.post('/idf/coder/:idfId/approve', async (req, res) => {
  try {
    const result = await approveInputDataFileOnPython({
      idfId: String(req.params.idfId || '').trim(),
      projectId: String(req.body?.projectId || '').trim(),
      expectedVersion: Number(req.body?.expectedVersion),
      expectedSha256: String(req.body?.expectedSha256 || ''),
    });
    return res.json(result);
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'idf_approval_failed' });
  }
});

router.post('/localcoder/run', async (req, res) => {
  let runId = '';
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const idfId = String(req.body?.idfId || '').trim();
    const expectedVersion = Number(req.body?.version);
    const expectedSha256 = String(req.body?.contentSha256 || '').trim();
    if (!projectId || !idfId || !Number.isInteger(expectedVersion) || !expectedSha256) {
      return res.status(400).json({ ok: false, error: 'approved_idf_reference_required' });
    }
    const idf = (await fetchInputDataFile({ projectId, idfId })).idf;
    if (
      idf.purpose !== 'coding_job'
      || idf.approvalStatus !== 'approved'
      || idf.version !== expectedVersion
      || idf.contentSha256 !== expectedSha256
      || idf.approvedSha256 !== expectedSha256
    ) {
      return res.status(409).json({ ok: false, error: 'exact_approved_idf_revision_required' });
    }
    const currentCard = await resolveCodingCard(projectId, idf.deckId, idf.originatingCardId);
    if (!currentCard) throw new Error('approved_idf_coder_card_unavailable');
    const cardContext = idf.cardContext as Record<string, any>;
    const jobContext = parseCoderJobContext(idf.jobContext);
    runId = idf.runId;
    const coderPacket = {
      ...jobContext,
      id: runId,
      projectId,
      repoPath: resolveRepoRoot(),
      modelProvider: cardContext.provider,
      providerModelId: cardContext.providerModelId,
      accessMode: cardContext.accessMode,
      reasoningEffort: cardContext.runtimeOptions?.reasoningEffort || undefined,
      mcpTools: Array.isArray(cardContext.tools)
        ? cardContext.tools.filter((tool: unknown) => tool !== 'run_local_coder')
        : [],
      cardId: idf.originatingCardId,
      cardTitle: cardContext.title,
      cardPrompt: idf.systemText,
      cardProfile: cardContext.profile,
      modelKey: cardContext.modelKey,
      approvedIdfId: idf.idfId,
      approvedIdfVersion: idf.version,
      approvedIdfContentSha256: idf.contentSha256,
      approvedIdfModelInputMarkdown: idf.modelInputMarkdown,
      nativeTools: cardContext.nativeTools || [],
      skills: cardContext.skills || [],
      toolsets: cardContext.toolsets || [],
      mcpConnectionIds: cardContext.mcpConnectionIds || [],
    };
    await beginConversationRun({
      runId,
      projectId,
      deckId: idf.deckId,
      cardId: idf.originatingCardId,
      conversationId: idf.conversationId,
      runtime: 'local_coder',
      sessionId: `approved-idf:${idf.idfId}`,
      userContent: idf.contentMarkdown,
    });
    await markConversationRunRunning({
      runId,
      invokingCardId: idf.originatingCardId,
      runtime: 'local_coder',
      provider: String(cardContext.provider),
      modelKey: String(cardContext.modelKey),
      providerModelId: String(cardContext.providerModelId),
      accessMode: String(cardContext.accessMode),
      idfId: idf.idfId,
      idfVersion: idf.version,
      idfContentSha256: idf.contentSha256,
    });
    const result = await localCoderService.run(coderPacket);
    await completeConversationRun({
      runId,
      assistantContent: JSON.stringify(result.report, null, 2),
      usage: unavailableUsage(),
      transport: result.runtimeDiagnostics ? {
        threadId: result.runtimeDiagnostics.providerThreadId,
        turnId: result.runtimeDiagnostics.providerTurnId,
        authMode: result.runtimeDiagnostics.providerAuthMode,
        planType: result.runtimeDiagnostics.providerPlanType,
      } : undefined,
      resultArtifact: {
        artifactType: 'CoderReport',
        cardId: idf.originatingCardId,
        provider: cardContext.provider,
        model: cardContext.providerModelId,
        accessMode: cardContext.accessMode,
        correlationId: runId,
        idfId: idf.idfId,
        idfVersion: idf.version,
        idfContentSha256: idf.contentSha256,
        report: result.report,
        comparison: result.comparison,
      },
    });
    const reportOk = result.report.status === 'succeeded' || result.report.status === 'partial';
    const statusCode =
      result.report.status === 'blocked'
        ? 424
        : result.report.status === 'failed'
          ? 502
          : 200;
    return res.status(statusCode).json({
      ok: reportOk,
      ...result,
    });
  } catch (error) {
    if (runId) {
      await failConversationRun(
        runId,
        'localcoder_run_failed',
        error instanceof Error ? error.message : 'localcoder_run_failed',
      ).catch(() => undefined);
    }
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_coder_packet',
        issues: error.issues,
      });
    }
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'localcoder_run_failed',
    });
  }
});

export default router;
