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

type ModelConfigDependencies = {
  listProjects?: () => Promise<Array<{ id: string; code: string; name: string }>>;
  readDeck?: typeof getDeckDocument;
  write?: (message: string) => void;
  writeError?: (message: string) => void;
};

export async function logModelConfiguration(
  dependencies: ModelConfigDependencies = {},
) {
  const write = dependencies.write ?? console.log;
  const writeError = dependencies.writeError ?? console.error;
  const listProjects = dependencies.listProjects ?? (async () => {
    const { rows } = await pool.query(
      `SELECT id::text AS id, COALESCE(code, '') AS code, COALESCE(name, '') AS name
         FROM ag_catalog.projects
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
    );
    return rows;
  });
  const readDeck = dependencies.readDeck ?? getDeckDocument;

  write('\n╔════════════════════════════════════════════════════════════════╗');
  write('║        AGENT MODELS (live saved deck — real authority)        ║');
  write('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    const rows = await listProjects();

    let printedAny = false;
    let unavailableProjects = 0;
    let malformedProjects = 0;
    for (const project of rows) {
      const projectLabel = String(project.name || project.code || project.id).trim();
      let deck: Awaited<ReturnType<typeof getDeckDocument>>['deck'] = null;
      try {
        ({ deck } = await readDeck(project.id, BUILDER_DECK_ID));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'python_deck_response_invalid') {
          malformedProjects += 1;
          writeError(`  ❌ Saved Agent Canvas deck malformed for Project ${projectLabel}: ${message}`);
        } else {
          unavailableProjects += 1;
          writeError(`  ❌ Saved Agent Canvas deck unavailable for Project ${projectLabel}: ${message}`);
        }
        continue;
      }
      if (!deck || deck.nodes.length === 0) continue;
      printedAny = true;

      write(`  Project ${projectLabel}:`);
      for (const card of deck.nodes) {
        const label = String(card.title || card.id).trim();
        const modelKey = String(card.runtimeOptions?.modelKey || '').trim() || '(unset)';
        const provider = derivePrintableProvider(card);
        write(`    ${label} [${cardRoleTag(card)}]:`);
        write(`      Provider:  ${provider}`);
        write(`      Model:     ${modelKey}`);
      }
      write('');
    }

    if (!printedAny) {
      if (malformedProjects > 0) {
        write('  (saved Agent Canvas deck response malformed — model routing not reported)\n');
      } else if (unavailableProjects > 0) {
        write('  (saved Agent Canvas deck state unavailable — model routing not reported)\n');
      } else {
        write('  (no saved Agent Canvas deck found — nothing routes yet)\n');
      }
    }
    write('════════════════════════════════════════════════════════════════\n');
  } catch (err: any) {
    const msg = err?.message || String(err);
    const code = err?.code ? ` (${err.code})` : '';
    writeError(`  ❌ Failed to load live deck configs${code}: ${msg}`);
    write('');
  }
}
