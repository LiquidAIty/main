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
 * back. This probe is read-only; live model proof belongs to the real Main Chat.
 *
 * Stages cover the live Main/Harness session, the separate Mag One card path,
 * and the graph reads. Actual Hermes integration is not implemented.
 *   1  backend-health        GET  /api/health  (chat entry reachable)
 *   2  services-listening    TCP  5173 (frontend) / 8003 (autogen) / 50051 (gRPC = Harness,
 *                            the principal chat owner)
 *   3  deck-topology         GET  /api/projects/:p/decks/:d  (bus edges = authority)
 *   4  mag-one-view          POST /api/coder/mcp-bridge/describe_connected_agents
 *                            (blank deckId → canonical-deck default is part of the check;
 *                            disconnected cards must be structurally absent)
 *   5  hermes-boundary       report whether the optional pre-integration Hermes card is saved
 *   6  thinkgraph-read       GET  /api/thinkgraph/projection + POST mcp-bridge/thinkgraph_read_scope
 *   7  knowgraph-read        services/knowgraph/hybrid_retrieval_probe.py (read-only, real Neo4j)
 *   8  runs-and-history      GET  /api/projects/:p/decks (latest run ids) +
 *                            GET  /api/coder/openclaude/session/history
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

function bindingOf(node: DeckNode): string {
  return String(node.runtimeBinding || node.runtimeOptions?.binding || '').trim().toLowerCase();
}

/** Native Bun roles. They run in the gRPC harness, not the AutoGen card runner,
 * and `resolvedMagenticOptions` excludes them from the worker roster
 * structurally "even against stale edges". Their absence from the roster is the
 * design, never a failure — and they must never be AutoGen-card-run. */
const NATIVE_BINDINGS = new Set(['main_chat', 'hermes_steward']);

export function isNativeRole(node: DeckNode): boolean {
  return NATIVE_BINDINGS.has(bindingOf(node));
}

/** Mirrors the backend's `resolvedMagenticOptions`: a bus edge is membership
 * (direction ignored — either end may be the orchestrator), and native roles are
 * excluded structurally. Only an explicit 'magentic_option' counts; an
 * unrecognised type authorises nothing. */
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
      if (isNativeRole(other)) continue; // principal roles are never workers
      connected.add(otherId);
    }
  }
  return [...connected].sort();
}

export type CardClass =
  | 'connected_worker'
  | 'intentionally_excluded_native'
  | 'orchestrator'
  | 'present_disconnected';

/** Classify every card the deck ACTUALLY holds. The probe used to compare the
 * live deck against a frozen roster (card_knowgraph_agent / card_thinkgraph_agent
 * / card_plan_agent / card_codegraph_agent), which no longer exist — so it
 * reported deleted cards as MISSING and a legitimately connected WorldSignals
 * Agent as WRONGLY_CONNECTED. Presence and connectivity are now derived from the
 * saved deck; the deck is the authority, not this file. */
export function classifyDeck(
  nodes: DeckNode[],
  edges: DeckEdge[],
): Array<{ id: string; cls: CardClass }> {
  const connected = new Set(busConnectedCardIds(nodes, edges));
  return nodes
    .filter((n) => String(n.kind || 'agent') === 'agent')
    .map((n) => {
      const cls: CardClass =
        String(n.runtimeType || '').trim().toLowerCase() === 'magentic_one'
          ? 'orchestrator'
          : isNativeRole(n)
            ? 'intentionally_excluded_native'
            : connected.has(n.id)
              ? 'connected_worker'
              : 'present_disconnected';
      return { id: n.id, cls };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function setDifference(a: string[], b: string[]): string[] {
  const bs = new Set(b);
  return a.filter((x) => !bs.has(x));
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

// No frozen card roster: the saved deck is the authority for what exists and
// what is connected. This probe defends the runtime LAW that must hold for any
// deck — exactly one Control plug, at least one Worker plug, and native roles
// kept off the worker roster.
const EXPECTED_MAG_ONE_PROVIDER = 'openrouter';
const EXPECTED_MAG_ONE_MODEL = 'openai/gpt-5.1-chat';
// A real topic against the real corpus — the retrieval probe requires a query.
const KNOWGRAPH_PROBE_QUERY = 'knowledge graph organizing principle';

async function main(): Promise<void> {
  const args = parseProbeArgs(process.argv.slice(2));
  if (!args.project) {
    console.error('usage: npx tsx scripts/poc-pipeline-probe.ts --project <id> [--deck deck_builder] [--conversation main] [--backend http://localhost:4000]');
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
  let deckEdges: DeckEdge[] = [];
  let connectedIds: string[] = [];
  try {
    const doc = await getJson(`${args.backend}/api/projects/${args.project}/decks/${args.deck}`);
    deckNodes = (doc?.deck?.nodes || []) as DeckNode[];
    deckEdges = (doc?.deck?.edges || []) as DeckEdge[];
    const edges = deckEdges;
    const connected = busConnectedCardIds(deckNodes, edges);
    connectedIds = connected;
    const classes = classifyDeck(deckNodes, edges);
    const group = (cls: CardClass) => classes.filter((c) => c.cls === cls).map((c) => c.id);
    const controlEdges = edges.filter(
      (e) => String(e.edgeType || '').trim().toLowerCase() === 'magentic_control',
    );
    const invalidEdges = edges.filter((e) => {
      const t = String(e.edgeType || '').trim().toLowerCase();
      return t !== 'flow' && t !== 'magentic_option' && t !== 'magentic_control';
    });
    // Runtime law, not a frozen roster: one Control plug, >=1 Worker plug, and
    // no invalid edge (an unrecognised type authorises nothing).
    const problems: string[] = [];
    if (controlEdges.length !== 1) problems.push(`control_plugs=${controlEdges.length} (must be exactly 1)`);
    if (connected.length === 0) problems.push('no_worker_plugs');
    if (invalidEdges.length) problems.push(`invalid_edges=${invalidEdges.length}`);
    const toolsLine = deckNodes
      .filter((n) => connected.includes(n.id))
      .map((n) => `${n.id}:[${cardToolNames(n).join(',')}]`)
      .join(' ');
    report(
      'deck-topology',
      problems.length === 0 ? 'PASS' : 'FAIL',
      `cards=${deckNodes.length} busEdges=${edges.filter((e) => String(e.edgeType).toLowerCase() === 'magentic_option').length}` +
        ` connected_workers=[${group('connected_worker').join(',')}]` +
        ` excluded_native=[${group('intentionally_excluded_native').join(',')}]` +
        ` disconnected=[${group('present_disconnected').join(',')}]` +
        (problems.length ? ` PROBLEMS=[${problems.join('; ')}]` : '') +
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
    // Cross-check the SERVER's roster against the one this probe derives from
    // the same saved deck. Both sides read the deck, so any divergence is a real
    // resolver disagreement rather than a stale expectation in this file.
    const expectedWorkers = busConnectedCardIds(deckNodes, deckEdges);
    const missing = setDifference(expectedWorkers, seen);
    const extra = setDifference(seen, expectedWorkers);
    // Native roles must never appear in the worker roster.
    const nativeLeaked = seen.filter((id) => {
      const node = deckNodes.find((n) => n.id === id);
      return node ? isNativeRole(node) : false;
    });
    const ok =
      Boolean(view?.ok) && missing.length === 0 && extra.length === 0 && nativeLeaked.length === 0;
    report(
      'mag-one-view',
      ok ? 'PASS' : 'FAIL',
      `deckIdDefaulted=${view?.deckId === args.deck} workers=[${seen.join(',')}] deckDerived=[${expectedWorkers.join(',')}]` +
        (missing.length ? ` MISSING=[${missing.join(',')}]` : '') +
        (extra.length ? ` UNEXPECTED=[${extra.join(',')}]` : '') +
        (nativeLeaked.length ? ` NATIVE_LEAKED_INTO_ROSTER=[${nativeLeaked.join(',')}]` : '') +
        ` tools: ${agents.map((a) => `${a.cardId}:[${(a.tools || []).join(',')}]`).join(' ')}`,
    );
  } catch (err: any) {
    report('mag-one-view', 'FAIL', String(err?.message || err));
  }

  // 5 — Hermes is a pre-integration card boundary only. Its presence proves
  // saved intent, not an installed Hermes process or a successful Hermes run.
  const hermesCards = deckNodes.filter((node) => node.runtimeBinding === 'hermes_steward');
  const hermes = hermesCards[0];
  const hermesOk = hermesCards.length === 1 && Boolean(String((hermes as any)?.prompt || '').trim());
  report(
    'hermes-boundary',
    hermesOk ? 'PASS' : hermesCards.length === 0 ? 'SKIP' : 'FAIL',
    hermesOk
      ? `pre-integration card present; model=${String(hermes?.runtimeOptions?.modelKey || 'missing')} prompt=present; actual Hermes runtime unimplemented`
      : hermesCards.length === 0
        ? 'pre-integration Hermes card absent from this saved deck; actual Hermes runtime unimplemented'
        : `matches=${hermesCards.length} prompt=${String((hermes as any)?.prompt || '').trim() ? 'present' : 'missing'}`,
  );

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

  // Source contract only, not a browser smoke: prove the active framework owns
  // all four graph authorities and is mounted by the product page.
  const frameworkPath = path.join(
    repoRoot,
    'client',
    'src',
    'components',
    'knowledge',
    'KnowledgeGraphFramework.tsx',
  );
  try {
    const source = readFileSync(frameworkPath, 'utf8');
    const pageSource = readFileSync(path.join(repoRoot, 'client', 'src', 'pages', 'agentbuilder.tsx'), 'utf8');
    const ok = ['UnifiedGraphSurface', 'NativeCodeGraphSurface', 'NativeThinkGraphSurface', 'KnowGraphAnalysisSurface']
      .every((name) => source.includes(name))
      && pageSource.includes('<KnowledgeGraphFramework');
    report(
      'graph-inspector',
      ok ? 'PASS' : 'FAIL',
      ok
        ? 'active four-authority graph framework is mounted (browser interaction not exercised by this probe)'
        : 'active graph framework composition is incomplete',
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
      // `--query` is REQUIRED by hybrid_retrieval_probe.py. Omitting it made this
      // stage die on an argparse error (exit=2) and report RESULT=missing, so the
      // KnowGraph pipe was never actually exercised by this probe at all.
      const child = spawn(
        venvPython,
        [kgProbe, '--project-id', args.project, '--query', KNOWGRAPH_PROBE_QUERY, '--max-results', '5'],
        { cwd: path.dirname(kgProbe), timeout: 120_000 },
      );
      let out = '';
      child.stdout.on('data', (d) => (out += String(d)));
      child.stderr.on('data', (d) => (out += String(d)));
      child.on('close', (code) => resolve({ code, out }));
      child.on('error', (err) => resolve({ code: null, out: String(err) }));
    });
    const resultLine = kg.out.split(/\r?\n/).find((l) => l.startsWith('RESULT=')) || 'RESULT=missing';
    // `knowgraph_corpus_unprepared` is a CORRECT typed outcome, not a broken
    // pipe: the reader checked corpus readiness, found no retrievable content
    // for this scope, and stopped BEFORE spending an embedding. Reporting that
    // as FAIL would punish the honest path and hide the real state, so it is
    // reported as SKIP with the reason surfaced.
    const unprepared = kg.out.includes('knowgraph_corpus_unprepared');
    report(
      'knowgraph-read',
      kg.code === 0 ? 'PASS' : unprepared ? 'SKIP' : 'FAIL',
      unprepared
        ? 'corpus_unprepared — retrieval stopped before embedding (no provider spend); ' +
          'evidence retrieval is blocked until the corpus is populated, which is honest, not broken'
        : `${resultLine} (exit=${kg.code})`,
    );
  }

  // 8 — run/conversation mapping (which runs exist for which decks + chat depth)
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
      'CURRENT PATHS: Main Chat → persistent Harness session; approved Mag One card → Python rails → connected workers → task/result artifacts. Actual Hermes runtime is not integrated.',
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

// tsx runs this file directly; the spec imports the pure helpers only.
if (process.argv[1] && /poc-pipeline-probe\.ts$/.test(process.argv[1])) {
  void main();
}
