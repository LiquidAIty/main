/**
 * Dev agent harness — /api/dev/agent-harness/* (SPEC: dev-only agent call
 * telemetry / test harness).
 *
 * The HTTP surface coding agents (Codex/Fable/Terra/…) use to understand and
 * probe the real agent system: what cards exist, what is connected, what a
 * call boundary would resolve to, and what a real run actually did (via the
 * agentTelemetry ring buffer). The dev MCP server
 * (apps/python-models/app/dev_agent_harness_mcp.py) is thin transport to these
 * routes.
 *
 * Guards:
 *  - every route calls requireDevTestMode() first → 403 in production;
 *  - probes default to dry_run (no model call, no Python call, no graph write);
 *  - a live single-card call requires BOTH mode='live_single_call' AND
 *    allowLive=true; disconnected cards additionally require
 *    allowDisconnected=true (a labeled dev-only override);
 *  - probe_frontdoor never runs Mag One — it fails closed with the real
 *    run_mag_one entrypoint named instead;
 *  - the pipeline probe runs the checked-in scripts/poc-pipeline-probe.ts and
 *    cannot pass --live-mag-one through this route.
 */

import { Router } from 'express';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireDevTestMode } from '../services/devTest';
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { describeConnectedAgents } from '../coder/openclaude/mcp/liquidAItyAgentFlow';
import { resolveCardModelStrict, resolveCardTools, runConfiguredCard } from '../cards/runtime';
import { resolveRuntimeBinding } from '../contracts/runtimeBinding';
import {
  clearAgentEvents,
  getAgentRunTrace,
  listAgentEvents,
  recordAgentEvent,
  summarizeForTelemetry,
} from '../services/agentTelemetry';
import { detectCardDrift } from '../services/cardDrift';
import { claimCoderJob, getCoderJob, listCoderJobs } from '../services/coderJobs';
import {
  clearCoderReports,
  getCoderReport,
  listCoderReports,
  reverifyCoderReport,
  submitCoderReport,
} from '../services/coderReportEvidence';
import {
  cancelAgentRuntimeTest,
  describeRuntimeTestCapabilities,
  getAgentRuntimeTest,
  startAgentRuntimeTest,
} from '../services/agentRuntimeReality';

const router = Router();

// Static wiring facts for describe_system — descriptions of the architecture,
// not decisions (the live deck stays the authority for card/bus state).
const GRAPH_ENDPOINTS = {
  thinkGraph: 'Postgres/AGE — read /api/thinkgraph/projection; card-scoped read/write via mcp-bridge thinkgraph tools',
  knowGraph: 'Neo4j — read in-run via the retrieve_knowgraph_context card tool (Python rails)',
  codeGraph: 'CBM index (SQLite) — codebase-memory MCP tools; canvas view dormant',
} as const;
const RUN_STAGES = [
  'frontdoor',
  'hermes_context',
  'mag_one_dispatch',
  'card_call',
  'graph_read',
  'graph_write',
  'hermes_postflight',
] as const;
// Which graphs a tool grants access to — data lookup for describe_card only.
const GRAPH_ACCESS_BY_TOOL: Record<string, { reads?: string[]; writes?: string[] }> = {
  read_thinkgraph_scope: { reads: ['thinkgraph'] },
  apply_thinkgraph_patch: { writes: ['thinkgraph'] },
  retrieve_knowgraph_context: { reads: ['knowgraph'] },
};

function asTrimmed(value: unknown): string {
  return String(value ?? '').trim();
}

type CardDescription = {
  cardId: string;
  title: string;
  runtimeType: string | null;
  runtimeBinding: string | null;
  connected: boolean;
  enabled: boolean;
  prompt: string;
  provider: string | null;
  modelKey: string | null;
  /** Resolution through the SAME strict runtime resolvers the real run uses;
   * a card that would fail to run reports the exact runtime error here. */
  resolved: { provider: string; providerModelId: string; tools: string[] } | null;
  resolutionError: string | null;
  graphReads: string[];
  graphWrites: string[];
  invocableBy: string[];
};

/** Structural description of one saved card (pure; exported for tests). */
export function describeCardFromDeck(
  nodes: any[],
  connectedIds: Set<string>,
  cardId: string,
): CardDescription | null {
  const card = nodes.find((node) => asTrimmed(node?.id) === cardId);
  if (!card) return null;
  const binding = resolveRuntimeBinding(
    card?.runtimeOptions?.binding ?? card?.runtimeBinding ?? card?.binding,
    card?.id,
  );
  let resolved: CardDescription['resolved'] = null;
  let resolutionError: string | null = null;
  try {
    const model = resolveCardModelStrict(card);
    resolved = { ...model, tools: resolveCardTools(card) };
  } catch (error: any) {
    resolutionError = String(error?.message || 'card_resolution_failed');
  }
  const tools = resolved?.tools ?? [];
  const graphReads = tools.flatMap((tool) => GRAPH_ACCESS_BY_TOOL[tool]?.reads ?? []);
  const graphWrites = tools.flatMap((tool) => GRAPH_ACCESS_BY_TOOL[tool]?.writes ?? []);
  const connected = connectedIds.has(cardId);
  const invocableBy =
    binding === 'main_chat'
      ? ['user (Main Chat front door)']
      : connected
        ? ['mag_one (team run)', 'harness card doorway (card.run_assistant_agent)', 'task tab (single assist)']
        : ['task tab (single assist only — disconnected from the Mag One bus)'];
  return {
    cardId,
    title: asTrimmed(card?.title) || cardId,
    runtimeType: asTrimmed(card?.runtimeType) || null,
    runtimeBinding: binding || null,
    connected,
    enabled: !(card?.enabled === false || card?.runtimeOptions?.enabled === false),
    prompt: String(card?.prompt || ''),
    provider: asTrimmed(card?.runtimeOptions?.provider) || null,
    modelKey: asTrimmed(card?.runtimeOptions?.modelKey) || null,
    resolved,
    resolutionError,
    graphReads,
    graphWrites,
    invocableBy,
  };
}

/** Parse the pipeline probe's PASS/FAIL/SKIP lines (pure; exported for tests). */
export function parsePipelineProbeOutput(output: string): Array<{
  stage: string;
  outcome: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}> {
  const stages: Array<{ stage: string; outcome: 'PASS' | 'FAIL' | 'SKIP'; detail: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^[✓✗○] \[(PASS|FAIL|SKIP)\] ([^ ]+) — (.*)$/u.exec(line.trim());
    if (match) {
      stages.push({ stage: match[2], outcome: match[1] as 'PASS' | 'FAIL' | 'SKIP', detail: match[3] });
    }
  }
  return stages;
}

async function loadDeckAndConnected(projectId: string, deckId: string) {
  const [{ deck }, view] = await Promise.all([
    getDeckDocument(projectId, deckId),
    describeConnectedAgents({ projectId, deckId }),
  ]);
  const nodes: any[] = Array.isArray(deck?.nodes) ? deck!.nodes : [];
  const edges: any[] = Array.isArray(deck?.edges) ? deck!.edges : [];
  const connectedIds = new Set(view.connectedAgents.map((a) => a.cardId));
  return { nodes, edges, view, connectedIds };
}

// Every handler: dev-mode gate first, honest JSON errors, never a fake success.
function devGuard(res: any): boolean {
  try {
    requireDevTestMode();
    return true;
  } catch {
    res.status(403).json({ ok: false, error: 'dev_agent_harness_disabled_in_production' });
    return false;
  }
}

// ── describe_system ──────────────────────────────────────────────────────────
router.get('/agent-harness/system', async (req, res) => {
  if (!devGuard(res)) return undefined;
  const projectId = asTrimmed(req.query?.projectId);
  const deckId = asTrimmed(req.query?.deckId) || BUILDER_DECK_ID;
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  try {
    const { nodes, edges, view, connectedIds } = await loadDeckAndConnected(projectId, deckId);
    const cards = nodes
      .filter((node) => asTrimmed(node?.kind || 'agent') === 'agent')
      .map((node) => describeCardFromDeck(nodes, connectedIds, asTrimmed(node?.id)))
      .filter((card): card is CardDescription => card !== null)
      // Full prompts stay in describe_card; the system view stays bounded.
      .map(({ prompt, ...card }) => ({ ...card, promptChars: prompt.length }));
    return res.json({
      ok: true,
      projectId,
      deckId,
      orchestratorCardId: view.orchestratorCardId,
      busEdges: edges.filter((e) => asTrimmed(e?.edgeType).toLowerCase() === 'magentic_option').length,
      connectedParticipants: view.connectedAgents,
      // The front door (main_chat binding) is deliberately not a bus worker —
      // it is neither connected nor parked, so it is excluded here (same
      // convention as Hermes preflight's disconnectedExclusions).
      disconnectedCards: cards
        .filter((c) => !c.connected && c.runtimeType !== 'magentic_one' && c.runtimeBinding !== 'main_chat')
        .map((c) => c.cardId),
      cards,
      graphEndpoints: GRAPH_ENDPOINTS,
      runStages: RUN_STAGES,
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'describe_system_failed' });
  }
});

// ── describe_card ────────────────────────────────────────────────────────────
router.get('/agent-harness/card', async (req, res) => {
  if (!devGuard(res)) return undefined;
  const projectId = asTrimmed(req.query?.projectId);
  const deckId = asTrimmed(req.query?.deckId) || BUILDER_DECK_ID;
  const cardId = asTrimmed(req.query?.cardId);
  if (!projectId || !cardId) return res.status(400).json({ ok: false, error: 'projectId_and_cardId_required' });
  try {
    const { nodes, connectedIds } = await loadDeckAndConnected(projectId, deckId);
    const card = describeCardFromDeck(nodes, connectedIds, cardId);
    if (!card) return res.status(404).json({ ok: false, error: `card_not_found: ${cardId}` });
    return res.json({ ok: true, card });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'describe_card_failed' });
  }
});

// ── probe_frontdoor (dry_run; never runs Mag One) ────────────────────────────
router.post('/agent-harness/probe-frontdoor', async (req, res) => {
  if (!devGuard(res)) return undefined;
  const body = req.body || {};
  const projectId = asTrimmed(body.projectId);
  const deckId = asTrimmed(body.deckId) || BUILDER_DECK_ID;
  const conversationId = asTrimmed(body.conversationId) || 'dev_probe';
  const testUserMessage = asTrimmed(body.testUserMessage);
  const mode = asTrimmed(body.mode) || 'dry_run';
  if (!projectId || !testUserMessage) {
    return res.status(400).json({ ok: false, error: 'projectId_and_testUserMessage_required' });
  }
  if (mode !== 'dry_run') {
    // Fail closed: a live frontdoor turn belongs to the real chat surface; a
    // live team run belongs to run_mag_one with its own explicit gating.
    return res.status(400).json({
      ok: false,
      error:
        'probe_frontdoor_live_not_supported: use the real Main Chat for a live turn, or POST /api/coder/mcp-bridge/run_mag_one explicitly for a team run',
    });
  }
  const turnProbe = { projectId, deckId, conversationId, userMessage: testUserMessage };
  try {
    const { view, connectedIds, nodes } = await loadDeckAndConnected(projectId, deckId);
    const blockedReasons: string[] = [];
    if (!view.orchestratorCardId) blockedReasons.push('no_orchestrator_card_on_deck');
    if (view.connectedAgents.length === 0) blockedReasons.push('no_bus_connected_participants');
    const disconnected = nodes
      .filter((node) => asTrimmed(node?.kind || 'agent') === 'agent')
      .map((node) => asTrimmed(node?.id))
      .filter((id) => id && !connectedIds.has(id) && id !== view.orchestratorCardId && id !== 'card_main_chat');
    const telemetryEventId = recordAgentEvent({
      stage: 'dev_probe',
      status: blockedReasons.length ? 'blocked' : 'completed',
      mode: 'dry_run',
      caller: 'dev_probe',
      projectId,
      deckId,
      conversationId,
      correlationId: `probe_${randomUUID().slice(0, 8)}`,
      inputSummary: testUserMessage,
      outputSummary: `frontdoor dry-run: workers=[${view.connectedAgents.map((a) => a.cardId).join(',')}]`,
      metadata: { probe: 'frontdoor', blockedReasons },
    });
    return res.json({
      ok: true,
      mode: 'dry_run',
      turnProbe,
      wouldCall: {
        harness: 'gRPC :50051 session turn (native agents + mcp tools)',
        hermes: 'Agent(subagent_type=card_hermes_steward, prompt omitted, inherited parent context)',
        magOne: 'POST /api/coder/mcp-bridge/run_mag_one with one Hermes RunPacket (only for route=mag_one)',
      },
      connectedParticipants: view.connectedAgents,
      disconnectedExclusions: disconnected,
      blockedReasons,
      telemetryEventId,
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'probe_frontdoor_failed' });
  }
});

// ── probe_card (dry_run default; live gated) ─────────────────────────────────
router.post('/agent-harness/probe-card', async (req, res) => {
  if (!devGuard(res)) return undefined;
  const body = req.body || {};
  const projectId = asTrimmed(body.projectId);
  const deckId = asTrimmed(body.deckId) || BUILDER_DECK_ID;
  const cardId = asTrimmed(body.cardId);
  const testInput = asTrimmed(body.testInput);
  const mode = asTrimmed(body.mode) || 'dry_run';
  if (!projectId || !cardId || !testInput) {
    return res.status(400).json({ ok: false, error: 'projectId_cardId_and_testInput_required' });
  }
  try {
    const { nodes, connectedIds } = await loadDeckAndConnected(projectId, deckId);
    const card = describeCardFromDeck(nodes, connectedIds, cardId);
    if (!card) return res.status(404).json({ ok: false, error: `card_not_found: ${cardId}` });

    if (mode === 'dry_run') {
      const telemetryEventId = recordAgentEvent({
        stage: 'dev_probe',
        status: card.resolutionError ? 'blocked' : 'completed',
        mode: 'dry_run',
        caller: 'dev_probe',
        projectId,
        deckId,
        cardId,
        correlationId: `probe_${randomUUID().slice(0, 8)}`,
        provider: card.resolved?.provider ?? null,
        model: card.resolved?.providerModelId ?? null,
        tools: card.resolved?.tools ?? [],
        inputSummary: testInput,
        outputSummary: card.resolutionError
          ? ''
          : `dry-run resolved: ${card.resolved?.provider}/${card.resolved?.providerModelId}`,
        errorSummary: card.resolutionError,
        metadata: { probe: 'card', connected: card.connected },
      });
      return res.json({ ok: true, mode: 'dry_run', card, wouldRun: !card.resolutionError && card.enabled, telemetryEventId });
    }

    if (mode !== 'live_single_call') {
      return res.status(400).json({ ok: false, error: `probe_card_mode_unknown: ${mode}` });
    }
    if (body.allowLive !== true) {
      return res.status(400).json({ ok: false, error: 'probe_card_live_requires_allowLive_true' });
    }
    if (!card.connected && body.allowDisconnected !== true) {
      return res.status(400).json({
        ok: false,
        error:
          'probe_card_disconnected: card is not on the Mag One bus; pass allowDisconnected=true (dev-only override) to live-call it anyway',
      });
    }
    // One REAL single-card run through the canonical executor. No conversationId
    // is minted — a graph-writing card honestly reports missing authority.
    const correlationId = `probe_live_${randomUUID().slice(0, 8)}`;
    const result = await runConfiguredCard({ projectId, deckId, cardId, correlationId, input: testInput });
    const telemetryEventId = recordAgentEvent({
      stage: 'dev_probe',
      status: result.status === 'completed' ? 'completed' : 'failed',
      mode: 'real_model_call',
      caller: 'dev_probe',
      projectId,
      deckId,
      cardId,
      correlationId,
      provider: card.resolved?.provider ?? null,
      model: card.resolved?.providerModelId ?? null,
      tools: result.tools,
      inputSummary: testInput,
      outputSummary: result.output,
      errorSummary: result.error,
      metadata: { probe: 'card', live: true, disconnectedOverride: !card.connected },
    });
    return res.json({ ok: result.status === 'completed', mode: 'live_single_call', card, result, telemetryEventId });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'probe_card_failed' });
  }
});

// ── telemetry: run trace / recent events / clear ─────────────────────────────
router.get('/agent-harness/trace/:correlationId', (req, res) => {
  if (!devGuard(res)) return undefined;
  const events = getAgentRunTrace(String(req.params.correlationId || ''));
  return res.json({ ok: true, correlationId: req.params.correlationId, count: events.length, events });
});

router.get('/agent-harness/events', (req, res) => {
  if (!devGuard(res)) return undefined;
  const limit = Number(req.query?.limit);
  return res.json({ ok: true, events: listAgentEvents(Number.isFinite(limit) ? limit : 100) });
});

router.post('/agent-harness/events/clear', (req, res) => {
  if (!devGuard(res)) return undefined;
  return res.json({ ok: true, cleared: clearAgentEvents() });
});

// ── Reusable external-agent runtime reality check ───────────────────────────
router.get('/agent-harness/runtime-tests/capabilities', (_req, res) => {
  if (!devGuard(res)) return undefined;
  return res.json({ ok: true, ...describeRuntimeTestCapabilities() });
});

router.post('/agent-harness/runtime-tests', (req, res) => {
  if (!devGuard(res)) return undefined;
  try { return res.status(202).json({ ok: true, runtimeTest: startAgentRuntimeTest(req.body || {}) }); }
  catch (error) { return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'runtime_test_start_failed' }); }
});

router.get('/agent-harness/runtime-tests/:runtimeTestId', (req, res) => {
  if (!devGuard(res)) return undefined;
  const record = getAgentRuntimeTest(String(req.params.runtimeTestId || ''));
  return record ? res.json({ ok: true, runtimeTest: record }) : res.status(404).json({ ok: false, error: 'runtime_test_not_found' });
});

router.post('/agent-harness/runtime-tests/:runtimeTestId/cancel', (req, res) => {
  if (!devGuard(res)) return undefined;
  try { return res.json({ ok: true, runtimeTest: cancelAgentRuntimeTest(String(req.params.runtimeTestId || '')) }); }
  catch (error) { return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'runtime_test_cancel_failed' }); }
});

// ── participant span intake (Python rails → participant_turn events) ─────────
// The Python streaming loop (our code, never vendored AutoGen) POSTs one span
// per participant turn here. Loopback dev-only; fields are re-bounded and
// re-redacted by recordAgentEvent — nothing is trusted verbatim.
router.post('/agent-harness/span', (req, res) => {
  if (!devGuard(res)) return undefined;
  const body = req.body || {};
  const eventId = recordAgentEvent({
    stage: 'participant_turn',
    status: 'completed',
    mode: 'real_model_call',
    caller: 'python_rails',
    projectId: asTrimmed(body.projectId) || null,
    correlationId: asTrimmed(body.correlationId) || null,
    cardId: asTrimmed(body.cardId) || null,
    provider: asTrimmed(body.provider) || null,
    model: asTrimmed(body.model) || null,
    outputSummary: summarizeForTelemetry(body.outputSummary),
    durationMs: Number.isFinite(Number(body.durationMs)) ? Number(body.durationMs) : null,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  });
  return res.json({ ok: eventId !== null, eventId });
});

// ── coder jobs (READ/CLAIM view over the canonical job folder) ───────────────
router.get('/agent-harness/coder-jobs', (req, res) => {
  if (!devGuard(res)) return undefined;
  try {
    return res.json({ ok: true, jobs: listCoderJobs() });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'list_coder_jobs_failed' });
  }
});

router.get('/agent-harness/coder-jobs/:jobId', (req, res) => {
  if (!devGuard(res)) return undefined;
  const job = getCoderJob(String(req.params.jobId || ''));
  if ('error' in job) {
    return res.status(job.error.startsWith('coder_job_not_found') ? 404 : 400).json({ ok: false, error: job.error });
  }
  return res.json({ ok: true, job });
});

router.post('/agent-harness/coder-jobs/:jobId/claim', (req, res) => {
  if (!devGuard(res)) return undefined;
  const body = req.body || {};
  const result = claimCoderJob({
    jobId: String(req.params.jobId || ''),
    adapter: String(body.adapter || ''),
    executionMode: String(body.executionMode || ''),
    model: typeof body.model === 'string' ? body.model : null,
    force: body.force === true,
  });
  return res.status(result.ok ? 200 : 400).json(result);
});

// ── CoderReport evidence verifier ─────────────────────────────────────────────
router.post('/agent-harness/coder-reports', (req, res) => {
  if (!devGuard(res)) return undefined;
  const result = submitCoderReport(req.body || {});
  return res.status(result.ok ? 200 : 400).json(result);
});

router.get('/agent-harness/coder-reports', (req, res) => {
  if (!devGuard(res)) return undefined;
  const limit = Number(req.query?.limit);
  return res.json({ ok: true, reports: listCoderReports(Number.isFinite(limit) ? limit : 20) });
});

router.get('/agent-harness/coder-reports/:id', (req, res) => {
  if (!devGuard(res)) return undefined;
  const record = getCoderReport(String(req.params.id || ''));
  if (!record) return res.status(404).json({ ok: false, error: `coder_report_not_found: ${req.params.id}` });
  return res.json({ ok: true, ...record });
});

router.post('/agent-harness/coder-reports/:id/verify', (req, res) => {
  if (!devGuard(res)) return undefined;
  const result = reverifyCoderReport(String(req.params.id || ''));
  return res.status(result.ok ? 200 : 404).json(result);
});

router.post('/agent-harness/coder-reports/clear', (req, res) => {
  if (!devGuard(res)) return undefined;
  return res.json({ ok: true, cleared: clearCoderReports() });
});

// ── card drift detection (deterministic; never mutates a card) ───────────────
router.get('/agent-harness/drift', async (req, res) => {
  if (!devGuard(res)) return undefined;
  const projectId = asTrimmed(req.query?.projectId);
  const deckId = asTrimmed(req.query?.deckId) || BUILDER_DECK_ID;
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  try {
    const { nodes, connectedIds } = await loadDeckAndConnected(projectId, deckId);
    const cards = nodes
      .filter((node) => asTrimmed(node?.kind || 'agent') === 'agent')
      .map((node) => describeCardFromDeck(nodes, connectedIds, asTrimmed(node?.id)))
      .filter((card): card is NonNullable<typeof card> => card !== null);
    const findings = detectCardDrift(cards);
    return res.json({
      ok: true,
      projectId,
      deckId,
      checkedCards: cards.length,
      problems: findings.filter((f) => f.severity === 'problem'),
      warnings: findings.filter((f) => f.severity === 'warning'),
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'drift_check_failed' });
  }
});

// ── run_pipeline_probe (non-live; --live-mag-one is structurally unreachable) ─
router.post('/agent-harness/run-pipeline-probe', async (req, res) => {
  if (!devGuard(res)) return undefined;
  const body = req.body || {};
  const projectId = asTrimmed(body.projectId);
  const deckId = asTrimmed(body.deckId) || BUILDER_DECK_ID;
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  // The same server-owned trusted repo root the coder routes use.
  const repoRoot = process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main';
  const scriptPath = path.join(repoRoot, 'scripts', 'poc-pipeline-probe.ts');
  const probe = await new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', scriptPath, '--project', projectId, '--deck', deckId],
      { cwd: repoRoot, timeout: 240_000, shell: process.platform === 'win32' },
    );
    let out = '';
    child.stdout?.on('data', (d) => (out += String(d)));
    child.stderr?.on('data', (d) => (out += String(d)));
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (err) => resolve({ code: null, out: String(err) }));
  });
  const stages = parsePipelineProbeOutput(probe.out);
  const summary = probe.out.split(/\r?\n/).find((line) => line.startsWith('SUMMARY:')) || null;
  return res.json({
    ok: probe.code === 0,
    exitCode: probe.code,
    liveMagOne: 'skipped (gated; this route never passes --live-mag-one)',
    summary,
    stages,
  });
});

export default router;
