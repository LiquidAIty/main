import type {
  ConversationMessage,
  SharedChatParticipant,
} from '../conversations/store';
import { getDeckDocument } from '../decks/store';
import type { DeckCard, DeckDocument } from '../types';

export const ADDRESS_PATTERN = /^@([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\s|$)/;
export const MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHARED_CHAT_USER: SharedChatParticipant = { kind: 'user', label: 'You' };

export type AddressableCard = {
  card: DeckCard;
  cardRevisionId: string;
  profile: string;
  title: string;
  address?: string;
  aliases: string[];
};

export type SharedChatAuthority = {
  deck: DeckDocument;
  main: AddressableCard;
  cards: AddressableCard[];
};

export type SavedSpecialistOperation = 'thinkgraph.reason' | 'knowgraph.research';


export function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function exactStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
}

export function requireSpecialistConfiguration(
  operation: SavedSpecialistOperation,
  target: AddressableCard,
): void {
  if (target.card.runtime.kind !== 'hermes' || target.card.runtime.mode !== 'delegate') {
    throw new Error('saved_specialist_runtime_invalid');
  }
  const runtimeOptions = objectRecord(target.card.runtimeOptions);
  const tools = new Set(exactStrings(runtimeOptions.tools));
  if (operation === 'thinkgraph.reason') {
    if (!tools.has('engraphis_recall_context')) {
      throw new Error('thinkgraph_recall_grant_required');
    }
    return;
  }
  const skills = new Set(exactStrings(runtimeOptions.skills));
  const toolsets = new Set(exactStrings(runtimeOptions.toolsets));
  if (!toolsets.has('web')) throw new Error('knowgraph_web_toolset_required');
  if (!skills.has('grounded-citations')) {
    throw new Error('knowgraph_grounded_citations_skill_required');
  }
  if (!tools.has('graphiti.add_memory')) {
    throw new Error('knowgraph_add_memory_grant_required');
  }
}

function enabledCard(card: DeckCard): boolean {
  const saved = card.runtimeOptions as (Record<string, unknown> & { enabled?: boolean }) | null | undefined;
  return (card as DeckCard & { enabled?: boolean }).enabled !== false
    && saved?.enabled !== false;
}

function addressableCard(card: DeckCard): AddressableCard {
  const cardId = String(card.id || '').trim();
  const cardRevisionId = String(card._cardRevisionId || '').trim();
  const profile = String(card.runtime?.profile || '').trim();
  const title = String(card.title || '').trim();
  if (!cardId || !cardRevisionId || !profile || !title || !enabledCard(card)) {
    throw new Error('shared_chat_card_invalid');
  }
  const address = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(title) ? title : undefined;
  return {
    card,
    cardRevisionId,
    profile,
    title,
    ...(address ? { address } : {}),
    aliases: [...new Set([cardId, profile, ...(address ? [address] : [])]
      .map((value) => value.toLowerCase()))],
  };
}


export async function sharedChatAuthority(projectId: string, deckId: string): Promise<SharedChatAuthority> {
  const loaded = await getDeckDocument(projectId, deckId);
  if (!loaded.deck) throw new Error('deck_not_found');
  const cards = loaded.deck.nodes.filter(enabledCard).map(addressableCard);
  const mains = cards.filter(({ card }) => card.runtime.kind === 'hermes' && card.runtime.mode === 'main');
  if (mains.length !== 1) throw new Error('main_card_identity_invalid');
  return { deck: loaded.deck, main: mains[0], cards };
}

export function participant(card: AddressableCard): SharedChatParticipant {
  return {
    kind: 'card',
    label: card.title,
    cardId: card.card.id,
    profile: card.profile,
    ...(card.address ? { address: card.address } : {}),
  };
}

function participantFromMessage(
  message: ConversationMessage,
  kind: 'shared_chat_speaker' | 'shared_chat_target',
): SharedChatParticipant | null {
  const activity = message.visibleActivities?.find((item) => item.kind === kind);
  if (!activity?.label) return null;
  return {
    kind: activity.status === 'user' ? 'user' : 'card',
    label: activity.label,
    ...(activity.cardId ? { cardId: activity.cardId } : {}),
    ...(activity.profile ? { profile: activity.profile } : {}),
    ...(activity.address ? { address: activity.address } : {}),
  };
}

export function sharedMessage(message: ConversationMessage) {
  const speaker = participantFromMessage(message, 'shared_chat_speaker')
    || (message.role === 'user' ? SHARED_CHAT_USER : null);
  if (!speaker || (message.role !== 'user' && message.role !== 'assistant')) return null;
  const target = participantFromMessage(message, 'shared_chat_target');
  return {
    messageId: message.messageId,
    seq: message.seq,
    role: message.role,
    text: message.content,
    speaker,
    ...(target ? { target } : {}),
  };
}

export function boundedSharedContext(messages: ConversationMessage[]): Array<Record<string, string>> {
  const result: Array<Record<string, string>> = [];
  let characters = 0;
  for (const message of messages.slice(-24)) {
    const visible = sharedMessage(message);
    if (!visible) continue;
    characters += visible.text.length;
    if (characters > 12_000) break;
    result.push({
      role: visible.role,
      speakerCardId: visible.speaker.cardId || '',
      speakerLabel: visible.speaker.label,
      targetCardId: visible.target?.cardId || '',
      targetLabel: visible.target?.label || '',
      content: visible.text,
    });
  }
  return result;
}

export function selectSharedChatTarget(
  authority: SharedChatAuthority,
  message: string,
  targetCardId: string,
): AddressableCard {
  const address = ADDRESS_PATTERN.exec(message)?.[1]?.toLowerCase() || '';
  const selected = targetCardId
    ? authority.cards.filter((card) => card.card.id === targetCardId)
    : [];
  if (targetCardId && selected.length !== 1) throw new Error('target_card_unavailable');
  const addressed = address
    ? authority.cards.filter((card) => card.aliases.includes(address))
    : [];
  if (address && addressed.length !== 1) {
    throw new Error(addressed.length ? 'addressed_card_ambiguous' : 'addressed_card_unavailable');
  }
  if (selected[0] && addressed[0] && selected[0].card.id !== addressed[0].card.id) {
    throw new Error('shared_chat_target_mismatch');
  }
  return selected[0] || addressed[0] || authority.main;
}
