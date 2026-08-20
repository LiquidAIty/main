import { describe, expect, it } from 'vitest';
import path from 'node:path';

import {
  buildHermesHostSessionProjection,
  buildHermesOfficialMcpServer,
  deriveHermesSessionKey,
  providerForHermes,
  requireHermesCompletionText,
  resolveHermesRuntimeHome,
} from './mainAdapter';

describe('Hermes ACP transport identity', () => {
  it('uses one repo-owned Hermes home for every stable native session', () => {
    const root = 'C:\\Projects\\LiquidAIty\\main\\Hermes';
    expect(resolveHermesRuntimeHome(root)).toBe(path.join(root, '.hermes'));
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

  it('projects one Card-owned native and MCP surface without creating subagent Cards', () => {
    const projection = buildHermesHostSessionProjection({
      sessionKey: 'session-1',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'main-run-1',
      cardId: 'card_main_chat',
      title: 'Main',
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      prompt: 'Main prompt',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
      accessMode: 'chatgpt-account',
      tools: ['canvas.inspect'],
      nativeTools: ['delegate_task'],
      skills: [],
      toolsets: ['memory', 'delegation'],
      mcpConnectionIds: [],
      message: '# IDF\n\nInspect the repository.',
    }, {
      LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
      LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
    }, 'root-context');

    expect(projection.mcpServers).toHaveLength(1);
    const sessionConfig = (projection.sessionMeta.hermes as any).sessionConfig;
    expect(sessionConfig.enabledToolsets).toEqual(expect.arrayContaining([
      'memory',
      'delegation',
      expect.stringMatching(/^mcp-main-runtime-/),
    ]));
    expect(sessionConfig.enabledTools).toEqual(['delegate_task']);
    expect(sessionConfig).not.toHaveProperty('delegateProfiles');
    expect(sessionConfig.hostSessionKey).toBe('session-1');
    expect(sessionConfig.executionContextId).toBe('root-context');
    expect(sessionConfig.systemPrompt).toBe('Main prompt');
    expect(sessionConfig.toolCallMeta).toEqual({
      'liquidaity/execution': 'root-context',
    });

    const bearer = String((projection.mcpServers[0] as any).headers[0].value)
      .replace(/^Bearer /, '');
    const claims = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString('utf8'));
    expect(claims).toEqual(expect.objectContaining({
      principal: expect.objectContaining({
        callerCardId: 'card_main_chat',
        grantedTools: ['canvas.inspect'],
        requiresExecutionContext: true,
      }),
    }));
  });
});
