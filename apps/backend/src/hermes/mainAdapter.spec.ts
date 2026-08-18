import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildHermesOfficialMcpServer,
  buildHermesDelegateCards,
  deriveHermesSessionKey,
  providerForHermes,
  requireHermesCompletionText,
  resolveHermesCardRuntimeHome,
} from './mainAdapter';

describe('Hermes ACP transport identity', () => {
  it('keeps each prepared profile in a stable isolated runtime home', () => {
    const root = 'C:\\Projects\\LiquidAIty\\main\\Hermes';
    expect(resolveHermesCardRuntimeHome(root, 'card_main_chat')).toBe(
      path.join(root, '.hermes', 'profiles', 'card_main_chat'),
    );
    expect(() => resolveHermesCardRuntimeHome(root, '../escape')).toThrow('hermes_profile_invalid');
  });

  it('mechanically maps prepared ChatGPT-account OpenAI transport to Codex ACP', () => {
    expect(providerForHermes('openai', 'chatgpt-account')).toBe('openai-codex');
    expect(providerForHermes('openrouter', 'openrouter-api')).toBe('openrouter');
  });

  it('derives one transport session key from resolved identities', () => {
    expect(deriveHermesSessionKey('project-1', 'conversation-1', 'card_main_chat')).toBe(
      'hermes:project-1:conversation-1:card_main_chat',
    );
  });

  it('requires visible completion text and classifies an empty Codex account result truthfully', () => {
    expect(requireHermesCompletionText('answer', 'chatgpt-account')).toBe('answer');
    expect(() => requireHermesCompletionText('  ', 'chatgpt-account')).toThrow(
      'codex_app_server_empty_completion',
    );
    expect(() => requireHermesCompletionText('', 'openrouter-api')).toThrow(
      'hermes_empty_completion',
    );
  });

  it('connects genuine Hermes to the one official HTTP MCP host with Card grants', () => {
    const server = buildHermesOfficialMcpServer({
      sessionKey: 'session-1',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'main-run-1',
      cardId: 'card_main_chat',
      runtimeBinding: 'main_chat',
      tools: ['canvas.inspect', 'card.run_assistant_agent', 'web_search'],
    }, {
      LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
      LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
    });
    expect(server).toMatchObject({
      type: 'http',
      name: expect.stringMatching(/^main-runtime-/),
      url: 'http://127.0.0.1:8765/mcp',
      headers: [{ name: 'Authorization', value: expect.stringMatching(/^Bearer /) }],
    });
    expect(server).not.toHaveProperty('command');
    expect(JSON.stringify(server)).not.toContain('0123456789abcdef0123456789abcdef');
  });

  it('projects saved Hermes delegates into exact native and official-MCP tool names', () => {
    expect(buildHermesDelegateCards([{
      cardId: 'card_local_coder',
      title: 'Coder',
      runtimeBinding: 'coder',
      runtimeOwner: 'hermes',
      prompt: 'Saved Coder prompt',
      profile: 'coder',
      provider: 'openai',
      providerModelId: 'gpt-5.6-luna',
      accessMode: 'chatgpt-account',
      executionMode: 'single',
      tools: ['cbm.search_graph', 'web_search'],
      nativeTools: ['terminal'],
      skills: [],
      toolsets: ['terminal'],
      mcpConnectionIds: [],
    }], 'main-runtime-abcd')).toEqual([{
      cardId: 'card_local_coder',
      title: 'Coder',
      runtimeBinding: 'coder',
      prompt: 'Saved Coder prompt',
      profile: 'coder',
      provider: 'openai',
      providerModelId: 'gpt-5.6-luna',
      accessMode: 'chatgpt-account',
      executionMode: 'single',
      skills: [],
      toolsets: ['terminal'],
      allowedToolNames: [
        'terminal',
        'mcp__main_runtime_abcd__cbm_search_graph',
        'web_search',
      ],
    }]);
  });

  it('does not advertise saved auto-Kanban Cards as plain delegate_task children', () => {
    expect(buildHermesDelegateCards([{
      cardId: 'card_hermes_steward',
      title: 'Helper',
      runtimeBinding: 'hermes_steward',
      runtimeOwner: 'hermes',
      prompt: 'Saved Helper prompt',
      profile: 'liquidaity-hermes-steward',
      provider: 'openai',
      providerModelId: 'gpt-5.6-luna',
      accessMode: 'chatgpt-account',
      executionMode: 'auto-kanban',
      tools: [],
      nativeTools: [],
      skills: [],
      toolsets: [],
      mcpConnectionIds: [],
    }], 'main-runtime-abcd')).toEqual([]);
  });
});
