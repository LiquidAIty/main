import { pool } from '../db/pool';
import { resolveModel } from '../llm/models.config';

export async function logModelConfiguration() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║              AGENT MODELS (from Agent Builder)                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    const { rows } = await pool.query(`
      SELECT 
        name,
        model,
        temperature,
        max_tokens
      FROM ag_catalog.project_agents
      WHERE is_active = true
        AND name IN ('Main Chat', 'KG Ingest')
      ORDER BY 
        CASE name 
          WHEN 'Main Chat' THEN 1
          WHEN 'KG Ingest' THEN 2
          ELSE 3
        END
    `);

    if (rows.length === 0) {
      console.log('  ⚠️  No agents configured');
      console.log('');
      return;
    }

    for (const agent of rows) {
      const modelKey = agent.model || '(not set)';
      let providerInfo = '';
      
      if (modelKey !== '(not set)') {
        try {
          const resolved = resolveModel(modelKey);
          providerInfo = ` (${resolved.provider}/${resolved.id})`;
        } catch {
          providerInfo = ' (invalid)';
        }
      }

      console.log(`  ${agent.name}:`);
      console.log(`    Model:       ${modelKey}${providerInfo}`);
      console.log(`    Temperature: ${agent.temperature ?? 'default'}`);
      console.log(`    Max Tokens:  ${agent.max_tokens ?? 'default'}`);
      console.log('');
    }

    console.log('════════════════════════════════════════════════════════════════\n');
  } catch (err: any) {
    const msg = err?.message || String(err);
    const code = err?.code ? ` (${err.code})` : '';
    console.error(`  ❌ Failed to load configs${code}: ${msg}`);
    console.log('');
  }
}

