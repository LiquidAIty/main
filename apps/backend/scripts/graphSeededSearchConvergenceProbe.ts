// Deterministic graph-seeded search convergence probe. NO live web, NO crawler, NO model.
// Loads an RDW/SpaceX graph seed fixture -> compiles bounded search tasks -> scores three
// deterministic result packets -> prints the convergence report. Exits 0 only if the expected
// partial-convergence checks pass. Proves the primitive without any search tool wired.
//   npx tsx apps/backend/scripts/graphSeededSearchConvergenceProbe.ts
import {
  buildGraphSeededSearchTasks,
  detectSearchConvergence,
  graphSearchSeedFromExtraction,
  type SearchAgentResultPacket,
} from '../src/slmGraph/graphSeededSearchConvergence';

const SEED = graphSearchSeedFromExtraction(
  {
    entities: [
      { id: 'e_rdw', label: 'Redwire Corporation', type: 'company' },
      { id: 'e_rdw_ticker', label: 'RDW', type: 'ticker' },
      { id: 'e_spacex', label: 'SpaceX', type: 'company' },
    ],
    relations: [
      { from: 'e_rdw_ticker', to: 'e_rdw', type: 'identifies' },
      { from: 'e_t1', to: 'e_rdw', type: 'requires' },
      { from: 'e_t2', to: 'e_spacex', type: 'requires' },
    ],
    nextSearchSeedCandidates: ['live_market_data_for_RDW', 'private_market_sources_for_SpaceX'],
    sourceRefs: [{ ref: 'user_request_stream' }],
  } as any,
  { projectId: 'magone-graphpayload-test', sourceRef: 'user_request_stream', freshness: 'P7D' },
);

const PACKETS: SearchAgentResultPacket[] = [
  {
    agentId: 'agent-rdw', searchTaskId: 't_entity_1', query: 'RDW Redwire Corporation current price live market data',
    sourceRefs: [{ ref: 'redwire-investor', url: 'https://www.redwirespace.com/investors', title: 'Redwire Investors', sourceType: 'web' }],
    entities: [{ label: 'RDW', type: 'ticker', confidence: 0.9 }, { label: 'Redwire Corporation', type: 'company', confidence: 0.95 }],
    relations: [{ from: 'RDW', to: 'live_market_data', type: 'requires', confidence: 0.85 }],
    claims: [{ subject: 'RDW', predicate: 'last_close_source', object: 'marketdata_feed_a', sourceRef: 'redwire-investor', confidence: 0.6 }],
    uncertainty: ['live RDW price unknown until market-data lookup'],
  },
  {
    agentId: 'agent-spacex', searchTaskId: 't_entity_3', query: 'SpaceX private market valuation tender offer secondary market',
    sourceRefs: [{ ref: 'forge-secondary', url: 'https://forgeglobal.com/spacex', title: 'SpaceX secondary', sourceType: 'web' }],
    entities: [{ label: 'SpaceX', type: 'company', confidence: 0.95 }],
    relations: [{ from: 'SpaceX', to: 'secondary_market_sources', type: 'requires', confidence: 0.85 }],
    claims: [],
    uncertainty: ['SpaceX is private; no public stock price'],
  },
  {
    agentId: 'agent-infra', searchTaskId: 't_class_neighborhood', query: 'Redwire SpaceX suppliers space infrastructure public companies',
    sourceRefs: [{ ref: 'redwire-investor', url: 'https://www.redwirespace.com/investors', title: 'Redwire Investors', sourceType: 'web' }],
    entities: [
      { label: 'Redwire Corporation', type: 'company', confidence: 0.9 },
      { label: 'SpaceX', type: 'company', confidence: 0.9 },
      { label: 'RDW', type: 'ticker', confidence: 0.8 },
      { label: 'space infrastructure suppliers', type: 'sector', confidence: 0.7 },
    ],
    relations: [{ from: 'Redwire Corporation', to: 'space infrastructure suppliers', type: 'supplies', confidence: 0.7 }],
    claims: [{ subject: 'RDW', predicate: 'last_close_source', object: 'investor_page_c', sourceRef: 'redwire-investor', confidence: 0.55 }],
    uncertainty: [],
  },
];

function main() {
  const tasks = buildGraphSeededSearchTasks(SEED);
  console.log('[converge] seed entities  =', SEED.seedEntities.join(', '));
  console.log('[converge] seed relations =', SEED.seedRelations.join(', '));
  console.log('[converge] seed classes   =', (SEED.seedClasses || []).join(', '));
  console.log('[converge] search tasks   =');
  for (const t of tasks) console.log(`  - [${t.kind}] ${t.query}`);

  const report = detectSearchConvergence(PACKETS, SEED);
  console.log('[converge] report =\n', JSON.stringify(report, null, 2));

  const blob = JSON.stringify(report).toLowerCase();
  const checks: Array<[string, boolean]> = [
    ['tasks compiled from graph seed', tasks.length > 0],
    ['repeated entities detected (RDW/Redwire/SpaceX)', ['rdw', 'redwire corporation', 'spacex'].every((e) => report.repeatedEntities.map((x) => x.toLowerCase()).includes(e))],
    ['repeated relation detected (requires)', report.repeatedRelations.map((r) => r.toLowerCase()).includes('requires')],
    ['overlapping sourceRef domain detected', report.overlappingSourceRefs.includes('redwirespace.com')],
    ['stable class detected (company)', report.stableClasses.map((c) => c.toLowerCase()).includes('company')],
    ['convergenceScore > 0', report.convergenceScore > 0],
    ['not converged on thin support', report.converged === false],
    ['unresolved contradiction preserved', report.unresolvedContradictions.length > 0],
    ['next search seeds produced', report.nextSearchSeedCandidates.length > 0],
    ['no invented dollar price', !/\$\s?\d/.test(blob)],
    ['no invented SpaceX public stock price', !/spacex[^.]{0,30}(stock price|share price|ticker)/.test(blob)],
  ];
  for (const [name, pass] of checks) console.log(`[converge] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[converge] RESULT =', allPass ? 'PASS (graph-seeded search convergence primitive proven; live search NOT wired)' : 'FAIL');
  process.exitCode = allPass ? 0 : 1;
}

main();
