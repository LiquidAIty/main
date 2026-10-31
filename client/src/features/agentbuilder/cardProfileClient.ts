/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Card Profiles
 * Relationship: Loads one saved Card's profile and learning state and transports typed setting, learning, and profile-publication requests to the backend.
 * Entity: Tool Catalog
 * Relationship: Carries profile toolset lists and toggle requests through the existing saved-Card settings owner.
 */

// The graph payload returned by Hermes Desktop's /api/learning/graph.
export type CardLearningGraph = {
  nodes: Array<{
    id: string; label: string; kind: 'memory' | 'skill';
    memorySource?: 'memory' | 'profile'; timestamp?: number | null;
    category: string; useCount: number; state: string; createdBy: string | null; pinned: boolean;
  }>;
  edges: Array<{ source: string; target: string }>;
  clusters: Array<{ category: string; count: number }>;
  memory: Array<{ source: 'memory' | 'profile'; timestamp?: number | null; title: string; body: string; fingerprint?: string }>;
  stats: Record<string, unknown>;
};

export type CardProfileView = {
  profile: {
    name: string;
    skills: Array<{ name: string; enabled: boolean }>;
    toolsets: Array<{ name: string; label?: string; description?: string; enabled: boolean; tools?: string[]; platform?: string; configured?: boolean }>;
    learning: {
      graph: CardLearningGraph;
    };
  };
  binding: {
    profile: string;
    mode: 'main' | 'delegate' | 'magentic_one';
  };
};

export type CardProfileOperation =
  | { method: 'profile.publish'; params: Record<string, never> }
  | { method: 'toolset.toggle' | 'skill.toggle'; params: { name: string; enabled: boolean } }
  | { method: 'learning.detail'; params: { id: string } }
  | { method: 'learning.edit'; params: { id: string; content: string } };

async function responseJson(response: Response): Promise<Record<string, any>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(String(body?.error || `card_profile_request_failed:${response.status}`));
  }
  return body;
}

export async function loadCardProfile(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  signal?: AbortSignal;
}): Promise<CardProfileView> {
  const query = new URLSearchParams({ projectId: input.projectId, deckId: input.deckId });
  const response = await fetch(
    `/api/card-profile/cards/${encodeURIComponent(input.cardId)}?${query.toString()}`,
    { signal: input.signal },
  );
  return responseJson(response) as Promise<CardProfileView>;
}

export async function applyCardProfileOperation(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  change: CardProfileOperation;
}): Promise<CardProfileView & { result: unknown }> {
  const response = await fetch(
    `/api/card-profile/cards/${encodeURIComponent(input.cardId)}/operations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: input.projectId, deckId: input.deckId, ...input.change }),
    },
  );
  return responseJson(response) as Promise<CardProfileView & { result: unknown }>;
}

export async function loadCardLearningDetail(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  nodeId: string;
}): Promise<{ ok: true; kind: 'memory' | 'skill'; id: string; label: string; content: string }> {
  const response = await fetch(
    `/api/card-profile/cards/${encodeURIComponent(input.cardId)}/operations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: input.projectId,
        deckId: input.deckId,
        method: 'learning.detail',
        params: { id: input.nodeId },
      }),
    },
  );
  const body = await responseJson(response);
  return body.result;
}
