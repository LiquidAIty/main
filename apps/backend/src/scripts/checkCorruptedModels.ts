import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: 'apps/backend/.env' });

/**
 * Check for corrupted agent.model values containing provider IDs
 * Run with: npx ts-node src/scripts/checkCorruptedModels.ts
 */
async function checkCorruptedModels() {
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity',
    max: 1 
  });

  try {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║           CHECKING FOR CORRUPTED MODEL VALUES                  ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    const { rows } = await pool.query(`
      SELECT agent_id, name, model, agent_type, created_at
      FROM ag_catalog.project_agents 
      WHERE model LIKE '%/%'
      ORDER BY created_at DESC
    `);

    if (rows.length === 0) {
      console.log('  ✅ No corrupted model values found!\n');
      console.log('  All agent.model values are using internal keys.\n');
    } else {
      console.log(`  ⚠️  Found ${rows.length} corrupted record(s):\n`);
      
      rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. Agent: ${row.name}`);
        console.log(`     ID:         ${row.agent_id}`);
        console.log(`     Type:       ${row.agent_type}`);
        console.log(`     Model:      ${row.model} ❌ (contains provider ID)`);
        console.log(`     Created:    ${row.created_at}`);
        console.log('');
      });

      console.log('  📋 SQL to fix these records:\n');
      console.log('  -- Fix OpenRouter models');
      console.log(`  UPDATE ag_catalog.project_agents SET model = 'kimi-k2-thinking' WHERE model = 'moonshotai/kimi-k2-thinking';`);
      console.log(`  UPDATE ag_catalog.project_agents SET model = 'kimi-k2-free' WHERE model = 'moonshotai/kimi-k2:free';`);
      console.log(`  UPDATE ag_catalog.project_agents SET model = 'deepseek-chat' WHERE model = 'deepseek/deepseek-chat';`);
      console.log(`  UPDATE ag_catalog.project_agents SET model = 'phi-4' WHERE model = 'microsoft/phi-4';`);
      console.log('');
      console.log('  -- Fix OpenAI models (if any)');
      console.log(`  UPDATE ag_catalog.project_agents SET model = 'gpt-5-nano' WHERE model LIKE '%gpt-5-nano%' AND model LIKE '%/%';`);
      console.log(`  UPDATE ag_catalog.project_agents SET model = 'gpt-5-mini' WHERE model LIKE '%gpt-5-mini%' AND model LIKE '%/%';`);
      console.log(`  UPDATE ag_catalog.project_agents SET model = 'gpt-5' WHERE model = 'gpt-5' AND model LIKE '%/%';`);
      console.log('');
    }

    console.log('════════════════════════════════════════════════════════════════\n');
  } catch (err: any) {
    console.error('Error checking corrupted models:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

checkCorruptedModels().catch(console.error);
