import { randomUUID } from 'crypto';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity',
  max: 5,
});

// ============================================================================
// Phase 1: Multi-Agent Support
// ============================================================================
// This module manages multiple agents per project in ag_catalog.project_agents

export interface ProjectAgent {
  agent_id: string;
  project_id: string;
  name: string;
  agent_type: 'kg_ingest' | 'kg_read' | 'llm_chat';
  
  // Agent configuration
  model?: string | null;
  prompt_template?: string | null;
  tools?: string[];
  io_schema?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  temperature?: number | null;
  max_tokens?: number | null;
  
  // Sectioned prompts
  role_text?: string | null;
  goal_text?: string | null;
  constraints_text?: string | null;
  io_schema_text?: string | null;
  memory_policy_text?: string | null;
  
  // Metadata
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentInput {
  project_id: string;
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

function normalizeTools(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeTools(parsed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string');
  }
  return [];
}

function normalizeJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as T;
      }
    } catch {
      // ignore
    }
  }
  if (value && typeof value === 'object') {
    return value as T;
  }
  return fallback;
}

function rowToAgent(row: any): ProjectAgent {
  return {
    agent_id: row.agent_id,
    project_id: row.project_id,
    name: row.name,
    agent_type: row.agent_type,
    model: row.model ?? null,
    prompt_template: row.prompt_template ?? null,
    tools: normalizeTools(row.tools),
    io_schema: normalizeJson(row.io_schema, {}),
    permissions: normalizeJson(row.permissions, {}),
    temperature: row.temperature ?? null,
    max_tokens: row.max_tokens ?? null,
    role_text: row.role_text ?? null,
    goal_text: row.goal_text ?? null,
    constraints_text: row.constraints_text ?? null,
    io_schema_text: row.io_schema_text ?? null,
    memory_policy_text: row.memory_policy_text ?? null,
    is_active: row.is_active ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * List all agents for a project
 */
export async function listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (agent_type) *
     FROM ag_catalog.project_agents 
     WHERE project_id = $1 AND is_active = true
     ORDER BY agent_type, updated_at DESC, created_at DESC`,
    [projectId]
  );
  return rows.map(rowToAgent);
}

/**
 * Get a specific agent by ID
 */
export async function getProjectAgent(agentId: string): Promise<ProjectAgent | null> {
  const { rows } = await pool.query(
    `SELECT * FROM ag_catalog.project_agents 
     WHERE agent_id = $1 AND is_active = true
     LIMIT 1`,
    [agentId]
  );
  if (!rows.length) return null;
  return rowToAgent(rows[0]);
}

/**
 * Get agent by project_id and agent_type (for assignment resolution)
 */
export async function getProjectAgentByProjectId(projectId: string, agentType: 'kg_ingest' | 'llm_chat'): Promise<ProjectAgent | null> {
  console.log('[STORE] Looking up agent by projectId=%s agentType=%s', projectId, agentType);
  const { rows } = await pool.query(
    `SELECT * FROM ag_catalog.project_agents 
     WHERE project_id = $1 AND agent_type = $2 AND is_active = true
     ORDER BY updated_at DESC
     LIMIT 1`,
    [projectId, agentType]
  );
  console.log('[STORE] Found %d rows', rows.length);
  if (!rows.length) return null;
  return rowToAgent(rows[0]);
}

/**
 * Create a new agent
 */
export async function createProjectAgent(input: CreateAgentInput): Promise<ProjectAgent> {
  console.log('[createProjectAgent] Starting with input:', {
    project_id: input.project_id,
    name: input.name,
    agent_type: input.agent_type,
    dbUrl: process.env.DATABASE_URL ? 'set' : 'NOT SET',
  });
  
  const agentId = randomUUID();
  
  try {
    const { rows } = await pool.query(
      `INSERT INTO ag_catalog.project_agents (
        agent_id, project_id, name, agent_type,
        model, prompt_template, tools, io_schema, permissions,
        temperature, max_tokens,
        role_text, goal_text, constraints_text, io_schema_text, memory_policy_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        agentId,
        input.project_id,
        input.name,
        input.agent_type,
        input.model ?? null,
        input.prompt_template ?? null,
        JSON.stringify(input.tools ?? []),
        JSON.stringify(input.io_schema ?? {}),
        JSON.stringify(input.permissions ?? {}),
        input.temperature ?? null,
        input.max_tokens ?? null,
        input.role_text ?? null,
        input.goal_text ?? null,
        input.constraints_text ?? null,
        input.io_schema_text ?? null,
        input.memory_policy_text ?? null,
      ]
    );
    
    console.log('[createProjectAgent] Success, agent_id:', agentId);
    return rowToAgent(rows[0]);
  } catch (err: any) {
    console.error('[createProjectAgent] Query failed:', {
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      table: 'ag_catalog.project_agents',
    });
    throw err;
  }
}

/**
 * Update an existing agent
 */
export async function updateProjectAgent(input: UpdateAgentInput): Promise<ProjectAgent> {
  const current = await getProjectAgent(input.agent_id);
  if (!current) {
    throw new Error(`Agent ${input.agent_id} not found`);
  }
  
  const { rows } = await pool.query(
    `UPDATE ag_catalog.project_agents
     SET name = $2,
         agent_type = $3,
         model = $4,
         prompt_template = $5,
         tools = $6,
         io_schema = $7,
         permissions = $8,
         temperature = $9,
         max_tokens = $10,
         role_text = $11,
         goal_text = $12,
         constraints_text = $13,
         io_schema_text = $14,
         memory_policy_text = $15
     WHERE agent_id = $1 AND is_active = true
     RETURNING *`,
    [
      input.agent_id,
      input.name ?? current.name,
      input.agent_type ?? current.agent_type,
      input.model !== undefined ? input.model : current.model,
      input.prompt_template !== undefined ? input.prompt_template : current.prompt_template,
      JSON.stringify(input.tools !== undefined ? input.tools : current.tools),
      JSON.stringify(input.io_schema !== undefined ? input.io_schema : current.io_schema),
      JSON.stringify(input.permissions !== undefined ? input.permissions : current.permissions),
      input.temperature !== undefined ? input.temperature : current.temperature,
      input.max_tokens !== undefined ? input.max_tokens : current.max_tokens,
      input.role_text !== undefined ? input.role_text : current.role_text,
      input.goal_text !== undefined ? input.goal_text : current.goal_text,
      input.constraints_text !== undefined ? input.constraints_text : current.constraints_text,
      input.io_schema_text !== undefined ? input.io_schema_text : current.io_schema_text,
      input.memory_policy_text !== undefined ? input.memory_policy_text : current.memory_policy_text,
    ]
  );
  
  if (!rows.length) {
    throw new Error(`Failed to update agent ${input.agent_id}`);
  }
  
  return rowToAgent(rows[0]);
}

/**
 * Soft delete an agent
 */
export async function deleteProjectAgent(agentId: string): Promise<void> {
  await pool.query(
    `UPDATE ag_catalog.project_agents
     SET is_active = false
     WHERE agent_id = $1`,
    [agentId]
  );
}

/**
 * Assemble sectioned prompts into full prompt_template
 */
export function assembleSectionedPrompt(agent: ProjectAgent): string {
  const sections: string[] = [];
  
  if (agent.role_text?.trim()) {
    sections.push(`# Role\n${agent.role_text.trim()}`);
  }
  
  if (agent.goal_text?.trim()) {
    sections.push(`# Goal\n${agent.goal_text.trim()}`);
  }
  
  if (agent.constraints_text?.trim()) {
    sections.push(`# Constraints\n${agent.constraints_text.trim()}`);
  }
  
  if (agent.io_schema_text?.trim()) {
    sections.push(`# Input/Output Schema\n${agent.io_schema_text.trim()}`);
  }
  
  if (agent.memory_policy_text?.trim()) {
    sections.push(`# Memory Policy\n${agent.memory_policy_text.trim()}`);
  }
  
  return sections.join('\n\n');
}

/**
 * Ensure default agents exist for a project (Main Chat + KG Ingest)
 * Creates them if missing, returns existing ones otherwise
 */
export async function ensureDefaultAgents(projectId: string): Promise<{
  mainChat: ProjectAgent;
  kgIngest: ProjectAgent;
}> {
  const agents = await listProjectAgents(projectId);
  
  let mainChat = agents.find(a => a.agent_type === 'llm_chat');
  let kgIngest = agents.find(a => a.agent_type === 'kg_ingest');
  
  if (!mainChat) {
    mainChat = await createProjectAgent({
      project_id: projectId,
      name: 'Main Chat',
      agent_type: 'llm_chat',
      model: 'deepseek-chat',
      temperature: 0.3,
      max_tokens: 2048,
      role_text: 'You are a helpful AI assistant with access to project knowledge.',
      goal_text: 'Help the user accomplish their goals by providing accurate, contextual responses.',
      constraints_text: 'Always use retrieved context when available. Be concise and actionable.',
    });
  }
  
  if (!kgIngest) {
    kgIngest = await createProjectAgent({
      project_id: projectId,
      name: 'KG Ingest',
      agent_type: 'kg_ingest',
      model: 'deepseek-chat',
      temperature: 0,
      max_tokens: 2048,
      role_text: 'You extract structured knowledge from text.',
      goal_text: 'Identify entities (people, organizations, projects, technologies) and relationships.',
      constraints_text: 'Only save durable facts. Prefer people/orgs/projects/tech stack. Always emit at least 1 relationship if there are 2 entities in the same sentence.',
      io_schema_text: 'Output valid JSON with entities and relations arrays.',
    });
  }
  
  return { mainChat, kgIngest };
}
