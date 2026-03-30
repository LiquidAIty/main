import type { RuntimeBinding, V3Blackboard, V3BlackboardField } from './types';

const TEXT_LIMIT = 320;
const LIST_LIMIT = 8;

export const RUNTIME_BINDINGS = [
  'main_chat',
  'kg_ingest',
  'research_agent',
  'knowgraph',
  'neo4j',
] as const satisfies RuntimeBinding[];
export const V3_BLACKBOARD_FIELDS = [
  'current_goal',
  'what_matters_now',
  'open_questions',
  'findings',
  'suggestions',
  'next_options',
  'next_move',
] as const satisfies V3BlackboardField[];
const SYSTEM_CARD_RUNTIME_BINDINGS: Record<string, RuntimeBinding> = {
  card_main_chat: 'main_chat',
  card_kg_ingest: 'kg_ingest',
  card_research: 'research_agent',
  card_knowgraph: 'knowgraph',
  card_neo4j: 'neo4j',
};

export function normalizeRuntimeBinding(value: unknown): RuntimeBinding | null {
  const normalized = String(value || '').trim().toLowerCase();
  return RUNTIME_BINDINGS.includes(normalized as RuntimeBinding)
    ? (normalized as RuntimeBinding)
    : null;
}

export function resolveRuntimeBinding(value: unknown, cardId?: unknown): RuntimeBinding | null {
  return normalizeRuntimeBinding(value) || SYSTEM_CARD_RUNTIME_BINDINGS[String(cardId || '').trim()] || null;
}

function normalizeText(value: unknown): string | null {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_LIMIT);
  return text ? text : null;
}

function normalizeTextList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value
          .split(/\r?\n+/)
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean)
      : [];

  const seen = new Set<string>();
  const items: string[] = [];
  source.forEach((entry) => {
    const text = normalizeText(entry);
    if (!text || seen.has(text)) return;
    seen.add(text);
    items.push(text);
  });
  return items.slice(0, LIST_LIMIT);
}

export function createEmptyV3Blackboard(): V3Blackboard {
  return {
    store: {},
    current_goal: null,
    what_matters_now: [],
    open_questions: [],
    findings: [],
    suggestions: [],
    next_options: [],
    next_move: null,
    updated_at: null,
  };
}

export function normalizeV3Blackboard(value: unknown): V3Blackboard {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const store =
    raw.store && typeof raw.store === 'object'
      ? Object.fromEntries(
          Object.entries(raw.store as Record<string, unknown>)
            .map(([key, entry]) => [String(key || '').trim(), String(entry || '').trim()] as const)
            .filter(([key, entry]) => Boolean(key && entry)),
        )
      : {};
  return {
    store,
    current_goal: normalizeText(raw.current_goal),
    what_matters_now: normalizeTextList(raw.what_matters_now),
    open_questions: normalizeTextList(raw.open_questions),
    findings: normalizeTextList(raw.findings),
    suggestions: normalizeTextList(raw.suggestions),
    next_options: normalizeTextList(raw.next_options),
    next_move: normalizeText(raw.next_move),
    updated_at: normalizeText(raw.updated_at),
  };
}

export function normalizeV3BlackboardFieldList(value: unknown): V3BlackboardField[] {
  if (!Array.isArray(value)) return [...V3_BLACKBOARD_FIELDS];
  const seen = new Set<V3BlackboardField>();
  const fields: V3BlackboardField[] = [];
  value.forEach((entry) => {
    const normalized = String(entry || '').trim() as V3BlackboardField;
    if (!V3_BLACKBOARD_FIELDS.includes(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    fields.push(normalized);
  });
  return fields;
}

function blackboardFieldValueToText(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value.join('\n');
  return String(value || '').trim();
}

export function filterV3BlackboardFields(
  blackboard: V3Blackboard | null | undefined,
  fields: V3BlackboardField[],
): V3Blackboard {
  const current = normalizeV3Blackboard(blackboard);
  const allowed = new Set(normalizeV3BlackboardFieldList(fields));
  const next = createEmptyV3Blackboard();
  next.store = { ...current.store };

  V3_BLACKBOARD_FIELDS.forEach((field) => {
    if (!allowed.has(field)) return;
    (next as any)[field] = Array.isArray((current as any)[field])
      ? [...((current as any)[field] as string[])]
      : (current as any)[field];
  });
  next.updated_at = current.updated_at;
  return next;
}

export function hasVisibleBlackboardContent(blackboard: V3Blackboard | null | undefined): boolean {
  const current = normalizeV3Blackboard(blackboard);
  return V3_BLACKBOARD_FIELDS.some((field) => {
    const text = blackboardFieldValueToText((current as any)[field]);
    return Boolean(text);
  });
}

function appendUnique(base: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  [...base, ...extra].forEach((item) => {
    const text = normalizeText(item);
    if (!text || seen.has(text)) return;
    seen.add(text);
    merged.push(text);
  });
  return merged.slice(0, LIST_LIMIT);
}

function deriveGoalFromInput(userInput: string | undefined): string | null {
  return normalizeText(userInput);
}

export function deriveNextStepsFromBlackboard(
  blackboard: V3Blackboard,
  context: { userInput?: string } = {},
): V3Blackboard {
  const next = normalizeV3Blackboard(blackboard);

  if (!next.current_goal) {
    next.current_goal = deriveGoalFromInput(context.userInput);
  }

  const optionCandidates = appendUnique(next.next_options, [
    ...next.suggestions,
    ...next.open_questions,
    ...next.findings,
  ]).slice(0, 4);

  if (!next.next_move && optionCandidates.length > 0) {
    next.next_move = optionCandidates[0];
  }

  if (next.next_options.length === 0 && optionCandidates.length > 0) {
    next.next_options = optionCandidates;
  }

  next.updated_at = new Date().toISOString();
  return next;
}

export function mergeV3Blackboard(
  base: V3Blackboard | null | undefined,
  write: V3Blackboard | null | undefined,
  context: { userInput?: string } = {},
): V3Blackboard {
  const current = normalizeV3Blackboard(base);
  const nextWrite = normalizeV3Blackboard(write);

  const merged: V3Blackboard = {
    store: {
      ...(current.store || {}),
      ...(nextWrite.store || {}),
    },
    current_goal: nextWrite.current_goal || current.current_goal,
    what_matters_now: appendUnique(current.what_matters_now, nextWrite.what_matters_now),
    open_questions: appendUnique(current.open_questions, nextWrite.open_questions),
    findings: appendUnique(current.findings, nextWrite.findings),
    suggestions: appendUnique(current.suggestions, nextWrite.suggestions),
    next_options: appendUnique(current.next_options, nextWrite.next_options),
    next_move: nextWrite.next_move || current.next_move,
    updated_at: null,
  };

  return deriveNextStepsFromBlackboard(merged, context);
}
