import { spawn as spawnPty } from 'node-pty';
import type { AgentCardInstance, DeckDocument } from '../types';
import type {
  CardRuntimeOwner,
  CardRuntimeState,
  CardTerminalListener,
} from './runtime/cardRuntime';
import { CardTerminal } from './runtime/cardTerminal';
import {
  CardRuntimeManager,
  cardRuntimeFingerprint,
  cardRuntimeManager,
  cardRuntimeWorkingDirectory,
  prepareCardRuntime,
  requireCardRuntimeCard,
  type CardRuntimeGatewayEvent,
  type CardRuntimeOpenOptions,
} from './cardRuntimeManager';
import type {
  DesiredBotProfile,
  DesiredCardRuntime,
} from './runtime/cardRuntimeReconciler';
import type {
  SessionCompactionIdentity,
  SessionCompactionReceipt,
} from './runtime/hermesSessionMaintenance';

export type AgentTerminalOwner = CardRuntimeOwner;
export type AgentTerminalState = CardRuntimeState;
export type AgentTerminalGatewayEvent = CardRuntimeGatewayEvent;
export type AgentTerminalCompactionIdentity = SessionCompactionIdentity;
export type AgentTerminalCompactionReceipt = SessionCompactionReceipt;
export type AgentTerminalLaunch = ReturnType<typeof prepareCardRuntime>;

export type AgentTerminalVoiceState = {
  enabled: boolean;
  tts: boolean;
  available: boolean | null;
  audioAvailable: boolean | null;
  sttAvailable: boolean | null;
  details: string;
  recordStatus?: 'recording' | 'stopped';
};

export type AgentTerminalOpenOptions = CardRuntimeOpenOptions & {
  attachTui?: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Terminal presentation is available only to CLI-capable Card modes. */
export function requireAgentTerminalCard(card: AgentCardInstance, deck: DeckDocument): string {
  const profile = requireCardRuntimeCard(card, deck);
  if (!['delegate', 'magentic_one'].includes(card.runtime.mode)) {
    throw new Error('agent_terminal_runtime_mode_unsupported');
  }
  return profile;
}

export function agentTerminalPresentationOptions(
  card: AgentCardInstance,
  attachTui: boolean,
): AgentTerminalOpenOptions {
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  if (!['delegate', 'magentic_one'].includes(card.runtime.mode)) {
    throw new Error('agent_terminal_runtime_mode_unsupported');
  }
  return {
    ...(cardRuntimeWorkingDirectory(card)
      ? { workingDirectory: cardRuntimeWorkingDirectory(card) }
      : {}),
    attachTui,
  };
}

export function prepareAgentTerminal(
  owner: AgentTerminalOwner,
  card: AgentCardInstance,
  deck: DeckDocument,
  sessionId: string,
  workingDirectory?: string,
): AgentTerminalLaunch {
  requireAgentTerminalCard(card, deck);
  return prepareCardRuntime(owner, card, deck, sessionId, workingDirectory);
}

export function agentTerminalFingerprint(
  owner: AgentTerminalOwner,
  card: AgentCardInstance,
  deck: DeckDocument,
  workingDirectory?: string,
): string {
  requireAgentTerminalCard(card, deck);
  return cardRuntimeFingerprint(owner, card, deck, workingDirectory);
}

/** Optional TUI/PTY presentation over an existing Card runtime.
 * It owns no profiles, Gateway processes, sessions, tools, or turns. */
export class AgentTerminalManager {
  private voiceLeaseSessionId: string | null = null;

  constructor(
    private readonly runtimeManager: CardRuntimeManager = cardRuntimeManager,
    private readonly spawnPtyProcess: typeof spawnPty = spawnPty,
  ) {}

  async open(
    owner: AgentTerminalOwner,
    card: AgentCardInstance,
    deck: DeckDocument,
    cols: number,
    rows: number,
    options: AgentTerminalOpenOptions = {},
  ): Promise<AgentTerminalState> {
    requireAgentTerminalCard(card, deck);
    const state = await this.runtimeManager.open(owner, card, deck, cols, rows, {
      ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
      ...(options.materializeTaskProfile ? { materializeTaskProfile: true } : {}),
    });
    const runtime = this.runtimeManager.runtime(owner, state.sessionId);
    if (options.attachTui !== false) {
      new CardTerminal(runtime, this.spawnPtyProcess).attach(cols, rows);
    }
    return runtime.snapshot(owner);
  }

  async reconcile(
    desired: DesiredCardRuntime[],
    dimensions: { cols: number; rows: number } = { cols: 120, rows: 36 },
    botProfiles?: DesiredBotProfile[],
  ): Promise<AgentTerminalState[]> {
    const openingTargets = desired.filter((target) => target.openAtReconcile !== false);
    const opened = await this.runtimeManager.reconcile(desired, dimensions, botProfiles);
    for (let index = 0; index < openingTargets.length; index += 1) {
      const target = openingTargets[index];
      if (target.attachTui === false) continue;
      requireAgentTerminalCard(target.card, target.deck);
      const runtime = this.runtimeManager.runtime(target.owner, opened[index].sessionId);
      new CardTerminal(runtime, this.spawnPtyProcess).attach(dimensions.cols, dimensions.rows);
      opened[index] = runtime.snapshot(target.owner);
    }
    return opened;
  }

  state(owner: AgentTerminalOwner, id: string): AgentTerminalState {
    return this.runtimeManager.state(owner, id);
  }

  find(owner: AgentTerminalOwner): AgentTerminalState | null {
    return this.runtimeManager.find(owner);
  }

  findCard(projectId: string, deckId: string, cardId: string) {
    return this.runtimeManager.findCard(projectId, deckId, cardId);
  }

  listRunning() {
    return this.runtimeManager.listRunning();
  }

  resize(owner: AgentTerminalOwner, id: string, cols: number, rows: number): AgentTerminalState {
    const runtime = this.runtimeManager.runtime(owner, id).requireRunning(owner);
    new CardTerminal(runtime, this.spawnPtyProcess).resize(cols, rows);
    return runtime.snapshot(owner);
  }

  input(owner: AgentTerminalOwner, id: string, data: string): void {
    const runtime = this.runtimeManager.runtime(owner, id).requireRunning(owner);
    new CardTerminal(runtime, this.spawnPtyProcess).input(data);
  }

  subscribe(
    owner: AgentTerminalOwner,
    id: string,
    after: number,
    listener: CardTerminalListener,
  ): () => void {
    return new CardTerminal(this.runtimeManager.runtime(owner, id), this.spawnPtyProcess)
      .subscribe(after, listener);
  }

  stop(owner: AgentTerminalOwner, id: string): void {
    const runtime = this.runtimeManager.runtime(owner, id);
    new CardTerminal(runtime, this.spawnPtyProcess).detach();
  }

  interrupt(owner: AgentTerminalOwner, id: string): void {
    const runtime = this.runtimeManager.runtime(owner, id).requireRunning(owner);
    new CardTerminal(runtime, this.spawnPtyProcess).interrupt();
  }

  async startVoiceCapture(
    owner: AgentTerminalOwner,
    id: string,
    options: { tts?: boolean } = {},
  ): Promise<AgentTerminalVoiceState> {
    const runtime = this.runtimeManager.runtime(owner, id).requireRunning(owner);
    if (this.voiceLeaseSessionId && this.voiceLeaseSessionId !== id) {
      throw new Error('agent_terminal_voice_owned_by_another_card');
    }
    this.voiceLeaseSessionId = id;
    try {
      let status = record(await runtime.client.request('voice.toggle', {
        action: 'status', profile: runtime.state.profile,
      }));
      if (status.available === false || status.stt_available === false) {
        throw new Error(String(status.details || 'agent_terminal_voice_unavailable'));
      }
      if (status.enabled !== true) {
        status = record(await runtime.client.request('voice.toggle', {
          action: 'on', profile: runtime.state.profile,
        }));
      }
      const wantsTts = options.tts !== false;
      if (Boolean(status.tts) !== wantsTts) {
        status = record(await runtime.client.request('voice.toggle', {
          action: 'tts', profile: runtime.state.profile,
        }));
      }
      const recording = record(await runtime.client.request('voice.record', {
        action: 'start',
        session_id: runtime.snapshot(owner).hermesSessionId,
        profile: runtime.state.profile,
      }));
      if (recording.status !== 'recording') {
        throw new Error(recording.reason === 'wake_owned'
          ? 'agent_terminal_voice_microphone_busy'
          : 'agent_terminal_voice_recording_not_started');
      }
      return {
        enabled: status.enabled === true,
        tts: status.tts === true,
        available: typeof status.available === 'boolean' ? status.available : null,
        audioAvailable: typeof status.audio_available === 'boolean'
          ? status.audio_available : null,
        sttAvailable: typeof status.stt_available === 'boolean' ? status.stt_available : null,
        details: typeof status.details === 'string' ? status.details : '',
        recordStatus: 'recording',
      };
    } catch (error) {
      if (this.voiceLeaseSessionId === id) this.voiceLeaseSessionId = null;
      await runtime.client.request('voice.toggle', {
        action: 'off', profile: runtime.state.profile,
      }).catch(() => undefined);
      throw error;
    }
  }

  async stopVoiceCapture(
    owner: AgentTerminalOwner,
    id: string,
    options: { cancel?: boolean } = {},
  ): Promise<AgentTerminalVoiceState> {
    const runtime = this.runtimeManager.runtime(owner, id).requireRunning(owner);
    if (this.voiceLeaseSessionId && this.voiceLeaseSessionId !== id) {
      throw new Error('agent_terminal_voice_owned_by_another_card');
    }
    if (options.cancel) {
      const status = record(await runtime.client.request('voice.toggle', {
        action: 'off', profile: runtime.state.profile,
      }));
      if (this.voiceLeaseSessionId === id) this.voiceLeaseSessionId = null;
      return {
        enabled: status.enabled === true,
        tts: status.tts === true,
        available: null,
        audioAvailable: null,
        sttAvailable: null,
        details: '',
        recordStatus: 'stopped',
      };
    }
    const result = record(await runtime.client.request('voice.record', {
      action: 'stop',
      session_id: runtime.snapshot(owner).hermesSessionId,
      profile: runtime.state.profile,
    }));
    if (result.status !== 'stopped') throw new Error('agent_terminal_voice_recording_not_stopped');
    const status = record(await runtime.client.request('voice.toggle', {
      action: 'status', profile: runtime.state.profile,
    }));
    return {
      enabled: status.enabled === true,
      tts: status.tts === true,
      available: typeof status.available === 'boolean' ? status.available : null,
      audioAvailable: typeof status.audio_available === 'boolean'
        ? status.audio_available : null,
      sttAvailable: typeof status.stt_available === 'boolean' ? status.stt_available : null,
      details: typeof status.details === 'string' ? status.details : '',
      recordStatus: 'stopped',
    };
  }
}

export const agentTerminalManager = new AgentTerminalManager();
