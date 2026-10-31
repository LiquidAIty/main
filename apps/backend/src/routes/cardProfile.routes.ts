/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Card Profiles
 * Relationship: Resolves an owner-authorized saved Card, forwards settings through Hermes Desktop's profile APIs, and publishes saved Main or KnowGraph plugin configuration.
 * Entity: Tool Catalog
 * Relationship: Reads and toggles Hermes toolsets separately from application tool grants.
 * Entity: Skills
 * Relationship: Returns the Hermes learning graph unchanged and forwards exact node reads and edits.
 * Entity: KnowGraph
 * Relationship: Publishes the saved KnowGraph prompt, model, selected toolsets and MCP ceiling, verifies prompt readback, and activates its existing graph plugin.
 */
import path from 'node:path';
import { lstat, mkdir, realpath, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import { tsImport } from 'tsx/esm/api';
import { getDeckDocument } from '../decks/deckDomainClient';
import { assertCardProfileOwner } from '../services/projectStore';
import { resolveRepoRoot } from '../services/workingDirectories';
import { requireOwnedProject } from './projectAccess';
import { MODEL_REGISTRY } from '../llm/models.config';

type Json = Record<string, any>;

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

async function activateGraphPlugin(profile: string) {
  const root = path.join(resolveRepoRoot(), 'HermesLatest');
  const { stdout } = await promisify(execFile)(path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    ['-c', 'import json; from hermes_cli.plugins_activation import reload_running_gateway; print(json.dumps(reload_running_gateway()))'],
    { cwd: root, env: { ...process.env, HERMES_HOME: path.join(root, '.hermes/profiles', profile), PYTHONPATH: root },
      windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (!result?.reloaded || !result.activations?.some((entry: Json) => entry.name === 'project-graph')) {
    throw new Error('project_graph_plugin_activation_unavailable');
  }
  return result;
}

export function createCardProfileRouter(connect = profileApi, activate = activateGraphPlugin) {
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
        if (req.body.method === 'profile.publish') {
          if (!['main', 'knowgraph'].includes(profile)) return res.status(403).json({ ok: false, error: 'graph_profile_publication_scope' });
          const options = card.runtimeOptions || {};
          const pluginSource = path.join(resolveRepoRoot(), 'apps/python-models/plugins/project-graph');
          const pluginTarget = path.join(resolveRepoRoot(), 'HermesLatest/.hermes/profiles', profile, 'plugins/project-graph');
          const installed = await lstat(pluginTarget).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null; throw error;
          });
          if (installed) {
            if (await realpath(pluginTarget) !== await realpath(pluginSource)) throw new Error('project_graph_plugin_source_conflict');
          } else {
            await mkdir(path.dirname(pluginTarget), { recursive: true });
            await symlink(pluginSource, pluginTarget, process.platform === 'win32' ? 'junction' : 'dir');
          }
          // The editor's serialized PromptBlocks are already the saved composition.
          // A caller cannot submit replacement prompt/model/grants to this operation.
          if (profile === 'knowgraph') {
            const model = MODEL_REGISTRY[String(options.modelKey || '')];
            if (!model || !String(card.prompt || '').startsWith('# CARD_PROMPT_V1')) throw new Error('saved_profile_configuration_invalid');
            await api(`/api/profiles/${encodeURIComponent(profile)}/soul`, 'PUT', { content: card.prompt });
            await api('/api/model/set', 'POST', { scope: 'main', profile,
              provider: options.accessMode === 'chatgpt-account' ? 'openai-codex' : model.provider,
              model: model.id, confirm_expensive_model: true });
          }
          const currentConfig = await api('/api/config');
          const selectedToolsets = options.toolsets || [];
          await api('/api/config', 'PUT', { profile, config: {
            ...(profile === 'knowgraph' ? {
              tools: { tool_search: { enabled: 'off' } },
              platform_toolsets: { cli: selectedToolsets },
              agent: { disabled_toolsets: [...new Set([
                ...(currentConfig.agent?.disabled_toolsets || []),
                ...(currentConfig.platform_toolsets?.cli || []),
                'project', 'catalog', 'desktop_ui',
              ])].filter(name => !selectedToolsets.includes(name)) },
            } : {}),
            plugins: { enabled: [...new Set([...(currentConfig.plugins?.enabled || []), 'project-graph'])],
              disabled: (currentConfig.plugins?.disabled || []).filter((name: string) => name !== 'project-graph'),
              entries: { 'project-graph': { settings: { recipient: profile }, mcp_allowlist: ['liquidaity'] } } },
            hooks: { output_spill: { max_chars: 65536 } },
            mcp_servers: { liquidaity: { tools: { include: options.tools || [],
              ...(profile === 'knowgraph' ? { resources: false, prompts: false } : {}) },
              ...(profile === 'knowgraph' ? { timeout: 600 } : {}) } },
          } });
          const published = profile === 'knowgraph'
            ? await api(`/api/profiles/${encodeURIComponent(profile)}/soul`) : null;
          if (published && published.content !== card.prompt) throw new Error('saved_prompt_publication_mismatch');
          const activation = await activate(profile);
          result = { published: true, cardId: card.id, profile, pluginActivated: activation.reloaded === true };
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
      const [skills, toolsets, graph] = await Promise.all([
        api('/api/skills'), api('/api/tools/toolsets'), api('/api/learning/graph'),
      ]);
      return res.json({ ok: true, result,
        binding: { profile, mode: card.runtime.mode },
        profile: { name: profile, skills, toolsets, learning: { graph } },
      });
    } catch (error) {
      console.warn('[card-profile]', error instanceof Error ? error.message : 'unknown profile failure');
      return res.status(503).json({ ok: false, error: 'card_profile_unavailable' });
    }
  });
  return router;
}

export default createCardProfileRouter();
