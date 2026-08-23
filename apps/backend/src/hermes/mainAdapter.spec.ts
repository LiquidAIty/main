import { describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  AcpProcess,
  buildHermesHostSessionProjection,
  buildHermesOfficialMcpServer,
  deriveHermesSessionKey,
  requireHermesCompletionText,
  requireHermesEffectSuccess,
  resolveHermesEffectToolName,
  resolveHermesRuntimeHome,
  startHermesTurnWithOnePrePromptRecovery,
} from './mainAdapter';
import {
  finishHermesExecutionContext,
  registerHermesRootExecutionContext,
} from './childExecutionContext';

function providerFreeTurnArgs(toolCount = 57) {
  return {
    cardId: 'card_main_chat',
    title: 'Main Chat',
    runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' } as const,
    prompt: 'Saved Main prompt',
    provider: 'openai',
    modelKey: 'gpt-5.6-sol',
    providerModelId: 'gpt-5.6-sol',
    accessMode: 'chatgpt-account' as const,
    tools: Array.from({ length: toolCount }, (_, index) => `test.tool_${index + 1}`),
    nativeTools: ['delegate_task'],
    skills: [],
    toolsets: ['delegation'],
    mcpConnectionIds: [],
    sessionKey: 'hermes:project-1:provider-free:card_main_chat',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'provider-free',
    parentRunId: 'provider-free-run',
    message: 'Return the bounded provider-free result.',
  };
}

function fakeAcpScript(exitAfterRegistration: boolean): string {
  return `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
rl.on('line', (line) => {
  const message = JSON.parse(line);
  const method = message.method;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
  if (method === 'session/list') return send({ jsonrpc: '2.0', id: message.id, result: { sessions: [] } });
  if (method === 'session/new') {
    process.stderr.write('MCP server provider-free (HTTP): registered 57 tool(s)\\n');
    ${exitAfterRegistration ? "return setImmediate(() => process.exit(0));" : "return send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'provider-free-session' } });"}
  }
  if (method === 'session/set_model') {
    return send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Card must not override native profile model' } });
  }
  if (method === '_session/configure_host') {
    return send({ jsonrpc: '2.0', id: message.id, result: {} });
  }
  if (method === '_profile/read' || method === '_learning/detail' || method === '_native/apply' || method === '_mcp/test') {
    return send({ jsonrpc: '2.0', id: message.id, result: { method } });
  }
  if (method === 'session/prompt') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'provider-free-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'provider-free terminal result' } } } });
    return send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn', usage: { inputTokens: 11, outputTokens: 4 } } });
  }
});
`;
}

describe('Hermes ACP transport identity', () => {
  it('permits only the bounded native profile and MCP manager extensions', async () => {
    const root = path.join(tmpdir(), `liquidaity-acp-${randomUUID()}`);
    const hermesHome = path.join(root, '.hermes');
    mkdirSync(hermesHome, { recursive: true });
    const processOwner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(false)] },
      hermesHome,
    });
    try {
      await expect(processOwner.requestExtension('_profile/read', { name: 'coder' }))
        .resolves.toEqual({ method: '_profile/read' });
      await expect(processOwner.requestExtension('_mcp/test', { profile: 'coder', name: 'liquidaity' }))
        .resolves.toEqual({ method: '_mcp/test' });
      await expect(processOwner.requestExtension('_native/apply', { profile: 'coder', operation: 'profile.soul.set', value: 'Soul' }))
        .resolves.toEqual({ method: '_native/apply' });
      await expect(processOwner.requestExtension('_learning/detail', { profile: 'coder', nodeId: 'skill' }))
        .resolves.toEqual({ method: '_learning/detail' });
      await expect(processOwner.requestExtension('_profile/apply', { name: 'coder' }))
        .rejects.toThrow('hermes_acp_extension_method_invalid');
      await expect(processOwner.requestExtension('_secrets/read', {}))
        .rejects.toThrow('hermes_acp_extension_method_invalid');
    } finally {
      processOwner.close();
      await processOwner.closed;
    }
  });

  it('keeps the real stdio lifecycle alive after a large MCP catalog and preserves unexpected pre-inference exit evidence', async () => {
    const previousSecret = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
    const previousUrl = process.env.LIQUIDAITY_INTERNAL_MCP_URL;
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'provider-free-secret-0123456789abcdef';
    process.env.LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:9/mcp';
    const root = path.join(tmpdir(), `liquidaity-acp-${randomUUID()}`);
    const hermesHome = path.join(root, '.hermes');
    mkdirSync(hermesHome, { recursive: true });
    const processes: AcpProcess[] = [];
    try {
      const premature = new AcpProcess(() => undefined, {
        install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(true)] },
        hermesHome,
      });
      processes.push(premature);
      await expect(premature.startTurn(providerFreeTurnArgs(), () => undefined)).rejects.toThrow(
        /hermes_acp_exited:0:none:explicit=no:last=request:session\/new:write/,
      );
      const unexpectedExit = await premature.closed;
      expect(unexpectedExit.stderrTail.join('\n')).toContain('registered 57 tool(s)');
      expect(unexpectedExit.stdoutTail).toBe('');

      const recoveryFirst = new AcpProcess(() => undefined, {
        install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(true)] },
        hermesHome,
      });
      const recoverySecond = new AcpProcess(() => undefined, {
        install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(false)] },
        hermesHome,
      });
      processes.push(recoveryFirst, recoverySecond);
      const queue = [recoveryFirst, recoverySecond];
      const events: string[] = [];
      const handle = await startHermesTurnWithOnePrePromptRecovery(
        providerFreeTurnArgs(),
        (event) => events.push(event.kind),
        () => {
          const next = queue.shift();
          if (!next) throw new Error('unexpected_third_acp_attempt');
          return next;
        },
      );
      const result = await handle.done;
      expect(queue).toHaveLength(0);
      expect(result.finalText).toBe('provider-free terminal result');
      expect(result.usage).toMatchObject({ providerInputTokens: 11, providerOutputTokens: 4 });
      expect(events).toContain('done');
      expect(recoverySecond.alive).toBe(true);
      recoverySecond.close();
      const explicitExit = await recoverySecond.closed;
      expect(explicitExit.explicit).toBe(true);
      expect(explicitExit.lastProtocolEvent).toBe('close:explicit');
    } finally {
      for (const processOwner of processes) {
        if (processOwner.alive) processOwner.close();
      }
      if (previousSecret === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
      else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = previousSecret;
      if (previousUrl === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_URL;
      else process.env.LIQUIDAITY_INTERNAL_MCP_URL = previousUrl;
    }
  });

  it('uses one repo-owned Hermes home for every stable native session', () => {
    const root = 'C:\\Projects\\LiquidAIty\\main\\Hermes';
    expect(resolveHermesRuntimeHome(root)).toBe(path.join(root, '.hermes'));
  });

  it('does not push Card provider/model fields into a native Hermes session', async () => {
    const root = path.join(tmpdir(), `liquidaity-acp-native-model-${randomUUID()}`);
    const hermesHome = path.join(root, '.hermes');
    mkdirSync(hermesHome, { recursive: true });
    const owner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(false)] },
      hermesHome,
    });
    try {
      await expect(owner.prepareSession(providerFreeTurnArgs(0))).resolves.toMatchObject({
        sessionId: 'provider-free-session',
      });
    } finally {
      owner.close();
      await owner.closed;
    }
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

  it('does not report a completed Run after a Card-authorized effect failed', () => {
    expect(() => {
      requireHermesEffectSuccess(
        ['engraphis.remember'],
        [{ toolName: 'engraphis.remember', toolUseId: 'tool-1', isError: true }],
      );
      requireHermesCompletionText('I answered even though the required write failed.');
    }).toThrow('hermes_required_effect_failed:engraphis.remember');
    expect(() => requireHermesEffectSuccess(
      ['engraphis.remember'],
      [{ toolName: 'engraphis.remember', toolUseId: 'tool-1', isError: false }],
    )).not.toThrow();
  });

  it('maps one Hermes MCP runtime name back to its exact Card effect grant', () => {
    const effects = new Set(['engraphis.remember', 'card.run_assistant_agent']);
    expect(resolveHermesEffectToolName(
      effects,
      'mcp__main_runtime_3b25e34a0e05__engraphis_remember',
    )).toBe('engraphis.remember');
    expect(resolveHermesEffectToolName(effects, 'engraphis.remember')).toBe('engraphis.remember');
    expect(resolveHermesEffectToolName(effects, 'engraphis.stats')).toBe('engraphis.stats');
  });

  it('does not guess when normalized Card effect names are ambiguous', () => {
    const effects = new Set(['example.a_b', 'example_a.b']);
    const reported = 'mcp__runtime__example_a_b';
    expect(resolveHermesEffectToolName(effects, reported)).toBe(reported);
  });

  it('keeps optional readable-tool failures separate from required effects', () => {
    expect(() => requireHermesEffectSuccess(
      ['engraphis.remember'],
      [{ toolName: 'engraphis.stats', toolUseId: 'tool-1', isError: true }],
    )).not.toThrow();
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

  it('preserves the native Hermes catalog when no LiquidAIty MCP tools are granted', () => {
    expect(buildHermesOfficialMcpServer({
      sessionKey: 'session-1',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'main-run-1',
      cardId: 'card_main_chat',
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      tools: ['web_search'],
    }, {})).toBeNull();
  });

  it('configures a signed Card MCP projection on one ACP session without prompting a model', async () => {
    const previousSecret = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
    const previousUrl = process.env.LIQUIDAITY_INTERNAL_MCP_URL;
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'provider-free-secret-0123456789abcdef';
    process.env.LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:9/mcp';
    const root = path.join(tmpdir(), `liquidaity-acp-config-${randomUUID()}`);
    const hermesHome = path.join(root, '.hermes');
    mkdirSync(hermesHome, { recursive: true });
    const owner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(false)] },
      hermesHome,
    });
    const context = registerHermesRootExecutionContext({
      sessionId: 'kanban:provider-free-run',
      runId: 'provider-free-run',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'provider-free',
      cardId: 'card_main_chat',
      runtimeMode: 'kanban',
      grantedTools: providerFreeTurnArgs().tools,
    });
    try {
      await expect(owner.configureHostSession(providerFreeTurnArgs(), context.contextId)).resolves.toMatchObject({
        sessionId: 'provider-free-session',
        hermesHome,
        transport: 'acp-stdio',
      });
      expect(owner.alive).toBe(true);
    } finally {
      await finishHermesExecutionContext({ contextId: context.contextId, state: 'cancelled' });
      if (owner.alive) owner.close();
      if (previousSecret === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
      else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = previousSecret;
      if (previousUrl === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_URL;
      else process.env.LIQUIDAITY_INTERNAL_MCP_URL = previousUrl;
    }
  });

  it('adds one Card-owned MCP surface without replacing native Hermes capabilities', () => {
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
      message: 'Inspect the repository.',
    }, {
      LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
      LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
    }, 'root-context');

    expect(projection.mcpServers).toHaveLength(1);
    const sessionConfig = (projection.sessionMeta.hermes as any).sessionConfig;
    expect(sessionConfig.enabledToolsets).toEqual([
      'hermes-acp',
      expect.stringMatching(/^mcp-main-runtime-/),
    ]);
    expect(sessionConfig).not.toHaveProperty('enabledTools');
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

  it('keeps Coder on Hermes native ACP capabilities regardless of Card-side native lists', () => {
    const projection = buildHermesHostSessionProjection({
      sessionKey: 'coder-session-1',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'coder-run-1',
      cardId: 'card_local_coder',
      title: 'Coder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
      prompt: 'Saved Coder prompt',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
      accessMode: 'chatgpt-account',
      tools: ['cbm.search_graph', 'cbm.trace_path'],
      nativeTools: ['delegate_task', 'terminal', 'read_file', 'python'],
      skills: ['software-development/test-driven-development'],
      toolsets: ['memory', 'delegation', 'skills', 'terminal', 'file', 'code_execution'],
      mcpConnectionIds: [],
      message: 'Inspect one symbol.',
    }, {
      LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
      LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
    }, 'coder-context');

    const sessionConfig = (projection.sessionMeta.hermes as any).sessionConfig;
    expect(sessionConfig.enabledToolsets).toEqual([
      'hermes-acp',
      expect.stringMatching(/^mcp-main-runtime-/),
    ]);
    expect(sessionConfig).not.toHaveProperty('enabledTools');
    expect(sessionConfig.executionContextId).toBe('coder-context');
  });
});
