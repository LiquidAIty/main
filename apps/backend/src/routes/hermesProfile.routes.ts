import { Router } from 'express';

import { getDeckDocument } from '../decks/store';
import {
  filterEffectiveHermesTools,
  hydrateHermesCardProfile,
} from '../hermes/cardProfileProjection';
import { requestHermesExtension } from '../hermes/mainAdapter';
import type { AgentCardInstance, DeckDocument } from '../types';

type Dependencies = {
  getDeck: typeof getDeckDocument;
  requestExtension: typeof requestHermesExtension;
};

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

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'deck_not_found' || message === 'card_not_found') return 404;
  if (message.includes("profile '") && message.includes('not found')) return 404;
  if (message.endsWith('_required') || message === 'card_runtime_not_hermes') return 400;
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
        profile: projection.binding.profile,
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
        effectiveTools: filterEffectiveHermesTools(discovered, projection.binding.cardGrants),
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
