import { Router, type Response } from 'express';
import {
  agentTerminalManager,
  resolveHermesBotRosterProjections,
  type HermesBotRosterProjection,
} from '../hermes/agentTerminal';
import {
  cardToolAuthenticationFailureStage,
  PROJECT_ROSTER_AUTHORITY_TOOL,
  RUNTIME_OBSERVATION_AUTHORITY_TOOL,
  type AuthenticatedCardToolRequest,
} from '../hermes/cardToolsPlugin';
import { cardTurnBridge } from '../hermes/runtime/cardTurn';
import { isLoopbackSocketRequest } from '../security/requestAccess';
import { resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { getDeckDocument } from '../decks/store';

const MAX_AUTH_FIELD_BYTES = 768 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

type CardToolManager = {
  authenticateCardToolRequest(
    keyId: string,
    payload: string,
    signature: string,
  ): AuthenticatedCardToolRequest | Promise<AuthenticatedCardToolRequest>;
};

type InternalCardToolRequest = {
  projectId: string;
  deckId: string;
  cardId: string;
  cardRevisionId: string;
  configurationFingerprint: string;
  runtimeMode: 'main' | 'delegate' | 'magentic_one';
  toolName: string;
  arguments: Record<string, unknown>;
  conversationId: string;
  parentRunId: string;
};

type Dependencies = {
  agentTerminalManager: CardToolManager;
  activeContext(sessionId: string): {
    runId: string;
    conversationId: string;
    authorizedCanonicalTools: string[];
  } | null;
  execute(request: InternalCardToolRequest): Promise<{ ok: true; output: string }>;
  observe(request: Record<string, unknown>): Promise<unknown>;
  resolveProjectRosters(projectId: string, deckId: string): Promise<HermesBotRosterProjection[]>;
  openProjectRosterTarget(
    authenticated: AuthenticatedCardToolRequest,
    projection: HermesBotRosterProjection,
  ): Promise<string>;
  isLoopbackSocketRequest: typeof isLoopbackSocketRequest;
};

class CardToolRouteError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function routeError(status: number, code: string): never {
  throw new CardToolRouteError(status, code);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactEnvelope(value: unknown): { keyId: string; payload: string; signature: string } {
  const body = record(value);
  if (Object.keys(body).sort().join('\0') !== 'keyId\0payload\0signature') {
    routeError(400, 'hermes_card_tool_request_invalid');
  }
  const keyId = typeof body.keyId === 'string' ? body.keyId : '';
  const payload = typeof body.payload === 'string' ? body.payload : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (
    !keyId || !payload || !signature
    || Buffer.byteLength(keyId) > MAX_AUTH_FIELD_BYTES
    || Buffer.byteLength(payload) > MAX_AUTH_FIELD_BYTES
    || Buffer.byteLength(signature) > MAX_AUTH_FIELD_BYTES
  ) routeError(400, 'hermes_card_tool_request_invalid');
  return { keyId, payload, signature };
}

async function openProjectRosterTarget(
  authenticated: AuthenticatedCardToolRequest,
  projection: HermesBotRosterProjection,
): Promise<string> {
  const loaded = await getDeckDocument(authenticated.owner.projectId, authenticated.owner.deckId);
  if (!loaded.deck) throw new Error('hermes_project_roster_deck_missing');
  const matches = loaded.deck.nodes.filter((card) => card.id === projection.cardId);
  if (matches.length !== 1) throw new Error('hermes_project_roster_target_missing');
  const card = matches[0];
  if (
    card.runtime.kind !== 'hermes'
    || String(card.runtime.profile || '').trim() !== projection.profile
  ) throw new Error('hermes_project_roster_target_stale');
  const state = await agentTerminalManager.open(
    {
      userId: authenticated.owner.userId,
      projectId: authenticated.owner.projectId,
      deckId: authenticated.owner.deckId,
      cardId: projection.cardId,
      conversationId: authenticated.owner.conversationId,
    },
    card,
    loaded.deck,
    120,
    36,
    { attachTui: false, botRosterProjection: projection },
  );
  if (!state.storedSessionId) throw new Error('hermes_project_roster_session_missing');
  return state.storedSessionId;
}

export async function executeInternalCardTool(
  request: InternalCardToolRequest,
): Promise<{ ok: true; output: string }> {
  const secret = String(process.env.LIQUIDAITY_INTERNAL_MCP_SECRET || '').trim();
  if (secret.length < 32) throw new Error('internal_mcp_secret_missing');
  const url = new URL(resolveInternalMcpUrl());
  url.pathname = '/internal/card-tool';
  url.search = '';
  url.hash = '';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LiquidAIty-Internal-MCP-Secret': secret,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(320_000),
  });
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_RESULT_BYTES) throw new Error('hermes_card_tool_result_too_large');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('hermes_card_tool_runtime_response_invalid');
  }
  const body = record(value);
  if (!response.ok || body.ok !== true || typeof body.output !== 'string') {
    const code = String(body.error || `http_${response.status}`).trim();
    throw new Error(`hermes_card_tool_runtime_failed:${code}`);
  }
  return { ok: true, output: body.output };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof CardToolRouteError) {
    res.status(error.status).json({ error: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : '';
  if (message.includes('configuration_stale') || message.includes('card_revision_stale')) {
    res.status(409).json({ error: 'hermes_card_tool_configuration_stale' });
    return;
  }
  res.status(503).json({ error: 'hermes_card_tool_runtime_unavailable' });
}

export function createHermesCardToolsRouter(
  dependencies: Dependencies = {
    agentTerminalManager,
    activeContext: (sessionId) => cardTurnBridge.activeContext(sessionId),
    execute: executeInternalCardTool,
    observe: (request) => requestPythonRailsJson('/domain/runs/attempt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
    resolveProjectRosters: resolveHermesBotRosterProjections,
    openProjectRosterTarget,
    isLoopbackSocketRequest,
  },
) {
  const router = Router();
  router.post('/', async (req, res) => {
    try {
      if (!dependencies.isLoopbackSocketRequest(req)) {
        routeError(403, 'hermes_card_tool_loopback_required');
      }
      const envelope = exactEnvelope(req.body);
      let authenticated: AuthenticatedCardToolRequest;
      try {
        authenticated = await dependencies.agentTerminalManager.authenticateCardToolRequest(
          envelope.keyId,
          envelope.payload,
          envelope.signature,
        );
      } catch (error) {
        const stage = cardToolAuthenticationFailureStage(error);
        if (stage) console.warn(`[hermes-card-tools] authentication failed stage=${stage}`);
        routeError(401, 'hermes_card_tool_authentication_failed');
      }
      const executionContext = authenticated!.executionContext;
      if (authenticated!.canonicalToolName === RUNTIME_OBSERVATION_AUTHORITY_TOOL) {
        const active = dependencies.activeContext(authenticated!.state.sessionId);
        if (!active?.runId) routeError(409, 'hermes_runtime_observation_run_unavailable');
        const attempt = authenticated!.request.arguments.attempt;
        if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
          routeError(400, 'hermes_runtime_observation_invalid');
        }
        await dependencies.observe({
          projectId: authenticated!.owner.projectId,
          deckId: authenticated!.owner.deckId,
          cardId: authenticated!.owner.cardId,
          runId: active.runId,
          attempt,
        });
        return res.json({ ok: true, output: JSON.stringify({ observed: true }) });
      }
      if (authenticated!.canonicalToolName === PROJECT_ROSTER_AUTHORITY_TOOL) {
        const projections = await dependencies.resolveProjectRosters(
          authenticated!.owner.projectId,
          authenticated!.owner.deckId,
        );
        const sources = projections.filter((entry) => (
          entry.cardId === authenticated!.owner.cardId
        ));
        if (sources.length !== 1) routeError(409, 'hermes_project_roster_stale');
        const source = sources[0];
        if (
          source.cardRevisionId
          && source.cardRevisionId !== authenticated!.cardTools.cardRevisionId
        ) routeError(409, 'hermes_project_roster_stale');
        const byProfile = new Map(projections.map((entry) => [entry.profile, entry]));
        const targetProjections = source.roster.map((profile) => {
          const target = byProfile.get(profile);
          if (!target) routeError(409, 'hermes_project_roster_stale');
          return target;
        });
        const targets = targetProjections.map((target) => ({
          title: target.title,
          profile: target.profile,
        }));
        const requested = authenticated!.request.arguments.target;
        if (requested === undefined) {
          return res.json({ ok: true, output: JSON.stringify({ targets }) });
        }
        if (typeof requested !== 'string') routeError(400, 'hermes_project_roster_target_invalid');
        // The plugin removes the single optional user-facing `@` before signing.
        // Resolve only that exact normalized title here so repeated prefixes cannot
        // be stripped once in the plugin and again at the authority boundary.
        const visible = requested.trim().toLocaleLowerCase('en-US');
        const matches = targetProjections.filter((target) => (
          target.title.toLocaleLowerCase('en-US') === visible
        ));
        if (matches.length !== 1) routeError(403, 'hermes_project_roster_target_forbidden');
        const target = matches[0];
        const storedSessionId = await dependencies.openProjectRosterTarget(authenticated!, target);
        return res.json({
          ok: true,
          output: JSON.stringify({
            targets,
            resolved: { profile: target.profile, storedSessionId },
          }),
        });
      }
      const active = executionContext
        ? null
        : dependencies.activeContext(authenticated!.state.sessionId);
      const result = await dependencies.execute({
        projectId: authenticated!.owner.projectId,
        deckId: authenticated!.owner.deckId,
        cardId: authenticated!.owner.cardId,
        cardRevisionId: authenticated!.cardTools.cardRevisionId,
        configurationFingerprint: authenticated!.cardTools.configurationFingerprint,
        runtimeMode: authenticated!.cardTools.runtimeMode,
        toolName: authenticated!.canonicalToolName,
        arguments: authenticated!.request.arguments,
        conversationId: executionContext?.conversationId || active?.conversationId || '',
        parentRunId: executionContext?.parentRunId || active?.runId || '',
      });
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });
  return router;
}

export default createHermesCardToolsRouter();
