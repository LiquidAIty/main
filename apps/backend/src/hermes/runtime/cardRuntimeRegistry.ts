import type { CardRuntime, CardRuntimeOwner, CardRuntimeState } from './cardRuntime';

export type PendingCardRuntime = {
  owner: CardRuntimeOwner;
  profile: string;
  cardId: string;
  fingerprint: string;
  profileCardFingerprint: string;
  promise: Promise<CardRuntimeState>;
};

function ownerKey(owner: CardRuntimeOwner): string {
  return JSON.stringify([owner.userId, owner.projectId, owner.deckId, owner.cardId]);
}

export class CardRuntimeRegistry {
  private readonly runtimes = new Map<string, CardRuntime>();
  private readonly pending = new Map<string, PendingCardRuntime>();

  key(owner: CardRuntimeOwner): string {
    return ownerKey(owner);
  }

  register(runtime: CardRuntime): void {
    const id = runtime.state.sessionId;
    if (this.runtimes.has(id)) throw new Error('card_runtime_session_duplicate');
    this.runtimes.set(id, runtime);
  }

  remove(sessionId: string): void {
    this.runtimes.delete(sessionId);
  }

  get(owner: CardRuntimeOwner, sessionId: string): CardRuntime {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || !runtime.owns(owner)) throw new Error('card_runtime_not_found');
    return runtime;
  }

  find(owner: CardRuntimeOwner): CardRuntime | null {
    return [...this.runtimes.values()].find((runtime) => (
      runtime.owns(owner) && runtime.state.status === 'running'
    )) || null;
  }

  findCard(projectId: string, deckId: string, cardId: string): CardRuntime | null {
    const matches = [...this.runtimes.values()].filter((runtime) => (
      runtime.owner.projectId === projectId
      && runtime.owner.deckId === deckId
      && runtime.owner.cardId === cardId
      && runtime.state.status === 'running'
    ));
    if (matches.length > 1) throw new Error('card_runtime_identity_ambiguous');
    return matches[0] || null;
  }

  list(): CardRuntime[] {
    return [...this.runtimes.values()];
  }

  listRunning(): Array<{ owner: CardRuntimeOwner; state: CardRuntimeState }> {
    return this.list()
      .filter((runtime) => runtime.state.status === 'running')
      .map((runtime) => ({ owner: { ...runtime.owner }, state: runtime.snapshot() }));
  }

  pendingFor(owner: CardRuntimeOwner): PendingCardRuntime | null {
    return this.pending.get(ownerKey(owner)) || null;
  }

  listPending(): PendingCardRuntime[] {
    return [...this.pending.values()];
  }

  setPending(owner: CardRuntimeOwner, value: PendingCardRuntime): void {
    const key = ownerKey(owner);
    if (this.pending.has(key)) throw new Error('card_runtime_start_duplicate');
    this.pending.set(key, value);
  }

  clearPending(owner: CardRuntimeOwner, promise: Promise<CardRuntimeState>): void {
    const key = ownerKey(owner);
    if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
  }

  deleteExitedFor(owner: CardRuntimeOwner): void {
    for (const [id, runtime] of this.runtimes) {
      if (runtime.owns(owner) && runtime.state.status !== 'running' && !runtime.listeners.size) {
        this.runtimes.delete(id);
      }
    }
  }

  stopAndRemove(runtime: CardRuntime): void {
    runtime.stop();
    this.runtimes.delete(runtime.state.sessionId);
  }

  stopAll(): void {
    for (const runtime of this.runtimes.values()) runtime.stop();
    this.runtimes.clear();
    this.pending.clear();
  }
}
