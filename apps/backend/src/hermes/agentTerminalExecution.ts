import { randomUUID } from 'node:crypto';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import { buildHermesHostSessionProjection, resolveHermesTurnArgs, type HermesTurnArgs } from './mainAdapter';
import { registerHermesRootExecutionContext, finishHermesExecutionContext } from './childExecutionContext';
import type { AgentTerminalOwner } from './agentTerminal';
import { handleHermesHostExecutionRequest, isHermesHostExecutionMethod } from './hostExecutionLifecycle';

/** Native CLI transport to the existing saved Card/IDF/Run authority. */
export class AgentTerminalExecution {
  private readonly active = new Map<string, {
    runId: string; contextId: string; nativeSessionId: string; started: number;
    closing?: boolean;
    script?: HermesTurnArgs['script']; presentedTools: string[];
  }>();
  private readonly preparing = new Map<string, { cancelled: boolean }>();
  private readonly children = new Map<string, Set<string>>();

  constructor(private readonly request = requestPythonRailsJson,
    private readonly catalog = listPythonAgentMcpCatalog) {}

  async begin(owner: AgentTerminalOwner, terminalSessionId: string, profile: string,
    payload: Record<string, unknown>) {
    if (this.active.has(terminalSessionId) || this.preparing.has(terminalSessionId)) {
      throw new Error('agent_terminal_turn_already_running');
    }
    const { message, nativeSessionId, model, provider } = payload;
    if (typeof message !== 'string' || !message.trim() || message.length > 512_000
      || typeof nativeSessionId !== 'string' || !nativeSessionId || nativeSessionId.length > 256) {
      throw new Error('agent_terminal_turn_input_invalid');
    }
    const preparation = { cancelled: false };
    this.preparing.set(terminalSessionId, preparation);
    let persistedRunId = '';
    let contextId = '';
    try {
      const runId = randomUUID();
      const prepared: any = await this.request('/domain/runs/begin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: owner.projectId, deckId: owner.deckId,
          cardId: owner.cardId, assignment: message, runId, correlationId: runId,
          discoveredTools: await this.catalog() }),
      });
      persistedRunId = String(prepared.runId || '');
      if (!persistedRunId) throw new Error('agent_terminal_run_not_persisted');
      if (preparation.cancelled) throw new Error('native_cli_process_exited');
      const args = resolveHermesTurnArgs({ prepared, projectId: owner.projectId,
        deckId: owner.deckId, conversationId: '', parentRunId: persistedRunId,
        onEvent: () => undefined }, prepared.hermesTransport);
      const nativeProvider = args.provider === 'openai' && args.accessMode === 'chatgpt-account'
        ? 'openai-codex' : args.provider;
      if (args.cardId !== owner.cardId || args.runtime.profile !== profile
        || args.providerModelId !== model || nativeProvider !== provider) {
        throw new Error('agent_terminal_native_configuration_mismatch');
      }
      args.sessionKey = JSON.stringify([owner.userId, owner.projectId, owner.deckId,
        owner.cardId, profile, terminalSessionId, nativeSessionId]);
      args.terminalOwner = { userId: owner.userId, terminalSessionId, profile,
        cardRevisionId: String(prepared.cardRevisionId || '') };
      const context = registerHermesRootExecutionContext({
        sessionId: nativeSessionId, runId: persistedRunId, projectId: owner.projectId,
        deckId: owner.deckId, conversationId: '', cardId: owner.cardId,
        runtimeMode: args.runtime.mode, terminalOwner: args.terminalOwner,
        grantedTools: (args.grantedTools || []).filter((name) => name !== 'web_search'),
      });
      contextId = context.contextId;
      const projection = buildHermesHostSessionProjection(args, process.env, contextId);
      this.active.set(terminalSessionId, { runId: persistedRunId, contextId,
        nativeSessionId, started: Date.now(), script: args.script, presentedTools: args.tools });
      return { runId: persistedRunId, executionContextId: contextId,
        message: args.message, mcpServers: projection.mcpServers,
        sessionConfig: (projection.sessionMeta as any).hermes.sessionConfig };
    } catch (error) {
      if (contextId) await finishHermesExecutionContext({ contextId, state: 'failed' });
      if (persistedRunId) await this.request('/domain/runs/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: persistedRunId, state: 'failed', errorSummary: String(error) }),
      });
      throw error;
    } finally { this.preparing.delete(terminalSessionId); }
  }

  async finish(terminalSessionId: string, payload: Record<string, unknown>) {
    const active = this.active.get(terminalSessionId);
    if (!active || active.closing || active.contextId !== payload.executionContextId) {
      throw new Error('agent_terminal_execution_context_mismatch');
    }
    const result = payload.result as Record<string, unknown> | undefined;
    const error = String(payload.error || result?.error || '');
    const failed = !!error || !result || result.failed === true || result.completed !== true;
    const nativeUsage = payload.usage as Record<string, unknown> | undefined;
    const usage = Object.fromEntries(['providerInputTokens', 'providerOutputTokens',
      'providerCachedTokens', 'providerReasoningTokens'].map((field) => [field,
      typeof nativeUsage?.[field] === 'number' && Number.isSafeInteger(nativeUsage[field]) && Number(nativeUsage[field]) >= 0
        ? nativeUsage[field] : null]));
    const scriptResult = payload.scriptExecution as Record<string, unknown> | undefined;
    active.closing = true;
    try {
      // Close authorization before awaiting persistence so a finishing turn
      // cannot dispatch another tool or attach another child.
      await finishHermesExecutionContext({ contextId: active.contextId,
        state: failed ? 'failed' : 'completed' });
      for (const contextId of this.children.get(terminalSessionId) || []) {
        await finishHermesExecutionContext({ contextId, state: 'cancelled',
          errorSummary: 'native_cli_parent_turn_finished', request: this.request });
      }
      await this.request('/domain/runs/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: active.runId, state: failed ? 'failed' : 'completed',
          errorSummary: failed ? error || 'native_cli_turn_incomplete' : undefined,
          finalResult: typeof result?.final_response === 'string' ? result.final_response : '',
          providerThreadRef: active.nativeSessionId, durationMs: Date.now() - active.started,
          ...usage, totalCostUsd: null,
          ...(active.script ? { cardScriptExecution: {
            schemaVersion: 'liquidaity.card-script.run-execution.v1', presentationMode: 'script',
            version: active.script.version, sourceHash: active.script.sourceHash, compiledHash: active.script.compiledHash,
            takenOverTools: active.script.scriptToolIds, toolStates: active.script.toolStates,
            orderedToolStages: active.script.toolHandles, presentedTools: active.presentedTools,
            executor: 'hermes-native-python-child', timeoutSeconds: active.script.timeoutSeconds,
            maxToolCalls: active.script.maxToolCalls, maxOutputBytes: active.script.maxOutputBytes,
            modelTool: { name: 'execute_host_script', invoked: scriptResult?.invoked === true },
            receipt: scriptResult?.receipt ?? null, fallback: scriptResult?.fallback ?? null,
          } } : {}) }),
      });
      return { ok: true, runId: active.runId };
    } finally {
      this.active.delete(terminalSessionId);
      this.children.delete(terminalSessionId);
    }
  }

  async host(terminalSessionId: string, payload: Record<string, unknown>) {
    const active = this.active.get(terminalSessionId);
    const params = payload.params as Record<string, unknown> | undefined;
    if (!active || active.closing || !isHermesHostExecutionMethod(payload.method) || !params) {
      throw new Error('agent_terminal_host_request_invalid');
    }
    const children = this.children.get(terminalSessionId) || new Set<string>();
    this.children.set(terminalSessionId, children);
    if (payload.method === 'session/create_execution_context') {
      if (params.sessionId !== active.nativeSessionId
        || (params.parentExecutionContextId !== active.contextId
          && !children.has(String(params.parentExecutionContextId)))) {
        throw new Error('agent_terminal_child_identity_mismatch');
      }
    } else if (!children.has(String(params.executionContextId))) {
      throw new Error('agent_terminal_child_identity_mismatch');
    }
    const result = await handleHermesHostExecutionRequest({ method: payload.method, params });
    if (active.closing && result.nativeContext) {
      await finishHermesExecutionContext({ contextId: result.nativeContext.contextId,
        state: 'cancelled', errorSummary: 'native_cli_parent_turn_finished', request: this.request });
      throw new Error('agent_terminal_parent_turn_finished');
    }
    if (result.nativeContext) children.add(result.nativeContext.contextId);
    return result.result;
  }

  async abort(terminalSessionId: string) {
    const preparation = this.preparing.get(terminalSessionId);
    if (preparation) preparation.cancelled = true;
    const active = this.active.get(terminalSessionId);
    if (active && !active.closing) await this.finish(terminalSessionId, {
      executionContextId: active.contextId, error: 'native_cli_process_exited',
    });
  }
}

export const agentTerminalExecution = new AgentTerminalExecution();
