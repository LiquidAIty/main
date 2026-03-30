import type { V3Blackboard } from "../../types/agentgraph";

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // fallback below
  }
  return String(value);
}

export function createEmptyBlackboard(): V3Blackboard {
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

export function normalizeBlackboardText(value: unknown): string | null {
  const text = safeText(value).replace(/\s+/g, " ").trim();
  return text ? text : null;
}

export function normalizeBlackboardTextList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value
          .split(/\r?\n+/)
          .map((line) => line.replace(/^[-*]\s*/, "").trim())
          .filter(Boolean)
      : [];
  const seen = new Set<string>();
  const items: string[] = [];
  source.forEach((entry) => {
    const text = normalizeBlackboardText(entry);
    if (!text || seen.has(text)) return;
    seen.add(text);
    items.push(text);
  });
  return items.slice(0, 8);
}

export function normalizeV3Blackboard(value: unknown): V3Blackboard {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const store =
    source.store && typeof source.store === "object"
      ? Object.fromEntries(
          Object.entries(source.store as Record<string, unknown>)
            .map(([key, entry]) => [safeText(key).trim(), safeText(entry).trim()] as const)
            .filter(([key, entry]) => Boolean(key && entry)),
        )
      : {};
  return {
    store,
    current_goal: normalizeBlackboardText(source.current_goal),
    what_matters_now: normalizeBlackboardTextList(source.what_matters_now),
    open_questions: normalizeBlackboardTextList(source.open_questions),
    findings: normalizeBlackboardTextList(source.findings),
    suggestions: normalizeBlackboardTextList(source.suggestions),
    next_options: normalizeBlackboardTextList(source.next_options),
    next_move: normalizeBlackboardText(source.next_move),
    updated_at: normalizeBlackboardText(source.updated_at),
  };
}
