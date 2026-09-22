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
      nativeTools: ['native_saved_tool'], toolsets: ['saved-toolset'],
      mcpConnectionIds: ['saved-remote-id'],
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
let ephemeralPromptBefore: string | undefined;

beforeEach(() => {
  nativeFs.existsSync.mockImplementation(() => true);
  nativeFs.realpathSync.mockReturnValue('C:\\saved-workspace-real');
  nativeFs.statSync.mockReturnValue({ isDirectory: () => true });
  for (const name of inheritedNames) {
    inheritedBefore.set(name, process.env[name]);
    process.env[name] = `must-not-inherit-${name}`;
  }
  ephemeralPromptBefore = process.env.HERMES_EPHEMERAL_SYSTEM_PROMPT;
  process.env.HERMES_EPHEMERAL_SYSTEM_PROMPT = 'stale-parent-prompt';
});

afterEach(() => {
  for (const name of inheritedNames) {
    const value = inheritedBefore.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  inheritedBefore.clear();
  if (ephemeralPromptBefore === undefined) delete process.env.HERMES_EPHEMERAL_SYSTEM_PROMPT;
  else process.env.HERMES_EPHEMERAL_SYSTEM_PROMPT = ephemeralPromptBefore;
  ephemeralPromptBefore = undefined;
});

describe('prepareAgentTerminal saved-card launch contract', () => {
  it('preserves saved selections and accepts the presentation-resolved Card workspace', () => {
    const card = savedCard();
    const launch = prepareAgentTerminal(owner, card, savedDeck(card), 'session-1', workspace);

    expect(launch).toMatchObject({
      file: 'C:\\repo\\Hermes\\venv\\Scripts\\python.exe',
      cwd: 'C:\\saved-workspace-real',
      profile: 'agent-cli-proof',
      gatewayArgs: [
        '-m', 'hermes_cli.main',
        '-p', 'agent-cli-proof', 'serve', '--host', '127.0.0.1', '--port', '0', '--isolated', '--skip-build',
      ],
      tuiArgs: [
        '-m', 'hermes_cli.main',
        '-p', 'agent-cli-proof', '--tui', '--in', 'C:\\saved-workspace-real',
        '--model', 'gpt-5.6-sol', '--provider', 'openai-codex',
        '--reasoning', 'high', '--max-turns', '7', '--skills', 'saved-skill-a,saved-skill-b',
      ],
    });
    expect(launch.env.HERMES_HOME).toBe('C:\\repo\\Hermes\\.hermes');
    expect(launch.env.HERMES_TUI_DIR).toBe('C:\\repo\\Hermes\\ui-tui');
    expect(launch.env.TERMINAL_CWD).toBe(launch.cwd);
    expect(workspaceRoot.resolveProductChatWorkingDirectory).not.toHaveBeenCalled();
    expect(launch.env.HERMES_EPHEMERAL_SYSTEM_PROMPT).toBeUndefined();
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
    ['native executable', (target: string) => !target.endsWith('python.exe'), 'agent_terminal_native_executable_missing'],
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

  it('forwards only an explicitly saved native subagent type to profile materialization', () => {
    const legacy = savedCard();
    expect(prepareAgentTerminal(owner, legacy, savedDeck(legacy), 'session-legacy').profileSelection)
      .not.toHaveProperty('subagentType');

    const recursive = savedCard({ runtimeOptions: {
      ...savedCard().runtimeOptions,
      subagentType: 'recursive',
    } });
    expect(prepareAgentTerminal(
      owner,
      recursive,
      savedDeck(recursive),
      'session-recursive',
    ).profileSelection).toMatchObject({ subagentType: 'recursive' });
  });

  it('derives Team task behavior from the stable Team Card identity', () => {
    const team = savedCard({
      id: 'card_team',
      title: 'Renamed by the user',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'team' },
    });
    const teamOwner = { ...owner, cardId: 'card_team' };
    expect(prepareAgentTerminal(
      teamOwner,
      team,
      savedDeck(team),
      'session-team',
    ).profileSelection).toMatchObject({ taskMode: 'team' });

    expect(prepareAgentTerminal(
      owner,
      savedCard({ title: 'Team' }),
      savedDeck(savedCard({ title: 'Team' })),
      'session-title-only',
    ).profileSelection).toMatchObject({ taskMode: null });
  });

  it('uses the canonical app-server transport for the existing Mag One account binding', () => {
    const card = savedCard({
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
    });
    const launch = prepareAgentTerminal(owner, card, savedDeck(card), 'session-1');

    expect(launch.providerSelection).toMatchObject({
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      apiMode: 'codex_app_server',
      openaiRuntime: 'codex_app_server',
      profileOpenaiRuntime: 'codex_app_server',
    });
  });

  it('defers Script capability materialization to the required canonical Run', () => {
    const card = savedCard({ runtimeOptions: {
      ...savedCard().runtimeOptions, script: { enabled: true },
    } as AgentCardInstance['runtimeOptions'] });
    const launch = prepareAgentTerminal(owner, card, savedDeck(card), 'session-1');
    expect(launch.env.HERMES_REQUIRE_CLI_HOST).toBeUndefined();
    expect(launch.env.HERMES_AGENT_TERMINAL_CONFIG).toBeUndefined();
    expect(launch.env.HERMES_MCP_SERVERS).toBeUndefined();
  });
});
