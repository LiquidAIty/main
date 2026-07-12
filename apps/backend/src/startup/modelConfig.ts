import { pool } from '../db/pool';
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveModel } from '../llm/models.config';
import type { AgentCardInstance } from '../types';

// The REAL runtime authority for every agent's provider/model is the saved
// Agent Canvas deck (project agent_io_schema → v3_state → decks[deck_builder]),
// resolved per-card from runtimeOptions by cards/runtime.ts. The legacy
// ag_catalog.project_agents table is a separate seed table (defaulted to
// openai) that no live chat path consumes — only the dead kg_ingest/neo4j/
// research_agent resolvers and the knowgraph-ingest config read it, so it must
// NOT be presented as the agent roster. This boot banner reads the deck so it
// reflects real routing: graph services (ThinkGraph/KnowGraph/Neo4j) never
// appear as agents, and each card shows its own saved provider/model.

function derivePrintableProvider(card: AgentCardInstance): string {
  const modelKey = String(card.runtimeOptions?.modelKey || '').trim();
  const savedProvider = String(card.runtimeOptions?.provider || '').trim();
  if (modelKey) {
    if (modelKey.includes('/')) return savedProvider || 'openrouter';
    try {
      return resolveModel(modelKey).provider;
    } catch {
      // Unknown key: trust the card's own saved provider if it set one.
    }
  }
  return savedProvider || '(unset)';
}

function cardRoleTag(card: AgentCardInstance): string {
  if (card.runtimeType === 'magentic_one') return 'orchestrator';
  if (card.runtimeType === 'local_coder') return 'local_coder';
  const binding = String(card.runtimeBinding || '').trim();
  return binding || 'agent';
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
