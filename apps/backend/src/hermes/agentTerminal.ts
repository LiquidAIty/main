import { randomUUID, createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn as spawnPty, type IPty } from 'node-pty';
import type { AgentCardInstance, DeckDocument } from '../types';
import { resolveRepoRoot } from '../services/workspaceRoot';
import { resolvePythonAgentMcpServerSpec } from '../services/mcp/pythonAgentMcpClient';
import { resolveSavedMcpConnections } from './mcpConnections';

export type AgentTerminalOwner = { userId: string; projectId: string; deckId: string; cardId: string };
export type AgentTerminalState = {
  sessionId: string; cardId: string; profile: string; pid: number; ptyId: string;
  status: 'running' | 'exited' | 'failed'; cols: number; rows: number;
  exitCode?: number; error?: string; replayTruncated?: boolean;
};
type Output = { sequence: number; data: string };
type Listener = (event: 'output' | 'state', value: Output | AgentTerminalState) => void;
type Launch = { file: string; args: string[]; cwd: string; env: Record<string, string>; profile: string };
type Session = {
  owner: AgentTerminalOwner; fingerprint: string; state: AgentTerminalState;
  pty: IPty; output: Output[]; outputBytes: number; sequence: number; listeners: Set<Listener>;
};

export function agentTerminalFingerprint(card: AgentCardInstance, deck: DeckDocument): string {
  return createHash('sha256').update(JSON.stringify({
    id: card.id, runtime: card.runtime, options: card.runtimeOptions, prompt: card.prompt,
    tools: card.tools, workspace: deck.workspaceRoot,
  })).digest('hex');
}

export function requireAgentTerminalCard(card: AgentCardInstance, deck: DeckDocument): string {
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  const profile = card.runtime.profile;
  if (card.id === 'card_main_chat' || card.id === 'builder'
    || ['main', 'liquidaity-main', 'builder', 'default'].includes(profile)) {
    throw new Error('agent_terminal_card_excluded');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) throw new Error('agent_terminal_profile_missing');
  if (deck.nodes.some((other) => other.id !== card.id && other.runtime.kind === 'hermes'
    && other.runtime.profile === profile)) throw new Error('agent_terminal_profile_shared');
  const options = card.runtimeOptions as Record<string, unknown> | undefined;
  if (options?.enabled === false) throw new Error('agent_terminal_card_disabled');
  return profile;
}

function list(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('agent_terminal_saved_selection_invalid');
  }
  return [...new Set(value as string[])];
}

/** Materialize only this saved Card's process arguments and environment. No profile writes. */
export function prepareAgentTerminal(
  owner: AgentTerminalOwner, card: AgentCardInstance, deck: DeckDocument, sessionId: string,
): Launch {
  const profile = requireAgentTerminalCard(card, deck);
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  const root = resolveRepoRoot();
  const file = path.join(root, 'Hermes', 'venv', 'Scripts', 'hermes.exe');
  if (!existsSync(file)) throw new Error('agent_terminal_native_executable_missing');
  const profileHome = path.join(root, 'Hermes', '.hermes', 'profiles', profile);
  if (!existsSync(path.join(profileHome, 'config.yaml'))) throw new Error('agent_terminal_profile_missing');
  if (!deck.workspaceRoot || !path.isAbsolute(deck.workspaceRoot)
    || !existsSync(deck.workspaceRoot) || !statSync(deck.workspaceRoot).isDirectory()) {
    throw new Error('agent_terminal_saved_workspace_missing');
  }
  const cwd = realpathSync(deck.workspaceRoot);
  const options = card.runtimeOptions as Record<string, unknown> | undefined;
  const model = options?.providerModelId;
  const provider = options?.provider === 'openai' && options?.accessMode === 'chatgpt-account'
    ? 'openai-codex' : options?.provider;
  if (typeof model !== 'string' || !model || typeof provider !== 'string' || !provider) {
    throw new Error('agent_terminal_saved_model_missing');
  }
  if (typeof card.prompt !== 'string' || !card.prompt.trim()) throw new Error('agent_terminal_saved_prompt_missing');
  if (options?.script && (options.script as { enabled?: boolean }).enabled) {
    throw new Error('agent_terminal_native_script_binding_unavailable');
  }
  if (options?.toolCatalogPolicy === 'all_healthy') {
    throw new Error('agent_terminal_live_catalog_selection_unavailable');
  }
  const disabled = new Set(list(options?.disabledTools));
  const tools = list(options?.tools ?? card.tools).filter((name) => !disabled.has(name));
  const nativeTools = list(options?.nativeTools).filter((name) => !disabled.has(name));
  if (tools.includes('web_search') && !nativeTools.includes('web_search')) nativeTools.push('web_search');
  const mcpTools = tools.filter((name) => name !== 'web_search');
  const servers: Record<string, Record<string, unknown>> = {};
  if (mcpTools.length) {
    const server = resolvePythonAgentMcpServerSpec({
      kind: 'agent-terminal', projectId: owner.projectId, deckId: owner.deckId,
      callerCardId: owner.cardId, terminalSessionId: sessionId,
      profile, callerRuntimeKind: 'hermes', callerRuntimeMode: card.runtime.mode,
      grantedTools: mcpTools, presentedTools: mcpTools,
    });
    servers.agent_terminal = { url: server.url, headers: server.headers, lazy: false };
  }
  const toolsets = list(options?.toolsets);
  for (const connection of resolveSavedMcpConnections(list(options?.mcpConnectionIds))) {
    if (connection.name === 'agent_terminal') throw new Error('agent_terminal_mcp_name_collision');
    servers[connection.name] = 'url' in connection
      ? { url: connection.url, headers: Object.fromEntries(connection.headers.map((entry) => [entry.name, entry.value])), lazy: false }
      : { command: connection.command, args: connection.args, env: Object.fromEntries(connection.env.map((entry) => [entry.name, entry.value])), lazy: false };
    toolsets.push(`mcp-${connection.name}`);
  }
  // OS/process plumbing is inherited; another runtime's selectors and bearer are not.
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
    'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH',
    'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'LANG', 'LC_ALL']) {
    if (process.env[name] !== undefined) env[name] = process.env[name]!;
  }
  Object.assign(env, {
    HERMES_HOME: profileHome, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', TERM: 'xterm-256color',
    HERMES_EPHEMERAL_SYSTEM_PROMPT: card.prompt,
    HERMES_AGENT_TERMINAL_CONFIG: JSON.stringify({
      cardId: card.id, profile, profileHome, toolsets, nativeTools,
      mcpTools: mcpTools.map((name) => `mcp__agent_terminal__${name.replace(/[^A-Za-z0-9_]/g, '_')}`),
    }),
  });
  if (Object.keys(servers).length) env.HERMES_MCP_SERVERS = JSON.stringify(servers);
  const args = ['-p', profile, 'chat', '--cli', '--in', cwd, '--model', model,
    '--provider', provider, '--toolsets', 'agent-terminal'];
  if (options?.reasoningEffort) args.push('--reasoning', String(options.reasoningEffort));
  if (options?.maxTurns != null) args.push('--max-turns', String(options.maxTurns));
  const skills = list(options?.skills);
  if (skills.length) args.push('--skills', skills.join(','));
  return { file, args, cwd, env, profile };
}

export class AgentTerminalManager {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly spawn: typeof spawnPty = spawnPty,
    private readonly prepare = prepareAgentTerminal) {}

  open(owner: AgentTerminalOwner, card: AgentCardInstance, deck: DeckDocument, cols: number, rows: number): AgentTerminalState {
    const profile = requireAgentTerminalCard(card, deck);
    const fingerprint = agentTerminalFingerprint(card, deck);
    for (const session of this.sessions.values()) {
      if (session.state.status !== 'running') continue;
      if (session.state.profile !== profile) continue;
      if (JSON.stringify(session.owner) !== JSON.stringify(owner)) throw new Error('agent_terminal_profile_in_use');
      if (session.fingerprint !== fingerprint) throw new Error('agent_terminal_configuration_changed_stop_required');
      return { ...session.state };
    }
    for (const [id, session] of this.sessions) {
      if (this.sessions.size < 32) break;
      if (session.state.status !== 'running' && !session.listeners.size) this.sessions.delete(id);
    }
    if (this.sessions.size >= 32) throw new Error('agent_terminal_session_limit');
    const sessionId = randomUUID();
    const launch = this.prepare(owner, card, deck, sessionId);
    const pty = this.spawn(launch.file, launch.args, { name: 'xterm-256color', cols, rows,
      cwd: launch.cwd, env: launch.env, useConpty: true });
    const session: Session = {
      owner: { ...owner }, fingerprint, pty,
      state: { sessionId, cardId: card.id, profile, pid: pty.pid, ptyId: sessionId,
        status: 'running', cols, rows },
      output: [], outputBytes: 0, sequence: 0, listeners: new Set(),
    };
    this.sessions.set(sessionId, session);
    pty.onData((data) => {
      const output = { sequence: ++session.sequence, data };
      session.output.push(output);
      session.outputBytes += Buffer.byteLength(data);
      while (session.outputBytes > 2 * 1024 * 1024 && session.output.length) {
        session.outputBytes -= Buffer.byteLength(session.output.shift()!.data);
        session.state.replayTruncated = true;
      }
      for (const listener of session.listeners) listener('output', output);
    });
    pty.onExit(({ exitCode }) => {
      session.state.status = exitCode === 0 ? 'exited' : 'failed';
      session.state.exitCode = exitCode;
      for (const listener of session.listeners) listener('state', { ...session.state });
    });
    return { ...session.state };
  }

  private owned(owner: AgentTerminalOwner, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || JSON.stringify(session.owner) !== JSON.stringify(owner)) throw new Error('agent_terminal_session_not_found');
    return session;
  }
  state(owner: AgentTerminalOwner, id: string) { return { ...this.owned(owner, id).state }; }
  verifyConfiguration(owner: AgentTerminalOwner, id: string, card: AgentCardInstance, deck: DeckDocument) {
    if (this.owned(owner, id).fingerprint !== agentTerminalFingerprint(card, deck)) {
      throw new Error('agent_terminal_configuration_changed_stop_required');
    }
  }
  input(owner: AgentTerminalOwner, id: string, data: string) {
    const session = this.owned(owner, id);
    if (session.state.status !== 'running') throw new Error('agent_terminal_not_running');
    session.pty.write(data);
  }
  resize(owner: AgentTerminalOwner, id: string, cols: number, rows: number) {
    const session = this.owned(owner, id);
    if (session.state.status !== 'running') throw new Error('agent_terminal_not_running');
    session.pty.resize(cols, rows);
    Object.assign(session.state, { cols, rows });
    return { ...session.state };
  }
  stop(owner: AgentTerminalOwner, id: string) {
    const session = this.owned(owner, id);
    if (session.state.status === 'running') session.pty.kill();
  }
  subscribe(owner: AgentTerminalOwner, id: string, after: number, listener: Listener): () => void {
    const session = this.owned(owner, id);
    for (const output of session.output) if (output.sequence > after) listener('output', output);
    listener('state', { ...session.state });
    if (session.listeners.size >= 8) throw new Error('agent_terminal_connection_limit');
    session.listeners.add(listener);
    return () => { session.listeners.delete(listener); };
  }
  stopAll() {
    for (const session of this.sessions.values()) if (session.state.status === 'running') session.pty.kill();
  }
}

export const agentTerminalManager = new AgentTerminalManager();
