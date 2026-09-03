import type { AgentCardRuntimeOptions, CardSubsystemAttachment } from '../../../types/agentgraph';

const CAPABILITIES = new Set(['state', 'events', 'commands', 'artifacts', 'readiness']);

export function readCardSubsystemAttachments(
  runtimeOptions: AgentCardRuntimeOptions | null | undefined,
): CardSubsystemAttachment[] {
  const raw = runtimeOptions?.subsystems;
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  const result: CardSubsystemAttachment[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as CardSubsystemAttachment;
    const id = String(item.id || '').trim();
    const label = String(item.label || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || !label || label.length > 80) continue;
    if (ids.has(id) || labels.has(label.toLowerCase())) continue;
    if (item.adapter?.kind !== 'python'
      || item.adapter.contractVersion !== 'card-subsystem.v1'
      || !Array.isArray(item.adapter.capabilities)
      || item.adapter.capabilities.some((entry) => !CAPABILITIES.has(entry))) continue;
    ids.add(id);
    labels.add(label.toLowerCase());
    result.push({
      id,
      label,
      adapter: {
        kind: 'python',
        contractVersion: 'card-subsystem.v1',
        capabilities: [...new Set(item.adapter.capabilities)],
      },
      cardTab: { enabled: item.cardTab?.enabled === true },
      configurationSchema: item.configurationSchema || null,
    });
  }
  return result;
}
