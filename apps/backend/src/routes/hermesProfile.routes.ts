import { Router } from 'express';

import { getDeckDocument } from '../decks/store';
import {
  applyHermesCardProfile,
  filterEffectiveHermesTools,
  HermesNativeProfileDriftError,
  hydrateHermesCardProfile,
} from '../hermes/cardProfileProjection';
import { requestHermesExtension } from '../hermes/mainAdapter';
import type { AgentCardInstance, DeckDocument } from '../types';

type Dependencies = {
  getDeck: typeof getDeckDocument;
  requestExtension: typeof requestHermesExtension;
};

const ALLOWED_DRAFT_FIELDS = new Set(['role', 'prompt', 'runtime', 'runtimeOptions']);
const ALLOWED_RUNTIME_OPTION_FIELDS = new Set([
  'provider',
  'accessMode',
  'modelKey',
  'reasoningEffort',
  'temperature',
  'maxTokens',
  'maxTurns',
  'tools',
  'nativeTools',
  'skills',
  'toolsets',
  'mcpConnectionIds',
]);

function requiredText(value: unknown, error: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(error);
  return text;
}

async function resolveCard(
  getDeck: Dependencies['getDeck'],
  projectIdValue: unknown,
  deckIdValue: unknown,
  cardIdValue: unknown,
): Promise<{ deck: DeckDocument; card: AgentCardInstance }> {
  const projectId = requiredText(projectIdValue, 'project_id_required');
  const deckId = requiredText(deckIdValue, 'deck_id_required');
  const cardId = requiredText(cardIdValue, 'card_id_required');
  const { deck } = await getDeck(projectId, deckId);
  if (!deck) throw new Error('deck_not_found');
  const card = deck.nodes.find((node) => node.id === cardId);
  if (!card) throw new Error('card_not_found');
  if (card.runtime.kind !== 'hermes') throw new Error('card_runtime_not_hermes');
  return { deck, card };
}

function mergeCardDraft(card: AgentCardInstance, value: unknown): AgentCardInstance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hermes_card_draft_required');
  }
  const draft = value as Record<string, unknown>;
  const unknown = Object.keys(draft).filter((key) => !ALLOWED_DRAFT_FIELDS.has(key));
  if (unknown.length) throw new Error(`hermes_card_draft_unknown_field:${unknown[0]}`);
  const runtime = draft.runtime && typeof draft.runtime === 'object'
    ? draft.runtime as Record<string, unknown>
    : card.runtime;
  if (
    runtime.kind !== 'hermes'
    || !['main', 'delegate', 'kanban'].includes(String(runtime.mode || ''))
    || !String(runtime.profile || '').trim()
  ) throw new Error('card_runtime_invalid');
  const options = draft.runtimeOptions && typeof draft.runtimeOptions === 'object'
    ? draft.runtimeOptions as Record<string, unknown>
    : card.runtimeOptions || {};
  const unknownOptions = Object.keys(options).filter((key) => !ALLOWED_RUNTIME_OPTION_FIELDS.has(key));
  if (unknownOptions.length) {
    throw new Error(`hermes_card_runtime_option_unknown_field:${unknownOptions[0]}`);
  }
  return {
    ...card,
    role: draft.role == null ? card.role : String(draft.role),
    prompt: draft.prompt == null ? card.prompt : String(draft.prompt),
    runtime: {
      kind: 'hermes',
      mode: runtime.mode as 'main' | 'delegate' | 'kanban',
      profile: String(runtime.profile).trim(),
    },
    runtimeOptions: options,
  };
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HermesNativeProfileDriftError) return 409;
  if (message === 'deck_not_found' || message === 'card_not_found') return 404;
  if (message.includes("profile '") && message.includes('not found')) return 404;
  if (
    message.endsWith('_required')
    || message === 'card_runtime_invalid'
    || message === 'card_runtime_not_hermes'
    || message.startsWith('hermes_card_draft_')
    || message.startsWith('hermes_card_runtime_option_')
    || message.startsWith('hermes_native_selection_unsupported')
  ) return 400;
  return 502;
}

export function createHermesProfileRouter(deps: Dependencies = {
  getDeck: getDeckDocument,
  requestExtension: requestHermesExtension,
}) {
  const router = Router();

  router.get('/cards/:cardId', async (req, res) => {
    try {
      const { deck, card } = await resolveCard(
        deps.getDeck,
        req.query.projectId,
        req.query.deckId,
        req.params.cardId,
      );
      const projection = await hydrateHermesCardProfile(card, deck, deps.requestExtension);
      return res.json({ ok: true, ...projection });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(errorStatus(error)).json({ ok: false, error: message });
    }
  });

  router.post('/cards/:cardId/apply', async (req, res) => {
    try {
      const { deck, card } = await resolveCard(
        deps.getDeck,
        req.body?.projectId,
        req.body?.deckId,
        req.params.cardId,
      );
      const draft = mergeCardDraft(card, req.body?.draft);
      const result = await applyHermesCardProfile(
        draft,
        deck,
        String(req.body?.expectedFingerprint || ''),
        deps.requestExtension,
      );
      return res.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(errorStatus(error)).json({ ok: false, error: message });
    }
  });

  router.post('/cards/:cardId/preview', async (req, res) => {
    try {
      const { deck, card } = await resolveCard(
        deps.getDeck,
        req.body?.projectId,
        req.body?.deckId,
        req.params.cardId,
      );
      const draft = mergeCardDraft(card, req.body?.draft);
      const projection = await hydrateHermesCardProfile(draft, deck, deps.requestExtension);
      return res.json({ ok: true, ...projection });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(errorStatus(error)).json({ ok: false, error: message });
    }
  });

  router.post('/cards/:cardId/mcp/:serverName/test', async (req, res) => {
    try {
      const { deck, card } = await resolveCard(
        deps.getDeck,
        req.body?.projectId,
        req.body?.deckId,
        req.params.cardId,
      );
      const projection = await hydrateHermesCardProfile(card, deck, deps.requestExtension);
      const serverName = requiredText(req.params.serverName, 'mcp_server_name_required');
      if (!projection.native.mcpServers.some((server) => server.name === serverName)) {
        throw new Error('hermes_mcp_server_not_bound');
      }
      const tested = await deps.requestExtension('_mcp/test', {
        profile: projection.intent.profile,
        name: serverName,
      }) as Record<string, unknown>;
      const discovered = Array.isArray(tested.tools)
        ? tested.tools.map((tool: any) => String(tool?.name || '')).filter(Boolean)
        : [];
      return res.json({
        ok: tested.ok === true,
        server: serverName,
        tools: tested.tools || [],
        prompts: tested.prompts || 0,
        resources: tested.resources || 0,
        credentialStatus: tested.credentialStatus || 'not_configured',
        effectiveTools: filterEffectiveHermesTools(discovered, projection.intent.cardGrants),
        error: tested.error || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(errorStatus(error)).json({ ok: false, error: message });
    }
  });

  return router;
}

export default createHermesProfileRouter();
