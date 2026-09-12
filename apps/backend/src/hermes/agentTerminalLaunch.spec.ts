import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeFs = vi.hoisted(() => ({
  existsSync: vi.fn<(target: string) => boolean>(),
  realpathSync: vi.fn<(target: string) => string>(),
  statSync: vi.fn<(target: string) => { isDirectory(): boolean }>(),
}));
const workspaceRoot = vi.hoisted(() => ({ resolveRepoRoot: vi.fn(() => 'C:\\repo') }));
const mcp = vi.hoisted(() => ({
  resolvePythonAgentMcpServerSpec: vi.fn(() => ({
    url: 'http://127.0.0.1:8765/mcp', headers: { Authorization: 'Bearer exact-saved-grant' },
  })),
  resolveSavedMcpConnections: vi.fn(() => ([{
    name: 'saved-remote', url: 'https://saved.example/mcp', headers: [{ name: 'X-Saved', value: 'connection' }],
  }])),
}));

vi.mock('node:fs', () => nativeFs);
vi.mock('../services/workspaceRoot', () => workspaceRoot);
vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  resolvePythonAgentMcpServerSpec: mcp.resolvePythonAgentMcpServerSpec,
}));
vi.mock('./mcpConnections', () => ({ resolveSavedMcpConnections: mcp.resolveSavedMcpConnections }));

import { prepareAgentTerminal, type AgentTerminalOwner } from './agentTerminal';
import type { AgentCardInstance, DeckDocument } from '../types';

const owner: AgentTerminalOwner = {
  userId: 'user-1', projectId: 'project-1', deckId: 'deck-1', cardId: 'card_agent_cli',
};
const workspace = 'C:\\saved-workspace';

function savedCard(overrides: Partial<AgentCardInstance> = {}): AgentCardInstance {
  return {
    id: owner.cardId,
    title: 'Saved Agent CLI',
    templateId: 'agent',
    position: { x: 0, y: 0 },
    prompt: 'Exact saved prompt. Do not inherit another card.',
    runtime: { kind: 'hermes', mode: 'delegate', profile: 'agent-cli-proof' },
    runtimeOptions: {
      provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'saved-model-key',
      providerModelId: 'gpt-6-astra', reasoningEffort: 'high', maxTurns: 7,
      skills: ['saved-skill-a', 'saved-skill-b'], tools: ['read_repo', 'web_search', 'disabled_tool'],
      nativeTools: ['native_saved_tool'], disabledTools: ['disabled_tool'], toolsets: ['saved-toolset'],
      mcpConnectionIds: ['saved-remote-id'], toolCatalogPolicy: 'selected',
    } as unknown as AgentCardInstance['runtimeOptions'],
    ...overrides,
  };
}

function savedDeck(card: AgentCardInstance, overrides: Partial<DeckDocument> = {}): DeckDocument {
  return {
    id: owner.deckId, name: 'Saved deck', nodes: [card], edges: [], promptTemplates: [], version: 1,
    workspaceRoot: workspace,
    ...overrides,
  };
}

const inheritedNames = ['HERMES_MAIN_MODEL', 'HERMES_BUILDER_PROFILE', 'CODEX_HOME', 'OPENAI_API_KEY'] as const;
const inheritedBefore = new Map<string, string | undefined>();

beforeEach(() => {
  nativeFs.existsSync.mockImplementation(() => true);
  nativeFs.realpathSync.mockReturnValue('C:\\saved-workspace-real');
  nativeFs.statSync.mockReturnValue({ isDirectory: () => true });
  mcp.resolvePythonAgentMcpServerSpec.mockClear();
  mcp.resolveSavedMcpConnections.mockClear();
  for (const name of inheritedNames) {
    inheritedBefore.set(name, process.env[name]);
    process.env[name] = `must-not-inherit-${name}`;
  }
});

afterEach(() => {
  for (const name of inheritedNames) {
    const value = inheritedBefore.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  inheritedBefore.clear();
});

describe('prepareAgentTerminal saved-card launch contract', () => {
  it('materializes only the saved card model, prompt, selections, MCP grants, and workspace', () => {
    const card = savedCard();
    const launch = prepareAgentTerminal(owner, card, savedDeck(card), 'session-1');

    expect(launch).toMatchObject({
      file: 'C:\\repo\\Hermes\\venv\\Scripts\\hermes.exe',
      cwd: 'C:\\saved-workspace-real',
      profile: 'agent-cli-proof',
      args: [
        '-p', 'agent-cli-proof', 'chat', '--cli', '--in', 'C:\\saved-workspace-real',
        '--model', 'gpt-6-astra', '--provider', 'openai-codex', '--toolsets', 'agent-terminal',
        '--reasoning', 'high', '--max-turns', '7', '--skills', 'saved-skill-a,saved-skill-b',
      ],
    });
    expect(launch.env.HERMES_HOME).toBe('C:\\repo\\Hermes\\.hermes\\profiles\\agent-cli-proof');
    expect(launch.env.HERMES_EPHEMERAL_SYSTEM_PROMPT).toBe(card.prompt);
    expect(JSON.parse(launch.env.HERMES_AGENT_TERMINAL_CONFIG)).toEqual({
      cardId: card.id,
      profile: 'agent-cli-proof',
      profileHome: 'C:\\repo\\Hermes\\.hermes\\profiles\\agent-cli-proof',
      toolsets: ['saved-toolset', 'mcp-saved-remote'],
      nativeTools: ['native_saved_tool', 'web_search'],
      mcpTools: ['mcp__agent_terminal__read_repo'],
    });
    expect(JSON.parse(launch.env.HERMES_MCP_SERVERS)).toEqual({
      agent_terminal: {
        url: 'http://127.0.0.1:8765/mcp', headers: { Authorization: 'Bearer exact-saved-grant' }, lazy: false,
      },
      'saved-remote': { url: 'https://saved.example/mcp', headers: { 'X-Saved': 'connection' }, lazy: false },
    });
    expect(mcp.resolvePythonAgentMcpServerSpec).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'agent-terminal', projectId: owner.projectId, deckId: owner.deckId, callerCardId: owner.cardId,
      terminalSessionId: 'session-1', profile: 'agent-cli-proof', grantedTools: ['read_repo'],
      presentedTools: ['read_repo'], callerRuntimeKind: 'hermes', callerRuntimeMode: 'delegate',
    }));
    expect(mcp.resolveSavedMcpConnections).toHaveBeenCalledWith(['saved-remote-id']);
    for (const name of inheritedNames) expect(launch.env).not.toHaveProperty(name);
  });

  it.each([
    ['native executable', (target: string) => !target.endsWith('hermes.exe'), 'agent_terminal_native_executable_missing'],
    ['profile', (target: string) => !target.endsWith('config.yaml'), 'agent_terminal_profile_missing'],
  ])('fails truthfully when the saved %s is unavailable', (_name, availability, error) => {
    nativeFs.existsSync.mockImplementation(availability);
    const card = savedCard();
    expect(() => prepareAgentTerminal(owner, card, savedDeck(card), 'session-1')).toThrow(error);
  });

  it('fails truthfully for absent saved model and workspace', () => {
    const modelMissing = savedCard({ runtimeOptions: {
      ...(savedCard().runtimeOptions as Record<string, unknown>), providerModelId: null,
    } as unknown as AgentCardInstance['runtimeOptions'] });
    expect(() => prepareAgentTerminal(owner, modelMissing, savedDeck(modelMissing), 'session-1'))
      .toThrow('agent_terminal_saved_model_missing');
    const card = savedCard();
    expect(() => prepareAgentTerminal(owner, card, savedDeck(card, { workspaceRoot: null }), 'session-1'))
      .toThrow('agent_terminal_saved_workspace_missing');
  });

  it.each([
    ['enabled Script', { script: { enabled: true } }, 'agent_terminal_native_script_binding_unavailable'],
    ['all-healthy catalog', { toolCatalogPolicy: 'all_healthy' }, 'agent_terminal_live_catalog_selection_unavailable'],
  ])('fails truthfully for unsupported saved %s', (_name, runtimeOptions, error) => {
    const card = savedCard({ runtimeOptions: {
      ...(savedCard().runtimeOptions as Record<string, unknown>), ...runtimeOptions,
    } as unknown as AgentCardInstance['runtimeOptions'] });
    expect(() => prepareAgentTerminal(owner, card, savedDeck(card), 'session-1')).toThrow(error);
  });
});
