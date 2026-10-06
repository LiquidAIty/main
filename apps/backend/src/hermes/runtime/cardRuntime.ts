import type { IPty } from 'node-pty';
import type { AgentCardInstance, DeckDocument } from '../../types';
import type { HermesCardTools } from '../cardToolsPlugin';
import type { HermesProfileSelection } from '../profileMaterialization';
import type { HermesProviderSelection } from '../providerSelection';
import type {
  HermesProcessHandle,
  HermesRuntimeClient,
  HermesRuntimeEvent,
} from './hermesProcess';
import {
  recordHermesStoredSession,
  resolveHermesSession,
  type HermesSessionBinding,
} from './hermesSession';

export type CardRuntimeOwner = {
  userId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId?: string;
};

export type CardRuntimeState = {
  sessionId: string;
  cardId: string;
  profile: string;
  pid: number;
  gatewayPid: number;
  tuiPid: number | null;
  ptyId: string | null;
  hermesSessionId: string;
  storedSessionId: string;
  completedTurnGeneration: number;
  completedHermesRunId: string | null;
  hermesHome: string;
  unavailableToolReasons: Record<string, string>;
  status: 'running' | 'exited' | 'failed';
  cols: number;
  rows: number;
  exitCode?: number;
  error?: string;
  replayTruncated?: boolean;
};

export type CardRuntimeLaunch = {
  file: string;
  gatewayArgs: string[];
  tuiArgs: string[];
  cwd: string;
  env: Record<string, string>;
  profile: string;
  profileHome: string;
  profileSelection: HermesProfileSelection;
  providerSelection: HermesProviderSelection;
};

export type CardTerminalOutput = { sequence: number; data: string };
export type CardTerminalListener = (
  event: 'output' | 'state',
  value: CardTerminalOutput | CardRuntimeState,
) => void;

export type CardRuntimeConfiguration = {
  owner: CardRuntimeOwner;
  card: AgentCardInstance;
  deck: DeckDocument;
  fingerprint: string;
  profileCardFingerprint: string;
  state: CardRuntimeState;
  process: HermesProcessHandle;
  gatewayUrl: string;
  client: HermesRuntimeClient;
  gatewayToken: string;
  gatewayKeyId: string;
  cardTools: HermesCardTools;
  launch: CardRuntimeLaunch;
  onRunExit: (sessionId: string) => Promise<void>;
};

function sameOwner(left: CardRuntimeOwner, right: CardRuntimeOwner): boolean {
  return left.userId === right.userId
    && left.projectId === right.projectId
    && left.deckId === right.deckId
    && left.cardId === right.cardId;
}

export class CardRuntime {
  readonly owner: CardRuntimeOwner;
  readonly card: AgentCardInstance;
  readonly deck: DeckDocument;
  readonly fingerprint: string;
  readonly profileCardFingerprint: string;
  readonly process: HermesProcessHandle;
  readonly gatewayUrl: string;
  readonly client: HermesRuntimeClient;
  readonly gatewayToken: string;
  readonly gatewayKeyId: string;
  cardTools: HermesCardTools;
  readonly launch: CardRuntimeLaunch;
  readonly priorStoredSessionIds = new Map<string, number>();
  readonly cardToolNonces = new Map<string, number>();
  readonly output: CardTerminalOutput[] = [];
  readonly listeners = new Set<CardTerminalListener>();
  readonly gatewayEventListeners = new Set<(event: HermesRuntimeEvent) => void>();
  readonly hermesTurnSettlementWaiters = new Set<(settled: boolean) => void>();
  readonly sessionBindings = new Map<string, HermesSessionBinding>();
  readonly onRunExit: (sessionId: string) => Promise<void>;
  state: CardRuntimeState;
  pty: IPty | null = null;
  outputBytes = 0;
  sequence = 0;
  stopping = false;
  turnTail: Promise<void> = Promise.resolve();
  hermesTurnSettled = true;
  detachGatewayEvents: () => void = () => {};

  constructor(configuration: CardRuntimeConfiguration) {
    this.owner = { ...configuration.owner };
    this.card = structuredClone(configuration.card);
    this.deck = structuredClone(configuration.deck);
    this.fingerprint = configuration.fingerprint;
    this.profileCardFingerprint = configuration.profileCardFingerprint;
    this.state = { ...configuration.state };
    this.process = configuration.process;
    this.gatewayUrl = configuration.gatewayUrl;
    this.client = configuration.client;
    this.gatewayToken = configuration.gatewayToken;
    this.gatewayKeyId = configuration.gatewayKeyId;
    this.cardTools = configuration.cardTools;
    this.launch = configuration.launch;
    this.onRunExit = configuration.onRunExit;
    this.sessionBindings.set(this.sessionKey(this.owner), {
      sessionId: this.state.hermesSessionId,
      storedSessionId: this.state.storedSessionId,
    });
  }

  owns(owner: CardRuntimeOwner): boolean {
    return sameOwner(this.owner, owner);
  }

  snapshot(owner?: CardRuntimeOwner): CardRuntimeState {
    if (owner && !this.owns(owner)) throw new Error('card_runtime_not_found');
    const binding = owner ? this.sessionBindings.get(this.sessionKey(owner)) : undefined;
    return binding ? {
      ...this.state,
      hermesSessionId: binding.sessionId,
      storedSessionId: binding.storedSessionId,
    } : { ...this.state };
  }

  async ensureSession(owner: CardRuntimeOwner): Promise<HermesSessionBinding> {
    if (!this.owns(owner)) throw new Error('card_runtime_not_found');
    const key = this.sessionKey(owner);
    const existing = this.sessionBindings.get(key);
    if (existing) return { ...existing };
    const reasoningEffort = String(
      (this.card.runtimeOptions as Record<string, unknown> | undefined)?.reasoningEffort || '',
    ).trim();
    const binding = await resolveHermesSession(this.client, owner, {
      profile: this.launch.profile,
      cwd: this.launch.cwd,
      cols: this.state.cols,
      model: this.launch.providerSelection.model,
      provider: this.launch.providerSelection.provider,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
    this.sessionBindings.set(key, binding);
    return { ...binding };
  }

  ownsHermesSession(sessionId: string): boolean {
    return [...this.sessionBindings.values()].some((binding) => binding.sessionId === sessionId);
  }

  recordStoredSession(sessionId: string, storedSessionId: string): void {
    for (const [key, binding] of this.sessionBindings) {
      if (binding.sessionId !== sessionId) continue;
      if (sessionId === this.state.hermesSessionId) {
        recordHermesStoredSession(this.state, this.priorStoredSessionIds, storedSessionId);
        this.sessionBindings.set(key, {
          sessionId,
          storedSessionId: this.state.storedSessionId,
        });
      } else if (storedSessionId.trim()) {
        this.sessionBindings.set(key, { sessionId, storedSessionId: storedSessionId.trim() });
      }
      return;
    }
  }

  private sessionKey(owner: CardRuntimeOwner): string {
    return JSON.stringify([
      owner.userId,
      owner.projectId,
      owner.deckId,
      owner.cardId,
      owner.conversationId || 'card',
    ]);
  }

  requireRunning(owner?: CardRuntimeOwner): CardRuntime {
    this.snapshot(owner);
    if (this.state.status !== 'running') throw new Error('card_runtime_not_running');
    return this;
  }

  verifyFingerprint(expected: string): void {
    if (this.fingerprint !== expected) {
      throw new Error('card_runtime_configuration_changed_stop_required');
    }
  }

  async interrupt(owner: CardRuntimeOwner): Promise<void> {
    this.requireRunning(owner);
    const binding = await this.ensureSession(owner);
    await this.client.request('session.interrupt', {
      session_id: binding.sessionId,
      profile: this.state.profile,
    });
  }

  stop(): void {
    if (this.state.status !== 'running') return;
    this.stopping = true;
    this.state.status = 'exited';
    this.detachGatewayEvents();
    this.gatewayEventListeners.clear();
    for (const settle of [...this.hermesTurnSettlementWaiters]) settle(false);
    this.priorStoredSessionIds.clear();
    this.cardToolNonces.clear();
    try { this.pty?.kill(); } catch {}
    this.pty = null;
    this.state.tuiPid = null;
    this.state.ptyId = null;
    this.process.stop();
    void this.onRunExit(this.state.sessionId).catch((error) => {
      this.state.error = String(error);
      this.emitState();
    });
    this.emitState();
  }

  processExited(exitCode: number | null): void {
    if (this.state.status !== 'running') return;
    this.state.status = this.stopping && (exitCode === 0 || exitCode === null)
      ? 'exited'
      : 'failed';
    this.state.exitCode = exitCode ?? undefined;
    if (!this.stopping) this.state.error = `hermes_process_exited:${exitCode ?? 'null'}`;
    this.detachGatewayEvents();
    this.gatewayEventListeners.clear();
    this.priorStoredSessionIds.clear();
    this.cardToolNonces.clear();
    try { this.pty?.kill(); } catch {}
    this.pty = null;
    this.state.tuiPid = null;
    this.state.ptyId = null;
    void this.onRunExit(this.state.sessionId).catch((error) => {
      this.state.error = String(error);
      this.emitState();
    });
    this.emitState();
  }

  transportClosed(): void {
    if (this.state.status !== 'running' || this.stopping) return;
    this.state.status = 'failed';
    this.state.error = 'hermes_transport_disconnected';
    this.detachGatewayEvents();
    this.gatewayEventListeners.clear();
    this.priorStoredSessionIds.clear();
    this.cardToolNonces.clear();
    try { this.pty?.kill(); } catch {}
    this.pty = null;
    this.state.tuiPid = null;
    this.state.ptyId = null;
    this.process.stop();
    void this.onRunExit(this.state.sessionId).catch((error) => {
      this.state.error = String(error);
      this.emitState();
    });
    this.emitState();
  }

  emitState(): void {
    for (const listener of this.listeners) listener('state', { ...this.state });
  }
}
