import type { ResolvedAgentConfig } from '../resolveAgents';
import type { ResearchSearchTask, ResearchTargetPacket } from './types';

// Legacy adapter-only client retained for older research ingestion callers.
export type AutoGenResearchPlannerResponse = {
  ok: boolean;
  planner: string;
  project_id: string;
  turn_id: string;
  query: string;
  planned_task_count: number;
  search_tasks: Array<{
    query?: unknown;
    intent?: unknown;
    priority?: unknown;
    triplet?: {
      entityA?: unknown;
      relationshipType?: unknown;
      entityB?: unknown;
      confidence?: unknown;
      source?: unknown;
    } | null;
  }>;
  stop_reason?: string | null;
  transcript?: string[];
};

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildSidecarBaseUrls(): string[] {
  const configured = trimBaseUrl(
    String(process.env.AUTOGEN_RESEARCH_URL || process.env.AUTOGEN_ORCHESTRATOR_URL || '').trim(),
  );
  if (!configured) {
    throw new Error(
      'autogen_research_url_missing: set AUTOGEN_ORCHESTRATOR_URL (or AUTOGEN_RESEARCH_URL) in apps/backend/.env',
    );
  }
  return [configured];
}

function isRetryableSidecarError(error: any): boolean {
  const code = String(error?.cause?.code || error?.code || '').trim();
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

function readTimeoutMs(): number {
  const raw = Number(process.env.AUTOGEN_RESEARCH_TIMEOUT_MS ?? 12_000);
  if (!Number.isFinite(raw)) return 12_000;
  return Math.max(1_500, Math.min(60_000, Math.floor(raw)));
}

export async function planResearchTasksWithAutoGen(
  packet: ResearchTargetPacket,
  resolvedAgent: ResolvedAgentConfig,
  draftTasks: ResearchSearchTask[],
): Promise<AutoGenResearchPlannerResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readTimeoutMs());
  try {
    const body = {
      project_id: packet.projectId,
      turn_id: packet.turnId,
      query: packet.query,
      priority_entities: packet.priorityEntities,
      priority_relationships: packet.priorityRelationships,
      triplets: packet.triplets,
      gaps: packet.gaps,
      open_questions: packet.openQuestions,
      draft_tasks: draftTasks,
      max_tasks: draftTasks.length || packet.maxResults || 6,
      agent: {
        provider: resolvedAgent.provider,
        provider_model_id: resolvedAgent.providerModelId,
        system_prompt: resolvedAgent.systemPrompt || '',
        temperature: resolvedAgent.temperature,
        max_tokens: resolvedAgent.maxTokens,
      },
    };

    let lastError: any = null;
    for (const baseUrl of buildSidecarBaseUrls()) {
      try {
        const response = await fetch(`${baseUrl}/autogen/research/plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const message = String(data?.detail || data?.error || response.statusText || 'autogen_sidecar_error').trim();
          throw new Error(`autogen_sidecar_http_${response.status}:${message}`);
        }
        return data as AutoGenResearchPlannerResponse;
      } catch (error: any) {
        lastError = error;
        if (!isRetryableSidecarError(error)) {
          break;
        }
      }
    }
    if (lastError) {
      throw lastError;
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
