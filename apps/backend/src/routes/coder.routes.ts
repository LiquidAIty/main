import { Router } from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import {
  coderTerminalSessionManager,
} from '../hermes/coderTerminal';
import {
  contextAuthorityModeForDriver,
  mainCliBridge,
  type MainCliBridgeEvent,
  type MainDriverSource,
} from '../hermes/mainCliBridge';
import {
  cancelHermesRun,
  deleteHermesHistory,
  deriveHermesSessionKey,
  dispatchHermesLearnCommand,
  materializeHermesProfileSelections,
  readHermesHistory,
  readHermesRunSnapshot,
  requestHermesNative,
  startHermesTurn,
  type HermesHistoryArgs,
  type HermesProfileMaterialization,
  type HermesSessionEvent,
  type HermesTurnArgs,
  type HermesTurnHandle,
} from '../hermes/mainAdapter';
import { readSavedSubagentModel } from '../hermes/subagentModel';
import { buildCardTerminal, projectKanbanTerminal, terminalHistoryEvents, terminalIdentity, terminalText } from '../hermes/cardTerminal';
import { resolveRepoRoot } from '../coder/workspaceRoot';
import { listConversations } from '../conversations/store';
import { logHarnessTrace, redactTrace } from '../services/harnessTrace';
// The app's one canonical Agent Canvas deck id, defined once on the deck store.
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveExternalIdentityMainGrant } from '../auth/externalIdentityGrantStore';
import {
  describeConnectedAgents,
  dispatchConfiguredRuntime,
  requestPythonRailsJson,
} from '../services/autogen/pythonRailsClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import {
  indexToolCatalogReferences,
  resolveScriptToolReferences,
  searchToolCatalogReferences,
  type ToolCatalogReference,
} from '../cards/toolCatalogProjection';
import { listConfiguredModelOptions } from '../llm/models.config';
import { hydrateHermesCardProfile } from '../hermes/cardProfileProjection';
import { resolveHermesExecutionContext } from '../hermes/childExecutionContext';
import {
  reconcileTerminalKanbanRun,
  startKanbanRunMonitor,
} from '../hermes/kanbanRunRecovery';
import {
  readHermesKanbanSessionUsage,
  readHermesKanbanCardSnapshots,
  startNativeHermesKanbanTurn,
  type HermesKanbanProgress,
} from './hermesKanban.routes';

const router = Router();
const CODER_CARD_ID = 'card_local_coder';
const AGENT_BUILDER_PROFILE = 'liquidaity-agent-builder';

function commaSeparatedIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
}

async function loadInputDictionaryToolCatalog() {
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
      tools: [...canonicalMcpTools, ...privateRuntimeManifest.tools],
    }),
  }) as { references?: unknown };
  if (!Array.isArray(materialized?.references)) {
    throw new Error('input_data_dictionary_tool_catalog_invalid');
  }
  return indexToolCatalogReferences(materialized.references as ToolCatalogReference[]);
}

type RemoteMainDriverSource = Exclude<MainDriverSource, 'native_cli'>;

type PreparedMainCliRun = {
  projectId: string;
  deckId: string;
  conversationId: string;
  runId: string;
  cardId: string;
  driverSource: RemoteMainDriverSource;
  prepared: any;
  profileMaterialization?: HermesProfileMaterialization;
};

function internalMcpBridgeAuthorized(value: unknown): boolean {
  const expected = Buffer.from(String(process.env.LIQUIDAITY_INTERNAL_MCP_SECRET || ''), 'utf8');
  const supplied = Buffer.from(String(value || ''), 'utf8');
  return expected.length >= 32
    && supplied.length === expected.length
    && timingSafeEqual(supplied, expected);
}

async function prepareMainCliRun(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  message: string;
  driverSource: RemoteMainDriverSource;
  runId?: string;
  dataAnchors?: unknown[];
}): Promise<PreparedMainCliRun> {
  const runId = String(args.runId || `req_${randomUUID().slice(0, 8)}`);
  const discoveredTools = await listPythonAgentMcpCatalog();
  const prepared: any = await requestPythonRailsJson('/domain/main/runs/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      message: args.message,
      conversationId: args.conversationId,
      driverSource: args.driverSource,
      runId,
      correlationId: runId,
      dataAnchors: Array.isArray(args.dataAnchors) ? args.dataAnchors : [],
      discoveredTools,
    }),
  });
  if (
    prepared.runtimeOwner !== 'hermes'
    || !prepared.hermesTransport?.cardIdentity
    || !prepared.hermesTransport?.request
  ) {
    throw new Error('main_hermes_card_not_runnable');
  }
  return {
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    runId,
    cardId: String(prepared.hermesTransport.cardIdentity.cardId || ''),
    driverSource: args.driverSource,
    prepared,
  };
}

async function executePreparedMainCliRun(
  run: PreparedMainCliRun,
  onEvent: (event: MainCliBridgeEvent) => void,
) {
  let result: Awaited<ReturnType<typeof mainCliBridge.submit>>;
  try {
    const turnArgs = resolveHermesTurnArgs({
      prepared: run.prepared,
      projectId: run.projectId,
      deckId: run.deckId,
      conversationId: run.conversationId,
      parentRunId: run.runId,
      onEvent: () => undefined,
    }, run.prepared.hermesTransport);
    run.profileMaterialization = await materializeHermesProfileSelections(turnArgs);
    result = await mainCliBridge.submit({
      runId: run.runId,
      driverSource: run.driverSource,
      message: String(run.prepared.hermesTransport.request.message || ''),
      onEvent,
    });
  } catch (error) {
    const rawReason = error instanceof Error ? error.message : 'main_cli_turn_failed';
    const reason = rawReason.includes('cancel')
      ? 'main_cli_turn_cancelled'
      : ['main_cli_bridge_unavailable', 'main_driver_turn_already_running'].includes(rawReason)
        ? rawReason
        : 'main_cli_turn_failed';
    await requestPythonRailsJson('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        state: reason === 'main_cli_turn_cancelled' ? 'cancelled' : 'failed',
        errorSummary: reason,
      }),
    }).catch(() => undefined);
    throw new Error(reason);
  }
  try {
    await requestPythonRailsJson('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        state: 'completed',
        providerThreadRef: result.nativeSessionId || null,
        providerTurnRef: result.nativeTurnId || null,
        finalResult: result.finalText,
      }),
    });
    return { ...result, profileMaterialization: run.profileMaterialization };
  } catch (error) {
    await requestPythonRailsJson('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        state: 'failed',
        errorSummary: 'main_run_persistence_failed',
      }),
    }).catch(() => undefined);
    throw new Error('main_run_persistence_failed');
  }
}

async function builderNativeOptions(projectId: string, deckId: string, cardId: string) {
  if (!projectId || !deckId || !cardId) return { nativeOptions: [], selectedIds: [] };
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = deck?.nodes.find((node) => node.id === cardId);
  if (!deck || !card) throw new Error('card_not_found');
  if (
    card.runtime.kind !== 'hermes'
    || card.runtime.mode !== 'delegate'
    || card.runtime.profile !== AGENT_BUILDER_PROFILE
  ) {
    throw new Error('agent_builder_card_required');
  }
  const saved = card.runtimeOptions || {};
  const selectedIds = [card.templateId, ...(saved.tools || []),
    ...(saved.nativeTools || []).map((name) => 'hermes:tool:' + name),
    ...(saved.skills || []).map((name) => 'skill:' + name),
    ...(saved.toolsets || []).map((name) => 'toolset:' + name),
    ...(saved.mcpConnectionIds || []).map((name) => 'mcp:' + name),
    ...(saved.provider && saved.modelKey ? ['model:' + saved.provider + ':' + saved.modelKey] : []),
  ].filter((value): value is string => typeof value === 'string' && Boolean(value));
  const catalog = await listPythonAgentMcpCatalog();
  const options: Array<Record<string, unknown>> = catalog.map((tool: any) => ({
    id: tool.name, kind: 'tool', owner: tool.sourceId, source: tool.sourceId,
    schema: tool.inputSchema, available: tool.available !== false,
  }));
  const { native } = await hydrateHermesCardProfile(card, deck);
  const [tools, plugins] = await Promise.all([
    requestHermesNative('tools.show', {}, card.runtime.profile),
    requestHermesNative('plugins.list', {}, card.runtime.profile),
  ]) as Array<Record<string, any>>;
  options.push({ id: 'profile:' + native.name, kind: 'profile', owner: 'Hermes',
    source: 'profiles.describe', schema: { name: native.name, model: native.model }, available: true });
  selectedIds.push('profile:' + card.runtime.profile);
  for (const [kind, values] of [
    ['skill', native.skills], ['toolset', native.toolsets], ['mcp', native.mcpServers],
    ['plugin', Array.isArray(plugins.plugins) ? plugins.plugins : []],
  ] as const) {
    for (const item of values) {
      options.push({ id: kind + ':' + item.name, kind, owner: 'Hermes',
        source: 'profile:' + native.name, schema: item, available: item.enabled !== false });
      if (item.enabled === true) selectedIds.push(kind + ':' + item.name);
    }
  }
  for (const section of Array.isArray(tools.sections) ? tools.sections : []) {
    for (const tool of section.tools || []) options.push({
      id: 'hermes:tool:' + tool.name, kind: 'tool', owner: 'Hermes', source: 'tools.show:' + native.name,
      // Native tools.show does not expose schemas. Do not invent a callable signature.
      schema: { nativeName: tool.name }, available: true,
    });
  }
  return { nativeOptions: options, selectedIds: [...new Set(selectedIds)] };
}

router.get('/card-editor/options', async (_req, res) => {
  try {
    const options = await requestPythonRailsJson('/card-editor/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: listConfiguredModelOptions(process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna'),
      }),
    }) as Record<string, unknown>;
    if (!Array.isArray(options?.fields) || !options.catalogs || typeof options.catalogs !== 'object') {
      throw new Error('runtime_options_invalid');
    }
    return res.json({ ok: true, fields: options.fields, catalogs: options.catalogs });
  } catch {
    return res.status(503).json({ ok: false, error: 'runtime_options_unavailable' });
  }
});

router.get('/input-data-dictionary/card-editor', async (req, res) => {
  try {
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
    const materialized = await requestPythonRailsJson('/idd/card-editor/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: listConfiguredModelOptions(openaiDefault),
        ...await builderNativeOptions(
          String(req.query.projectId || ''), String(req.query.deckId || ''), String(req.query.cardId || ''),
        ),
      }),
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
    const catalog = await loadInputDictionaryToolCatalog();
    const selectedIds = commaSeparatedIds(req.query.selectedIds);
    return res.json({
      ok: true,
      ...searchToolCatalogReferences(catalog, {
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        namespace: typeof req.query.namespace === 'string' ? req.query.namespace : undefined,
        access: req.query.access === 'read' || req.query.access === 'write'
          ? req.query.access
          : undefined,
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

router.get('/input-data-dictionary/script-tools', async (req, res) => {
  try {
    const catalog = await loadInputDictionaryToolCatalog();
    const references = resolveScriptToolReferences(catalog, {
      policy: req.query.policy === 'all_healthy' ? 'all_healthy' : 'selected',
      selectedIds: commaSeparatedIds(req.query.selectedIds),
      disabledIds: commaSeparatedIds(req.query.disabledIds),
    });
    const fingerprint = createHash('sha256').update(JSON.stringify(
      references.map((reference) => ({
        canonicalId: reference.canonicalId,
        access: reference.access,
        availability: reference.availability,
        contracts: reference.contracts,
      })),
    )).digest('hex');
    const header = await requestPythonRailsJson('/card-script/header', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogTools: catalog.references,
        selectedTools: references.map((reference) => reference.canonicalId),
        cardId: typeof req.query.cardId === 'string' ? req.query.cardId : '',
      }),
    });
    return res.json({ ok: true, references, paletteFingerprint: fingerprint, header });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_script_tools_unavailable',
      references: [],
      paletteFingerprint: '',
      header: null,
    });
  }
});

router.post('/card-script/validate', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const catalog = await loadInputDictionaryToolCatalog();
    const references = resolveScriptToolReferences(catalog, {
      policy: body.toolCatalogPolicy === 'all_healthy' ? 'all_healthy' : 'selected',
      selectedIds: Array.isArray(body.selectedTools) ? body.selectedTools.map(String) : [],
      disabledIds: Array.isArray(body.disabledTools) ? body.disabledTools.map(String) : [],
    });
    const paletteFingerprint = createHash('sha256').update(JSON.stringify(
      references.map((reference) => ({
        canonicalId: reference.canonicalId,
        access: reference.access,
        availability: reference.availability,
        contracts: reference.contracts,
      })),
    )).digest('hex');
    const script = await requestPythonRailsJson('/card-script/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: body.script,
        selectedTools: references.map((reference) => reference.canonicalId),
        paletteFingerprint,
        nativeAvailable: body.runtimeKind === 'hermes',
      }),
    });
    return res.json({ ok: true, script, references, paletteFingerprint });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_script_validation_failed',
    });
  }
});

// ── Main MCP bridge (SDK-free) ─────────────────────────────────────────────
// Internal JSON endpoints that run the proven MCP handlers server-side, where
// the backend already owns deck state + the Python transport. These import NO
// MCP SDK, so they are safe in the Nx serve graph. The separate MCP host
// process bridges MCP tool/resource calls to these endpoints without owning
// another domain store.
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
    const mainIdentity = await resolveMainChatHermesIdentity(grant.projectId, BUILDER_DECK_ID);
    if (!mainIdentity) {
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
        mainCardId: mainIdentity.cardId,
      },
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'external_main_context_failed',
    });
  }
});

router.post('/mcp-bridge/external_main_chat', async (req, res) => {
  if (!internalMcpBridgeAuthorized(req.headers['x-liquidaity-internal-mcp-secret'])) {
    return res.status(401).json({ ok: false, error: 'internal_mcp_bridge_authorization_required' });
  }
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  const mainCardId = String(req.body?.mainCardId || '').trim();
  const message = String(req.body?.message || '');
  if (!projectId || !deckId || !conversationId || !mainCardId || !message) {
    return res.status(400).json({ ok: false, error: 'external_main_chat_context_required' });
  }
  try {
    const run = await prepareMainCliRun({
      projectId,
      deckId,
      conversationId,
      message,
      driverSource: 'external_plugin',
      dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
    });
    if (run.cardId !== mainCardId) {
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: run.runId,
          state: 'failed',
          errorSummary: 'external_main_card_identity_mismatch',
        }),
      }).catch(() => undefined);
      return res.status(409).json({ ok: false, error: 'external_main_card_identity_mismatch' });
    }
    const result = await executePreparedMainCliRun(run, () => undefined);
    return res.json({
      ok: true,
      runId: run.runId,
      cardId: run.cardId,
      driverSource: run.driverSource,
      contextAuthorityMode: result.contextAuthorityMode,
      finalText: result.finalText,
      nativeSessionId: result.nativeSessionId || null,
      nativeTurnId: result.nativeTurnId || null,
      configuration: {
        subagentModel: result.profileMaterialization?.effectiveSubagentModel || null,
        honchoTurnStatus: 'bypassed',
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'external_main_chat_failed';
    return res.status(reason === 'main_driver_turn_already_running' ? 409 : 502).json({
      ok: false,
      error: reason,
    });
  }
});

router.post('/mcp-bridge/describe_connected_agents', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
    const result = await describeConnectedAgents({ projectId, deckId });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'describe_connected_agents_failed' });
  }
});

router.post('/mcp-bridge/internal_execution_context', (req, res) => {
  try {
    const context = resolveHermesExecutionContext({
      contextId: String(req.body?.contextId || ''),
      principal: req.body?.principal && typeof req.body.principal === 'object'
        ? req.body.principal
        : {},
    });
    return res.json({ ok: true, context });
  } catch (error) {
    return res.status(403).json({
      ok: false,
      error: error instanceof Error ? error.message : 'hermes_execution_context_rejected',
    });
  }
});

type PreparedHermesTransportArgs = {
  prepared: any;
  projectId: string;
  deckId: string;
  correlationId?: string;
  conversationId: string;
  parentRunId?: string;
  workingDirectory?: string;
  onEvent: (event: HermesSessionEvent) => void;
  onKanbanProgress?: (progress: HermesKanbanProgress) => Promise<void> | void;
};

function resolveHermesTurnArgs(
  args: PreparedHermesTransportArgs,
  transport: any,
): HermesTurnArgs {
  const identity = transport?.cardIdentity || {};
  const input = transport?.request;
  const runtime = input?.runtime;
  const provider = input?.provider;
  if (
    !input || typeof input !== 'object'
    || args.prepared?.runtimeOwner !== 'hermes'
    || runtime?.kind !== 'hermes'
    || !['main', 'delegate', 'kanban'].includes(runtime?.mode)
    || !String(runtime?.profile || '').trim()
  ) {
    throw new Error('prepared_hermes_transport_invalid');
  }
  const savedSubagentModel = readSavedSubagentModel(input.runtimeOptions?.subagentModel);
  const scriptState = input.runtimeOptions?.script;
  const scriptCompiled = scriptState?.compiled;
  const scriptPresentation = input.scriptPresentation;
  const script = scriptPresentation?.mode === 'script'
    && scriptState?.nativeSupport?.active === true
    && typeof scriptState?.source === 'string'
    && typeof scriptState?.sourceHash === 'string'
    && typeof scriptState?.compiledHash === 'string'
    && Number.isInteger(scriptState?.version)
    && Number(scriptState.version) >= 1
    && scriptCompiled && typeof scriptCompiled === 'object'
    && scriptCompiled.mode === 'outer_controller'
    ? {
        version: Number(scriptState.version),
        source: scriptState.source,
        sourceHash: scriptState.sourceHash,
        compiledHash: scriptState.compiledHash,
        mode: scriptCompiled.mode,
        inputSchema: scriptCompiled.inputSchema,
        outputSchema: scriptCompiled.outputSchema,
        toolHandles: Array.isArray(scriptCompiled.toolHandles) ? scriptCompiled.toolHandles : [],
        toolStates: scriptCompiled.toolStates && typeof scriptCompiled.toolStates === 'object'
          ? scriptCompiled.toolStates : {},
        offToolIds: Array.isArray(scriptCompiled.offToolIds) ? scriptCompiled.offToolIds : [],
        scriptToolIds: Array.isArray(scriptCompiled.scriptToolIds) ? scriptCompiled.scriptToolIds : [],
        agentToolIds: Array.isArray(scriptCompiled.agentToolIds) ? scriptCompiled.agentToolIds : [],
        timeoutSeconds: Number(scriptCompiled.timeoutSeconds),
        maxToolCalls: Number(scriptCompiled.maxToolCalls),
        maxOutputBytes: Number(scriptCompiled.maxOutputBytes),
      }
    : undefined;
  const scriptDeclaresCardInput = Boolean(
    script
    && script.inputSchema
    && typeof script.inputSchema === 'object'
    && (script.inputSchema as any).properties?.card,
  );
  return {
    cardId: String(identity.cardId || ''),
    title: String(identity.title || ''),
    runtime,
    prompt: String(input.systemPrompt || ''),
    provider: String(provider?.provider || ''),
    modelKey: String(provider?.modelKey || ''),
    providerModelId: String(provider?.providerModelId || ''),
    ...(savedSubagentModel
      ? { subagentModel: savedSubagentModel }
      : {}),
    accessMode: provider?.accessMode,
    tools: Array.isArray(input.presentedTools)
      ? input.presentedTools
      : Array.isArray(input.enabledTools) ? input.enabledTools : [],
    grantedTools: Array.isArray(input.enabledTools) ? input.enabledTools : [],
    toolCatalogPolicy: input.toolCatalogPolicy === 'all_healthy' ? 'all_healthy' : 'selected',
    disabledTools: Array.isArray(input.disabledTools) ? input.disabledTools : [],
    mcpConnectionIds: Array.isArray(input.mcpConnectionIds) ? input.mcpConnectionIds : [],
    nativeTools: Array.isArray(input.nativeTools) ? input.nativeTools : [],
    toolsets: Array.isArray(input.toolsets) ? input.toolsets : [],
    ...(script ? { script } : {}),
    ...(script ? {
      scriptInput: {
        mission: String(input.task || input.message || ''),
        ...(scriptDeclaresCardInput ? {
          card: {
            revisionId: String(args.prepared?.cardRevisionId || ''),
            defaultPrompt: String(input.message || ''),
            blocks: [
              { id: 'graph.context', content: String(input.graphContext || '') },
              { id: 'card.output_requirements', content: String(input.outputRequirements || '') },
              { id: 'run.mission', content: String(input.task || '') },
            ],
          },
        } : {}),
      },
    } : {}),
    sessionKey: deriveHermesSessionKey(
      args.projectId,
      args.conversationId,
      String(identity.cardId || ''),
    ),
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    parentRunId: args.parentRunId || args.conversationId,
    message: String(input.message || ''),
    ...(args.workingDirectory ? { workingDirectory: args.workingDirectory } : {}),
  };
}

function resolvePreparedHermesTurnArgs(
  args: PreparedHermesTransportArgs,
): HermesTurnArgs {
  return resolveHermesTurnArgs(args, args.prepared?.hermesTransport);
}

async function startPreparedHermesTransport(
  args: PreparedHermesTransportArgs,
): Promise<HermesTurnHandle> {
  const turnArgs = resolvePreparedHermesTurnArgs(args);
  const input = args.prepared?.hermesTransport?.request || {};
  const transientTask = String(input.task || '').trim();
  if (transientTask === '/learn' || transientTask.startsWith('/learn ')) {
    if (turnArgs.runtime.mode === 'kanban') throw new Error('hermes_learn_requires_acp_mode');
    const learnedPrompt = await dispatchHermesLearnCommand(
      turnArgs.runtime.profile,
      transientTask.slice('/learn'.length).trim(),
    );
    turnArgs.message = [String(input.graphContext || '').trim(), learnedPrompt]
      .filter(Boolean)
      .join('\n\n');
  }
  if (turnArgs.runtime.mode === 'kanban') {
    const mission = String(input.kanbanMission || '');
    if (!mission.trim()) throw new Error('prepared_hermes_kanban_mission_missing');
    return startNativeHermesKanbanTurn(
      { ...turnArgs, nativeMission: mission },
      args.onEvent,
      { onProgress: args.onKanbanProgress },
    );
  }
  return startHermesTurn(turnArgs, args.onEvent);
}

type ConfiguredCardRunStatus = {
  runId: string;
  correlationId: string;
  cardId: string;
  runtimeKind: string;
  runtimeMode: string;
  runtimeProfile: string;
  state: string;
  status: string;
  nativeRootId: string | null;
  nativeRunId: string | number | null;
  tasksCompleted: number;
  tasksTotal: number;
  activeWorkers: number;
  elapsedMs: number;
  toolCallCount: number;
  graphReads: number;
  graphWrites: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number;
  resultReady: boolean;
  output: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  terminal?: ReturnType<typeof buildCardTerminal>;
};

function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

async function readConfiguredCardRunStatus(args: {
  projectId: string;
  deckId: string;
  runId?: string;
  correlationId?: string;
  nativeRootId?: string;
  cardId?: string;
  reconcileTerminal?: boolean;
  includeTerminal?: boolean;
}): Promise<ConfiguredCardRunStatus | null> {
  const response = await requestPythonRailsJson('/domain/runs/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }) as any;
  const run = response?.run;
  if (!run || typeof run !== 'object') return null;
  const runId = String(run.runId || '').trim();
  const state = String(run.state || 'running');
  const nativeRootId = String(run.nativeRootId || '').trim();
  if (
    args.reconcileTerminal !== false
    && (state === 'failed' || state === 'cancelled')
    && nativeRootId
    && !String(run.result || '').trim()
    && String(run.runtimeKind || '') === 'hermes'
    && String(run.runtimeMode || '') === 'kanban'
  ) {
    reconcileTerminalKanbanRun({
      runId,
      projectId: String(run.projectId || ''),
      deckId: String(run.deckId || ''),
      cardId: String(run.cardId || ''),
      nativeRootId,
      runtimeProfile: String(run.runtimeProfile || ''),
    });
  }
  const inspection = await requestPythonRailsJson('/domain/agentgraph/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      runId,
      limit: 50,
    }),
  }) as any;
  const telemetryRun = Array.isArray(inspection?.runs)
    ? inspection.runs.find((candidate: any) => String(candidate?.runId || '') === runId)
    : null;
  const attention = Array.isArray(telemetryRun?.attentionEvents)
    ? telemetryRun.attentionEvents
    : Array.isArray(inspection?.attentionEvents) ? inspection.attentionEvents : [];
  const graphReads = Number.isSafeInteger(telemetryRun?.graphReads)
    ? telemetryRun.graphReads
    : attention.filter((event: any) => String(event?.operation || '') === 'read').length;
  const graphWrites = Number.isSafeInteger(telemetryRun?.graphWrites)
    ? telemetryRun.graphWrites
    : attention.filter((event: any) => String(event?.operation || '') === 'write').length;
  const startedAt = Date.parse(String(run.startedAt || ''));
  const finishedAt = Date.parse(String(run.finishedAt || ''));
  const elapsedMs = Number.isFinite(startedAt)
    ? Math.max(0, (Number.isFinite(finishedAt) ? finishedAt : Date.now()) - startedAt)
    : 0;
  const nativeStatus = String(run.nativePhase || '').trim();
  const output = typeof run.result === 'string' && run.result.length > 0
    ? run.result
    : null;
  let terminal: ReturnType<typeof buildCardTerminal> | undefined;
  if (args.includeTerminal) {
    terminal = buildCardTerminal(run, run.runtimeKind === 'hermes'
      ? readHermesRunSnapshot(String(run.runtimeProfile || ''), runId) : null);
    if (run.runtimeKind === 'hermes' && run.runtimeMode === 'kanban' && nativeRootId) {
      try {
        terminal = projectKanbanTerminal(run, await readHermesKanbanCardSnapshots({
          nativeRootId, projectId: String(run.projectId), cardId: String(run.cardId),
        }));
      } catch (error) {
        terminal = { ...terminal, observation: 'unavailable',
          unavailableReason: terminalText(error instanceof Error ? error.message : 'kanban_observation_failed') };
      }
    }
  }
  return {
    runId,
    correlationId: String(run.correlationId || ''),
    cardId: String(run.cardId || ''),
    runtimeKind: String(run.runtimeKind || ''),
    runtimeMode: String(run.runtimeMode || ''),
    runtimeProfile: String(run.runtimeProfile || ''),
    state,
    status: nativeStatus || (state === 'completed'
      ? 'complete'
      : state === 'cancelled'
        ? 'cancelled'
        : state === 'failed'
          ? 'failed'
        : state === 'blocked'
          ? 'blocked'
          : state === 'pending'
            ? 'queued'
            : 'working'),
    nativeRootId: nativeRootId || null,
    nativeRunId: typeof run.nativeRunId === 'number' || typeof run.nativeRunId === 'string'
      ? run.nativeRunId
      : null,
    tasksCompleted: nonNegativeNumber(run.tasksCompleted),
    tasksTotal: nonNegativeNumber(run.tasksTotal),
    activeWorkers: nonNegativeNumber(run.activeWorkers),
    elapsedMs,
    toolCallCount: nonNegativeNumber(run.toolCallCount),
    graphReads,
    graphWrites,
    inputTokens: nonNegativeNumber(run.inputTokens),
    outputTokens: nonNegativeNumber(run.outputTokens),
    cachedTokens: nonNegativeNumber(run.cachedTokens),
    reasoningTokens: nonNegativeNumber(run.reasoningTokens),
    costUsd: nonNegativeNumber(run.costUsd),
    resultReady: output !== null,
    output,
    errorCode: String(run.errorCode || '').trim() || null,
    errorSummary: String(run.errorSummary || '').trim() || null,
    ...(terminal ? { terminal } : {}),
  };
}

// Thin configured-Card transport. Python owns saved Card authorization, the one
// canonical IDF materializer, runtime-owner selection, and separate Run
// persistence. This route never rebuilds the model call.
router.post('/mcp-bridge/run_configured_card', async (req, res) => {
  const body = req.body || {};
  const action = body.action;
  if (
    action !== 'execute'
    && action !== 'status'
    && action !== 'inputs'
    && action !== 'stop'
    && action !== 'transcript'
    && action !== 'delete_transcript'
  ) {
    return res.status(400).json({ ok: false, error: 'configured_card_action_invalid' });
  }
  const projectId = String(body.projectId || '').trim();
  const deckId = String(body.deckId || BUILDER_DECK_ID).trim();
  const cardId = String(body.cardId || '').trim();
  const correlationId = String(body.correlationId || '').trim();
  const conversationId = String(body.conversationId || '').trim() || 'main';
  const originatingRunId = String(body.originatingRunId || body.parentRunId || '').trim();
  const senderCardId = String(body.senderCardId || '').trim();
  const input = String(body.input || '').trim();
  if (!projectId || !deckId) {
    return res.status(400).json({ ok: false, error: 'card_run_args_incomplete' });
  }

  if (action === 'status') {
    const runId = String(body.runId || '').trim();
    const nativeRootId = String(body.nativeRootId || '').trim();
    const selectors = [runId, correlationId, nativeRootId, cardId].filter(Boolean);
    if (selectors.length !== 1) {
      return res.status(400).json({ ok: false, error: 'card_run_status_selector_invalid' });
    }
    try {
      const status = await readConfiguredCardRunStatus({
        projectId,
        deckId,
        ...(runId ? { runId } : {}),
        ...(correlationId ? { correlationId } : {}),
        ...(nativeRootId ? { nativeRootId } : {}),
        ...(cardId ? { cardId } : {}),
        reconcileTerminal: body.inspectOnly !== true,
        includeTerminal: body.includeTerminal === true,
      });
      return res.json({ ok: true, result: status });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'card_run_status_failed',
      });
    }
  }

  if (action === 'transcript' || action === 'delete_transcript') {
    const runId = String(body.runId || '').trim();
    if (!runId || !cardId) return res.status(400).json({ ok: false, error: 'card_transcript_identity_required' });
    try {
      const response = await requestPythonRailsJson('/domain/runs/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, runId, includeTerminal: true }),
      }) as any;
      const run = response?.run;
      if (!run) return res.status(404).json({ ok: false, error: 'card_run_not_found' });
      if (run.cardId !== cardId || run.runId !== runId || run.projectId !== projectId || run.deckId !== deckId) {
        return res.status(409).json({ ok: false, error: 'card_transcript_identity_mismatch' });
      }
      if (run.runtimeKind !== 'hermes' || !['main', 'delegate'].includes(run.runtimeMode)) {
        return res.status(409).json({ ok: false, error: 'card_transcript_specialized_or_unsupported_runtime' });
      }
      if (['pending', 'running'].includes(run.state)) {
        return res.status(409).json({ ok: false, error: 'card_transcript_run_active' });
      }
      const transcript = run.terminal?.transcript;
      if (!transcript?.sessionId || transcript.unavailableReason !== null) {
        return res.status(409).json({ ok: false, error: transcript?.unavailableReason || 'native_session_identity_unavailable' });
      }
      const args: HermesHistoryArgs = {
        sessionKey: '', profile: run.runtimeProfile, sessionId: transcript.sessionId, terminal: true,
      };
      if (action === 'delete_transcript') {
        // Native #2 deletes only this exclusive runtime transcript. No Run,
        // accepted result, saved Card, Deck or graph deletion is invoked.
        const deleted = await deleteHermesHistory(args);
        return res.json({ ok: true, result: { ...terminalIdentity(run), ...deleted } });
      }
      const history = await readHermesHistory(args);
      return res.json({ ok: true, result: { ...terminalIdentity(run), sessionId: history.sessionId,
        events: terminalHistoryEvents(run, history.events || []) } });
    } catch (error) {
      return res.status(502).json({ ok: false, error: 'card_transcript_failed',
        detail: terminalText(error instanceof Error ? error.message : String(error)) });
    }
  }

  if (action === 'inputs') {
    const runId = String(body.runId || '').trim();
    if (!runId) {
      return res.status(400).json({ ok: false, error: 'card_run_input_files_run_required' });
    }
    try {
      const result = await requestPythonRailsJson('/domain/runs/input-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, runId }),
      });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'card_run_input_files_failed',
      });
    }
  }

  if (action === 'stop') {
    const runId = String(body.runId || '').trim();
    if (!runId || !cardId) {
      return res.status(400).json({ ok: false, error: 'card_run_stop_args_incomplete' });
    }
    try {
      const status = await readConfiguredCardRunStatus({ projectId, deckId, runId });
      if (!status) return res.status(404).json({ ok: false, error: 'card_run_not_found' });
      if (status.cardId !== cardId) {
        return res.status(409).json({ ok: false, error: 'card_run_stop_identity_mismatch' });
      }
      if (['completed', 'failed', 'cancelled', 'blocked'].includes(status.state)) {
        return res.json({ ok: true, result: status });
      }
      if (status.runtimeKind === 'hermes' && status.runtimeMode === 'kanban') {
        return res.status(409).json({ ok: false, error: 'hermes_kanban_stop_requires_native_task_control' });
      }
      if (status.runtimeKind !== 'hermes') {
        return res.status(409).json({ ok: false, error: 'configured_card_stop_not_supported' });
      }
      cancelHermesRun(status.runtimeProfile, runId);
      return res.status(202).json({ ok: true, result: { ...status, status: 'stopping' } });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'card_run_stop_failed',
      });
    }
  }

  if (!cardId || !correlationId || !input) {
    return res.status(400).json({ ok: false, error: 'card_run_args_incomplete' });
  }

  const transientRequest = {
    projectId,
    deckId,
    cardId,
    assignment: input,
    senderCardId: senderCardId || undefined,
    originatingRunId: originatingRunId || undefined,
    conversationId,
    dataAnchors: Array.isArray(body.dataAnchors) ? body.dataAnchors : [],
    images: Array.isArray(body.images) ? body.images : [],
  };

  try {
    const cardRevisionId = String(body.cardRevisionId || '').trim();
    const discoveredTools = await listPythonAgentMcpCatalog();
    const prepared = await requestPythonRailsJson('/domain/runs/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...transientRequest,
        cardRevisionId: cardRevisionId || undefined,
        runId: correlationId,
        correlationId,
        discoveredTools,
      }),
    }) as any;

    const runId = String(prepared.runId || correlationId).trim();
    if (prepared.rejoined) {
      const status = await readConfiguredCardRunStatus({ projectId, deckId, runId });
      return res.json({ ok: true, result: status });
    }

    const runtimeMode = String(prepared?.hermesTransport?.request?.runtime?.mode || '').trim();
    if (prepared.runtimeOwner === 'hermes' && runtimeMode === 'kanban') {
      let latestProgress: HermesKanbanProgress | null = null;
      const persistProgress = async (progress: HermesKanbanProgress): Promise<void> => {
        latestProgress = progress;
        await requestPythonRailsJson('/domain/runs/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            nativeRootId: progress.nativeRootId,
            nativeRunId: progress.nativeRunId,
            nativePhase: progress.phase,
            tasksCompleted: progress.tasksCompleted,
            tasksTotal: progress.tasksTotal,
            activeWorkers: progress.activeWorkers,
          }),
        });
      };
      let hermesHandle: HermesTurnHandle;
      try {
        hermesHandle = await startPreparedHermesTransport({
          prepared,
          projectId,
          deckId,
          conversationId,
          parentRunId: runId,
          onEvent: () => undefined,
          onKanbanProgress: (progress) => persistProgress(progress).catch((error) => {
            logHarnessTrace(
              `[harness] configured-card progress persistence failed run=${runId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
            );
          }),
        });
        const nativeRootId = String(hermesHandle.runtime.sessionId || '').trim();
        if (!nativeRootId) throw new Error('hermes_kanban_card_task_id_missing');
        latestProgress = {
          nativeRootId,
          nativeRunId: null,
          phase: 'queued',
          tasksCompleted: 0,
          tasksTotal: 1,
          activeWorkers: 0,
          workerSessionIds: [],
        };
        await persistProgress(latestProgress);

        const monitor = async (): Promise<void> => {
          try {
            const response = await hermesHandle.done;
            const progress = latestProgress ?? {
              nativeRootId,
              nativeRunId: null,
              phase: 'complete' as const,
              tasksCompleted: 1,
              tasksTotal: 1,
              activeWorkers: 0,
              workerSessionIds: [],
            };
            let usage = {
              toolCallCount: 0,
              providerInputTokens: 0,
              providerOutputTokens: 0,
              providerCachedTokens: 0,
              providerReasoningTokens: 0,
              totalCostUsd: 0,
            };
            try {
              usage = await readHermesKanbanSessionUsage(
                String(prepared.hermesTransport.request.runtime.profile || ''),
                progress.workerSessionIds,
              );
            } catch (error) {
              logHarnessTrace(
                `[harness] configured-card usage read failed run=${runId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
              );
            }
            await requestPythonRailsJson('/domain/runs/finish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                runId,
                state: 'completed',
                providerThreadRef: nativeRootId,
                providerTurnRef: response.transport?.turnId || progress.nativeRunId,
                nativePhase: 'complete',
                tasksCompleted: Math.max(progress.tasksCompleted, progress.tasksTotal),
                tasksTotal: progress.tasksTotal,
                activeWorkers: 0,
                ...usage,
                finalResult: response.finalText,
              }),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
            const blocked = message === 'hermes_kanban_card_blocked';
            await requestPythonRailsJson('/domain/runs/finish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                runId,
                state: blocked ? 'blocked' : 'failed',
                providerThreadRef: nativeRootId,
                providerTurnRef: latestProgress?.nativeRunId || null,
                nativePhase: blocked ? 'blocked' : 'failed',
                tasksCompleted: latestProgress?.tasksCompleted || 0,
                tasksTotal: latestProgress?.tasksTotal || 1,
                activeWorkers: 0,
                errorCode: 'configured_card_transport_failed',
                errorSummary: message,
              }),
            }).catch(() => undefined);
          }
        };
        startKanbanRunMonitor(runId, monitor);
        return res.status(202).json({
          ok: true,
          result: {
            status: 'queued',
            state: 'running',
            runId,
            correlationId: String(prepared.correlationId || correlationId),
            cardId,
            runtimeOwner: prepared.runtimeOwner,
            cardRevisionId: prepared.cardRevisionId,
            nativeRootId,
            transport: {
              nativeTaskId: nativeRootId,
              planType: 'hermes-native-kanban',
            },
            resultReady: false,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
        await requestPythonRailsJson('/domain/runs/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            state: 'failed',
            nativePhase: 'failed',
            errorCode: 'configured_card_transport_failed',
            errorSummary: message,
          }),
        }).catch(() => undefined);
        throw error;
      }
    }

    let hermesHandle: HermesTurnHandle | null = null;
    let runFinalized = false;
    const finishRun = async (
      state: 'completed' | 'failed' | 'cancelled',
      fields: Record<string, unknown> = {},
    ): Promise<any> => {
      if (runFinalized) return null;
      runFinalized = true;
      return requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, state, ...fields }),
      });
    };
    let output = '';
    let transport: Record<string, unknown> | null = null;
    const nativeEvents: HermesSessionEvent[] = [];
    let providerInputTokens: number | null = null;
    let providerOutputTokens: number | null = null;
    let totalCostUsd: number | null = null;
    try {
      if (prepared.runtimeOwner === 'hermes') {
        hermesHandle = await startPreparedHermesTransport({
          prepared,
          projectId,
          deckId,
          conversationId,
          parentRunId: runId,
          ...(cardId === CODER_CARD_ID ? { workingDirectory: resolveRepoRoot() } : {}),
          onEvent: (event) => {
            // Preserve real child tool effects for the parent/UI observer. Text,
            // reasoning, and memory remain inside the child Hermes session.
            if (
              event.kind === 'tool_start'
              || event.kind === 'tool_result'
              || event.kind === 'script_start'
              || event.kind === 'script_result'
            ) {
              nativeEvents.push(event);
            }
          },
        });
        const response = await hermesHandle.done;
        output = response.finalText;
        transport = response.transport;
        providerInputTokens = response.usage.providerInputTokens;
        providerOutputTokens = response.usage.providerOutputTokens;
        totalCostUsd = response.usage.totalCostUsd;
      } else if (prepared.nativeRuntimeRequest) {
        const response = await dispatchConfiguredRuntime(prepared.nativeRuntimeRequest);
        if (!response.ok) throw new Error(response.error || 'configured_runtime_failed');
        output = String(response.finalResponseText || '');
      } else {
        throw new Error(`configured_card_runtime_owner_unsupported:${String(prepared.runtimeOwner || '')}`);
      }
      const finished = await finishRun('completed', {
        providerThreadRef: hermesHandle?.runtime?.sessionId || transport?.threadId || null,
        providerTurnRef: transport?.turnId || null,
        providerInputTokens,
        providerOutputTokens,
        totalCostUsd,
        finalResult: output,
        ...(prepared.hermesTransport?.request?.scriptPresentation?.mode === 'script'
          ? {
              cardScriptExecution: {
                schemaVersion: 'liquidaity.card-script.run-execution.v1',
                presentationMode: transport?.scriptFallback ? 'degraded-script-mcp' : 'script',
                version: prepared.hermesTransport.request.runtimeOptions?.script?.version,
                sourceHash: prepared.hermesTransport.request.runtimeOptions?.script?.sourceHash,
                compiledHash: prepared.hermesTransport.request.runtimeOptions?.script?.compiledHash,
                takenOverTools: prepared.hermesTransport.request.runtimeOptions?.script?.compiled?.scriptToolIds || [],
                toolStates: prepared.hermesTransport.request.runtimeOptions?.script?.compiled?.toolStates || {},
                orderedToolStages: prepared.hermesTransport.request.runtimeOptions?.script?.compiled?.toolHandles || [],
                presentedTools: prepared.hermesTransport.request.presentedTools || [],
                executor: 'hermes-native-python-child',
                timeoutSeconds: prepared.hermesTransport.request.runtimeOptions?.script?.compiled?.timeoutSeconds,
                maxToolCalls: prepared.hermesTransport.request.runtimeOptions?.script?.compiled?.maxToolCalls,
                maxOutputBytes: prepared.hermesTransport.request.runtimeOptions?.script?.compiled?.maxOutputBytes,
                receipt: transport?.scriptReceipt || null,
                fallback: transport?.scriptFallback || null,
                controller: transport?.scriptControl || null,
                agentStage: {
                  invoked: providerInputTokens !== null || providerOutputTokens !== null,
                  provider: prepared.hermesTransport.request.provider?.provider || null,
                  model: prepared.hermesTransport.request.provider?.providerModelId || null,
                  inputTokens: providerInputTokens,
                  outputTokens: providerOutputTokens,
                },
              },
            }
          : {}),
      }) as any;
      if (res.destroyed || res.writableEnded) return undefined;
      return res.json({
        ok: true,
        result: {
          status: 'completed',
          state: 'completed',
          runId,
          correlationId: String(prepared.correlationId || correlationId),
          cardId,
          runtimeOwner: prepared.runtimeOwner,
          cardRevisionId: prepared.cardRevisionId,
          invocation: {
            ephemeral: true,
            cardRevisionId: prepared.cardRevisionId,
            cardRevision: prepared.cardRevision,
            cardRevisionSha256: prepared.cardRevisionSha256,
            runtimeOwner: prepared.runtimeOwner,
            resolvedNativeReads: prepared.resolvedNativeReads,
            resolvedGraphProjection: prepared.resolvedGraphProjection,
            idf: prepared.idf,
            inputSummary: prepared.inputSummary,
            inputFile: prepared.inputFile,
            cardIdentity: prepared.cardIdentity,
          },
          output,
          transport,
          nativeEvents,
          receipt: finished.receipt || null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
      const cancelled = message === 'hermes_turn_cancelled';
      const scriptResultEvent = [...nativeEvents].reverse().find((event) => event.kind === 'script_result') as
        | Extract<HermesSessionEvent, { kind: 'script_result' }>
        | undefined;
      await finishRun(cancelled ? 'cancelled' : 'failed', {
        providerThreadRef: hermesHandle?.runtime?.sessionId || null,
        nativePhase: cancelled ? 'cancelled' : 'failed',
        errorCode: cancelled ? 'configured_card_run_stopped' : 'configured_card_transport_failed',
        errorSummary: message,
        ...(transport?.scriptReceipt || transport?.scriptFallback || scriptResultEvent
          ? {
              cardScriptExecution: {
                schemaVersion: 'liquidaity.card-script.run-execution.v1',
                presentationMode: transport?.scriptFallback ? 'degraded-script-mcp' : 'script-failed',
                version: prepared.hermesTransport?.request?.runtimeOptions?.script?.version,
                sourceHash: prepared.hermesTransport?.request?.runtimeOptions?.script?.sourceHash,
                compiledHash: prepared.hermesTransport?.request?.runtimeOptions?.script?.compiledHash,
                takenOverTools: prepared.hermesTransport?.request?.runtimeOptions?.script?.compiled?.scriptToolIds || [],
                toolStates: prepared.hermesTransport?.request?.runtimeOptions?.script?.compiled?.toolStates || {},
                orderedToolStages: prepared.hermesTransport?.request?.runtimeOptions?.script?.compiled?.toolHandles || [],
                presentedTools: prepared.hermesTransport?.request?.presentedTools || [],
                executor: 'hermes-native-python-child',
                receipt: transport?.scriptReceipt || scriptResultEvent?.receipt || null,
                fallback: transport?.scriptFallback || scriptResultEvent?.fallback || null,
                controller: transport?.scriptControl || null,
                agentStage: { invoked: false },
              },
            }
          : {}),
      }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_configured_card_failed' });
  }
});

// ── Persistent repo-owned Hermes Main bridge (BuilderChat -> ACP) ───────────
// One stable native Hermes conversation per saved Main card and product
// conversation. The saved Coder Card remains a separate Hermes profile.

type NativeAttentionEvent = {
  eventId: string;
  timestamp: string;
  projectId: string | null;
  deckId: string | null;
  conversationId: string | null;
  runId: string | null;
  cardId: string | null;
  authority: 'codegraph' | 'knowgraph' | 'thinkgraph' | 'agentgraph';
  operation: 'read' | 'write';
  toolName: string;
  nativeNodeIds: string[];
  nativeEdgeIds: string[];
  nativeEdges: Array<{
    id: string;
    source: string;
    target: string;
    predicate: string | null;
    provenance?: Record<string, unknown>;
  }>;
  resultHash: string;
  truncated: boolean;
  phase?: 'pending' | 'completed' | 'failed';
  change?: 'read' | 'write' | 'create' | 'delete' | 'clear';
  nativeChildId?: string | null;
  nativeRunId?: string | null;
  runState?: string;
  scopeGroupIds?: string[];
};

function nativeAttentionEvents(value: unknown): NativeAttentionEvent[] {
  if (!value || typeof value !== 'object') return [];
  const runs = Array.isArray((value as any).runs) ? (value as any).runs : [];
  return runs.flatMap((run: any) => Array.isArray(run?.attentionEvents)
    ? run.attentionEvents.map((event: any) => ({ ...event, runState: run.state })) : [])
    .filter((event: any) => (
      event
      && typeof event === 'object'
      && String(event.eventId || '').trim()
      && ['codegraph', 'knowgraph', 'thinkgraph', 'agentgraph'].includes(event.authority)
      && ['read', 'write'].includes(event.operation)
    ))
    .map((event: any) => ({
      eventId: String(event.eventId),
      timestamp: String(event.timestamp || ''),
      projectId: event.projectId ? String(event.projectId) : null,
      deckId: event.deckId ? String(event.deckId) : null,
      conversationId: event.conversationId ? String(event.conversationId) : null,
      runId: event.runId ? String(event.runId) : null,
      cardId: event.cardId ? String(event.cardId) : null,
      authority: event.authority,
      operation: event.operation,
      toolName: String(event.toolName || ''),
      nativeNodeIds: Array.isArray(event.nativeNodeIds) ? event.nativeNodeIds.map(String).slice(0, 128) : [],
      nativeEdgeIds: Array.isArray(event.nativeEdgeIds) ? event.nativeEdgeIds.map(String).slice(0, 256) : [],
      nativeEdges: Array.isArray(event.nativeEdges) ? event.nativeEdges
        .filter((edge: any) => edge && typeof edge === 'object')
        .map((edge: any) => ({
          id: String(edge.id || ''),
          source: String(edge.source || ''),
          target: String(edge.target || ''),
          predicate: String(edge.predicate || '').trim() || null,
          ...(edge.provenance && typeof edge.provenance === 'object'
            ? { provenance: edge.provenance as Record<string, unknown> }
            : {}),
        }))
        .filter((edge: any) => edge.id && edge.source && edge.target)
        .slice(0, 256) : [],
      resultHash: String(event.resultHash || ''),
      truncated: event.truncated === true,
      ...(event.phase ? { phase: event.phase } : {}),
      ...(event.change ? { change: event.change } : {}),
      ...(event.nativeChildId ? { nativeChildId: String(event.nativeChildId) } : {}),
      ...(event.nativeRunId ? { nativeRunId: String(event.nativeRunId) } : {}),
      ...(event.runState ? { runState: String(event.runState) } : {}),
      ...(Array.isArray(event.scopeGroupIds) ? { scopeGroupIds: event.scopeGroupIds.map(String).slice(0, 128) } : {}),
    }));
}

function latestScopedNativeAttentionEvents(
  value: unknown,
  scope: { projectId: string; deckId: string; conversationId?: string; cardId?: string; runId?: string },
): NativeAttentionEvent[] {
  const scoped = nativeAttentionEvents(value)
    .filter((event) => event.projectId === scope.projectId && event.deckId === scope.deckId)
    .filter((event) => !scope.conversationId || event.conversationId === scope.conversationId)
    .filter((event) => !scope.cardId || event.cardId === scope.cardId)
    .filter((event) => !scope.runId || event.runId === scope.runId)
    .filter((event) => event.authority !== 'agentgraph')
    .filter((event) => event.runId && Number.isFinite(Date.parse(event.timestamp)))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const latestRunId = scoped.at(-1)?.runId;
  if (!latestRunId) return [];
  const seen = new Set<string>();
  return scoped.filter((event) => {
    if (event.runId !== latestRunId || seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    return true;
  });
}

router.get('/main/session/attention', async (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const deckId = String(req.query?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query?.conversationId || '').trim();
  const cardId = String(req.query?.cardId || '').trim();
  const runId = String(req.query?.runId || '').trim();
  const stream = req.query?.stream === 'true';
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  try {
    const readInspection = () => requestPythonRailsJson('/domain/agentgraph/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, limit: cardId ? 1 : 50,
        ...(conversationId ? { conversationId } : {}),
        ...(cardId ? { cardId, directOnly: true } : {}),
        ...(runId ? { runId } : {}),
      }),
    });
    const inspection = await readInspection();
    if (stream) {
      // Follow the existing AGE observation store using the same session and
      // native_attention SSE contracts as Main. No runtime or event bus is
      // started by this read-only subscription.
      res.writeHead(200, { 'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
        'X-Accel-Buffering': 'no' });
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let previous = new Map<string, string>();
      const emit = (kind: string, value: Record<string, unknown>, key: string,
        next: Map<string, string>) => {
        const body = JSON.stringify({ ...value, kind });
        next.set(key, body);
        if (body !== previous.get(key) && !closed) res.write(`event: ${kind}\ndata: ${body}\n\n`);
      };
      const deliver = (value: any) => {
        const next = new Map<string, string>();
        const runs = Array.isArray(value?.runs) ? value.runs : [];
        for (const run of runs) {
          emit('session', { projectId, deckId: run.deckId || deckId,
            conversationId: run.conversationId || null, cardId: run.cardId,
            runId: run.runId, state: run.state, nativeChildId: run.nativeChildId || null,
            materializedNativeReferences: run.materializedNativeReferences || [] },
          `run:${run.runId}`, next);
        }
        if (cardId && !runs.length) emit('session', { projectId, deckId, cardId,
          runId: null, state: null, materializedNativeReferences: [] }, `card:${cardId}`, next);
        // AGE returns newest-first for bounded selection. Replay oldest-first
        // so a retained read cannot resurrect an acknowledged later deletion.
        for (const event of nativeAttentionEvents(value)
          .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))) {
          if (event.authority === 'agentgraph' || event.projectId !== projectId
            || event.deckId !== deckId || (cardId && (event.cardId !== cardId || event.nativeChildId))) continue;
          emit('native_attention', event, event.eventId, next);
        }
        previous = next;
      };
      const poll = async () => {
        try { deliver(await readInspection()); }
        catch (error) {
          if (!closed) {
            res.write(`event: error\ndata: ${JSON.stringify({ kind: 'error',
              error: error instanceof Error ? error.message : 'native_attention_read_failed' })}\n\n`);
            res.end();
          }
          return;
        }
        if (!closed) timer = setTimeout(poll, 2000);
      };
      res.on('close', () => { closed = true; if (timer) clearTimeout(timer); });
      deliver(inspection);
      res.write(': AGE attention connected\n\n');
      timer = setTimeout(poll, 2000);
      return;
    }
    return res.json({
      ok: true,
      events: latestScopedNativeAttentionEvents(inspection, {
        projectId,
        deckId,
        ...(conversationId ? { conversationId } : {}),
        ...(cardId ? { cardId } : {}),
        ...(runId ? { runId } : {}),
      }),
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'native_attention_read_failed',
    });
  }
});

router.get('/main/session/driver', (_req, res) => {
  const status = mainCliBridge.status();
  return res.json({
    ok: true,
    ready: status.ready,
    activeDriver: status.activeDriver,
    activeContextAuthorityMode: status.activeContextAuthorityMode,
  });
});

router.post('/main/session/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'default').trim();
  const message = String(req.body?.message || '');
  if (!projectId || !message) {
    return res.status(400).json({ ok: false, error: 'projectId_and_message_required' });
  }

  let run: PreparedMainCliRun;
  try {
    run = await prepareMainCliRun({
      projectId,
      deckId,
      conversationId,
      message,
      driverSource: 'internal_chat',
      dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'main_domain_preparation_failed';
    logHarnessTrace(`[main-cli] request rejected reason=${redactTrace(reason)}`);
    return res.status(reason === 'main_hermes_card_not_runnable' ? 424 : 503).json({
      ok: false,
      error: reason === 'main_hermes_card_not_runnable'
        ? reason
        : 'main_domain_preparation_failed',
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const eventIdentity = {
    projectId,
    deckId,
    conversationId,
    cardId: run.cardId,
    runId: run.runId,
  };
  const writeSse = (eventName: string, payload: Record<string, unknown>): boolean => {
    if (res.destroyed || res.writableEnded) return false;
    res.write(`event: ${eventName}\ndata: ${JSON.stringify({ ...payload, ...eventIdentity })}\n\n`);
    return true;
  };
  writeSse('run', {
    state: 'accepted',
    driverSource: 'internal_chat',
    contextAuthorityMode: contextAuthorityModeForDriver('internal_chat'),
  });

  try {
    const result = await executePreparedMainCliRun(
      run,
      (event) => {
        if (event.kind === 'started') {
          writeSse('session', {
            sessionId: event.nativeSessionId || null,
            nativeTurnId: event.nativeTurnId || null,
            driverSource: 'internal_chat',
            contextAuthorityMode: event.contextAuthorityMode
              || contextAuthorityModeForDriver('internal_chat'),
            configuration: {
              provider: run.prepared.hermesTransport.request.provider?.provider || null,
              model: run.prepared.hermesTransport.request.provider?.providerModelId || null,
              profile: run.prepared.hermesTransport.request.runtime?.profile || null,
              grantedTools: run.prepared.hermesTransport.request.enabledTools || [],
              loadedSkills: null,
              subagentModel: run.profileMaterialization?.effectiveSubagentModel || null,
              honchoTurnStatus: 'native_fail_open',
            },
          });
        } else if (event.kind === 'text' && event.delta) {
          writeSse('text', { text: event.delta });
        }
      },
    );
    writeSse('done', {
      fullText: result.finalText,
      contextAuthorityMode: result.contextAuthorityMode,
      usage: {
        providerInputTokens: null,
        providerOutputTokens: null,
        totalCostUsd: null,
        usageAvailable: false,
        usageSource: 'native_cli_usage_unavailable',
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'main_cli_turn_failed';
    writeSse('error', {
      code: reason,
      message: reason === 'main_driver_turn_already_running'
        ? 'Another Main input driver owns the active turn.'
        : 'The native Main CLI turn failed.',
      status: reason === 'main_driver_turn_already_running'
        ? 409
        : reason === 'main_cli_bridge_unavailable'
          ? 503
          : 502,
    });
  } finally {
    writeSse('end', {});
    if (!res.destroyed && !res.writableEnded) res.end();
  }
  return undefined;
});
router.post('/main/session/stop', async (req, res) => {
  const expectedRunId = String(req.body?.expectedRunId || '').trim();
  if (!expectedRunId) {
    return res.status(400).json({ ok: false, error: 'expected_run_id_required' });
  }
  if (!mainCliBridge.requestCancel(expectedRunId)) {
    return res.status(404).json({ ok: false, error: 'no_active_turn' });
  }
  const mainTerminal = coderTerminalSessionManager.list().find((session) => (
    session.ownerCardId === 'card_main_chat'
    && session.runtimeSource === 'repository_hermes_cli'
    && ['starting', 'running'].includes(session.state)
  ));
  const session = mainTerminal ? coderTerminalSessionManager.get(mainTerminal.id) : undefined;
  if (!session?.write('\x03')) {
    return res.status(503).json({ ok: false, error: 'main_cli_stop_unavailable' });
  }
  return res.status(202).json({ ok: true, runId: expectedRunId, state: 'stopping' });
});
router.post('/main/session/answer', (_req, res) => {
  return res.status(409).json({
    ok: false,
    error: 'main_cli_structured_answer_unavailable',
  });
});
router.get('/main/session/history', (_req, res) => {
  const history = mainCliBridge.history();
  if (!history) {
    return res.status(503).json({
      ok: false,
      error: 'main_cli_history_bridge_unavailable',
      messages: [],
    });
  }
  return res.json({ ok: true, ...history });
});
router.delete('/main/session/history', (_req, res) => {
  return res.status(405).json({
    ok: false,
    error: 'main_cli_history_is_native_owned',
  });
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

// ── Repository Hermes control center ───────────────────────────────────────
// xterm forwards bytes to and from the startup-owned Hermes Coder ConPTY.
// Opening or closing the dock never owns this process lifecycle.
function mountConsoleSessionRoutes(
  prefix: string,
  manager: typeof coderTerminalSessionManager,
): void {
  router.get(`${prefix}/sessions`, (_req, res) => {
    return res.json({ ok: true, sessions: manager.list() });
  });

  router.get(`${prefix}/sessions/:id`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    return res.json({ ok: true, session: session.info });
  });

  router.get(`${prefix}/sessions/:id/pty`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    if (!session.isLive()) {
      return res.status(409).json({ ok: false, error: 'hermes_coder_terminal_not_running' });
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const unsubscribeOutput = session.subscribeOutput((data) => {
      if (!res.destroyed && !res.writableEnded) res.write(data);
    });
    const unsubscribeLifecycle = session.subscribeLifecycle((info) => {
      if (['stopped', 'failed'].includes(info.state) && !res.writableEnded) {
        res.end();
      }
    });
    if (!session.isLive() && !res.writableEnded) res.end();
    const detach = () => {
      unsubscribeOutput();
      unsubscribeLifecycle();
    };
    res.once('close', detach);
    req.once('aborted', () => {
      detach();
      if (!res.writableEnded) res.end();
    });
    return undefined;
  });

  router.post(`${prefix}/sessions/:id/input`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const data = typeof req.body?.data === 'string' ? req.body.data : '';
    if (!data || data.length > 65_536) {
      return res.status(400).json({ ok: false, error: 'coder_terminal_data_required' });
    }
    const delivered = session.write(data);
    return res.status(delivered ? 200 : 409).json({
      ok: delivered,
      delivered,
      ...(delivered ? {} : { error: 'hermes_coder_terminal_not_running' }),
    });
  });

  router.post(`${prefix}/sessions/:id/resize`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const resized = session.resize(Number(req.body?.cols), Number(req.body?.rows));
    return res.status(resized ? 200 : 409).json({
      ok: resized,
      resized,
      ...(resized ? {} : { error: 'hermes_coder_terminal_resize_rejected' }),
    });
  });

}

mountConsoleSessionRoutes('/hermes/coder-terminal', coderTerminalSessionManager);


/** Resolve the saved Main Card's durable Hermes identity, never its title or grants. */
async function resolveMainChatHermesIdentity(
  projectId: string,
  deckId: string,
): Promise<{ cardId: string; profile: string } | null> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = (deck?.nodes || []).find(
    (node: any) =>
      node?.runtime?.kind === 'hermes' && node?.runtime?.mode === 'main',
  );
  const runtime = card?.runtime;
  if (!card || runtime?.kind !== 'hermes' || runtime.mode !== 'main') return null;
  const cardId = String(card?.id || '').trim();
  const profile = String(runtime.profile || '').trim();
  return cardId && profile ? { cardId, profile } : null;
}

export default router;
