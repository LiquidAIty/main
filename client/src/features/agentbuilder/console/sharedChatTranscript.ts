import type {
  DirectChatTarget,
  SharedChatMessage,
  SharedChatParticipant,
} from './sharedChatClient';

export type SharedCardChatMessage = SharedChatMessage & {
  status?: 'pending' | 'complete' | 'error';
};

export type SharedCardRunInput = { images?: Array<Record<string, unknown>> };

export const SHARED_CHAT_USER: SharedChatParticipant = { kind: 'user', label: 'You' };

export function participantFromEvent(value: unknown): SharedChatParticipant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const participant = value as Record<string, unknown>;
  if (
    !['user', 'card'].includes(String(participant.kind))
    || typeof participant.label !== 'string'
    || !participant.label
  ) return null;
  return {
    kind: participant.kind as 'user' | 'card',
    label: participant.label,
    ...(typeof participant.cardId === 'string' && participant.cardId
      ? { cardId: participant.cardId } : {}),
    ...(typeof participant.profile === 'string' && participant.profile
      ? { profile: participant.profile } : {}),
    ...(typeof participant.address === 'string' && participant.address
      ? { address: participant.address } : {}),
  };
}

export type PreparedChatSubmission = {
  key: string;
  text: string;
  userMessageId: string;
  assistantMessageId: string;
  targetCardId: string | null;
  participant: SharedChatParticipant;
  runInput?: SharedCardRunInput;
};

export function participantForTarget(target: DirectChatTarget): SharedChatParticipant {
  return {
    kind: 'card',
    label: target.title,
    cardId: target.cardId,
    profile: target.profile,
    ...(target.address ? { address: target.address } : {}),
  };
}

export function uniqueCardTarget(
  targets: DirectChatTarget[],
  cardId: string | null,
): DirectChatTarget | null {
  if (!cardId) return null;
  const matches = targets.filter((target) => target.cardId === cardId);
  return matches.length === 1 ? matches[0] : null;
}

export function prepareChatSubmission({
  conversationKey,
  text,
  mainCardId,
  selectedResponderCardId,
  targets,
}: {
  conversationKey: string;
  text: string;
  mainCardId: string;
  selectedResponderCardId: string | null;
  targets: DirectChatTarget[];
}): PreparedChatSubmission & { nextResponderCardId?: string | null } {
  const userMessageId = `msg_${globalThis.crypto.randomUUID()}`;
  const assistantMessageId = `msg_${globalThis.crypto.randomUUID()}`;
  const mainTarget = uniqueCardTarget(targets, mainCardId);
  const mainParticipant = mainTarget
    ? participantForTarget(mainTarget)
    : { kind: 'card' as const, label: 'Main', ...(mainCardId ? { cardId: mainCardId } : {}) };
  const selectedTarget = uniqueCardTarget(targets, selectedResponderCardId);
  const directResponderCardId = selectedTarget && selectedTarget.cardId !== mainCardId
    ? selectedTarget.cardId
    : null;
  const addressMatch = /^\s*@([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/i.exec(text);
  if (!addressMatch) {
    return {
      key: conversationKey,
      text,
      userMessageId,
      assistantMessageId,
      targetCardId: directResponderCardId,
      participant: selectedTarget ? participantForTarget(selectedTarget) : mainParticipant,
    };
  }
  const address = addressMatch[1].toLowerCase();
  const matches = targets.filter((target) => (
    target.aliases.some((alias) => alias.toLowerCase() === address)
  ));
  if (matches.length !== 1) {
    return {
      key: conversationKey,
      text,
      userMessageId,
      assistantMessageId,
      targetCardId: directResponderCardId,
      participant: { kind: 'card', label: `@${address}`, address },
    };
  }
  const target = matches[0];
  const targetsMain = target.cardId === mainCardId;
  return {
    key: conversationKey,
    text,
    userMessageId,
    assistantMessageId,
    targetCardId: targetsMain ? null : target.cardId,
    participant: participantForTarget(target),
    nextResponderCardId: targetsMain ? null : target.cardId,
  };
}

export function messageIndex(messages: SharedCardChatMessage[], messageId: string): number {
  return messages.findIndex((message) => message.messageId === messageId);
}

export function reconcileHistory(
  persisted: SharedCardChatMessage[],
  visible: SharedCardChatMessage[],
): SharedCardChatMessage[] {
  const persistedIds = new Set(
    persisted.flatMap((message) => message.messageId ? [message.messageId] : []),
  );
  return [
    ...persisted,
    ...visible.filter((message) => !message.messageId || !persistedIds.has(message.messageId)),
  ];
}
