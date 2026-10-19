/**
 * Entity: Hermes Profiles
 * Relationship: This file verifies reusable profiles retain the exact saved Card configuration and remove persisted Project context from the profile-owned MCP connection.
 * Entity: Saved Cards
 * Relationship: This file verifies profile materialization follows the saved Card revision and refuses a tool not authorized for that Card's profile.
 * Entity: Tool Catalog
 * Relationship: This file verifies only catalog-published, grant-eligible tools enter a saved profile's MCP filter.
 * Entity: MCP Host
 * Relationship: This file verifies the profile-owned LiquidAIty connection is rewritten without a persisted Project header and retains only the stable profile header.
 * Entity: Authentication
 * Relationship: This file verifies one hashed owner claims the profile and a different owner is rejected before any MCP or profile mutation.
 * Entity: Credentials
 * Relationship: This file verifies raw user identity and unavailable tool names do not leak into the configured OAuth connection payload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeckCard } from '../types';
import type { ToolCatalogDescriptor } from '../services/mcp/toolCatalogMcpClient';
import {
  materializeSavedCardProfile,
  type HermesProfileState,
} from './profileMaterialization';

const card: DeckCard = {
  id: 'builder',
  kind: 'agent',
  templateId: 'template_assist',
  title: 'Builder',
  prompt: 'Saved Builder prompt',
  runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
  runtimeOptions: {
    provider: 'openai',
    accessMode: 'chatgpt-account',
    modelKey: 'gpt-5.6-sol',
    providerModelId: 'gpt-5.6-sol',
    tools: ['canvas.inspect', 'cbm.search_graph'],
  },
  position: { x: 0, y: 0 },
};

const tool: ToolCatalogDescriptor = {
  name: 'canvas.inspect',
  sourceId: 'main_mcp',
  namespace: 'canvas',
  providerToolName: 'inspect',
  connectionKind: 'external-mcp',
  publication: 'external-mcp',
  access: 'read',
  available: true,
  grantEligible: true,
  grantProfiles: [],
  inputSchema: { type: 'object', properties: {} },
  canonicalInputSchema: { type: 'object', properties: {} },
  serverInjectedArguments: [],
  dispatcherContextArguments: [],
  dispatcherOwner: 'canvas.inspect',
  authenticatedProjection: true,
};

function profile(ownerRef?: string): HermesProfileState {
  return {
    name: 'builder',
    soul: 'Saved Builder prompt',
    model: {
      provider: 'openai-codex',
      default: 'gpt-5.6-sol',
      openai_runtime: 'auto',
    },
    skills: [],
    toolsets: [],
    mcp_servers: [{
      name: 'liquidaity',
      enabled: true,
      tool_filter: ['canvas.inspect'],
      context_headers: { project_id: 'project-old', profile: 'builder' },
    }],
    bot_mode_roster: [],
    task_mode: null,
    ui_meta_revisions: { 'hermes-bots': 0 },
    ui_meta: ownerRef ? {
      'hermes-bots': {
        title: 'Builder',
        owner_ref: ownerRef,
        owner_scoped: true,
      },
    } : null,
  };
}

describe('Hermes profile owner and request-context materialization', () => {
  beforeEach(() => {
    vi.stubEnv('MCP_PUBLIC_RESOURCE_URL', 'https://mcp.example.test/mcp');
    vi.stubEnv('MCP_AUTH0_CLIENT_ID', 'client-one');
    vi.stubEnv('MCP_AUTH0_REQUIRED_SCOPE', 'liquidaity.main');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('removes static Project context and claims one hashed owner without exposing the user ID', async () => {
    let current = profile();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params: structuredClone(params) });
      if (method === 'mcp.servers.list') {
        return {
          servers: [{
            name: 'liquidaity',
            url: 'https://mcp.example.test/mcp',
            auth: 'oauth',
          }],
        };
      }
      if (method === 'mcp.servers.remove') {
        return { ok: true, removed: true };
      }
      if (method === 'mcp.servers.add') {
        current = {
          ...current,
          mcp_servers: [{
            name: 'liquidaity',
            enabled: true,
            tool_filter: ['canvas.inspect'],
            context_headers: null,
          }],
        };
        return { ok: true, name: 'liquidaity' };
      }
      if (method === 'profiles.configure') {
        const uiMeta = params.ui_meta as Record<string, unknown> | undefined;
        current = {
          ...current,
          ...(uiMeta ? { ui_meta: uiMeta, ui_meta_revisions: { 'hermes-bots': 1 } } : {}),
          mcp_servers: [{
            name: 'liquidaity',
            enabled: true,
            tool_filter: ['canvas.inspect'],
            context_headers: null,
          }],
        };
        return { ok: true, applied: { ui_meta: true } };
      }
      if (method === 'profiles.describe') return current;
      throw new Error(`unexpected_method:${method}`);
    });
    const gatewayRequest = <T>(method: string, params?: Record<string, unknown>): Promise<T> => (
      request(method, params) as Promise<T>
    );

    const result = await materializeSavedCardProfile(
      gatewayRequest,
      card,
      'user-owner-one',
      current,
      [tool],
      ['cbm'],
    );

    expect(result.ui_meta).toMatchObject({
      'hermes-bots': {
        title: 'Builder',
        owner_scoped: true,
      },
    });
    const ownerRef = String(
      (result.ui_meta?.['hermes-bots'] as { owner_ref?: unknown } | undefined)?.owner_ref
      || '',
    );
    expect(ownerRef).toHaveLength(64);
    expect([...ownerRef].every((character) => '0123456789abcdef'.includes(character)))
      .toBe(true);
    const added = calls.find((call) => call.method === 'mcp.servers.add');
    expect(added?.params).toMatchObject({
      profile: 'builder',
      name: 'liquidaity',
      config: {
        headers: { 'X-LiquidAIty-Hermes-Profile': 'builder' },
      },
    });
    expect(JSON.stringify(calls)).not.toContain('X-LiquidAIty-Project-Id');
    expect(JSON.stringify(calls)).not.toContain('project-old');
    expect(JSON.stringify(calls)).not.toContain('user-owner-one');
    expect(JSON.stringify(calls)).not.toContain('cbm.search_graph');
    expect(calls.map((call) => call.method)).toContain('mcp.servers.remove');
  });

  it('refuses a different owner before MCP or profile configuration', async () => {
    const existing = profile('owner-one-hash');
    const mutation = vi.fn(async (_method?: string, _params?: Record<string, unknown>) => {
      throw new Error('profile_mutation_must_not_run');
    });
    const request = <T>(method: string, params?: Record<string, unknown>): Promise<T> => (
      mutation(method, params) as Promise<T>
    );

    await expect(materializeSavedCardProfile(
      request,
      card,
      'owner-two',
      existing,
      [tool],
    )).rejects.toThrow('hermes_profile_owner_conflict');
    expect(mutation).not.toHaveBeenCalled();
  });

  it('refuses a profile-scoped tool before changing an ordinary Card profile', async () => {
    const mutation = vi.fn(async (
      _method: string,
      _params?: Record<string, unknown>,
    ) => {
      throw new Error('profile_mutation_must_not_run');
    });
    const restrictedCard: DeckCard = {
      ...card,
      runtimeOptions: {
        ...card.runtimeOptions,
        tools: ['engraphis_update_memory'],
      },
    };
    const restrictedTool: ToolCatalogDescriptor = {
      ...tool,
      name: 'engraphis_update_memory',
      providerToolName: 'engraphis_update_memory',
      grantProfiles: ['thinkgraph'],
    };

    await expect(materializeSavedCardProfile(
      ((method: string, params?: Record<string, unknown>) => (
        mutation(method, params) as Promise<never>
      )),
      restrictedCard,
      'user-owner-one',
      profile(),
      [restrictedTool],
    )).rejects.toThrow('hermes_profile_tool_unavailable:builder:engraphis_update_memory');
    expect(mutation).not.toHaveBeenCalled();
  });
});
