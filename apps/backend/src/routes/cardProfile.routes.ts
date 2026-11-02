/**
 * Graph + less = more: change the smallest existing path; never duplicate its authority.
 * Entity: Card Profiles
 * Relationship: Resolves an owner-authorized saved Card, publishes its prompt and application-tool selection, and forwards settings to the same profile-scoped HTTP APIs used by Hermes Desktop.
 * Entity: Tool Catalog
 * Relationship: Reads and toggles Hermes toolsets separately from application tool grants.
 * Entity: Skills
 * Relationship: Returns the Hermes learning graph unchanged and forwards exact node reads and edits.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import { tsImport } from 'tsx/esm/api';
import { getDeckDocument } from '../decks/deckDomainClient';
import { assertCardProfileOwner } from '../services/projectStore';
import { resolveRepoRoot } from '../services/workingDirectories';
import { requireOwnedProject } from './projectAccess';

type Json = Record<string, any>;
type ProfileRequest = (pathname: string, method?: string, body?: Json) => Promise<any>;

const APPLICATION_MCP_SERVER = 'liquidaity';
const VISIBLE_PUBLICATION_ERRORS = new Set([
  'card_application_mcp_ambiguous',
  'card_application_mcp_missing',
  'card_application_mcp_not_configurable',
  'card_application_tools_readback_mismatch',
  'card_profile_soul_readback_mismatch',
]);

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))];
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function savedApplicationTools(card: Json): string[] {
  const options = card.runtimeOptions && typeof card.runtimeOptions === 'object'
    ? card.runtimeOptions as Json
    : {};
  return stringList(options.tools);
}

async function readProfileState(api: ProfileRequest, card: Json, profile: string) {
  const [skills, toolsets, graph, soul, mcp] = await Promise.all([
    api('/api/skills'),
    api('/api/tools/toolsets'),
    api('/api/learning/graph'),
    api(`/api/profiles/${encodeURIComponent(profile)}/soul`),
    api('/api/mcp/servers'),
  ]);
  const selectedTools = savedApplicationTools(card);
  const servers = Array.isArray(mcp?.servers) ? mcp.servers : [];
  const applicationServers = servers.filter((server: Json) => server?.name === APPLICATION_MCP_SERVER);
  if (applicationServers.length > 1) throw new Error('card_application_mcp_ambiguous');
  const applicationServer = applicationServers[0] as Json | undefined;
  const include = stringList(applicationServer?.tools?.include);
  const soulContent = typeof soul?.content === 'string' ? soul.content : '';
  const savedPrompt = String(card.prompt || '');
  return {
    binding: { profile, mode: card.runtime.mode },
    profile: {
      name: profile,
      soul: {
        content: soulContent,
        exists: soul?.exists === true,
        matchesSavedPrompt: soul?.exists === true && soulContent === savedPrompt,
      },
      skills,
      toolsets,
      applicationTools: {
        server: APPLICATION_MCP_SERVER,
        configured: Boolean(applicationServer),
        enabled: applicationServer?.enabled === true,
        selected: selectedTools,
        include,
        matchesSavedSelection: selectedTools.length === 0
          ? !applicationServer || sameStrings(include, selectedTools)
          : applicationServer?.enabled === true && sameStrings(include, selectedTools),
      },
      learning: { graph },
    },
  };
}

async function publishSavedCardConfiguration(api: ProfileRequest, card: Json, profile: string) {
  const savedPrompt = String(card.prompt || '');
  await api(`/api/profiles/${encodeURIComponent(profile)}/soul`, 'PUT', { content: savedPrompt });
  const soul = await api(`/api/profiles/${encodeURIComponent(profile)}/soul`);
  if (soul?.exists !== true || soul.content !== savedPrompt) {
    throw new Error('card_profile_soul_readback_mismatch');
  }

  const selectedTools = savedApplicationTools(card);
  const listed = await api('/api/mcp/servers');
  const servers = Array.isArray(listed?.servers) ? listed.servers : [];
  const applicationServers = servers.filter((server: Json) => server?.name === APPLICATION_MCP_SERVER);
  if (applicationServers.length > 1) throw new Error('card_application_mcp_ambiguous');
  if (!applicationServers.length) {
    if (selectedTools.length) throw new Error('card_application_mcp_missing');
    return;
  }
  if (applicationServers[0]?.source !== 'config') {
    throw new Error('card_application_mcp_not_configurable');
  }
  await api('/api/config', 'PUT', {
    config: {
      mcp_servers: {
        [APPLICATION_MCP_SERVER]: {
          ...(selectedTools.length ? { enabled: true } : {}),
          tools: { include: selectedTools },
        },
      },
    },
  });
  const readback = await api('/api/mcp/servers');
  const readbackServers = Array.isArray(readback?.servers) ? readback.servers : [];
  const applicationReadback = readbackServers.filter(
    (server: Json) => server?.name === APPLICATION_MCP_SERVER,
  );
  const include = stringList(applicationReadback[0]?.tools?.include);
  if (
    applicationReadback.length !== 1
    || !sameStrings(include, selectedTools)
    || (selectedTools.length > 0 && applicationReadback[0]?.enabled !== true)
  ) {
    throw new Error('card_application_tools_readback_mismatch');
  }
}

// Settings transport only: discover the running provider; never ensure/start it,
// open a chat, attach a model, or borrow Main's Bot Mode connection.
async function profileApi(profile: string) {
  const root = path.join(resolveRepoRoot(), 'HermesLatest');
  const home = path.join(root, '.hermes');
  const load = (file: string) => tsImport(pathToFileURL(path.join(root, file)).href, pathToFileURL(__filename).href);
  const [local, tickets] = await Promise.all([
    load('apps/desktop/electron/local-gateway.ts'),
    load('apps/desktop/electron/local-gateway-python.ts'),
  ]);
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const discovery = 'import os,json; from dataclasses import asdict; from hermes_cli.gateway_runtime import discover_gateway_endpoint; print(json.dumps(asdict(discover_gateway_endpoint(os.environ["HERMES_HOME"])),default=list))';
  const descriptor = await local.ensureLocalGateway(() => local.runGatewayEnsure({
    command: python, args: ['-c', discovery], shell: false, env: { PYTHONPATH: root },
  }, root, home, process.env, { timeoutMs: 15000, label: 'Card settings endpoint discovery' }));
  const ticket = tickets.createGatewayTicketResolver(
    async () => ({ command: python, args: [], kind: 'python', shell: false, env: { PYTHONPATH: root } }), () => root,
  );
  return async (pathname: string, method = 'GET', body?: Json): Promise<any> => {
    const url = new URL(pathname, descriptor.baseUrl);
    url.searchParams.set('profile', profile);
    const endpoint = await local.routedTicketEndpoint(descriptor.gatewayEndpoint, url.toString(), home, method);
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', 'X-Hermes-Gateway-Ticket': await ticket(endpoint, 'native-http') },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || result?.ok === false) throw new Error(`card_profile_provider_failed:${response.status}`);
    return result;
  };
}

export function createCardProfileRouter(connect = profileApi) {
  const router = Router();
  router.all('/cards/:cardId/:operation?', async (req, res) => {
    try {
      const input = req.method === 'GET' ? req.query : req.body;
      const access = await requireOwnedProject(req, res, String(input?.projectId || ''));
      if (!access) return;
      const { deck } = await getDeckDocument(access.projectId, String(input?.deckId || ''));
      const card = deck?.nodes.find(item => item.id === req.params.cardId);
      if (!card || card.runtime.kind !== 'hermes' || !card.runtime.profile) return res.status(404).json({ ok: false, error: 'card_not_found' });
      const profile = card.runtime.profile;
      await assertCardProfileOwner(profile, access.ownerUserId);
      const api = await connect(profile);
      let result: unknown;
      if (req.method === 'POST' && req.params.operation === 'operations') {
        const params = req.body.params || {};
        if (req.body.method === 'configuration.publish') {
          await publishSavedCardConfiguration(api, card, profile);
          result = { published: true };
        } else if (req.body.method === 'toolset.toggle' || req.body.method === 'skill.toggle') {
          if (typeof params.name !== 'string' || !params.name.trim() || typeof params.enabled !== 'boolean') {
            return res.status(400).json({ ok: false, error: 'card_profile_toggle_invalid' });
          }
          result = req.body.method === 'toolset.toggle'
            ? await api(`/api/tools/toolsets/${encodeURIComponent(params.name)}`, 'PUT', { enabled: params.enabled })
            : await api('/api/skills/toggle', 'PUT', { name: params.name, enabled: params.enabled });
        } else if (req.body.method === 'learning.detail' || req.body.method === 'learning.edit') {
          if (typeof params.id !== 'string' || !params.id.trim()) return res.status(400).json({ ok: false, error: 'card_learning_node_required' });
          if (req.body.method === 'learning.detail') {
            result = { ...await api(`/api/learning/node?id=${encodeURIComponent(params.id)}`), id: params.id };
            return res.json({ ok: true, result });
          }
          if (typeof params.content !== 'string') return res.status(400).json({ ok: false, error: 'card_learning_content_required' });
          result = await api('/api/learning/node', 'PUT', { id: params.id, content: params.content });
        } else return res.status(400).json({ ok: false, error: 'card_profile_method_unsupported' });
      } else if (req.method !== 'GET' || req.params.operation) {
        return res.status(405).json({ ok: false, error: 'card_profile_method_unsupported' });
      }
      return res.json({ ok: true, result, ...await readProfileState(api, card, profile) });
    } catch (error) {
      const code = error instanceof Error && VISIBLE_PUBLICATION_ERRORS.has(error.message)
        ? error.message
        : 'card_profile_unavailable';
      return res.status(503).json({ ok: false, error: code });
    }
  });
  return router;
}

export default createCardProfileRouter();
