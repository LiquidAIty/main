import { pool } from '../../db/pool';
import { MODEL_REGISTRY } from '../../llm/models.config';

export type AgentType =
  | 'llm_chat'
  | 'kg_ingest'
  | 'knowgraph'
  | 'neo4j'
  | 'research_agent'
  | 'agent_builder';

export interface AgentConfigRecord {
  agent_id: string;
  agent_type: AgentType;
  provider: string | null;
  model_key: string | null;
  temperature: number | null;
  top_p?: number | null;
  max_tokens: number | null;
  previous_response_id?: string | null;
  response_format?: any | null;
  tools?: any[] | null;
  prompt_template: string | null;
  organizing_principle?: string | null;
  entity_taxonomy?: any | null;
  relationship_taxonomy?: any | null;
  extraction_policy?: any | null;
}

export type AgentConfigPatch = Partial<Omit<AgentConfigRecord, 'agent_id' | 'agent_type'>>;
const SYSTEM_AGENT_TYPES: AgentType[] = ['llm_chat', 'kg_ingest', 'knowgraph', 'neo4j', 'research_agent'];

const DEFAULT_KG_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'kg_extract',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            chunk_id: { type: 'string' },
            text: { type: 'string' },
            start: { type: 'number' },
            end: { type: 'number' },
          },
          required: ['chunk_id', 'text', 'start', 'end'],
        },
      },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            name: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } },
            evidence_chunk_ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'type', 'name', 'aliases', 'evidence_chunk_ids'],
        },
      },
      relations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            type: { type: 'string' },
            evidence_chunk_ids: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' },
          },
          required: ['from', 'to', 'type', 'evidence_chunk_ids', 'confidence'],
        },
      },
    },
    required: ['chunks', 'entities', 'relations'],
  },
};

function normalizeJson<TDefault>(value: unknown, fallback: TDefault): TDefault {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as TDefault;
      }
    } catch {
      // ignore
    }
  }
  if (value && typeof value === 'object') {
    return value as TDefault;
  }
  return fallback;
}

function normalizeTools(value: unknown): any[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeTools(parsed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.filter((v) => v !== null && v !== undefined);
  }
  return [];
}

function sectionPromptFallback(row: any): string | null {
  const rawSections: Array<[string, string]> = [
    ['Role', String(row.role_text ?? '').trim()],
    ['Goal', String(row.goal_text ?? '').trim()],
    ['Constraints', String(row.constraints_text ?? '').trim()],
    ['Input/Output Schema', String(row.io_schema_text ?? '').trim()],
    ['Memory Policy', String(row.memory_policy_text ?? '').trim()],
  ];
  const sections = rawSections.filter(([, value]) => value.length > 0);

  if (!sections.length) return null;
  return sections.map(([title, value]) => `# ${title}\n${value}`).join('\n\n');
}

function defaultAgentName(agentType: AgentType): string {
  switch (agentType) {
    case 'llm_chat':
      return 'Main Chat';
    case 'kg_ingest':
      return 'ThinkGraph';
    case 'knowgraph':
      return 'KnowGraph';
    case 'neo4j':
      return 'Neo4j';
    case 'research_agent':
      return 'Research Agent';
    case 'agent_builder':
      return 'Agent Builder';
    default:
      return `agent:${agentType}`;
  }
}

function pickDefaultModelKey(agentType: AgentType): string {
  const candidatesByAgent: Record<AgentType, string[]> = {
    llm_chat: ['gpt-5.1-chat-latest', 'gpt-5-mini', 'gpt-5-nano'],
    kg_ingest: ['gpt-5-mini', 'gpt-5.1-chat-latest', 'gpt-5-nano'],
    knowgraph: ['gpt-5-mini', 'gpt-5.1-chat-latest', 'gpt-5-nano'],
    neo4j: ['gpt-5-mini', 'gpt-5.1-chat-latest', 'gpt-5-nano'],
    research_agent: ['gpt-5-mini', 'gpt-5.1-chat-latest', 'gpt-5-nano'],
    agent_builder: ['gpt-5-mini', 'gpt-5.1-chat-latest', 'gpt-5-nano'],
  };
  const envCandidates = [
    process.env.OPENAI_MODEL,
    process.env.OPENAI_DEFAULT_MODEL,
  ].filter((v): v is string => Boolean(v && v.trim()));
  const options = [...candidatesByAgent[agentType], ...envCandidates];
  const seen = new Set<string>();
  for (const key of options) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const m = MODEL_REGISTRY[key];
    if (m?.provider === 'openai') return key;
  }
  const firstOpenAi = Object.entries(MODEL_REGISTRY).find(([, m]) => m.provider === 'openai');
  if (!firstOpenAi) {
    throw new Error('default_openai_model_missing');
  }
  return firstOpenAi[0];
}

function defaultPromptTemplate(agentType: AgentType): string {
  switch (agentType) {
    case 'llm_chat':
      return [
        '# Role',
        'You are Sol, the primary assistant for this project.',
        '',
        '# Goal',
        'Help the user make practical progress with clear, grounded steps.',
        '',
        '# Constraints',
        '- Be direct and avoid invented capabilities.',
        '- If context is missing, state that clearly.',
      ].join('\n');
    case 'kg_ingest':
      return [
        '# Role',
        'You are ThinkGraph extraction.',
        '',
        '# Goal',
        'Extract durable entities and relationships from chunks.',
        '',
        '# Constraints',
        '- Return strict JSON only.',
        '- Use evidence_chunk_ids from provided chunks.',
      ].join('\n');
    case 'knowgraph':
      return [
        '# Role',
        'You are KnowGraph extraction for Neo4j.',
        '',
        '# Goal',
        'Extract stable entities and relations suitable for Neo4j ingest.',
        '',
        '# Constraints',
        '- Return strict JSON only.',
        '- Use evidence_chunk_ids from provided chunks.',
      ].join('\n');
    case 'neo4j':
      return [
        '# Role',
        'You are Neo4j extraction for the local graph sync pipeline.',
        '',
        '# Goal',
        'Extract stable entities and relations for the Neo4j dual-write path.',
        '',
        '# Constraints',
        '- Return strict JSON only.',
        '- Use evidence_chunk_ids from provided chunks.',
      ].join('\n');
    case 'research_agent':
      return [
        '# Role',
        'You are the spawned web research agent for KnowGraph.',
        '',
        '# Goal',
        'Collect web evidence via Tavily MCP and prepare grounded source material for the Neo4j GraphRAG ingest pipeline.',
        '',
        '# Constraints',
        '- Prefer primary and official sources when available.',
        '- Preserve provenance for every result.',
        '- Do not invent facts that are not present in fetched source text.',
      ].join('\n');
    case 'agent_builder':
      return [
        '# Role',
        'You are Agent Builder.',
        '',
        '# Goal',
        'Help configure and validate agent settings.',
      ].join('\n');
    default:
      return '';
  }
}

function defaultResponseFormat(agentType: AgentType): any | null {
  if (agentType === 'kg_ingest' || agentType === 'knowgraph' || agentType === 'neo4j') {
    return DEFAULT_KG_RESPONSE_FORMAT;
  }
  return null;
}

function normalizeProviderValue(value: unknown): 'openai' | 'openrouter' | null {
  const provider = String(value ?? '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'openrouter') {
    return provider;
  }
  return null;
}

function deriveProviderFromModelKey(modelKeyRaw: unknown): 'openai' | 'openrouter' | null {
  const modelKey = String(modelKeyRaw ?? '').trim();
  if (!modelKey) return null;
  const entry = MODEL_REGISTRY[modelKey];
  if (entry?.provider === 'openai' || entry?.provider === 'openrouter') {
    return entry.provider;
  }
  if (modelKey.includes('/')) {
    return 'openrouter';
  }
  if (/^gpt-|^o\d|^text-embedding/i.test(modelKey)) {
    return 'openai';
  }
  return null;
}

function rowToConfig(row: any): AgentConfigRecord {
  const modelKey = row.model_key ?? row.model ?? null;
  const provider = normalizeProviderValue(row.provider) ?? deriveProviderFromModelKey(modelKey);
  const promptTemplate = String(row.prompt_template ?? '').trim() || sectionPromptFallback(row);
  const maxTokens = typeof row.max_tokens === 'number' ? row.max_tokens : 2048;
  const permissions = normalizeJson(row.permissions, {} as Record<string, unknown>);
  const responseFormat =
    (permissions as any)?.text?.format ??
    (permissions as any)?.response_format ??
    null;
  const topP = typeof (permissions as any)?.top_p === 'number' ? (permissions as any).top_p : null;
  const previousResponseId =
    typeof (permissions as any)?.previous_response_id === 'string'
      ? String((permissions as any).previous_response_id)
      : null;
  const organizingPrinciple =
    typeof (permissions as any)?.organizing_principle === 'string'
      ? String((permissions as any).organizing_principle).trim() || null
      : null;
  const entityTaxonomy = (permissions as any)?.entity_taxonomy ?? null;
  const relationshipTaxonomy = (permissions as any)?.relationship_taxonomy ?? null;
  const extractionPolicy = (permissions as any)?.extraction_policy ?? null;
  const tools = normalizeTools(row.tools);
  return {
    agent_id: row.agent_id,
    agent_type: row.agent_type,
    provider,
    model_key: modelKey,
    temperature: row.temperature ?? null,
    top_p: topP,
    max_tokens: maxTokens,
    previous_response_id: previousResponseId,
    response_format: responseFormat,
    tools,
    prompt_template: promptTemplate,
    organizing_principle: organizingPrinciple,
    entity_taxonomy: entityTaxonomy,
    relationship_taxonomy: relationshipTaxonomy,
    extraction_policy: extractionPolicy,
  };
}

function rowTimestampMs(row: any, key: 'updated_at' | 'created_at'): number {
  const raw = row?.[key];
  if (raw == null) return 0;
  const time = Date.parse(String(raw));
  return Number.isFinite(time) ? time : 0;
}

function rowCompletenessScore(row: any): number {
  const modelKey = String(row?.model_key ?? row?.model ?? '').trim();
  const provider = normalizeProviderValue(row?.provider) ?? deriveProviderFromModelKey(modelKey);
  const promptTemplate =
    String(row?.prompt_template ?? '').trim() ||
    sectionPromptFallback(row) ||
    '';
  let score = 0;
  if (provider) score += 4;
  if (modelKey) score += 4;
  if (promptTemplate) score += 2;
  if (typeof row?.max_tokens === 'number' && Number.isFinite(row.max_tokens)) score += 1;
  if (typeof row?.temperature === 'number' && Number.isFinite(row.temperature)) score += 1;
  return score;
}

function sortRowsForCanonical(rows: any[]): any[] {
  return [...rows].sort((a, b) => {
    const scoreDiff = rowCompletenessScore(b) - rowCompletenessScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    const updatedDiff = rowTimestampMs(b, 'updated_at') - rowTimestampMs(a, 'updated_at');
    if (updatedDiff !== 0) return updatedDiff;
    const createdDiff = rowTimestampMs(b, 'created_at') - rowTimestampMs(a, 'created_at');
    if (createdDiff !== 0) return createdDiff;
    const aId = String(a?.agent_id ?? '');
    const bId = String(b?.agent_id ?? '');
    return aId.localeCompare(bId);
  });
}

async function listActiveAgentRows(projectId: string, agentType: AgentType): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template, tools, permissions,
            role_text, goal_text, constraints_text, io_schema_text, memory_policy_text, updated_at, created_at
     FROM ag_catalog.project_agents
     WHERE project_id = $1 AND agent_type::text = $2 AND is_active = true`,
    [projectId, agentType],
  );
  if (!rows.length) return [];
  return sortRowsForCanonical(rows);
}

async function deactivateDuplicateActiveRows(projectId: string, agentType: AgentType, keepAgentId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE ag_catalog.project_agents
     SET is_active = false,
         updated_at = NOW()
     WHERE project_id = $1
       AND agent_type::text = $2
       AND is_active = true
       AND agent_id <> $3`,
    [projectId, agentType, keepAgentId],
  );
  return Number(result.rowCount || 0);
}

type CanonicalizeOptions = { deactivateDuplicates?: boolean };

async function getCanonicalActiveAgentRow(
  projectId: string,
  agentType: AgentType,
  options: CanonicalizeOptions = {},
): Promise<any | null> {
  const rows = await listActiveAgentRows(projectId, agentType);
  if (!rows.length) return null;
  const canonical = rows[0];
  if (options.deactivateDuplicates !== false && rows.length > 1) {
    const removed = await deactivateDuplicateActiveRows(projectId, agentType, String(canonical.agent_id));
    if (removed > 0) {
      console.warn(
        '[AGENT_CONFIG_CANONICALIZE] projectId=%s agentType=%s keptAgentId=%s deactivated=%d',
        projectId,
        agentType,
        String(canonical.agent_id),
        removed,
      );
    }
  }
  return canonical;
}

export async function ensureAgentConfig(projectId: string, agentType: AgentType): Promise<AgentConfigRecord | null> {
  const existing = await getAgentConfig(projectId, agentType);
  if (existing) return existing;

  const model_key = pickDefaultModelKey(agentType);
  const prompt_template = defaultPromptTemplate(agentType);
  const response_format = defaultResponseFormat(agentType);
  const temperature =
    agentType === 'llm_chat' ? 0.7 : agentType === 'agent_builder' ? 0.2 : 0;

  return updateAgentConfig(projectId, agentType, {
    provider: 'openai',
    model_key,
    temperature,
    max_tokens: 2048,
    prompt_template,
    response_format,
    tools: [],
  });
}

export async function ensureSystemAgentConfigs(projectId: string) {
  const llm_chat = await ensureAgentConfig(projectId, 'llm_chat');
  const kg_ingest = await ensureAgentConfig(projectId, 'kg_ingest');
  const knowgraph = await ensureAgentConfig(projectId, 'knowgraph');
  const neo4j = await ensureAgentConfig(projectId, 'neo4j');
  const research_agent = await ensureAgentConfig(projectId, 'research_agent');
  return { llm_chat, kg_ingest, knowgraph, neo4j, research_agent };
}

export async function getAgentConfig(projectId: string, agentType: AgentType): Promise<AgentConfigRecord | null> {
  const row = await getCanonicalActiveAgentRow(projectId, agentType, { deactivateDuplicates: true });
  if (!row) {
    return null;
  }
  return rowToConfig(row);
}

export async function updateAgentConfig(
  projectId: string,
  agentType: AgentType,
  patch: AgentConfigPatch,
): Promise<AgentConfigRecord | null> {
  const canonical = await getCanonicalActiveAgentRow(projectId, agentType, { deactivateDuplicates: true });
  const sets: string[] = [];
  const values: any[] = [projectId, agentType];
  let paramIndex = 3;

  if (patch.model_key !== undefined) {
    sets.push(`model = $${paramIndex}`);
    values.push(patch.model_key ?? null);
    paramIndex += 1;
    sets.push(`model_key = $${paramIndex}`);
    values.push(patch.model_key ?? null);
    paramIndex += 1;
  }

  if (patch.provider !== undefined) {
    sets.push(`provider = $${paramIndex}`);
    values.push(normalizeProviderValue(patch.provider));
    paramIndex += 1;
  }

  if (patch.temperature !== undefined) {
    sets.push(`temperature = $${paramIndex}`);
    values.push(patch.temperature ?? null);
    paramIndex += 1;
  }

  if (patch.max_tokens !== undefined) {
    sets.push(`max_tokens = $${paramIndex}`);
    values.push(patch.max_tokens ?? null);
    paramIndex += 1;
  }

  if (patch.tools !== undefined) {
    sets.push(`tools = $${paramIndex}`);
    values.push(JSON.stringify(patch.tools ?? []));
    paramIndex += 1;
  }

  const needsPermissionsUpdate =
    patch.response_format !== undefined ||
    patch.top_p !== undefined ||
    patch.previous_response_id !== undefined ||
    patch.organizing_principle !== undefined ||
    patch.entity_taxonomy !== undefined ||
    patch.relationship_taxonomy !== undefined ||
    patch.extraction_policy !== undefined;
  if (needsPermissionsUpdate) {
    const currentPermissions = normalizeJson(canonical?.permissions, {} as Record<string, unknown>);
    const nextPermissions: Record<string, unknown> = { ...currentPermissions };
    if (patch.response_format !== undefined) {
      const nextText = {
        ...(typeof (nextPermissions as any).text === 'object' ? (nextPermissions as any).text : {}),
        format: patch.response_format ?? null,
      };
      nextPermissions.text = nextText;
      nextPermissions.response_format = patch.response_format ?? null;
    }
    if (patch.top_p !== undefined) {
      nextPermissions.top_p = patch.top_p ?? null;
    }
    if (patch.previous_response_id !== undefined) {
      nextPermissions.previous_response_id = patch.previous_response_id ?? null;
    }
    if (patch.organizing_principle !== undefined) {
      nextPermissions.organizing_principle = patch.organizing_principle ?? null;
    }
    if (patch.entity_taxonomy !== undefined) {
      nextPermissions.entity_taxonomy = patch.entity_taxonomy ?? null;
    }
    if (patch.relationship_taxonomy !== undefined) {
      nextPermissions.relationship_taxonomy = patch.relationship_taxonomy ?? null;
    }
    if (patch.extraction_policy !== undefined) {
      nextPermissions.extraction_policy = patch.extraction_policy ?? null;
    }
    sets.push(`permissions = $${paramIndex}`);
    values.push(JSON.stringify(nextPermissions));
    paramIndex += 1;
  }

  if (patch.prompt_template !== undefined) {
    sets.push(`prompt_template = $${paramIndex}`);
    values.push(patch.prompt_template ?? null);
    paramIndex += 1;
  }

  if (!sets.length) {
    if (canonical) return rowToConfig(canonical);
    return getAgentConfig(projectId, agentType);
  }

  sets.push('updated_at = NOW()');

  let rows: any[] = [];
  if (canonical?.agent_id) {
    const updateValues = [...values, canonical.agent_id];
    const { rows: updatedRows } = await pool.query(
      `UPDATE ag_catalog.project_agents
       SET ${sets.join(', ')}
       WHERE project_id = $1
         AND agent_type::text = $2
         AND is_active = true
         AND agent_id = $${paramIndex}
       RETURNING agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template, tools, permissions,
                 role_text, goal_text, constraints_text, io_schema_text, memory_policy_text`,
      updateValues,
    );
    rows = updatedRows;
  }

  if (!rows.length) {
    const existing = await getAgentConfig(projectId, agentType);
    if (existing) {
      return existing;
    }

    const nextModelKey = patch.model_key ?? null;
    const nextProvider =
      normalizeProviderValue(patch.provider) ??
      deriveProviderFromModelKey(nextModelKey) ??
      null;
    const insertValues = [
      projectId,
      defaultAgentName(agentType),
      agentType,
      nextProvider,
      nextModelKey,
      nextModelKey,
      patch.temperature ?? null,
      patch.max_tokens ?? null,
      patch.prompt_template ?? null,
      JSON.stringify(patch.tools ?? []),
      JSON.stringify({
        text: { format: patch.response_format ?? null },
        response_format: patch.response_format ?? null,
        top_p: patch.top_p ?? null,
        previous_response_id: patch.previous_response_id ?? null,
        organizing_principle: patch.organizing_principle ?? null,
        entity_taxonomy: patch.entity_taxonomy ?? null,
        relationship_taxonomy: patch.relationship_taxonomy ?? null,
        extraction_policy: patch.extraction_policy ?? null,
      }),
    ];
    const inserted = await pool.query(
      `INSERT INTO ag_catalog.project_agents
       (project_id, name, agent_type, is_active, provider, model, model_key, temperature, max_tokens, prompt_template, tools, permissions)
       VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template, tools, permissions,
                 role_text, goal_text, constraints_text, io_schema_text, memory_policy_text`,
      insertValues,
    );
    if (!inserted.rows.length) return null;
    return rowToConfig(inserted.rows[0]);
  }

  return rowToConfig(rows[0]);
}

function defaultTemperatureForAgent(agentType: AgentType): number {
  if (agentType === 'llm_chat') return 0.7;
  if (agentType === 'agent_builder') return 0.2;
  return 0;
}

export type SystemAgentRepairRecord = {
  agent_type: AgentType;
  agent_id: string | null;
  repaired: boolean;
  provider: string | null;
  model_key: string | null;
  max_tokens: number | null;
};

export async function repairSystemAgentConfigs(projectId: string): Promise<SystemAgentRepairRecord[]> {
  const out: SystemAgentRepairRecord[] = [];
  for (const agentType of SYSTEM_AGENT_TYPES) {
    const ensured = await ensureAgentConfig(projectId, agentType);
    const current = ensured || (await getAgentConfig(projectId, agentType));
    if (!current) {
      out.push({
        agent_type: agentType,
        agent_id: null,
        repaired: false,
        provider: null,
        model_key: null,
        max_tokens: null,
      });
      continue;
    }

    const nextModelKey = String(current.model_key || '').trim() || pickDefaultModelKey(agentType);
    const nextProvider =
      normalizeProviderValue(current.provider) ??
      deriveProviderFromModelKey(nextModelKey) ??
      'openai';
    const nextPrompt = String(current.prompt_template || '').trim() || defaultPromptTemplate(agentType);
    const nextMaxTokens =
      typeof current.max_tokens === 'number' && Number.isFinite(current.max_tokens) && current.max_tokens > 0
        ? current.max_tokens
        : 2048;
    const nextTemperature =
      typeof current.temperature === 'number' && Number.isFinite(current.temperature)
        ? current.temperature
        : defaultTemperatureForAgent(agentType);
    const nextResponseFormat =
      current.response_format ?? defaultResponseFormat(agentType);
    const nextTools = Array.isArray(current.tools) ? current.tools : [];

    const patch: AgentConfigPatch = {};
    if (current.model_key !== nextModelKey) patch.model_key = nextModelKey;
    if (normalizeProviderValue(current.provider) !== nextProvider) patch.provider = nextProvider;
    if (String(current.prompt_template || '').trim() !== nextPrompt) patch.prompt_template = nextPrompt;
    if (current.max_tokens !== nextMaxTokens) patch.max_tokens = nextMaxTokens;
    if (current.temperature !== nextTemperature) patch.temperature = nextTemperature;
    if ((agentType === 'kg_ingest' || agentType === 'knowgraph' || agentType === 'neo4j') && !current.response_format) {
      patch.response_format = nextResponseFormat;
    }
    if (!Array.isArray(current.tools)) {
      patch.tools = nextTools;
    }

    const repaired = Object.keys(patch).length > 0;
    const finalCfg = repaired
      ? await updateAgentConfig(projectId, agentType, patch)
      : current;

    out.push({
      agent_type: agentType,
      agent_id: finalCfg?.agent_id || null,
      repaired,
      provider: finalCfg?.provider ?? null,
      model_key: finalCfg?.model_key ?? null,
      max_tokens: finalCfg?.max_tokens ?? null,
    });
  }
  return out;
}

