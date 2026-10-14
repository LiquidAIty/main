import { Router, type Request, type Response } from 'express';

import {
  ensureSavedCardProfile,
  materializeSavedCardProfile,
  type HermesProfileState,
} from '../hermes/profileMaterialization';
import { hermesGateway, type HermesGatewayClient } from '../services/hermesGateway';
import { readToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import { getOwnedProjectByReference } from '../services/projectStore';
import {
  objectRecord,
  projectCardAuthority,
  type ProjectCardAuthority,
  type ProjectCardBinding,
} from '../services/projectCardAuthority';

const router = Router();

type AuthorizedCard = {
  authority: ProjectCardAuthority;
  card: ProjectCardBinding;
  client: HermesGatewayClient;
  profile: HermesProfileState;
};

function requiredText(value: unknown, error: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(error);
  return text;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'deck_not_found' || message === 'card_not_found') return 404;
  if (message.endsWith('_required') || message.endsWith('_unsupported')) return 400;
  if (message.endsWith('_access_denied')) return 403;
  return 503;
}

async function resolveAuthorizedCard(
  req: Request,
  res: Response,
  projectIdValue: unknown,
  deckIdValue: unknown,
  cardIdValue: unknown,
): Promise<AuthorizedCard | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'hermes_profile_authentication_required' });
    return null;
  }
  const projectId = requiredText(projectIdValue, 'project_id_required');
  const deckId = requiredText(deckIdValue, 'deck_id_required');
  const cardId = requiredText(cardIdValue, 'card_id_required');
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'hermes_profile_access_denied' });
    return null;
  }
  const authority = await projectCardAuthority(projectId, deckId);
  const matches = authority.cards.filter((candidate) => candidate.card.id === cardId);
  if (matches.length !== 1 || matches[0].card.runtime.kind !== 'hermes') {
    throw new Error('card_not_found');
  }
  const card = matches[0];
  const client = await hermesGateway();
  const request = <T>(method: string, params: Record<string, unknown> = {}) => (
    client.request<T>(method, params)
  );
  const existing = await ensureSavedCardProfile(
    request,
    card.card,
  );
  const toolCatalog = await readToolCatalog();
  const profile = await materializeSavedCardProfile(
    request,
    card.card,
    projectId,
    existing,
    toolCatalog.tools,
  );
  return { authority, card, client, profile };
}

function mcpServerView(value: unknown, profile: HermesProfileState) {
  const server = objectRecord(value);
  const name = String(server.name || '').trim();
  if (!name) return null;
  const selected = (profile.mcp_servers || []).find((item) => (
    String(item.name || '').toLowerCase() === name.toLowerCase()
  ));
  const auth = String(server.auth || '').trim() || null;
  const tools = objectRecord(server.tools);
  return {
    name,
    transport: String(server.transport || 'unknown'),
    enabled: selected?.enabled ?? server.enabled !== false,
    auth,
    credentialStatus: auth === 'oauth'
      ? server.oauth_tokens_present === true ? 'configured' : 'not_configured'
      : auth ? 'configured' : 'not_required',
    toolFilter: stringList(tools.include),
  };
}

async function readCardProfile(input: AuthorizedCard) {
  const mcp = objectRecord(await input.client.request('mcp.servers.list', {
    profile: input.card.profile,
  }));
  const learning = objectRecord(await input.client.request('learning.frames', {
    profile: input.card.profile,
    cols: 60,
    rows: 18,
    frames: 2,
  }));
  const model = objectRecord(input.profile.model);
  return {
    binding: {
      profile: input.card.profile,
      mode: input.card.card.runtime.mode,
    },
    profile: {
      name: String(input.profile.name || input.card.profile),
      description: String(input.profile.description || ''),
      soul: String(input.profile.soul || ''),
      model: {
        provider: String(model.provider || ''),
        default: String(model.default || ''),
      },
      skills: (input.profile.skills || []).map((skill) => ({
        name: String(skill.name || ''),
        enabled: skill.enabled === true,
      })).filter((skill) => skill.name),
      toolsets: (input.profile.toolsets || []).map((toolset) => ({
        name: String(toolset.name || ''),
        enabled: toolset.enabled === true,
      })).filter((toolset) => toolset.name),
      toolsetsPinned: objectRecord(input.profile).toolsets_pinned === true,
      mcpServers: (Array.isArray(mcp.servers) ? mcp.servers : [])
        .map((server) => mcpServerView(server, input.profile))
        .filter((server): server is NonNullable<ReturnType<typeof mcpServerView>> => server !== null),
      learning: {
        count: Number.isFinite(learning.count) ? Number(learning.count) : 0,
        summary: stringList(learning.summary),
        buckets: (Array.isArray(learning.buckets) ? learning.buckets : []).map((value) => {
          const bucket = objectRecord(value);
          return {
            index: Number.isFinite(bucket.index) ? Number(bucket.index) : 0,
            label: String(bucket.label || ''),
            date: String(bucket.date || ''),
            skills: Number.isFinite(bucket.skills) ? Number(bucket.skills) : 0,
            memories: Number.isFinite(bucket.memories) ? Number(bucket.memories) : 0,
            total: Number.isFinite(bucket.total) ? Number(bucket.total) : 0,
            category: bucket.category == null ? null : String(bucket.category),
            color: bucket.color == null ? null : String(bucket.color),
            nodes: (Array.isArray(bucket.nodes) ? bucket.nodes : []).map((value) => {
              const node = objectRecord(value);
              return {
                id: String(node.id || ''),
                glyph: String(node.glyph || ''),
                label: String(node.label || ''),
                fullLabel: String(node.fullLabel || ''),
                meta: String(node.meta || ''),
                body: String(node.body || ''),
                style: String(node.style || ''),
              };
            }).filter((node) => node.id),
          };
        }),
      },
    },
  };
}

function safeMcpTestResult(value: unknown) {
  const result = objectRecord(value);
  const error = String(result.error || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(access_token|refresh_token|client_secret|api_key)=([^&\s]+)/gi, '$1=[REDACTED]')
    .slice(0, 2_000);
  return {
    ok: result.ok === true,
    tools: (Array.isArray(result.tools) ? result.tools : []).map((value) => {
      const tool = objectRecord(value);
      return {
        name: String(tool.name || ''),
        description: String(tool.description || '').slice(0, 2_000),
      };
    }).filter((tool) => tool.name),
    prompts: Number(result.prompts || 0),
    resources: Number(result.resources || 0),
    credentialStatus: result.ok === true || result.oauth_tokens_present === true
      ? 'configured'
      : 'not_configured',
    error: result.ok === true ? null : error || 'Hermes MCP connection failed',
  };
}

router.get('/cards/:cardId', async (req, res) => {
  try {
    const resolved = await resolveAuthorizedCard(
      req,
      res,
      req.query.projectId,
      req.query.deckId,
      req.params.cardId,
    );
    if (!resolved) return undefined;
    return res.json({ ok: true, ...(await readCardProfile(resolved)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(errorStatus(error)).json({ ok: false, error: message });
  }
});

router.post('/cards/:cardId/operations', async (req, res) => {
  try {
    const resolved = await resolveAuthorizedCard(
      req,
      res,
      req.body?.projectId,
      req.body?.deckId,
      req.params.cardId,
    );
    if (!resolved) return undefined;
    const method = requiredText(req.body?.method, 'hermes_profile_method_required');
    const params = objectRecord(req.body?.params);
    let result: unknown;
    if (method === 'learning.detail') {
      result = await resolved.client.request(method, {
        profile: resolved.card.profile,
        id: requiredText(params.id, 'hermes_learning_node_required'),
      });
      if (objectRecord(result).ok !== true) throw new Error('hermes_learning_detail_failed');
    } else if (method === 'learning.edit') {
      if (typeof params.content !== 'string') throw new Error('hermes_learning_content_required');
      result = await resolved.client.request(method, {
        profile: resolved.card.profile,
        id: requiredText(params.id, 'hermes_learning_node_required'),
        content: params.content,
      });
      if (objectRecord(result).ok !== true) throw new Error('hermes_learning_edit_failed');
    } else if (method === 'mcp.servers.test') {
      result = safeMcpTestResult(await resolved.client.request(method, {
        profile: resolved.card.profile,
        name: requiredText(params.name, 'mcp_server_name_required'),
      }));
    } else if (method === 'mcp.servers.oauth.start') {
      result = objectRecord(await resolved.client.request(method, {
        profile: resolved.card.profile,
        name: requiredText(params.name, 'mcp_server_name_required'),
      }));
      if (
        objectRecord(result).ok !== true
        || !String(objectRecord(result).session_id || '').trim()
        || !String(objectRecord(result).auth_url || '').trim()
      ) throw new Error('hermes_mcp_oauth_start_failed');
    } else if (method === 'mcp.servers.oauth.poll') {
      result = objectRecord(await resolved.client.request(method, {
        profile: resolved.card.profile,
        name: requiredText(params.name, 'mcp_server_name_required'),
        session_id: requiredText(params.session_id, 'mcp_oauth_session_required'),
      }));
      if (objectRecord(result).ok !== true) throw new Error('hermes_mcp_oauth_poll_failed');
    } else if (method === 'mcp.servers.oauth.cancel') {
      result = objectRecord(await resolved.client.request(method, {
        profile: resolved.card.profile,
        name: requiredText(params.name, 'mcp_server_name_required'),
        session_id: requiredText(params.session_id, 'mcp_oauth_session_required'),
      }));
      if (objectRecord(result).ok !== true) throw new Error('hermes_mcp_oauth_cancel_failed');
    } else {
      throw new Error('hermes_profile_method_unsupported');
    }
    const readback = method === 'mcp.servers.test'
      ? null
      : await readCardProfile(resolved);
    return res.json({
      ok: true,
      method,
      result,
      ...(readback || {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(errorStatus(error)).json({ ok: false, error: message });
  }
});

export default router;
