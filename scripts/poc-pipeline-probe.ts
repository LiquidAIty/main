/**
 * POC pipeline probe — the checked-in, repeatable diagnostic for the
 * Main Chat → Mag One → workers → graph memory pipeline.
 *
 *   npx tsx scripts/poc-pipeline-probe.ts \
 *     --project 20ac92da-01fd-4cf6-97cc-0672421e751a --deck deck_builder --conversation main
 *
 * It plugs into each pipe in order and prints one PASS/FAIL/SKIP line per
 * stage with the real evidence (counts, ids, tools, errors). Nothing here
 * fakes success: every check reads live state and reports exactly what came
 * back. The optional live Mag One team run is OFF by default and only runs
 * with the explicit `--live-mag-one` flag.
 *
 * Stages (the authority chain: Harness RunIntent → Hermes preflight →
 * RunPacket → Mag One → Hermes postflight → graph memory):
 *   1  backend-health        GET  /api/health  (chat entry reachable)
 *   2  services-listening    TCP  5173 (frontend) / 8003 (autogen) / 50051 (gRPC = Harness,
 *                            the RunIntent owner)
 *   3  deck-topology         GET  /api/projects/:p/decks/:d  (bus edges = authority)
 *   4  mag-one-view          POST /api/coder/mcp-bridge/describe_connected_agents
 *                            (blank deckId → canonical-deck default is part of the check;
 *                            disconnected cards must be structurally absent)
 *   5  hermes-preflight      POST /api/coder/mcp-bridge/hermes_preflight
 *                            (ContextPacket returned + RunPacket draft fields validated)
 *   6  thinkgraph-read       GET  /api/thinkgraph/projection + POST mcp-bridge/thinkgraph_read_scope
 *   7  knowgraph-read        services/knowgraph/hybrid_retrieval_probe.py (read-only, real Neo4j)
 *   8  hermes-activity       GET  /api/coder/hermes/activity (honest empty is a PASS)
 *   9  hermes-postflight     POST /api/coder/hermes/postflight with an empty body — the
 *                            expected 400 runId_required proves the path exists while
 *                            writing NOTHING (no fake run records, ever)
 *   10 runs-and-history      GET  /api/projects/:p/decks (latest run ids) +
 *                            GET  /api/coder/openclaude/session/history
 *   11 live-mag-one          POST /api/coder/mcp-bridge/run_mag_one  [gated: --live-mag-one]
 *
 * Output ends with a PASS/FAIL summary plus the CARD ROLE MAP read from the
 * live deck. Exit code: 0 when every non-skipped stage passes; 1 otherwise.
 */

import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM module — no __dirname; resolve this file's directory from import.meta.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ── args ─────────────────────────────────────────────────────────────────────

export type ProbeArgs = {
  project: string;
  deck: string;
  conversation: string;
  backend: string;
  liveMagOne: boolean;
};

export function parseProbeArgs(argv: string[]): ProbeArgs {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    project: get('project', ''),
    deck: get('deck', 'deck_builder'),
    conversation: get('conversation', 'main'),
    // 127.0.0.1, not localhost: Node ≥17 resolves localhost IPv6-first and the
    // backend listens on IPv4 only, so a bare localhost fetch fails.
    backend: get('backend', 'http://127.0.0.1:4000').replace(/\/$/, ''),
    liveMagOne: argv.includes('--live-mag-one'),
  };
}

// ── pure topology helpers (unit-tested in poc-pipeline-probe.spec.ts) ───────
// The BACKEND's resolvedMagenticOptions stays the runtime authority; this local
// filter only recomputes eligibility from the raw deck JSON so stage 4 can
// cross-check "what the deck says" against "what Mag One actually sees".

type DeckNode = {
  id: string;
  kind?: string;
  runtimeType?: string | null;
  runtimeBinding?: string | null;
  parentGraphId?: string | null;
  runtimeOptions?: { tools?: unknown; binding?: unknown; modelKey?: unknown; provider?: unknown } | null;
  title?: string;
};
type DeckEdge = { source: string; target: string; edgeType?: string };

function cardToolNames(node: DeckNode): string[] {
  const tools = node.runtimeOptions?.tools;
  return Array.isArray(tools)
    ? tools.filter((tool): tool is string => typeof tool === 'string')
    : [];
}

export function busConnectedCardIds(nodes: DeckNode[], edges: DeckEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const orchestrators = nodes.filter(
    (n) => String(n.runtimeType || '').trim().toLowerCase() === 'magentic_one',
  );
  const connected = new Set<string>();
  for (const orch of orchestrators) {
    for (const edge of edges) {
      if (String(edge.edgeType || '').trim().toLowerCase() !== 'magentic_option') continue;
      if (edge.source !== orch.id && edge.target !== orch.id) continue;
      const otherId = edge.source === orch.id ? edge.target : edge.source;
      const other = byId.get(otherId);
      if (!other || String(other.kind || 'agent') !== 'agent') continue;
      if (String(other.parentGraphId || '').trim()) continue;
      connected.add(otherId);
    }
  }
  return [...connected].sort();
}

export function setDifference(a: string[], b: string[]): string[] {
  const bs = new Set(b);
  return a.filter((x) => !bs.has(x));
}

/** Required RunPacket-draft fields (runtimeContracts.RunPacketDraft) — the
 * bounded packet contract stage 5 defends. Returns the missing field names. */
export function runPacketDraftMissingFields(draft: any): string[] {
  const missing: string[] = [];
  const hasText = (key: string) => typeof draft?.[key] === 'string' && draft[key].trim().length > 0;
  const hasArray = (key: string, nonEmpty: boolean) =>
    Array.isArray(draft?.[key]) && (!nonEmpty || draft[key].length > 0);
  for (const key of ['userRequest', 'projectId', 'deckId', 'conversationId', 'hermesContextSummary', 'expectedVisibleOutput', 'promptMarkdown']) {
    if (!hasText(key)) missing.push(key);
  }
  if (!hasArray('connectedParticipants', true)) missing.push('connectedParticipants');
  if (!hasArray('disconnectedExclusions', false)) missing.push('disconnectedExclusions');
  if (!hasArray('proofRequirements', true)) missing.push('proofRequirements');
  if (!hasArray('noFallbackRules', true)) missing.push('noFallbackRules');
  for (const graph of ['thinkGraph', 'knowGraph', 'codeGraph']) {
    if (!String(draft?.graphContext?.[graph] || '').trim()) missing.push(`graphContext.${graph}`);
  }
  return missing;
}

// ── stage runner ─────────────────────────────────────────────────────────────

type StageOutcome = 'PASS' | 'FAIL' | 'SKIP';
const results: Array<{ stage: string; outcome: StageOutcome; detail: string }> = [];

function report(stage: string, outcome: StageOutcome, detail: string): void {
  results.push({ stage, outcome, detail });
  const mark = outcome === 'PASS' ? '✓' : outcome === 'FAIL' ? '✗' : '○';
  console.log(`${mark} [${outcome}] ${stage} — ${detail}`);
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 200)}`);
  return body;
}

async function postJson(url: string, payload: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 200)}`);
  return body;
}

function checkPort(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

// The narrowed POC board contract this probe defends.
const EXPECTED_CONNECTED = [
  'card_hermes_steward',
  'card_knowgraph_agent',
  'card_main_chat',
  'card_research_agent',
  'card_thinkgraph_agent',
];
const EXPECTED_DISCONNECTED = [
  'card_codegraph_agent',
  'card_local_coder',
  'card_plan_agent',
  'card_trading_workbench',
  'card_worldsignals_agent',
];
const EXPECTED_MAG_ONE_PROVIDER = 'openrouter';
const EXPECTED_MAG_ONE_MODEL = 'openai/gpt-5.1-chat';

async function main(): Promise<void> {
  const args = parseProbeArgs(process.argv.slice(2));
  if (!args.project) {
    console.error('usage: npx tsx scripts/poc-pipeline-probe.ts --project <id> [--deck deck_builder] [--conversation main] [--backend http://localhost:4000] [--live-mag-one]');
    process.exit(2);
  }
  console.log(`POC pipeline probe — project=${args.project} deck=${args.deck} conversation=${args.conversation}`);
  console.log('');
  const repoRoot = path.resolve(SCRIPT_DIR, '..');

  // 1 — backend health
  try {
    const health = await getJson(`${args.backend}/api/health`);
    report('backend-health', health?.status === 'ok' ? 'PASS' : 'FAIL', JSON.stringify(health));
  } catch (err: any) {
    report('backend-health', 'FAIL', String(err?.message || err));
  }

  // Chat route reachability without a model call, transcript write, or turn.
  try {
    const response = await fetch(`${args.backend}/api/coder/openclaude/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await response.json().catch(() => null);
    const ok = response.status === 400 && body?.error === 'projectId_and_message_required';
    report(
      'chat-sse-route',
      ok ? 'PASS' : 'FAIL',
      ok
        ? 'route reachable — missing payload rejected before any chat turn starts'
        : `unexpected status=${response.status} body=${JSON.stringify(body)?.slice(0, 160)}`,
    );
  } catch (err: any) {
    report('chat-sse-route', 'FAIL', String(err?.message || err));
  }

  // 2 — sibling services listening
  const [frontendUp, autogenUp, grpcUp] = await Promise.all([
    checkPort(5173),
    checkPort(8003),
    checkPort(50051),
  ]);
  report(
    'services-listening',
    frontendUp && autogenUp && grpcUp ? 'PASS' : 'FAIL',
    `frontend:5173=${frontendUp ? 'up' : 'DOWN'} autogen:8003=${autogenUp ? 'up' : 'DOWN'} grpc:50051=${grpcUp ? 'up' : 'DOWN'}`,
  );

  // 3 — deck topology (bus edges are the only activation authority)
  let deckNodes: DeckNode[] = [];
  let connectedIds: string[] = [];
  try {
    const doc = await getJson(`${args.backend}/api/projects/${args.project}/decks/${args.deck}`);
    deckNodes = (doc?.deck?.nodes || []) as DeckNode[];
    const edges = (doc?.deck?.edges || []) as DeckEdge[];
    const connected = busConnectedCardIds(deckNodes, edges);
    connectedIds = connected;
    const missingConnected = setDifference(EXPECTED_CONNECTED, connected);
    const wronglyConnected = connected.filter((id) => EXPECTED_DISCONNECTED.includes(id));
    const toolsLine = deckNodes
      .filter((n) => connected.includes(n.id))
      .map((n) => `${n.id}:[${cardToolNames(n).join(',')}]`)
      .join(' ');
    const ok = missingConnected.length === 0 && wronglyConnected.length === 0;
    report(
      'deck-topology',
      ok ? 'PASS' : 'FAIL',
      `cards=${deckNodes.length} busEdges=${edges.filter((e) => String(e.edgeType).toLowerCase() === 'magentic_option').length} connected=[${connected.join(',')}]` +
        (missingConnected.length ? ` MISSING=[${missingConnected.join(',')}]` : '') +
        (wronglyConnected.length ? ` WRONGLY_CONNECTED=[${wronglyConnected.join(',')}]` : '') +
        ` tools: ${toolsLine}`,
    );
  } catch (err: any) {
    report('deck-topology', 'FAIL', String(err?.message || err));
  }

  // Model authority on the real Mag One card. The probe reads but never
  // changes a deck; a stale provider/model is an explicit failure.
  const magenticCard = deckNodes.find(
    (node) => String(node.runtimeType || '').trim().toLowerCase() === 'magentic_one',
  );
  const magenticProvider = String(magenticCard?.runtimeOptions?.provider || '').trim();
  const magenticModel = String(magenticCard?.runtimeOptions?.modelKey || '').trim();
  report(
    'mag-one-model',
    magenticProvider === EXPECTED_MAG_ONE_PROVIDER && magenticModel === EXPECTED_MAG_ONE_MODEL
      ? 'PASS'
      : 'FAIL',
    magenticCard
      ? `card=${magenticCard.id} provider=${magenticProvider || 'missing'} model=${magenticModel || 'missing'} openrouter=${magenticProvider === 'openrouter'}`
      : 'Magentic-One card missing from deck',
  );

  // 4 — Mag One's own view (server-side resolvedMagenticOptions; blank deckId
  //     also proves the canonical-deck default on the bridge)
  try {
    const view = await postJson(`${args.backend}/api/coder/mcp-bridge/describe_connected_agents`, {
      projectId: args.project,
    });
    const agents: Array<{ cardId: string; tools: string[] }> = view?.connectedAgents || [];
    const seen = agents.map((a) => a.cardId).sort();
    // Mag One's worker view excludes the main_chat front door by design.
    const expectedWorkers = EXPECTED_CONNECTED.filter((id) => id !== 'card_main_chat');
    const missing = setDifference(expectedWorkers, seen);
    const leaked = seen.filter((id) => EXPECTED_DISCONNECTED.includes(id));
    const ok = Boolean(view?.ok) && missing.length === 0 && leaked.length === 0;
    report(
      'mag-one-view',
      ok ? 'PASS' : 'FAIL',
      `deckIdDefaulted=${view?.deckId === args.deck} workers=[${seen.join(',')}]` +
        (missing.length ? ` MISSING=[${missing.join(',')}]` : '') +
        (leaked.length ? ` DISCONNECTED_LEAKED=[${leaked.join(',')}]` : '') +
        ` tools: ${agents.map((a) => `${a.cardId}:[${(a.tools || []).join(',')}]`).join(' ')}`,
    );
  } catch (err: any) {
    report('mag-one-view', 'FAIL', String(err?.message || err));
  }

  // 5 — Hermes preflight (ContextPacket returned + RunPacket draft validated).
  //     Read-only by contract: the only side effect is a real activity entry.
  try {
    const preflight = await postJson(`${args.backend}/api/coder/mcp-bridge/hermes_preflight`, {
      projectId: args.project,
      deckId: args.deck,
      conversationId: args.conversation,
      userRequest: 'Pipeline probe preflight check (no run will be started).',
    });
    const context = preflight?.contextPacket;
    const draft = preflight?.runPacketDraft;
    const missingFields = runPacketDraftMissingFields(draft);
    const draftConnected: string[] = Array.isArray(draft?.connectedParticipants)
      ? draft.connectedParticipants
      : [];
    const expectedWorkers = EXPECTED_CONNECTED.filter((id) => id !== 'card_main_chat');
    const missingWorkers = setDifference(expectedWorkers, draftConnected);
    const leaked = draftConnected.filter((id) => EXPECTED_DISCONNECTED.includes(id));
    const contextOk =
      Boolean(context) &&
      typeof context?.thinkGraph?.available === 'boolean' &&
      typeof context?.knowGraph?.available === 'boolean' &&
      typeof context?.codeGraph?.consulted === 'boolean';
    const ok =
      preflight?.ok === true &&
      contextOk &&
      missingFields.length === 0 &&
      missingWorkers.length === 0 &&
      leaked.length === 0;
    report(
      'hermes-preflight',
      ok ? 'PASS' : 'FAIL',
      `thinkGraph=${context?.thinkGraph?.available ? `available(${context.thinkGraph.nodeCount}n)` : `unavailable:${context?.thinkGraph?.reason || '?'}`} ` +
        `knowGraph=${context?.knowGraph?.available ? 'available' : `unavailable:${context?.knowGraph?.reason || '?'}`} ` +
        `codeGraph=${context?.codeGraph?.consulted ? 'consulted' : 'not-consulted'} ` +
        `runPacketFields=${missingFields.length === 0 ? 'complete' : `MISSING=[${missingFields.join(',')}]`} ` +
        `workers=[${draftConnected.join(',')}]` +
        (missingWorkers.length ? ` MISSING_WORKERS=[${missingWorkers.join(',')}]` : '') +
        (leaked.length ? ` DISCONNECTED_LEAKED=[${leaked.join(',')}]` : '') +
        ` exclusions=[${(draft?.disconnectedExclusions || []).join(',')}]`,
    );
  } catch (err: any) {
    report('hermes-preflight', 'FAIL', String(err?.message || err));
  }

  // 6 — ThinkGraph read (projection route + scoped read tool bridge)
  try {
    const projection = await getJson(
      `${args.backend}/api/thinkgraph/projection?projectId=${encodeURIComponent(args.project)}`,
    );
    const scope = await postJson(`${args.backend}/api/coder/mcp-bridge/thinkgraph_read_scope`, {
      authority: { projectId: args.project, correlationId: `probe_${Date.now()}` },
    });
    const ok = Array.isArray(projection?.nodes) && scope?.ok === true;
    report(
      'thinkgraph-read',
      ok ? 'PASS' : 'FAIL',
      `projection nodes=${projection?.nodes?.length ?? '?'} edges=${projection?.edges?.length ?? '?'}; scope nodes=${scope?.scope?.nodes?.length ?? '?'}`,
    );
  } catch (err: any) {
    report('thinkgraph-read', 'FAIL', String(err?.message || err));
  }

  // Source contract only, not a browser smoke: this proves the selected-node
  // inspector seam is shipped without pretending interaction was exercised.
  const inspectorPath = path.join(
    repoRoot,
    'client',
    'src',
    'components',
    'knowledge',
    'KnowledgeGraphFramework.tsx',
  );
  try {
    const source = readFileSync(inspectorPath, 'utf8');
    const ok = source.includes('knowledge-graph-node-inspector') && source.includes('selectedNodeId');
    report(
      'graph-inspector',
      ok ? 'PASS' : 'FAIL',
      ok
        ? 'selected-node inspector source present (browser interaction not exercised by this probe)'
        : 'selected-node inspector contract missing from KnowledgeGraphFramework',
    );
  } catch (err: any) {
    report('graph-inspector', 'FAIL', String(err?.message || err));
  }

  // 7 — KnowGraph read (the checked-in read-only Python probe against live Neo4j)
  const venvPython = path.join(repoRoot, 'apps', 'python-models', '.venv', 'Scripts', 'python.exe');
  const kgProbe = path.join(repoRoot, 'services', 'knowgraph', 'hybrid_retrieval_probe.py');
  if (!existsSync(venvPython) || !existsSync(kgProbe)) {
    report('knowgraph-read', 'SKIP', `missing ${!existsSync(venvPython) ? venvPython : kgProbe}`);
  } else {
    const kg = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(venvPython, [kgProbe, '--project-id', args.project, '--max-results', '5'], {
        cwd: path.dirname(kgProbe),
        timeout: 120_000,
      });
      let out = '';
      child.stdout.on('data', (d) => (out += String(d)));
      child.stderr.on('data', (d) => (out += String(d)));
      child.on('close', (code) => resolve({ code, out }));
      child.on('error', (err) => resolve({ code: null, out: String(err) }));
    });
    const resultLine = kg.out.split(/\r?\n/).find((l) => l.startsWith('RESULT=')) || 'RESULT=missing';
    report('knowgraph-read', kg.code === 0 ? 'PASS' : 'FAIL', `${resultLine} (exit=${kg.code})`);
  }

  // 8 — Hermes activity (an honest empty feed passes; a transport error fails)
  try {
    const hermes = await getJson(`${args.backend}/api/coder/hermes/activity?limit=20`);
    report(
      'hermes-activity',
      hermes?.ok === true ? 'PASS' : 'FAIL',
      `entries=${hermes?.activity?.length ?? '?'}${(hermes?.activity?.length ?? 0) === 0 ? ' (honestly empty — no reviews yet)' : ''}`,
    );
  } catch (err: any) {
    report('hermes-activity', 'FAIL', String(err?.message || err));
  }

  // 9 — Hermes postflight path present. Proven WITHOUT writing anything: an
  //     empty body must be rejected 400 runId_required — a real route that
  //     refuses to fabricate a run review is exactly the honest contract.
  try {
    const res = await fetch(`${args.backend}/api/coder/hermes/postflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => null);
    const ok = res.status === 400 && body?.error === 'runId_required';
    report(
      'hermes-postflight',
      ok ? 'PASS' : 'FAIL',
      ok
        ? 'path present — empty body rejected with runId_required, nothing written'
        : `unexpected response status=${res.status} body=${JSON.stringify(body)?.slice(0, 160)}`,
    );
  } catch (err: any) {
    report('hermes-postflight', 'FAIL', String(err?.message || err));
  }

  // 10 — run/conversation mapping (which runs exist for which decks + chat depth)
  try {
    const decks = await getJson(`${args.backend}/api/projects/${args.project}/decks`);
    const history = await getJson(
      `${args.backend}/api/coder/openclaude/session/history?projectId=${encodeURIComponent(args.project)}&conversationId=${encodeURIComponent(args.conversation)}`,
    );
    const runLine = (decks?.decks || [])
      .map((d: any) => `${d.id}→${d.latestRunId || 'no-runs'}`)
      .join(' ');
    report(
      'runs-and-history',
      decks?.ok && history?.ok ? 'PASS' : 'FAIL',
      `${runLine}; conversation '${args.conversation}' messages=${history?.messages?.length ?? '?'}`,
    );
  } catch (err: any) {
    report('runs-and-history', 'FAIL', String(err?.message || err));
  }

  // 11 — live Mag One team run (explicitly gated; never runs by default)
  if (!args.liveMagOne) {
    report('live-mag-one', 'SKIP', 'gated — pass --live-mag-one to run a real team run');
  } else {
    try {
      const run = await postJson(`${args.backend}/api/coder/mcp-bridge/run_mag_one`, {
        projectId: args.project,
        deckId: args.deck,
        conversationId: args.conversation,
        promptMarkdown: [
          '# Probe team run',
          'Confirm the connected team is reachable: each selected worker states its role in one sentence.',
          'Use graph context only; do not write any graph.',
        ].join('\n'),
      });
      const ok = run?.ok === true && run?.result?.status === 'completed';
      report(
        'live-mag-one',
        ok ? 'PASS' : 'FAIL',
        `status=${run?.result?.status} runId=${run?.result?.runId} ` +
          `connectedParticipants=[${(run?.result?.connectedParticipants || []).join(',')}] ` +
          `finalText=${String(run?.result?.finalText || '').slice(0, 120)}`,
      );
    } catch (err: any) {
      report('live-mag-one', 'FAIL', String(err?.message || err));
    }
  }

  // ── summary ────────────────────────────────────────────────────────────────
  console.log('');
  const failed = results.filter((r) => r.outcome === 'FAIL');
  const skipped = results.filter((r) => r.outcome === 'SKIP');
  console.log(
    `SUMMARY: ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
  );
  if (failed.length > 0) {
    console.log(`FAILED STAGES: ${failed.map((f) => f.stage).join(', ')}`);
  }

  // ── card role map (read from the live deck; no guesses) ────────────────────
  if (deckNodes.length > 0) {
    console.log('');
    console.log('CARD ROLE MAP (live deck):');
    for (const node of [...deckNodes].sort((a, b) => a.id.localeCompare(b.id))) {
      const isOrchestrator = String(node.runtimeType || '').toLowerCase() === 'magentic_one';
      const state = isOrchestrator
        ? 'orchestrator'
        : node.id === 'card_main_chat'
          ? 'front-door'
          : connectedIds.includes(node.id)
            ? 'connected'
            : 'disconnected';
      const tools = cardToolNames(node);
      console.log(
        `  ${node.id.padEnd(24)} ${String(state).padEnd(13)} binding=${String(node.runtimeBinding || 'none').padEnd(20)} tools=[${tools.join(',')}] title=${node.title || ''}`,
      );
    }
    console.log('');
    console.log(
      'AUTHORITY CHAIN: Harness(RunIntent, gRPC:50051) → Hermes preflight(ContextPacket+RunPacket draft) → run_mag_one(RunPacket Markdown, connected workers only) → Hermes postflight(ReviewReport → ThinkGraph run memory)',
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

// tsx runs this file directly; the spec imports the pure helpers only.
if (process.argv[1] && /poc-pipeline-probe\.ts$/.test(process.argv[1])) {
  void main();
}
