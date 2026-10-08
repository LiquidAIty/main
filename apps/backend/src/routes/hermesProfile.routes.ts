import { Router, type Request } from 'express';

import { getDeckDocument } from '../decks/store';
import { materializeSavedCardProfile } from '../hermes/profileMaterialization';
import { getProject } from '../services/projectStore';
import { hermesGateway } from '../services/hermesGateway';
import type { AgentCardInstance } from '../types';

type RequestHermes = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

type Dependencies = {
  getDeck: typeof getDeckDocument;
  requestHermes: RequestHermes;
  authorizeProject(req: Request, projectId: string): Promise<boolean>;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function requiredText(value: unknown, error: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(error);
  return text;
}

function exactFields(value: Record<string, unknown>, fields: string[]): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`hermes_profile_params_unknown_field:${unknown}`);
}

async function resolveCard(
  getDeck: Dependencies['getDeck'],
  projectIdValue: unknown,
  deckIdValue: unknown,
  cardIdValue: unknown,
): Promise<{ projectId: string; card: AgentCardInstance }> {
  const projectId = requiredText(projectIdValue, 'project_id_required');
  const deckId = requiredText(deckIdValue, 'deck_id_required');
  const cardId = requiredText(cardIdValue, 'card_id_required');
  const { deck } = await getDeck(projectId, deckId);
  if (!deck) throw new Error('deck_not_found');
  const card = deck.nodes.find((node) => node.id === cardId);
  if (!card) throw new Error('card_not_found');
  if (card.runtime.kind !== 'hermes') throw new Error('card_runtime_not_hermes');
  return { projectId, card };
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'deck_not_found' || message === 'card_not_found') return 404;
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

function operation(value: unknown): { method: string; params: Record<string, unknown> } {
  const body = record(value);
  exactFields(body, ['projectId', 'deckId', 'method', 'params']);
  const method = requiredText(body.method, 'hermes_method_required');
  const params = record(body.params);
  if (method === 'learning.detail') {
    exactFields(params, ['id']);
    return { method, params: { id: requiredText(params.id, 'hermes_learning_node_required') } };
  }
  if (method === 'learning.edit') {
    exactFields(params, ['id', 'content']);
    if (typeof params.content !== 'string') throw new Error('hermes_learning_content_must_be_string');
    return {
      method,
      params: { id: requiredText(params.id, 'hermes_learning_node_required'), content: params.content },
    };
  }
  if (method === 'skills.manage') {
    exactFields(params, ['action', 'query', 'page', 'page_size']);
    if (!['list', 'search', 'install', 'browse', 'inspect'].includes(String(params.action || ''))) {
      throw new Error('hermes_skills_action_unsupported');
    }
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
  throw new Error('hermes_method_unsupported');
}

function safeMcpTestResult(value: unknown): Record<string, unknown> {
  const result = record(value);
  const error = String(result.error || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(access_token|refresh_token|client_secret|api_key)=([^&\s]+)/gi, '$1=[REDACTED]')
    .slice(0, 2_000);
  return {
    ok: result.ok === true,
    tools: (Array.isArray(result.tools) ? result.tools : []).map(record).map((tool) => ({
      name: String(tool.name || ''),
      description: String(tool.description || '').slice(0, 2_000),
    })).filter((tool) => tool.name),
    prompts: Number(result.prompts || 0),
    resources: Number(result.resources || 0),
    credentialStatus: result.ok === true || result.oauth_tokens_present === true
      ? 'configured'
      : 'not_configured',
    error: result.ok === true ? null : error || 'Hermes MCP connection failed',
  };
}

async function readProfile(
  requestHermes: RequestHermes,
  card: AgentCardInstance,
) {
  const request = <T>(method: string, params: Record<string, unknown> = {}) => (
    requestHermes(method, params) as Promise<T>
  );
  const profile = record(await materializeSavedCardProfile(request, card));
  const learning = record(await request('learning.frames', {
    profile: card.runtime.profile,
    cols: 80,
    rows: 24,
    frames: 48,
  }));
  const mcp = record(await request('mcp.servers.list', { profile: card.runtime.profile }));
  const serverDetails = new Map((Array.isArray(mcp.servers) ? mcp.servers : [])
    .map(record).map((server) => [String(server.name || ''), server]));
  return {
    profileApply: 'run_start',
    cardSaveMutatesProfile: false,
    binding: { profile: card.runtime.profile, mode: card.runtime.mode },
    profile: {
      name: String(profile.name || ''),
      description: String(profile.description || ''),
      soul: String(profile.soul || ''),
      model: record(profile.model),
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      toolsets: Array.isArray(profile.toolsets) ? profile.toolsets : [],
      toolsetsPinned: profile.toolsets_pinned === true,
      mcpServers: (Array.isArray(profile.mcp_servers) ? profile.mcp_servers : []).map(record)
        .map((server) => {
          const detail = record(serverDetails.get(String(server.name || '')));
          return {
            name: String(server.name || ''),
            transport: String(detail.transport || server.transport || 'stdio'),
            enabled: server.enabled === true,
            auth: typeof detail.auth === 'string' ? detail.auth : null,
            credentialStatus: detail.oauth_tokens_present === true
              ? 'configured'
              : detail.auth ? 'not_configured' : 'not_required',
            toolFilter: Array.isArray(detail.tools) ? detail.tools.map(String) : [],
          };
        }).filter((server) => server.name),
      learning: {
        count: Number(learning.count || 0),
        summary: Array.isArray(learning.summary) ? learning.summary.map(String) : [],
        buckets: Array.isArray(learning.buckets) ? learning.buckets : [],
      },
    },
  };
}

const defaultDependencies: Dependencies = {
  getDeck: getDeckDocument,
  requestHermes: async (method, params = {}) => {
    const client = await hermesGateway();
    return client.request(method, params);
  },
  authorizeProject: async (req, projectId) => {
    const userId = String((req as Request & { userId?: string }).userId || '').trim();
    if (!userId) return false;
    const project = await getProject(projectId, userId);
    return Boolean(project && project.ownerUserId === userId);
  },
};

export function createHermesProfileRouter(deps: Dependencies = defaultDependencies) {
  const router = Router();

  router.get('/cards/:cardId', async (req, res) => {
    try {
      const resolved = await resolveCard(
        deps.getDeck, req.query.projectId, req.query.deckId, req.params.cardId,
      );
      if (!(await deps.authorizeProject(req, resolved.projectId))) {
        return res.status(403).json({ ok: false, error: 'hermes_profile_project_access_denied' });
      }
      return res.json({ ok: true, ...await readProfile(deps.requestHermes, resolved.card) });
    } catch (error) {
      return res.status(errorStatus(error)).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/cards/:cardId/operations', async (req, res) => {
    try {
      const resolved = await resolveCard(
        deps.getDeck, req.body?.projectId, req.body?.deckId, req.params.cardId,
      );
      if (!(await deps.authorizeProject(req, resolved.projectId))) {
        return res.status(403).json({ ok: false, error: 'hermes_profile_project_access_denied' });
      }
      const selected = operation(req.body);
      const result = await deps.requestHermes(
        selected.method,
        { ...selected.params, profile: resolved.card.runtime.profile },
      );
      return res.json({
        ok: true,
        method: selected.method,
        result: selected.method === 'mcp.servers.test' ? safeMcpTestResult(result) : result,
        ...await readProfile(deps.requestHermes, resolved.card),
      });
    } catch (error) {
      return res.status(errorStatus(error)).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

export default createHermesProfileRouter();
