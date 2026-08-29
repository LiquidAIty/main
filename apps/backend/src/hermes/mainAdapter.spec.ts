import { describe, expect, it, vi } from 'vitest';
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
    mcpConnectionIds: [],
    sessionKey: 'hermes:project-1:provider-free:card_main_chat',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'provider-free',
    parentRunId: 'provider-free-run',
    message: 'Return the bounded provider-free result.',
  };
}

function fakeAcpScript(exitAfterRegistration: boolean, holdTerminalTurn = false, holdConfiguration = false): string {
  return `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
let heldPromptId;
let heldConfigureId;
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
    ${holdConfiguration ? 'heldConfigureId = message.id; return;' : ''}
    return send({ jsonrpc: '2.0', id: message.id, result: {} });
  }
  if (method === '_session/delete_history') {
    return send({ jsonrpc: '2.0', id: message.id, result: { deleted: true } });
  }
  if (method === '_session/read_history') {
    return send({ jsonrpc: '2.0', id: message.id, result: { replayed: true } });
  }
  if (method === '_native/call') {
    if (heldConfigureId) {
      send({ jsonrpc: '2.0', id: heldConfigureId, ...(message.params?.failConfiguration
        ? { error: { code: -32000, message: 'fixture_configuration_failed' } } : { result: {} }) });
      heldConfigureId = undefined;
    }
    if (heldPromptId) {
      send({ jsonrpc: '2.0', id: heldPromptId, result: { stopReason: 'end_turn', _meta: { hermes: { finalAssistantText: 'provider-free terminal result' } } } });
      heldPromptId = undefined;
    }
    return send({ jsonrpc: '2.0', id: message.id, result: { method } });
  }
  if (method === 'session/prompt') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'provider-free-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'deterministic local status' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'provider-free-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'provider-free terminal result' }, _meta: { hermes: { messageSource: 'model' } } } } });
    ${holdTerminalTurn ? `
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'provider-free-session', update: { sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'read_file', rawInput: { path: 'example.ts' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'provider-free-session', update: { sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'failed', rawOutput: { error: 'missing_file' } } } });
    heldPromptId = message.id;
    return;
    ` : ''}
    return send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn', usage: { inputTokens: 11, outputTokens: 4 }, _meta: { hermes: { messageSource: 'model', finalAssistantText: 'provider-free terminal result' } } } });
  }
});
`;
}

function fakeHistoryAcpScript(exactSessionOnly = false): string {
  return `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let deleted = false;
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
rl.on('line', (line) => {
  const message = JSON.parse(line);
  const method = message.method;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
  if (method === 'session/list') {
    ${exactSessionOnly ? "return send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'must_use_stored_session_id' } });" : ''}
    const config = message.params?._meta?.hermes?.sessionConfig || {};
    const keys = Object.keys(config).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['hostSessionKey'])) {
      return send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'history_list_runtime_config_forbidden' } });
    }
    if ('mcpServers' in (message.params || {})) {
      return send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'history_list_mcp_forbidden' } });
    }
    return send({ jsonrpc: '2.0', id: message.id, result: { sessions: deleted ? [] : [{ sessionId: 'persisted-session' }] } });
  }
  if (method === '_session/read_history') {
    if (JSON.stringify(Object.keys(message.params || {}).sort()) !== JSON.stringify(['sessionId'])) {
      return send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'history_read_extra_fields_forbidden' } });
    }
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'persisted-session', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Earlier question.' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'persisted-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Earlier answer.' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'persisted-session', update: { sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'read_file', rawInput: { path: 'example.ts' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'persisted-session', update: { sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'failed', rawOutput: { error: 'missing_file' } } } });
    return send({ jsonrpc: '2.0', id: message.id, result: { replayed: true, sessionId: 'persisted-session', messageCount: 2 } });
  }
  if (method === '_session/delete_history') {
    if (JSON.stringify(Object.keys(message.params || {}).sort()) !== JSON.stringify(['sessionId'])) {
      return send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'history_delete_extra_fields_forbidden' } });
    }
    deleted = true;
    return send({ jsonrpc: '2.0', id: message.id, result: { deleted: true, sessionId: 'persisted-session' } });
  }
  if (method === 'session/load') {
    return send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'history_must_not_load_execution_session' } });
  }
});
`;
}

describe('Hermes ACP transport identity', () => {
  it('excludes transcript deletion throughout asynchronous native session configuration', async () => {
    const root = path.join(tmpdir(), `liquidaity-acp-configure-history-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    const owner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(false, false, true)] },
      hermesHome: root,
    });
    let completing: Promise<{ finalText: string }> | undefined;
    try {
      await owner.requestExtension('_native/call', { method: 'fixture_ready' });
      completing = owner.startTurn(providerFreeTurnArgs(0), () => undefined).then((handle) => handle.done);
      void completing.catch(() => undefined);
      await vi.waitFor(() => expect((owner as unknown as { lastProtocolEvent: string }).lastProtocolEvent)
        .toBe('request:_session/configure_host:write'), { timeout: 5000 });
      await expect(owner.startTurn({ ...providerFreeTurnArgs(0), parentRunId: 'another-run' }, () => undefined))
        .rejects.toThrow('hermes_session_turn_already_running');
      await expect(owner.readHistory({ sessionKey: '', sessionId: 'provider-free-session', profile: '' }))
        .rejects.toThrow('hermes_session_turn_already_running');
      await expect(owner.deleteHistory({ sessionKey: '', sessionId: 'provider-free-session', profile: '' }))
        .rejects.toThrow('hermes_session_turn_already_running');
      await owner.requestExtension('_native/call', { method: 'release_fixture_configuration' });
      expect((await completing).finalText).toBe('provider-free terminal result');
    } finally {
      owner.close();
      await completing?.catch(() => undefined);
      await owner.closed;
    }
  }, 15000);

  it.each(['host', 'turn'])('releases native configuration exclusion after a failed %s configuration', async (entry) => {
    const root = path.join(tmpdir(), `liquidaity-acp-configure-failure-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    const owner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(false, false, true)] },
      hermesHome: root,
    });
    const context = registerHermesRootExecutionContext({ sessionId: 'configuration-session',
      runId: 'configuration-run', projectId: 'project-1', deckId: 'deck_builder',
      conversationId: 'provider-free', cardId: 'card_main_chat', runtimeMode: 'kanban', grantedTools: [] });
    let configuring: Promise<unknown> | undefined;
    try {
      await owner.requestExtension('_native/call', { method: 'fixture_ready' });
      configuring = entry === 'host' ? owner.configureHostSession(providerFreeTurnArgs(0), context.contextId)
        : owner.startTurn(providerFreeTurnArgs(0), () => undefined);
      void configuring.catch(() => undefined);
      await vi.waitFor(() => expect((owner as unknown as { lastProtocolEvent: string }).lastProtocolEvent)
        .toBe('request:_session/configure_host:write'), { timeout: 5000 });
      const history = { sessionKey: '', sessionId: 'provider-free-session', profile: '' };
      await expect(owner.deleteHistory(history)).rejects.toThrow('hermes_session_turn_already_running');
      await owner.requestExtension('_native/call', { method: 'release_fixture_configuration', failConfiguration: true });
      await expect(configuring).rejects.toThrow('fixture_configuration_failed');
      await expect(owner.readHistory(history)).resolves.toEqual({ sessionId: history.sessionId, messages: [] });
    } finally {
      owner.close();
      await configuring?.catch(() => undefined);
      await owner.closed;
      await finishHermesExecutionContext({ contextId: context.contextId, state: 'cancelled' });
    }
  }, 15000);

  it('projects the existing active turn without replay, model/status confusion or another turn', async () => {
    const root = path.join(tmpdir(), `liquidaity-acp-terminal-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    const owner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(false, true)] },
      hermesHome: root,
    });
    try {
      const handle = await owner.startTurn(providerFreeTurnArgs(0), () => undefined);
      await vi.waitFor(() => expect(owner.readRunSnapshot('provider-free-run')?.tools).toHaveLength(1));
      const first = owner.readRunSnapshot('provider-free-run');
      expect(first).toMatchObject({ runId: 'provider-free-run', cardId: 'card_main_chat',
        fullText: 'provider-free terminal result', sessionId: 'provider-free-session',
        tools: [{ toolName: 'read_file', toolUseId: 'read-1', isError: true }],
      });
      expect(owner.readRunSnapshot('provider-free-run')).toEqual(first);
      expect(owner.readRunSnapshot('another-run')).toBeNull();
      expect(JSON.stringify(first)).not.toContain('deterministic local status');
      await owner.requestExtension('_native/call', { method: 'finish_fixture' });
      expect((await handle.done).finalText).toBe('provider-free terminal result');
      expect(owner.readRunSnapshot('provider-free-run')).toBeNull();
    } finally { owner.close(); await owner.closed; }
  });

  it('reuses native exact-session transcript read/delete and preserves structured tool errors', async () => {
    const root = path.join(tmpdir(), `liquidaity-acp-terminal-history-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    const owner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeHistoryAcpScript(true)] },
      hermesHome: root,
    });
    const args = { sessionKey: '', sessionId: 'persisted-session', profile: '', terminal: true };
    try {
      const history = await owner.readHistory(args);
      expect(history.events).toEqual([
        { kind: 'text', text: 'Earlier answer.' },
        expect.objectContaining({ kind: 'tool_start', toolUseId: 'read-1' }),
        expect.objectContaining({ kind: 'tool_result', toolUseId: 'read-1', isError: true }),
      ]);
      expect(JSON.stringify(history.events)).not.toContain('Earlier question');
      await expect(owner.deleteHistory(args)).resolves.toEqual({ sessionId: 'persisted-session', deleted: true });
    } finally { owner.close(); await owner.closed; }
  });

  it('reads native history without loading or configuring an execution session', async () => {
    const root = path.join(tmpdir(), `liquidaity-acp-history-${randomUUID()}`);
    const hermesHome = path.join(root, '.hermes');
    mkdirSync(hermesHome, { recursive: true });
    const owner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeHistoryAcpScript()] },
      hermesHome,
    });
    try {
      await expect(owner.readHistory({
        sessionKey: 'hermes:project-1:main:card_main_chat',
        profile: '',
      })).resolves.toEqual({
        sessionId: 'persisted-session',
        messages: [
          { role: 'user', text: 'Earlier question.' },
          { role: 'assistant', text: 'Earlier answer.' },
        ],
      });
    } finally {
      owner.close();
      await owner.closed;
    }
  });

  it('deletes the exact native history selected by the host session key', async () => {
    const root = path.join(tmpdir(), `liquidaity-acp-history-delete-${randomUUID()}`);
    const hermesHome = path.join(root, '.hermes');
    mkdirSync(hermesHome, { recursive: true });
    const owner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeHistoryAcpScript()] },
      hermesHome,
    });
    const args = {
      sessionKey: 'hermes:project-1:main:card_main_chat',
      profile: '',
    };
    try {
      await expect(owner.deleteHistory(args)).resolves.toEqual({
        sessionId: 'persisted-session',
        deleted: true,
      });
      await expect(owner.readHistory(args)).resolves.toEqual({
        sessionId: null,
        messages: [],
      });
    } finally {
      owner.close();
      await owner.closed;
    }
  });

  it('permits only the one bounded native manager pass-through', async () => {
    const root = path.join(tmpdir(), `liquidaity-acp-${randomUUID()}`);
    const hermesHome = path.join(root, '.hermes');
    mkdirSync(hermesHome, { recursive: true });
    const processOwner = new AcpProcess(() => undefined, {
      install: { root, executable: process.execPath, args: ['-e', fakeAcpScript(false)] },
      hermesHome,
    });
    try {
      await expect(processOwner.requestExtension('_native/call', {
        method: 'profiles.describe', params: { name: 'coder' },
      })).resolves.toEqual({ method: '_native/call' });
      await expect(processOwner.requestExtension('_native/apply', {}))
        .rejects.toThrow('hermes_acp_extension_method_invalid');
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
      let prematureError: unknown;
      try {
        await premature.startTurn(providerFreeTurnArgs(), () => undefined);
      } catch (error) {
        prematureError = error;
      }
      expect(prematureError).toBeInstanceOf(Error);
      expect((prematureError as Error).message).toMatch(
        /hermes_acp_exited:0:none:explicit=no:last=request:session\/new:write/,
      );
      expect((prematureError as Error).message).not.toContain('registered 57 tool(s)');
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
      const events: Array<{ kind: string; text?: string }> = [];
      const handle = await startHermesTurnWithOnePrePromptRecovery(
        providerFreeTurnArgs(),
        (event) => events.push(event),
        () => {
          const next = queue.shift();
          if (!next) throw new Error('unexpected_third_acp_attempt');
          return next;
        },
        async () => ({
          name: 'liquidaity-main',
          toolsets: [],
          mcp_servers: [],
        }),
      );
      const result = await handle.done;
      expect(queue).toHaveLength(0);
      expect(result.finalText).toBe('provider-free terminal result');
      expect(result.usage).toMatchObject({ providerInputTokens: 11, providerOutputTokens: 4 });
      expect(events.map((event) => event.kind)).toContain('done');
      expect(events.filter((event) => event.kind === 'text').map((event) => event.text)).toEqual([
        'provider-free terminal result',
      ]);
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

  it('uses the same profile home and memory DB for direct/team runs while isolating other Cards', async () => {
    const fakeRoot = path.join(tmpdir(), `liquidaity-acp-profile-home-${randomUUID()}`);
    const hermesHome = path.join(fakeRoot, '.hermes');
    mkdirSync(path.join(hermesHome, 'profiles', 'coder'), { recursive: true });
    mkdirSync(path.join(hermesHome, 'profiles', 'research'), { recursive: true });
    const install = {
      root: fakeRoot,
      executable: process.execPath,
      args: ['-e', fakeAcpScript(false)],
    };
    const directOwner = new AcpProcess(() => undefined, { install, hermesHome, profile: 'coder' });
    const teamOwner = new AcpProcess(() => undefined, { install, hermesHome, profile: 'coder' });
    const otherCardOwner = new AcpProcess(() => undefined, {
      install, hermesHome, profile: 'research',
    });
    const owners = [directOwner, teamOwner, otherCardOwner];
    try {
      expect(directOwner.hermesHome).toBe(path.join(hermesHome, 'profiles', 'coder'));
      expect(teamOwner.hermesHome).toBe(directOwner.hermesHome);
      expect(path.join(teamOwner.hermesHome, 'memory_store.db')).toBe(
        path.join(directOwner.hermesHome, 'memory_store.db'),
      );
      expect(otherCardOwner.hermesHome).toBe(path.join(hermesHome, 'profiles', 'research'));
      expect(path.join(otherCardOwner.hermesHome, 'memory_store.db')).not.toBe(
        path.join(directOwner.hermesHome, 'memory_store.db'),
      );
      await expect(directOwner.requestExtension('_native/call', {
        method: 'profiles.describe', params: { name: 'coder' },
      })).resolves.toEqual({ method: '_native/call' });
      await expect(teamOwner.requestExtension('_native/call', {
        method: 'profiles.describe', params: { name: 'coder' },
      })).resolves.toEqual({ method: '_native/call' });
      await expect(otherCardOwner.requestExtension('_native/call', {
        method: 'profiles.describe', params: { name: 'research' },
      })).resolves.toEqual({ method: '_native/call' });
    } finally {
      for (const owner of owners) {
        owner.close();
        await owner.closed;
      }
    }
  });

  it('derives one transport session key from resolved identities', () => {
    expect(deriveHermesSessionKey('project-1', 'conversation-1', 'card_main_chat')).toBe(
      'hermes:project-1:conversation-1:card_main_chat',
    );
  });

  it('materializes one saved Card subagent model into native delegation and background review before inference', async () => {
    const startTurn = vi.fn(async (args: any) => ({ args }));
    const acquire = vi.fn(() => ({ startTurn }) as never);
    const readNative = vi.fn()
      .mockResolvedValueOnce({
        name: 'liquidaity-main',
        subagent_model: { provider: '', model: '' },
        background_review: { enabled: false, provider: 'auto', model: '' },
        toolsets: [],
        mcp_servers: [],
      })
      .mockResolvedValueOnce({
        name: 'liquidaity-main',
        subagent_model: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
        background_review: {
          enabled: true,
          provider: 'openai-codex',
          model: 'gpt-5.6-luna',
          max_input_tokens: 120_000,
        },
        toolsets: [],
        mcp_servers: [],
      });
    const configure = vi.fn(async () => ({
      ok: true,
      applied: { subagent_model: true, background_review: true },
    }));
    const saved = {
      provider: 'openai',
      accessMode: 'chatgpt-account' as const,
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
    };

    await startHermesTurnWithOnePrePromptRecovery(
      { ...providerFreeTurnArgs(0), subagentModel: saved },
      () => undefined,
      acquire,
      readNative,
      configure,
    );

    expect(configure).toHaveBeenCalledWith('liquidaity-main', {
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
    });
    expect(readNative).toHaveBeenCalledTimes(2);
    expect(startTurn.mock.calls[0][0].effectiveSubagentModel).toEqual({
      desired: saved,
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      fallbackOccurred: false,
      fallbackReason: null,
    });
  });

  it('requires visible completion text from the Hermes loop', () => {
    expect(requireHermesCompletionText('answer')).toBe('answer');
    expect(() => requireHermesCompletionText('  ')).toThrow('hermes_empty_completion');
    expect(() => requireHermesCompletionText('')).toThrow('hermes_empty_completion');
  });

  it('does not report a completed Run after a Card-authorized effect failed', () => {
    expect(() => {
      requireHermesEffectSuccess(
        ['constellation.remember'],
        [{ toolName: 'constellation.remember', toolUseId: 'tool-1', isError: true }],
      );
      requireHermesCompletionText('I answered even though the required write failed.');
    }).toThrow('hermes_required_effect_failed:constellation.remember');
    expect(() => requireHermesEffectSuccess(
      ['constellation.remember'],
      [{ toolName: 'constellation.remember', toolUseId: 'tool-1', isError: false }],
    )).not.toThrow();
  });

  it('maps one Hermes MCP runtime name back to its exact Card effect grant', () => {
    const effects = new Set(['constellation.remember', 'card.run_assistant_agent']);
    expect(resolveHermesEffectToolName(
      effects,
      'mcp__main_runtime_3b25e34a0e05__constellation_remember',
    )).toBe('constellation.remember');
    expect(resolveHermesEffectToolName(effects, 'constellation.remember')).toBe('constellation.remember');
    expect(resolveHermesEffectToolName(effects, 'constellation.inspect')).toBe('constellation.inspect');
  });

  it('does not guess when normalized Card effect names are ambiguous', () => {
    const effects = new Set(['example.a_b', 'example_a.b']);
    const reported = 'mcp__runtime__example_a_b';
    expect(resolveHermesEffectToolName(effects, reported)).toBe(reported);
  });

  it('keeps optional readable-tool failures separate from required effects', () => {
    expect(() => requireHermesEffectSuccess(
      ['constellation.remember'],
      [{ toolName: 'constellation.inspect', toolUseId: 'tool-1', isError: true }],
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
      await owner.closed;
      if (previousSecret === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
      else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = previousSecret;
      if (previousUrl === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_URL;
      else process.env.LIQUIDAITY_INTERNAL_MCP_URL = previousUrl;
    }
  });

  it('adds one selected Card MCP surface without injecting native ACP defaults', () => {
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
      mcpConnectionIds: [],
      message: 'Inspect the repository.',
    }, {
      LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
      LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
    }, 'root-context');

    expect(projection.mcpServers).toHaveLength(1);
    const sessionConfig = (projection.sessionMeta.hermes as any).sessionConfig;
    expect(sessionConfig.enabledToolsets).toEqual([
      expect.stringMatching(/^mcp-main-runtime-/),
    ]);
    expect(sessionConfig.enabledTools).toEqual([]);
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

  it('preserves explicitly selected native profile capabilities for Coder', () => {
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
      mcpConnectionIds: [],
      nativeProfileToolsets: ['terminal', 'file'],
      nativeTools: ['read_file'],
      message: 'Inspect one symbol.',
    }, {
      LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
      LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
    }, 'coder-context');

    const sessionConfig = (projection.sessionMeta.hermes as any).sessionConfig;
    expect(sessionConfig.enabledToolsets).toEqual([
      'terminal', 'file',
      expect.stringMatching(/^mcp-main-runtime-/),
    ]);
    expect(sessionConfig.enabledTools).toEqual(['read_file']);
    expect(sessionConfig.executionContextId).toBe('coder-context');
  });

  it('keeps an empty native and Card selection empty', () => {
    const projection = buildHermesHostSessionProjection({
      ...providerFreeTurnArgs(), tools: [], mcpConnectionIds: [],
      nativeTools: [], toolsets: [], nativeProfileToolsets: [], nativeProfileMcpServerNames: [],
    }, {});
    expect(projection.mcpServers).toEqual([]);
    expect((projection.sessionMeta.hermes as any).sessionConfig.enabledTools).toEqual([]);
    expect((projection.sessionMeta.hermes as any).sessionConfig.enabledToolsets).toEqual([]);
  });
});
