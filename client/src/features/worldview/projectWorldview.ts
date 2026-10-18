/**
 * Entity: WorldView
 * Relationship: Transports authenticated Project capability reads and explicit user writes for the one Earth surface while rejecting malformed, cross-Project, duplicate, or mismatched server state.
 */

export type ProjectWorldviewCapability = {
  capabilityId: string;
  enabled: boolean;
  controlledBy: 'user' | 'main';
  lastOrigin: 'user' | 'main' | 'worldview_card';
  mainReason: string | null;
  updatedAt: string | null;
};

export type ProjectWorldviewState = {
  projectId: string;
  defaultEnabled: true;
  capabilities: ProjectWorldviewCapability[];
};

const CAPABILITY_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

export function isCapability(value: unknown): value is ProjectWorldviewCapability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.capabilityId === 'string'
    && CAPABILITY_ID.test(row.capabilityId)
    && typeof row.enabled === 'boolean'
    && (row.controlledBy === 'user' || row.controlledBy === 'main')
    && (row.lastOrigin === 'user' || row.lastOrigin === 'main'
      || row.lastOrigin === 'worldview_card')
    && (row.mainReason === null || typeof row.mainReason === 'string')
    && (row.updatedAt === null || typeof row.updatedAt === 'string');
}

function parseState(value: unknown, projectId: string): ProjectWorldviewState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('project_worldview_response_invalid');
  }
  const body = value as Record<string, unknown>;
  if (body.ok !== true || body.projectId !== projectId || body.defaultEnabled !== true
    || !Array.isArray(body.capabilities) || !body.capabilities.every(isCapability)) {
    throw new Error('project_worldview_response_invalid');
  }
  const capabilityIds = body.capabilities.map((capability) => capability.capabilityId);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    throw new Error('project_worldview_response_invalid');
  }
  return {
    projectId,
    defaultEnabled: true,
    capabilities: body.capabilities,
  };
}

async function responseJson(response: Response): Promise<unknown> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? String((payload as Record<string, unknown>).error || '')
      : '';
    throw new Error(message || `project_worldview_http_${response.status}`);
  }
  return payload;
}

export async function loadProjectWorldview(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<ProjectWorldviewState> {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) throw new Error('project_id_required');
  const response = await fetcher(
    `/api/worldview/projects/${encodeURIComponent(normalizedProjectId)}/capabilities`,
    { method: 'GET' },
  );
  return parseState(await responseJson(response), normalizedProjectId);
}

export async function setProjectWorldviewCapability(
  projectId: string,
  capabilityId: string,
  enabled: boolean,
  fetcher: typeof fetch = fetch,
): Promise<ProjectWorldviewCapability> {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedCapabilityId = String(capabilityId || '').trim();
  if (!normalizedProjectId) throw new Error('project_id_required');
  if (!normalizedCapabilityId) throw new Error('worldview_capability_id_required');
  if (!CAPABILITY_ID.test(normalizedCapabilityId)) {
    throw new Error('worldview_capability_id_invalid');
  }
  const response = await fetcher(
    `/api/worldview/projects/${encodeURIComponent(normalizedProjectId)}/capabilities/${encodeURIComponent(normalizedCapabilityId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  );
  const payload = await responseJson(response);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('project_worldview_response_invalid');
  }
  const body = payload as Record<string, unknown>;
  if (body.ok !== true || body.projectId !== normalizedProjectId
    || !isCapability(body.capability)
    || body.capability.capabilityId !== normalizedCapabilityId) {
    throw new Error('project_worldview_response_invalid');
  }
  return body.capability;
}
