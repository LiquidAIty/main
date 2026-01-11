// ============================================================================
// Phase 1-3: Multi-Agent API Client
// ============================================================================

const BASE = import.meta.env.VITE_BACKEND_URL || '/api';

export interface ProjectAgent {
  agent_id: string;
  project_id: string;
  name: string;
  agent_type: 'kg_ingest' | 'kg_read' | 'llm_chat';
  
  model?: string | null;
  prompt_template?: string | null;
  tools?: string[];
  io_schema?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  temperature?: number | null;
  max_tokens?: number | null;
  
  role_text?: string | null;
  goal_text?: string | null;
  constraints_text?: string | null;
  io_schema_text?: string | null;
  memory_policy_text?: string | null;
  
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentInput {
  name: string;
  agent_type: 'kg_ingest' | 'kg_read' | 'llm_chat';
  model?: string;
  prompt_template?: string;
  tools?: string[];
  io_schema?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  temperature?: number;
  max_tokens?: number;
  role_text?: string;
  goal_text?: string;
  constraints_text?: string;
  io_schema_text?: string;
  memory_policy_text?: string;
}

export interface UpdateAgentInput extends Partial<CreateAgentInput> {
  agent_id: string;
}

export interface AgentRunResult {
  ok: boolean;
  agent_id: string;
  agent_name: string;
  agent_type: string;
  output: any;
  side_effects?: any;
  errors?: string[];
}

export interface ProjectAssistAssignments {
  assist_main_agent_id: string | null;
  assist_kg_ingest_agent_id: string | null;
}

/**
 * List all agents for a project
 */
export async function listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  if (!projectId) {
    throw new Error('No projectId provided');
  }
  const res = await fetch(`${BASE}/projects/${projectId}/agents`);

  const text = await res.text().catch(() => '');
  if (!text) {
    throw new Error(`Backend returned ${res.status}: (empty response)`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Failed to list agents');
  }
  return data.agents || [];
}

/**
 * Get a specific agent
 */
export async function getProjectAgent(projectId: string, agentId: string): Promise<ProjectAgent> {
  const res = await fetch(`${BASE}/projects/${projectId}/agents/${agentId}`);
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to get agent');
  }
  return data.agent;
}

/**
 * Create a new agent
 */
export async function createProjectAgent(
  projectId: string,
  input: CreateAgentInput
): Promise<ProjectAgent> {
  if (!projectId) {
    throw new Error('No projectId provided');
  }
  const res = await fetch(`${BASE}/projects/${projectId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  
  // Check if response is JSON
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await res.text();
    console.error('[API] Non-JSON response:', { status: res.status, contentType, text: text.slice(0, 500) });
    throw new Error(`Backend returned ${res.status}: ${text.slice(0, 200)}`);
  }
  
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to create agent');
  }
  return data.agent;
}

/**
 * Update an existing agent
 */
export async function updateProjectAgent(
  projectId: string,
  agentId: string,
  input: Partial<CreateAgentInput>
): Promise<ProjectAgent> {
  const res = await fetch(`${BASE}/projects/${projectId}/agents/${agentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to update agent');
  }
  return data.agent;
}

/**
 * Delete an agent
 */
export async function deleteProjectAgent(projectId: string, agentId: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${projectId}/agents/${agentId}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to delete agent');
  }
}

/**
 * Run an agent with test input (Phase 2: Test Harness)
 */
export async function runProjectAgent(
  projectId: string,
  agentId: string,
  input: string,
  context?: any
): Promise<AgentRunResult> {
  const res = await fetch(`${BASE}/projects/${projectId}/agents/${agentId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, context }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to run agent');
  }
  return data;
}

/**
 * Get assist-mode agent assignments for a project
 */
export async function getProjectAssistAssignments(projectId: string): Promise<ProjectAssistAssignments> {
  if (!projectId) throw new Error('No projectId provided');
  const res = await fetch(`${BASE}/projects/${projectId}/assist/assignments`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Failed to load assignments (HTTP ${res.status})`);
  }
  const assignments = data.assignments || {};
  return {
    assist_main_agent_id: assignments.assist_main_agent_id ?? null,
    assist_kg_ingest_agent_id: assignments.assist_kg_ingest_agent_id ?? null,
  };
}

/**
 * Update assist-mode agent assignments for a project
 */
export async function setProjectAssistAssignments(
  projectId: string,
  assignments: Partial<ProjectAssistAssignments>
): Promise<ProjectAssistAssignments> {
  if (!projectId) throw new Error('No projectId provided');
  const res = await fetch(`${BASE}/projects/${projectId}/assist/assignments`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(assignments),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Failed to save assignments (HTTP ${res.status})`);
  }
  const next = data.assignments || {};
  return {
    assist_main_agent_id: next.assist_main_agent_id ?? null,
    assist_kg_ingest_agent_id: next.assist_kg_ingest_agent_id ?? null,
  };
}

/**
 * Get available model options for agent configuration
 */
export function getAvailableModels(): Array<{ value: string; label: string }> {
  return [
    { value: 'deepseek-chat', label: 'DeepSeek Chat (OpenRouter)' },
    { value: 'kimi-k2-free', label: 'Kimi K2 Free (OpenRouter)' },
    { value: 'phi-4', label: 'Phi-4 (OpenRouter)' },
    { value: 'gpt-4o', label: 'GPT-4o (OpenAI)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (OpenAI)' },
  ];
}

/**
 * Get agent type options
 */
export function getAgentTypes(): Array<{ value: string; label: string; description: string }> {
  return [
    {
      value: 'kg_ingest',
      label: 'Knowledge Builder',
      description: 'Ingests text and extracts entities/relationships into knowledge graph',
    },
    {
      value: 'kg_read',
      label: 'Knowledge Reader',
      description: 'Queries knowledge graph and returns context packets',
    },
    {
      value: 'llm_chat',
      label: 'Main Chat',
      description: 'Conversational agent with memory access',
    },
  ];
}

/**
 * Ensure default agents exist for a project (Main Chat + KG Ingest)
 */
export async function ensureDefaultAgents(projectId: string): Promise<{
  mainChat: ProjectAgent;
  kgIngest: ProjectAgent;
}> {
  const res = await fetch(`${BASE}/projects/${projectId}/agents/ensure-defaults`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to ensure default agents');
  }
  return data.agents;
}
