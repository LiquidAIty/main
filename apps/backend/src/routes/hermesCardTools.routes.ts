import { Router, type Response } from 'express';
import {
  agentTerminalManager,
  type AuthenticatedCardToolRequest,
} from '../hermes/agentTerminal';
import { agentTerminalExecution } from '../hermes/agentTerminalExecution';
import { isLoopbackSocketRequest } from '../security/requestAccess';
import { resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';

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
  runtimeMode: 'main' | 'delegate' | 'kanban' | 'magentic_one';
  toolName: string;
  arguments: Record<string, unknown>;
  conversationId: string;
  parentRunId: string;
};

type Dependencies = {
  agentTerminalManager: CardToolManager;
  activeContext(sessionId: string): { runId: string; conversationId: string } | null;
  execute(request: InternalCardToolRequest): Promise<{ ok: true; output: string }>;
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
    activeContext: (sessionId) => agentTerminalExecution.activeContext(sessionId),
    execute: executeInternalCardTool,
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
      } catch {
        routeError(401, 'hermes_card_tool_authentication_failed');
      }
      const executionContext = authenticated!.executionContext;
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
