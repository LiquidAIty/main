import { pool } from '../db/pool';
import { resolveModel } from '../llm/models.config';

type SystemAgentType = 'llm_chat' | 'kg_ingest' | 'knowgraph' | 'neo4j' | 'research_agent';

function systemAgentLabel(agentType: SystemAgentType): string {
  if (agentType === 'llm_chat') return 'Main Chat';
  if (agentType === 'kg_ingest') return 'ThinkGraph';
  if (agentType === 'knowgraph') return 'KnowGraph';
  if (agentType === 'research_agent') return 'Research Agent';
  return 'Neo4j';
}

function resolveProviderModelId(modelKey: string): string {
  const normalizedModelKey = String(modelKey || '').trim();
  if (!normalizedModelKey) return '(not set)';
  if (normalizedModelKey.includes('/')) return normalizedModelKey;
  try {
    return resolveModel(normalizedModelKey).id;
  } catch {
    return normalizedModelKey;
  }
}

function normalizeProvider(value: unknown): 'openai' | 'openrouter' | null {
  const provider = String(value ?? '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'openrouter') return provider;
  return null;
}

function deriveProviderFromModel(modelKey: string): 'openai' | 'openrouter' | null {
  const key = String(modelKey || '').trim();
  if (!key) return null;
  try {
    return resolveModel(key).provider;
  } catch {
    if (key.includes('/')) return 'openrouter';
    if (/^gpt-|^o\d|^text-embedding/i.test(key)) return 'openai';
    return null;
  }
}

function scoreRow(row: any): number {
  const modelKey = String(row?.model_key ?? row?.model ?? '').trim();
  const provider = normalizeProvider(row?.provider) ?? deriveProviderFromModel(modelKey);
  const prompt = String(row?.prompt_template ?? '').trim();
  let score = 0;
  if (provider) score += 4;
  if (modelKey) score += 4;
  if (prompt) score += 2;
  if (typeof row?.max_tokens === 'number') score += 1;
  return score;
}

function rowTimeMs(row: any, key: 'updated_at' | 'created_at'): number {
  const raw = row?.[key];
  if (!raw) return 0;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : 0;
}

function pickCanonicalRow(rows: any[]): any | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => {
    const scoreDiff = scoreRow(b) - scoreRow(a);
    if (scoreDiff !== 0) return scoreDiff;
    const updatedDiff = rowTimeMs(b, 'updated_at') - rowTimeMs(a, 'updated_at');
    if (updatedDiff !== 0) return updatedDiff;
    const createdDiff = rowTimeMs(b, 'created_at') - rowTimeMs(a, 'created_at');
    if (createdDiff !== 0) return createdDiff;
    return String(a?.agent_id ?? '').localeCompare(String(b?.agent_id ?? ''));
  });
  return sorted[0];
}

export async function logModelConfiguration() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║              AGENT MODELS (from Agent Builder)                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    const { rows } = await pool.query(
      `SELECT project_id,
              agent_id,
              agent_type,
              provider,
              COALESCE(model_key, model) AS model_key,
              temperature,
              max_tokens,
              prompt_template,
              updated_at,
              created_at
       FROM ag_catalog.project_agents
       WHERE is_active = true
         AND agent_type::text IN ('llm_chat', 'kg_ingest', 'knowgraph', 'neo4j', 'research_agent')`,
    );

    const byType = new Map<string, any[]>();
    rows.forEach((row: any) => {
      const type = String(row.agent_type || '').trim();
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)?.push(row);
    });
    const ordered: SystemAgentType[] = ['llm_chat', 'kg_ingest', 'knowgraph', 'neo4j', 'research_agent'];
    ordered.forEach((agentType) => {
      const row = pickCanonicalRow(byType.get(agentType) || []);
      const label = systemAgentLabel(agentType);
      if (!row) {
        console.log(`  ${label}:`);
        console.log('    Provider:    (not configured)');
        console.log('    Model:       (not configured)');
        console.log('    Max Tokens:  (not configured)');
        console.log('');
        return;
      }
      const modelKey = String(row.model_key || '').trim();
      const effectiveModelKey = modelKey;
      const derivedProvider = deriveProviderFromModel(effectiveModelKey);
      const provider =
        derivedProvider === 'openrouter'
            ? 'openrouter'
            : normalizeProvider(row.provider) ?? derivedProvider ?? 'unknown';
      const providerModelId = resolveProviderModelId(effectiveModelKey);
      console.log(`  ${label}:`);
      console.log(`    Provider:    ${provider}`);
      console.log(`    Model:       ${effectiveModelKey || '(not set)'} (${providerModelId})`);
      console.log(`    Max Tokens:  ${row.max_tokens ?? 'default'}`);
      console.log('');
    });

    console.log('════════════════════════════════════════════════════════════════\n');
  } catch (err: any) {
    const msg = err?.message || String(err);
    const code = err?.code ? ` (${err.code})` : '';
    console.error(`  ❌ Failed to load configs${code}: ${msg}`);
    console.log('');
  }
}

