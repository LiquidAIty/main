import type { StandaloneCardTestResult } from '../../../components/AgentManager';

export function selectLatestRunResult(
  current: StandaloneCardTestResult | null,
  next: StandaloneCardTestResult | null,
): StandaloneCardTestResult | null {
  if (!current?.runId || !next?.runId) return next;
  if (current.runId !== next.runId
    && current.conversationId === next.conversationId
    && Date.parse(current.startedAt || '') > Date.parse(next.startedAt || '')) return current;
  if (current.runId === next.runId
    && ['completed', 'failed', 'cancelled', 'blocked'].includes(current.state || '')
    && ['pending', 'running'].includes(next.state || '')) return current;
  return next;
}
