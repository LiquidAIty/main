import { Router, type Response } from 'express';
import { getDeckDocument } from '../decks/store';
import {
  agentTerminalManager,
  requireAgentTerminalCard,
  type AgentTerminalOwner,
  type AgentTerminalState,
} from '../hermes/agentTerminal';
import { isLoopbackSocketRequest } from '../security/requestAccess';
import { getProjectCard } from '../services/agentBuilderStore';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import type { AgentCardInstance, DeckDocument } from '../types';

const MAX_AUTH_FIELD_BYTES = 256 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;

type HermesBotDmRequest = {
  version: 1;
  expiresAt: number;
  nonce: string;
  sourceStoredSessionId: string;
  target: string;
  message: string;
};

type AuthenticatedHermesBotDmRequest = {
  owner: AgentTerminalOwner;
  state: AgentTerminalState;
  request: HermesBotDmRequest;
};

type HermesBotDmManager = {
  authenticateBotDmRequest(
    keyId: string,
    payload: string,
    signature: string,
  ): AuthenticatedHermesBotDmRequest | Promise<AuthenticatedHermesBotDmRequest>;
  verifyConfiguration(
    owner: AgentTerminalOwner,
    sessionId: string,
    card: AgentCardInstance,
    deck: DeckDocument,
  ): void;
};

type ResolvedHermesBotDmCard = {
  cardId: string;
  title: string;
  profile: string;
  description: string;
  cardRevisionId: string;
};

export type HermesBotDmRouterDependencies = {
  agentTerminalManager: HermesBotDmManager;
  getProjectCard: typeof getProjectCard;
  getDeckDocument: typeof getDeckDocument;
  requestPythonRailsJson: typeof requestPythonRailsJson;
  isLoopbackSocketRequest: typeof isLoopbackSocketRequest;
  requireAgentTerminalCard: typeof requireAgentTerminalCard;
};

class HermesBotDmRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function routeError(status: number, code: string): never {
  throw new HermesBotDmRouteError(status, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedProfile(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function exactEnvelope(body: unknown): { keyId: string; payload: string; signature: string } {
  if (!isRecord(body)) routeError(400, 'hermes_bot_dm_request_invalid');
  const keys = Object.keys(body).sort();
  if (keys.length !== 3 || keys[0] !== 'keyId' || keys[1] !== 'payload' || keys[2] !== 'signature') {
    routeError(400, 'hermes_bot_dm_request_invalid');
  }
  const { keyId, payload, signature } = body;
  if (
    typeof keyId !== 'string' || !keyId.trim()
    || typeof payload !== 'string' || !payload.trim()
    || typeof signature !== 'string' || !signature.trim()
    || Buffer.byteLength(keyId) > MAX_AUTH_FIELD_BYTES
    || Buffer.byteLength(payload) > MAX_AUTH_FIELD_BYTES
    || Buffer.byteLength(signature) > MAX_AUTH_FIELD_BYTES
  ) routeError(400, 'hermes_bot_dm_request_invalid');
  return { keyId, payload, signature };
}

function requireOwner(value: unknown): AgentTerminalOwner {
  if (!isRecord(value)) routeError(401, 'hermes_bot_dm_authentication_failed');
  const owner = {
    userId: typeof value.userId === 'string' ? value.userId.trim() : '',
    projectId: typeof value.projectId === 'string' ? value.projectId.trim() : '',
    deckId: typeof value.deckId === 'string' ? value.deckId.trim() : '',
    cardId: typeof value.cardId === 'string' ? value.cardId.trim() : '',
  };
  if (Object.values(owner).some((field) => !field)) {
    routeError(401, 'hermes_bot_dm_authentication_failed');
  }
  return owner;
}

function requireAuthenticatedRequest(value: unknown): AuthenticatedHermesBotDmRequest {
  if (!isRecord(value) || !isRecord(value.state) || !isRecord(value.request)) {
    routeError(401, 'hermes_bot_dm_authentication_failed');
  }
  const owner = requireOwner(value.owner);
  const state = value.state as AgentTerminalState;
  const request = value.request as Partial<HermesBotDmRequest>;
  if (
    request.version !== 1
    || typeof request.expiresAt !== 'number' || !Number.isFinite(request.expiresAt)
    || typeof request.nonce !== 'string' || !request.nonce
    || typeof request.sourceStoredSessionId !== 'string' || !request.sourceStoredSessionId
    || typeof request.target !== 'string' || !request.target.trim()
    || typeof request.message !== 'string' || !request.message.trim()
    || Buffer.byteLength(request.message) > MAX_MESSAGE_BYTES
  ) routeError(401, 'hermes_bot_dm_authentication_failed');
  return { owner, state, request: request as HermesBotDmRequest };
}

function requireResolvedCard(
  value: unknown,
  owner: AgentTerminalOwner,
): ResolvedHermesBotDmCard {
  if (!isRecord(value)) routeError(502, 'hermes_bot_dm_authority_response_invalid');
  if (
    value.ok !== true
    || value.projectId !== owner.projectId
    || value.deckId !== owner.deckId
    || value.sourceCardId !== owner.cardId
    || !isRecord(value.card)
  ) routeError(502, 'hermes_bot_dm_authority_response_invalid');
  const card = value.card;
  if (typeof card.title !== 'string' || typeof card.description !== 'string') {
    routeError(502, 'hermes_bot_dm_authority_response_invalid');
  }
  const resolved = {
    cardId: typeof card.cardId === 'string' ? card.cardId.trim() : '',
    title: card.title,
    profile: typeof card.profile === 'string' ? card.profile.trim() : '',
    description: card.description,
    cardRevisionId: typeof card.cardRevisionId === 'string' ? card.cardRevisionId.trim() : '',
  };
  if (!resolved.cardId || !resolved.profile || !resolved.cardRevisionId) {
    routeError(502, 'hermes_bot_dm_authority_response_invalid');
  }
  return resolved;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof HermesBotDmRouteError) {
    res.status(error.status).json({ error: error.code });
    return;
  }
  res.status(500).json({ error: 'hermes_bot_dm_internal_failure' });
}

const defaultManager = agentTerminalManager as typeof agentTerminalManager & HermesBotDmManager;

export function createHermesBotDmRouter(
  dependencies: HermesBotDmRouterDependencies = {
    agentTerminalManager: defaultManager,
    getProjectCard,
    getDeckDocument,
    requestPythonRailsJson,
    isLoopbackSocketRequest,
    requireAgentTerminalCard,
  },
) {
  const router = Router();
  router.post('/', async (req, res) => {
    try {
      if (!dependencies.isLoopbackSocketRequest(req)) {
        routeError(403, 'hermes_bot_dm_loopback_required');
      }
      const envelope = exactEnvelope(req.body);
      let authenticated: AuthenticatedHermesBotDmRequest;
      try {
        authenticated = requireAuthenticatedRequest(await dependencies.agentTerminalManager
          .authenticateBotDmRequest(envelope.keyId, envelope.payload, envelope.signature));
      } catch {
        routeError(401, 'hermes_bot_dm_authentication_failed');
      }

      const { owner, state: sourceState, request } = authenticated!;
      let project;
      try {
        project = await dependencies.getProjectCard(owner.projectId, owner.userId);
      } catch {
        routeError(503, 'hermes_bot_dm_source_lookup_unavailable');
      }
      if (
        !project
        || project.id !== owner.projectId
        || String(project.ownerUserId || '').trim() !== owner.userId
      ) routeError(403, 'hermes_bot_dm_source_identity_invalid');

      let deck: DeckDocument | null;
      try {
        ({ deck } = await dependencies.getDeckDocument(owner.projectId, owner.deckId));
      } catch {
        routeError(503, 'hermes_bot_dm_source_lookup_unavailable');
      }
      if (!deck || deck.id !== owner.deckId) routeError(403, 'hermes_bot_dm_source_identity_invalid');
      const sourceCard = deck.nodes.find((card) => card.id === owner.cardId);
      if (!sourceCard) {
        routeError(403, 'hermes_bot_dm_source_identity_invalid');
      }

      let sourceProfile: string;
      try {
        sourceProfile = dependencies.requireAgentTerminalCard(sourceCard, deck);
      } catch {
        routeError(403, 'hermes_bot_dm_source_identity_invalid');
      }
      if (
        sourceState.status !== 'running'
        || sourceState.cardId !== owner.cardId
        || sourceState.profile !== sourceProfile!
        || !sourceState.sessionId
        || !sourceState.storedSessionId
      ) routeError(409, 'hermes_bot_dm_source_runtime_stale');
      try {
        dependencies.agentTerminalManager.verifyConfiguration(
          owner,
          sourceState.sessionId,
          sourceCard,
          deck,
        );
      } catch {
        routeError(409, 'hermes_bot_dm_source_runtime_stale');
      }

      let resolvedCard: ResolvedHermesBotDmCard;
      try {
        resolvedCard = requireResolvedCard(
          await dependencies.requestPythonRailsJson('/domain/hermes-bot-dm/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: owner.projectId,
              deckId: owner.deckId,
              sourceCardId: owner.cardId,
              targetProfile: request.target,
            }),
          }),
          owner,
        );
      } catch (error) {
        if (error instanceof HermesBotDmRouteError) throw error;
        const message = error instanceof Error ? error.message : '';
        if (message === 'python_rails_http_404:hermes_bot_dm_profile_not_found') {
          routeError(404, 'hermes_bot_dm_saved_card_not_found');
        }
        if (message === 'python_rails_http_409:hermes_bot_dm_profile_not_unique') {
          routeError(409, 'hermes_bot_dm_saved_card_profile_not_unique');
        }
        if (message === 'python_rails_http_409:hermes_bot_dm_card_revision_missing') {
          routeError(409, 'hermes_bot_dm_card_runtime_stale');
        }
        if (
          message === 'python_rails_http_404:project_not_found'
          || message === 'python_rails_http_404:deck_not_found'
          || message === 'python_rails_http_404:hermes_bot_dm_source_card_not_found'
        ) routeError(409, 'hermes_bot_dm_source_runtime_stale');
        if (message === 'python_rails_http_400:target_profile_required') {
          routeError(400, 'hermes_bot_dm_profile_required');
        }
        if (
          message.startsWith('python_rails_http_400:')
          || message.startsWith('python_rails_http_404:')
          || message.startsWith('python_rails_http_409:')
        ) {
          routeError(502, 'hermes_bot_dm_authority_response_invalid');
        }
        routeError(503, 'hermes_bot_dm_authority_unavailable');
      }
      const receivingCard = deck.nodes.find((card) => card.id === resolvedCard!.cardId);
      if (
        !receivingCard
        || String(receivingCard._cardRevisionId || '') !== resolvedCard!.cardRevisionId
        || receivingCard.runtime.kind !== 'hermes'
        || normalizedProfile(receivingCard.runtime.profile) !== normalizedProfile(resolvedCard!.profile)
      ) routeError(409, 'hermes_bot_dm_card_runtime_stale');

      let receivingProfile: string;
      try {
        receivingProfile = dependencies.requireAgentTerminalCard(receivingCard, deck);
      } catch {
        routeError(409, 'hermes_bot_dm_card_runtime_stale');
      }
      return res.json({ ok: true, targetProfile: receivingProfile! });
    } catch (error) {
      return sendError(res, error);
    }
  });
  return router;
}

export default createHermesBotDmRouter();
