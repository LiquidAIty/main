import { Router } from 'express';

import { getDeckDocument } from '../decks/store';
import {
  hydrateHermesCardProfile,
  invokeHermesNativeOperation,
  type HermesNativeCardOperation,
} from '../hermes/cardProfileProjection';
import { requestHermesNative } from '../hermes/mainAdapter';
import type { AgentCardInstance, DeckDocument } from '../types';

type Dependencies = {
  getDeck: typeof getDeckDocument;
  requestNative: typeof requestHermesNative;
};

function requiredText(value: unknown, error: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(error);
  return text;
}

function objectValue(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, fields: string[]): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`hermes_native_params_unknown_field:${unknown}`);
}

function stringList(value: unknown, error: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(error);
  return value;
}

function parseProfileConfigure(params: Record<string, unknown>): HermesNativeCardOperation {
  const keys = Object.keys(params);
  const singleString = ['description', 'soul'].find((key) => keys.length === 1 && typeof params[key] === 'string');
  if (singleString) return { method: 'profiles.configure', params };
  if (keys.length === 1 && keys[0] === 'background_review') {
    const backgroundReview = objectValue(
      params.background_review,
      'hermes_native_background_review_must_be_object',
    );
    exactFields(backgroundReview, ['enabled', 'provider', 'model', 'max_input_tokens']);
    if (typeof backgroundReview.enabled !== 'boolean') {
      throw new Error('hermes_native_background_review_enabled_must_be_boolean');
    }
    const provider = requiredText(
      backgroundReview.provider,
      'hermes_native_background_review_provider_required',
    );
    const model = String(backgroundReview.model || '').trim();
    if (provider !== 'auto' && !model) {
      throw new Error('hermes_native_background_review_model_required');
    }
    const maxInputTokens = backgroundReview.max_input_tokens;
    if (
      !Number.isInteger(maxInputTokens)
      || Number(maxInputTokens) < 1
      || Number(maxInputTokens) > 120_000
    ) {
      throw new Error('hermes_native_background_review_max_input_tokens_invalid');
    }
    return {
      method: 'profiles.configure',
      params: {
        background_review: {
          enabled: backgroundReview.enabled,
          provider,
          model,
          max_input_tokens: Number(maxInputTokens),
        },
      },
    };
  }
  if (keys.length === 1 && keys[0] === 'subagent_model') {
    const subagentModel = objectValue(
      params.subagent_model,
      'hermes_native_subagent_model_must_be_object',
    );
    exactFields(subagentModel, ['provider', 'model']);
    return {
      method: 'profiles.configure',
      params: {
        subagent_model: {
          provider: requiredText(
            subagentModel.provider,
            'hermes_native_subagent_model_provider_required',
          ),
          model: requiredText(
            subagentModel.model,
            'hermes_native_subagent_model_model_required',
          ),
        },
      },
    };
  }
  if (keys.length === 1 && keys[0] === 'memory_provider') {
    return {
      method: 'profiles.configure',
      params: {
        memory_provider: requiredText(
          params.memory_provider,
          'hermes_native_memory_provider_required',
        ),
      },
    };
  }
  if (keys.length === 2 && keys.includes('provider') && keys.includes('model')) {
    requiredText(params.provider, 'hermes_native_provider_required');
    requiredText(params.model, 'hermes_native_model_required');
    return { method: 'profiles.configure', params };
  }
  const listKey = ['disabled_skills', 'enabled_toolsets', 'enabled_mcp_servers']
    .find((key) => keys.length === 1 && keys[0] === key);
  if (listKey) {
    stringList(params[listKey], 'hermes_native_values_must_be_string_list');
    return { method: 'profiles.configure', params };
  }
  throw new Error('hermes_native_profile_operation_invalid');
}

function parseNativeOperation(value: unknown): HermesNativeCardOperation {
  const body = objectValue(value, 'hermes_native_request_must_be_object');
  exactFields(body, ['projectId', 'deckId', 'method', 'params']);
  const method = requiredText(body.method, 'hermes_native_method_required');
  const params = objectValue(body.params ?? {}, 'hermes_native_params_must_be_object');
  if (method === 'profiles.configure') return parseProfileConfigure(params);
  if (method === 'learning.detail') {
    exactFields(params, ['id']);
    return { method, params: { id: requiredText(params.id, 'hermes_native_learning_node_required') } };
  }
  if (method === 'learning.edit') {
    exactFields(params, ['id', 'content']);
    if (typeof params.content !== 'string') throw new Error('hermes_native_learning_content_must_be_string');
    return {
      method,
      params: {
        id: requiredText(params.id, 'hermes_native_learning_node_required'),
        content: params.content,
      },
    };
  }
  if (method === 'skills.manage') {
    exactFields(params, ['action', 'query', 'page', 'page_size']);
    const action = requiredText(params.action, 'hermes_native_skills_action_required');
    if (!['list', 'search', 'install', 'browse', 'inspect'].includes(action)) {
      throw new Error('hermes_native_skills_action_unsupported');
    }
    return { method, params };
  }
  if (method === 'tools.configure') {
    exactFields(params, ['action', 'names', 'session_id']);
    const action = requiredText(params.action, 'hermes_native_tools_action_required');
    if (!['enable', 'disable'].includes(action)) throw new Error('hermes_native_tools_action_unsupported');
    stringList(params.names, 'hermes_native_tool_names_must_be_string_list');
    return { method, params };
  }
  if (method === 'toolsets.list' || method === 'mcp.servers.list') {
    exactFields(params, []);
    return { method, params: {} };
  }
  if (method === 'mcp.servers.test') {
    exactFields(params, ['name']);
    return { method, params: { name: requiredText(params.name, 'mcp_server_name_required') } };
  }
  throw new Error('hermes_native_method_unsupported');
}

function assertCardOperationScope(
  card: AgentCardInstance,
  operation: HermesNativeCardOperation,
): void {
  if (operation.method !== 'profiles.configure' || !('memory_provider' in operation.params)) return;
  if (card.runtime.kind !== 'hermes' || card.runtime.mode !== 'main') {
    throw new Error('main_honcho_configuration_required');
  }
  const provider = String(operation.params.memory_provider || '').trim();
  if (!['builtin', 'honcho'].includes(provider)) {
    throw new Error('main_honcho_provider_invalid');
  }
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
    || message.endsWith('_invalid')
    || message.includes('_unknown_field:')
    || message.includes('_must_be_')
    || message === 'card_runtime_not_hermes'
  ) return 400;
  return 502;
}

function safeMcpTestResult(value: unknown): Record<string, unknown> {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const tools = Array.isArray(result.tools) ? result.tools : [];
  const error = String(result.error || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(access_token|refresh_token|client_secret|api_key)=([^&\s]+)/gi, '$1=[REDACTED]')
    .slice(0, 2000);
  return {
    ok: result.ok === true,
    tools: tools.filter((tool) => tool && typeof tool === 'object').map((tool: any) => ({
      name: String(tool.name || ''),
      description: String(tool.description || '').slice(0, 2000),
    })).filter((tool) => tool.name),
    prompts: Number(result.prompts || 0),
    resources: Number(result.resources || 0),
    credentialStatus: result.ok === true || result.oauth_tokens_present === true
      ? 'configured'
      : 'not_configured',
    error: result.ok === true ? null : error || 'native MCP connection failed',
  };
}

export function createHermesProfileRouter(deps: Dependencies = {
  getDeck: getDeckDocument,
  requestNative: requestHermesNative,
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
      const projection = await hydrateHermesCardProfile(card, deck, deps.requestNative);
      return res.json({ ok: true, ...projection });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(errorStatus(error)).json({ ok: false, error: message });
    }
  });

  router.post('/cards/:cardId/native', async (req, res) => {
    try {
      const { deck, card } = await resolveCard(
        deps.getDeck,
        req.body?.projectId,
        req.body?.deckId,
        req.params.cardId,
      );
      const operation = parseNativeOperation(req.body);
      assertCardOperationScope(card, operation);
      const invoked = await invokeHermesNativeOperation(card, deck, operation, deps.requestNative);
      const result = operation.method === 'mcp.servers.test'
        ? safeMcpTestResult(invoked.result)
        : invoked.result;
      return res.json({ ok: true, method: operation.method, result, ...invoked.readback });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(errorStatus(error)).json({ ok: false, error: message });
    }
  });

  return router;
}

export default createHermesProfileRouter();
