import { pool } from '../db/pool';
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import type { AgentCardInstance } from '../types';

// The REAL runtime authority for every agent's provider/model is the saved
// Agent Canvas deck (Python-owned relational Deck/Card domain → deck_builder),
// resolved by the runtime owner. This boot banner reads saved values only so it
// reflects configured routing: graph services (Engraphis/Graphiti/Neo4j) never
// appear as agents, and each card shows its own saved provider/model.

function derivePrintableProvider(card: AgentCardInstance): string {
  const savedProvider = String(card.runtimeOptions?.provider || '').trim();
  return savedProvider || '(unset)';
}

function cardRoleTag(card: AgentCardInstance): string {
  return `${card.runtime.kind}/${card.runtime.mode}`;
}

export async function logModelConfiguration() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║        AGENT MODELS (live saved deck — real authority)        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    const { rows } = await pool.query(
      `SELECT id::text AS id, COALESCE(code, '') AS code, COALESCE(name, '') AS name
         FROM ag_catalog.projects
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
    );

    let printedAny = false;
    for (const project of rows) {
      let deck: Awaited<ReturnType<typeof getDeckDocument>>['deck'] = null;
      try {
        ({ deck } = await getDeckDocument(project.id, BUILDER_DECK_ID));
      } catch {
        continue; // project without a readable builder deck — skip, never invent one
      }
      if (!deck || deck.nodes.length === 0) continue;
      printedAny = true;

      const projectLabel = String(project.name || project.code || project.id).trim();
      console.log(`  Project ${projectLabel}:`);
      for (const card of deck.nodes) {
        const label = String(card.title || card.id).trim();
        const modelKey = String(card.runtimeOptions?.modelKey || '').trim() || '(unset)';
        const provider = derivePrintableProvider(card);
        console.log(`    ${label} [${cardRoleTag(card)}]:`);
        console.log(`      Provider:  ${provider}`);
        console.log(`      Model:     ${modelKey}`);
      }
      console.log('');
    }

    if (!printedAny) {
      console.log('  (no saved Agent Canvas deck found — nothing routes yet)\n');
    }
    console.log('════════════════════════════════════════════════════════════════\n');
  } catch (err: any) {
    const msg = err?.message || String(err);
    const code = err?.code ? ` (${err.code})` : '';
    console.error(`  ❌ Failed to load live deck configs${code}: ${msg}`);
    console.log('');
  }
}
