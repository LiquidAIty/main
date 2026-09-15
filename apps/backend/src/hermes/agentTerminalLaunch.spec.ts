import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeFs = vi.hoisted(() => ({
  existsSync: vi.fn<(target: string) => boolean>(),
  realpathSync: vi.fn<(target: string) => string>(),
  statSync: vi.fn<(target: string) => { isDirectory(): boolean }>(),
}));
const workspaceRoot = vi.hoisted(() => ({
  resolveRepoRoot: vi.fn(() => 'C:\\repo'),
  resolveProductChatWorkingDirectory: vi.fn((scope: string) => `C:\\neutral\\${JSON.parse(scope).join('-')}`),
}));
vi.mock('node:fs', () => nativeFs);
vi.mock('../services/workspaceRoot', () => workspaceRoot);

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
      providerModelId: 'gpt-5.6-sol', reasoningEffort: 'high', maxTurns: 7,
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
  it('preserves saved selections and accepts the presentation-resolved Card workspace', () => {
    const card = savedCard();
    const launch = prepareAgentTerminal(owner, card, savedDeck(card), 'session-1', workspace);

    expect(launch).toMatchObject({
      file: 'C:\\repo\\Hermes\\venv\\Scripts\\hermes.exe',
      cwd: 'C:\\saved-workspace-real',
      profile: 'agent-cli-proof',
      gatewayArgs: [
        '-p', 'agent-cli-proof', 'serve', '--host', '127.0.0.1', '--port', '0', '--isolated', '--skip-build',
      ],
      tuiArgs: [
        '-p', 'agent-cli-proof', '--tui', '--in', 'C:\\saved-workspace-real',
        '--model', 'gpt-5.6-sol', '--provider', 'openai-codex',
        '--reasoning', 'high', '--max-turns', '7', '--skills', 'saved-skill-a,saved-skill-b',
      ],
    });
    expect(launch.env.HERMES_HOME).toBe('C:\\repo\\Hermes\\.hermes');
    expect(launch.env.HERMES_TUI_DIR).toBe('C:\\repo\\Hermes\\ui-tui');
    expect(launch.env.TERMINAL_CWD).toBe(launch.cwd);
    expect(workspaceRoot.resolveProductChatWorkingDirectory).not.toHaveBeenCalled();
    expect(launch.env.HERMES_EPHEMERAL_SYSTEM_PROMPT).toBe(card.prompt);
    expect(launch.env.HERMES_AGENT_TERMINAL_CONFIG).toBeUndefined();
    expect(launch.env.HERMES_REQUIRE_CLI_HOST).toBeUndefined();
    expect(launch.env.HERMES_MCP_SERVERS).toBeUndefined();
    for (const name of inheritedNames) expect(launch.env[name]).toBe(`must-not-inherit-${name}`);
  });

  it('does not grant an ordinary Card the deck workspace implicitly', () => {
    const card = savedCard();
    const launch = prepareAgentTerminal(owner, card, savedDeck(card), 'session-1');
    expect(launch.cwd).toBe('C:\\neutral\\project-1-deck-1-card_agent_cli-agent-cli-proof');
    expect(launch.cwd).not.toBe('C:\\saved-workspace-real');
    expect(workspaceRoot.resolveProductChatWorkingDirectory).toHaveBeenCalledWith(
      JSON.stringify(['project-1', 'deck-1', 'card_agent_cli', 'agent-cli-proof']),
    );
  });

  it.each([
    ['native executable', (target: string) => !target.endsWith('hermes.exe'), 'agent_terminal_native_executable_missing'],
    ['profile', (target: string) => !target.endsWith('config.yaml'), 'agent_terminal_profile_missing'],
  ])('fails truthfully when the saved %s is unavailable', (_name, availability, error) => {
    nativeFs.existsSync.mockImplementation(availability);
    const card = savedCard();
    expect(() => prepareAgentTerminal(owner, card, savedDeck(card), 'session-1')).toThrow(error);
  });

  it('fails truthfully for an absent saved model and keeps the existing per-Card fallback distinct', () => {
    const modelMissing = savedCard({ runtimeOptions: {
      ...(savedCard().runtimeOptions as Record<string, unknown>), providerModelId: null, modelKey: null,
    } as unknown as AgentCardInstance['runtimeOptions'] });
    expect(() => prepareAgentTerminal(owner, modelMissing, savedDeck(modelMissing), 'session-1'))
      .toThrow('hermes_saved_provider_selection_incomplete');
    const card = savedCard();
    const launch = prepareAgentTerminal(owner, card, savedDeck(card, { workspaceRoot: null }), 'session-1');
    expect(launch.cwd).toBe('C:\\neutral\\project-1-deck-1-card_agent_cli-agent-cli-proof');
    const other = savedCard({ runtime: { kind: 'hermes', mode: 'delegate', profile: 'other-agent' } });
    expect(prepareAgentTerminal(owner, other, savedDeck(other), 'session-2').cwd).not.toBe(launch.cwd);
    expect(prepareAgentTerminal({ ...owner, deckId: 'other-deck' }, card, savedDeck(card), 'session-3').cwd)
      .not.toBe(launch.cwd);
    expect(prepareAgentTerminal({ ...owner, projectId: 'other-project' }, card, savedDeck(card), 'session-4').cwd)
      .not.toBe(launch.cwd);
  });

  it('uses the same saved modelKey as canonical Run materialization when providerModelId is absent', () => {
    const card = savedCard({ runtimeOptions: {
      ...savedCard().runtimeOptions, providerModelId: undefined,
    } });
    expect(prepareAgentTerminal(owner, card, savedDeck(card), 'session-1').tuiArgs)
      .toContain('saved-model-key');
  });

  it.each([
    { script: { enabled: true } }, { toolCatalogPolicy: 'all_healthy' },
  ])('defers capability materialization to the required canonical Run', (options) => {
    const card = savedCard({ runtimeOptions: {
      ...savedCard().runtimeOptions, ...options,
    } as AgentCardInstance['runtimeOptions'] });
    const launch = prepareAgentTerminal(owner, card, savedDeck(card), 'session-1');
    expect(launch.env.HERMES_REQUIRE_CLI_HOST).toBeUndefined();
    expect(launch.env.HERMES_AGENT_TERMINAL_CONFIG).toBeUndefined();
    expect(launch.env.HERMES_MCP_SERVERS).toBeUndefined();
  });
});
