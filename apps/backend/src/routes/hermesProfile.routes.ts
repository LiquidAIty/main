import { Router } from 'express';

import { getDeckDocument } from '../decks/store';
import {
  applyHermesNativeOperation,
  filterEffectiveHermesTools,
  hydrateHermesCardProfile,
  type HermesNativeApplyOperation,
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

function exactBodyFields(body: Record<string, unknown>, fields: string[]): void {
  const allowed = new Set(['projectId', 'deckId', 'operation', ...fields]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`hermes_native_apply_unknown_field:${unknown}`);
}

function stringValue(value: unknown, error: string): string {
  if (typeof value !== 'string') throw new Error(error);
  return value;
}

function stringValues(value: unknown, error: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(error);
  }
  return value;
}

function parseNativeOperation(value: unknown): HermesNativeApplyOperation {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const operation = requiredText(body.operation, 'hermes_native_operation_required');
  if (operation === 'profile.description.set' || operation === 'profile.soul.set') {
    exactBodyFields(body, ['value']);
    return { operation, value: stringValue(body.value, 'hermes_native_value_must_be_string') };
  }
  if (operation === 'profile.model.set') {
    exactBodyFields(body, ['provider', 'model']);
    return {
      operation,
      provider: requiredText(body.provider, 'hermes_native_provider_required'),
      model: requiredText(body.model, 'hermes_native_model_required'),
    };
  }
  if (
    operation === 'skills.disabled.replace'
    || operation === 'toolsets.enabled.replace'
    || operation === 'mcp.enabled.replace'
  ) {
    exactBodyFields(body, ['values']);
    return { operation, values: stringValues(body.values, 'hermes_native_values_must_be_string_list') };
  }
  if (operation === 'learning.edit') {
    exactBodyFields(body, ['nodeId', 'content']);
    return {
      operation,
      nodeId: requiredText(body.nodeId, 'hermes_native_learning_node_required'),
      content: stringValue(body.content, 'hermes_native_learning_content_must_be_string'),
    };
  }
  throw new Error('hermes_native_operation_unsupported');
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
  if (
    message.endsWith('_required')
    || message.endsWith('_unsupported')
    || message.includes('_unknown_field:')
    || message.includes('_must_be_')
    || message === 'card_runtime_not_hermes'
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

  router.post('/cards/:cardId/native/apply', async (req, res) => {
    try {
      const { deck, card } = await resolveCard(
        deps.getDeck,
        req.body?.projectId,
        req.body?.deckId,
        req.params.cardId,
      );
      const operation = parseNativeOperation(req.body);
      const projection = await applyHermesNativeOperation(
        card,
        deck,
        operation,
        deps.requestExtension,
      );
      return res.json({ ok: true, applied: operation.operation, ...projection });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(errorStatus(error)).json({ ok: false, error: message });
    }
  });

  router.get('/cards/:cardId/learning/detail', async (req, res) => {
    try {
      const { deck, card } = await resolveCard(
        deps.getDeck,
        req.query.projectId,
        req.query.deckId,
        req.params.cardId,
      );
      const projection = await hydrateHermesCardProfile(card, deck, deps.requestExtension);
      const nodeId = requiredText(req.query.nodeId, 'hermes_native_learning_node_required');
      const detail = await deps.requestExtension('_learning/detail', {
        profile: projection.binding.profile,
        nodeId,
      });
      return res.json({ ok: true, detail });
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
