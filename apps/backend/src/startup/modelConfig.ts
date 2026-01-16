import { MODEL_REGISTRY, resolveModel } from '../llm/models.config';

/**
 * Log resolved model configuration on startup
 * Shows internal keys and their resolved provider IDs
 */
export function logModelConfiguration() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    MODEL CONFIGURATION                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Chat model (main assistant)
  const chatModelKey = process.env.DEFAULT_MODEL || 'gpt-5-nano';
  try {
    const chatModel = resolveModel(chatModelKey);
    console.log('  [CHAT MODEL]');
    console.log(`    Internal Key:      ${chatModelKey}`);
    console.log(`    Provider:          ${chatModel.provider}`);
    console.log(`    Provider Model ID: ${chatModel.id}`);
    console.log('');
  } catch (err: any) {
    console.error(`  [CHAT MODEL] ERROR: ${err.message}`);
    console.log('');
  }

  // KG Ingest model
  const kgModelKey = process.env.OPENROUTER_DEFAULT_KG_MODEL_KEY || 'kimi-k2-thinking';
  try {
    const kgModel = resolveModel(kgModelKey);
    console.log('  [KG INGEST MODEL]');
    console.log(`    Internal Key:      ${kgModelKey}`);
    console.log(`    Provider:          ${kgModel.provider}`);
    console.log(`    Provider Model ID: ${kgModel.id}`);
    console.log('');
  } catch (err: any) {
    console.error(`  [KG INGEST MODEL] ERROR: ${err.message}`);
    console.log('');
  }

  // Chunking model (same as KG ingest)
  console.log('  [CHUNKING MODEL]');
  console.log(`    Internal Key:      ${kgModelKey} (same as KG ingest)`);
  console.log(`    Provider:          ${kgModelKey === 'kimi-k2-thinking' ? 'openrouter' : 'N/A'}`);
  console.log(`    Provider Model ID: ${kgModelKey === 'kimi-k2-thinking' ? 'moonshotai/kimi-k2-thinking' : 'N/A'}`);
  console.log('');

  // Embedding model (provider ID is OK for embeddings)
  const embedModel = process.env.OPENROUTER_DEFAULT_EMBED_MODEL || 'openai/text-embedding-3-small';
  console.log('  [EMBEDDING MODEL]');
  console.log(`    Provider Model ID: ${embedModel}`);
  console.log('');

  // Validation warnings
  const warnings: string[] = [];
  
  if (chatModelKey.includes('/')) {
    warnings.push(`CHAT model key contains '/' - should be internal key, not provider ID`);
  }
  if (kgModelKey.includes('/')) {
    warnings.push(`KG INGEST model key contains '/' - should be internal key, not provider ID`);
  }
  if (!MODEL_REGISTRY[chatModelKey]) {
    warnings.push(`CHAT model key '${chatModelKey}' not found in MODEL_REGISTRY`);
  }
  if (!MODEL_REGISTRY[kgModelKey]) {
    warnings.push(`KG INGEST model key '${kgModelKey}' not found in MODEL_REGISTRY`);
  }

  if (warnings.length > 0) {
    console.log('  ⚠️  WARNINGS:');
    warnings.forEach(w => console.log(`    - ${w}`));
    console.log('');
  } else {
    console.log('  ✅ All model keys validated\n');
  }

  console.log('════════════════════════════════════════════════════════════════\n');
}
