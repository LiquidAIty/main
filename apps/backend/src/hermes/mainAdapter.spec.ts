import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildHermesHostSessionProjection,
  buildHermesOfficialMcpServer,
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

  it('mechanically maps prepared ChatGPT-account OpenAI transport to Hermes native OAuth', () => {
    expect(providerForHermes('openai', 'chatgpt-account')).toBe('openai-codex');
    expect(providerForHermes('openrouter', 'openrouter-api')).toBe('openrouter');
  });

  it('derives one transport session key from resolved identities', () => {
    expect(deriveHermesSessionKey('project-1', 'conversation-1', 'card_main_chat')).toBe(
      'hermes:project-1:conversation-1:card_main_chat',
    );
  });

  it('requires visible completion text from the Hermes loop', () => {
    expect(requireHermesCompletionText('answer')).toBe('answer');
    expect(() => requireHermesCompletionText('  ')).toThrow('hermes_empty_completion');
    expect(() => requireHermesCompletionText('')).toThrow('hermes_empty_completion');
  });

  it('connects genuine Hermes to the one official HTTP MCP host with Card grants', () => {
    const server = buildHermesOfficialMcpServer({
      sessionKey: 'session-1',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'main-run-1',
      cardId: 'card_main_chat',
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
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

  it('projects saved Hermes delegates into isolated native profiles on one MCP host', () => {
    const projection = buildHermesHostSessionProjection({
      sessionKey: 'session-1',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'main-run-1',
      cardId: 'card_main_chat',
      title: 'Main',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      prompt: 'Main prompt',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
      accessMode: 'chatgpt-account',
      tools: ['canvas.inspect'],
      nativeTools: ['memory'],
      skills: [],
      toolsets: ['memory'],
      mcpConnectionIds: [],
      delegateProfiles: [{
        cardId: 'card_coder',
        title: 'Coder',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
        prompt: 'Saved Coder prompt',
        provider: 'openai',
        modelKey: 'gpt-5.6-terra',
        providerModelId: 'gpt-5.6-terra',
        accessMode: 'chatgpt-account',
        tools: ['cbm.search_graph'],
        nativeTools: ['terminal'],
        skills: ['repository-coder'],
        toolsets: ['terminal'],
        mcpConnectionIds: [],
      }],
      message: '# IDF\n\nInspect the repository.',
    }, {
      LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
      LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
    });

    expect(projection.mcpServers).toHaveLength(2);
    expect(projection.mcpServers.map((server) => server.url)).toEqual([
      'http://127.0.0.1:8765/mcp',
      'http://127.0.0.1:8765/mcp',
    ]);
    const sessionConfig = (projection.sessionMeta.hermes as any).sessionConfig;
    expect(sessionConfig.enabledTools).toEqual(['memory', 'delegate_task']);
    expect(sessionConfig.delegateProfiles).toEqual([
      expect.objectContaining({
        id: 'card_coder',
        systemPrompt: 'Saved Coder prompt',
        model: 'gpt-5.6-terra',
        enabledTools: ['terminal'],
        skills: ['repository-coder'],
        enabledToolsets: expect.arrayContaining(['terminal']),
      }),
    ]);

    const claims = projection.mcpServers.map((server: any) => {
      const bearer = String(server.headers[0].value).replace(/^Bearer /, '');
      return JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString('utf8'));
    });
    expect(claims).toEqual([
      expect.objectContaining({
        principal: expect.objectContaining({
          callerCardId: 'card_main_chat', grantedTools: ['canvas.inspect'],
        }),
      }),
      expect.objectContaining({
        principal: expect.objectContaining({
          callerCardId: 'card_coder', grantedTools: ['cbm.search_graph'],
        }),
      }),
    ]);
  });

  it('rejects a delegate that would require a different provider authority', () => {
    const args: any = {
      sessionKey: 'session-1', projectId: 'project-1', deckId: 'deck_builder',
      conversationId: 'conversation-1', parentRunId: 'main-run-1',
      cardId: 'card_main_chat', title: 'Main',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      prompt: '', provider: 'openai', modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna', accessMode: 'chatgpt-account',
      tools: [], nativeTools: [], skills: [], toolsets: [], mcpConnectionIds: [],
      message: '# IDF',
      delegateProfiles: [{
        cardId: 'card_paid', title: 'Paid',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'paid' },
        prompt: '', provider: 'openrouter', modelKey: 'model', providerModelId: 'model',
        accessMode: 'openrouter-api', tools: [], nativeTools: [], skills: [],
        toolsets: [], mcpConnectionIds: [],
      }],
    };
    expect(() => buildHermesHostSessionProjection(args, {})).toThrow(
      'hermes_delegate_provider_authority_mismatch:card_paid',
    );
  });

});
