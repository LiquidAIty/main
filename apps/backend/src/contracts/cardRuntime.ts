import type { CardRuntime } from '../types';

export function resolveCardRuntime(value: unknown): CardRuntime | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const kind = String(candidate.kind || '').trim().toLowerCase();
  const mode = String(candidate.mode || '').trim().toLowerCase();

  if (kind === 'hermes') {
    const profile = String(candidate.profile || '').trim();
    if (!profile || !['main', 'delegate', 'kanban'].includes(mode)) return null;
    return { kind, mode: mode as 'main' | 'delegate' | 'kanban', profile };
  }
  if (kind === 'autogen' && ['assistant', 'magentic_one'].includes(mode)) {
    return { kind, mode: mode as 'assistant' | 'magentic_one' };
  }
  return null;
}
