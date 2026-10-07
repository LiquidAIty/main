import type { AgentCardInstance, DeckDocument } from '../../types';
import type { CardRuntimeOwner, CardRuntimeState } from './cardRuntime';
import type { CardRuntimeRegistry } from './cardRuntimeRegistry';

export type BotRosterProjection = {
  cardId: string;
  cardRevisionId: string;
  profile: string;
  title: string;
  botEnabled: boolean;
  roster: string[];
};

export type DesiredCardRuntime = {
  owner: CardRuntimeOwner;
  card: AgentCardInstance;
  deck: DeckDocument;
  workingDirectory?: string;
  attachTui?: boolean;
  openAtReconcile?: boolean;
};

export type DesiredBotProfile = {
  owner: CardRuntimeOwner;
  card: AgentCardInstance;
  projection: BotRosterProjection;
};

export type CardRuntimeReconcilerDependencies = {
  requireCard(card: AgentCardInstance, deck: DeckDocument): string;
  fingerprint(
    owner: CardRuntimeOwner,
    card: AgentCardInstance,
    deck: DeckDocument,
    workingDirectory?: string,
  ): string;
  resolveWorkingDirectory(
    owner: CardRuntimeOwner,
    card: AgentCardInstance,
    profile: string,
    workingDirectory?: string,
  ): string;
  open(
    target: DesiredCardRuntime,
    dimensions: { cols: number; rows: number },
  ): Promise<CardRuntimeState>;
  stop(runtime: ReturnType<CardRuntimeRegistry['list']>[number]): void;
  configureInstructions(profile: string, prompt: string): Promise<void>;
  configureBotProfiles(
    runtime: ReturnType<CardRuntimeRegistry['list']>[number],
    profiles: DesiredBotProfile[],
  ): Promise<void>;
};

function ownerKey(owner: CardRuntimeOwner): string {
  return JSON.stringify([owner.userId, owner.projectId, owner.deckId, owner.cardId]);
}

export async function reconcileCardRuntimes(
  registry: CardRuntimeRegistry,
  desired: DesiredCardRuntime[],
  dimensions: { cols: number; rows: number },
  botProfiles: DesiredBotProfile[] | undefined,
  dependencies: CardRuntimeReconcilerDependencies,
): Promise<CardRuntimeState[]> {
  const wantedOwners = new Map<string, DesiredCardRuntime>();
  for (const target of desired) {
    dependencies.requireCard(target.card, target.deck);
    const key = ownerKey(target.owner);
    if (wantedOwners.has(key)) throw new Error('card_runtime_topology_owner_duplicate');
    wantedOwners.set(key, target);
  }
  const projectedOwners = new Set<string>();
  for (const target of botProfiles ?? []) {
    const key = ownerKey(target.owner);
    if (projectedOwners.has(key)) throw new Error('card_runtime_bot_profile_owner_duplicate');
    if (target.card.id !== target.owner.cardId || target.projection.cardId !== target.owner.cardId) {
      throw new Error('card_runtime_bot_profile_identity_invalid');
    }
    projectedOwners.add(key);
  }
  const openingTargets = desired.filter((target) => target.openAtReconcile !== false);
  const openingProfiles = new Set(openingTargets.map((target) => (
    dependencies.requireCard(target.card, target.deck).toLowerCase()
  )));
  const existingRuntime = registry.list().find((runtime) => runtime.state.status === 'running');

  for (const target of botProfiles ?? []) {
    if (!target.projection.botEnabled
      || (!existingRuntime && openingProfiles.has(target.projection.profile.toLowerCase()))) continue;
    await dependencies.configureInstructions(
      target.projection.profile,
      String(target.card.prompt || ''),
    );
  }
  if (existingRuntime && botProfiles !== undefined) {
    const revocations: DesiredBotProfile[] = [];
    for (const runtime of registry.list()) {
      if (runtime.state.status !== 'running'
        || botProfiles.some((target) => (
          target.projection.profile.toLowerCase() === runtime.launch.profile.toLowerCase()
        ))) continue;
      revocations.push({
        owner: runtime.owner,
        card: {
          id: runtime.owner.cardId,
          title: runtime.launch.profile,
          kind: 'agent',
          runtime: { kind: 'hermes', mode: 'delegate', profile: runtime.launch.profile },
        } as AgentCardInstance,
        projection: {
          cardId: runtime.owner.cardId,
          cardRevisionId: '',
          profile: runtime.launch.profile,
          title: runtime.launch.profile,
          botEnabled: false,
          roster: [],
        },
      });
    }
    await dependencies.configureBotProfiles(existingRuntime, [
      ...(botProfiles ?? []),
      ...revocations,
    ]);
  }

  for (const runtime of registry.list()) {
    if (runtime.state.status !== 'running') continue;
    const target = wantedOwners.get(ownerKey(runtime.owner));
    if (!target && !desired.some((candidate) => (
      candidate.owner.projectId === runtime.owner.projectId
      && candidate.owner.deckId === runtime.owner.deckId
    ))) continue;
    const profile = target ? dependencies.requireCard(target.card, target.deck) : null;
    const cwd = target && profile
      ? dependencies.resolveWorkingDirectory(
        target.owner,
        target.card,
        profile,
        target.workingDirectory,
      )
      : undefined;
    if (!target || runtime.fingerprint !== dependencies.fingerprint(
      target.owner,
      target.card,
      target.deck,
      cwd,
    )) dependencies.stop(runtime);
  }

  const opened: CardRuntimeState[] = [];
  for (const target of openingTargets) {
    opened.push(await dependencies.open(target, dimensions));
  }
  return opened;
}
