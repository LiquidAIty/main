// Dev agent harness routes (SPEC: dev-only MCP/test harness). Mocks ONLY the
// heavy boundaries (deck store, connected-agents view, Hermes preflight, the
// single-card executor). Proves: production mode 403s every route; dry-run
// probes resolve real card config without any model/Python call; a live
// single-card call is double-gated (mode + allowLive) and disconnected cards
// need the labeled dev-only override; telemetry trace/list/clear serve the
// real ring buffer.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deckStoreMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(),
}));
const agentFlowMocks = vi.hoisted(() => ({
  describeConnectedAgents: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({
  runConfiguredCard: vi.fn(),
}));

vi.mock('../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckStoreMocks.getDeckDocument,
}));
vi.mock('../coder/openclaude/mcp/liquidAItyAgentFlow', () => ({
  describeConnectedAgents: agentFlowMocks.describeConnectedAgents,
}));
vi.mock('../cards/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cards/runtime')>();
  return {
    resolveCardModelStrict: actual.resolveCardModelStrict,
    resolveCardTools: actual.resolveCardTools,
    runConfiguredCard: runtimeMocks.runConfiguredCard,
  };
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  flushAgentTelemetry,
  listAgentEvents,
  recordAgentEvent,
  resetAgentTelemetryForTest,
} from '../services/agentTelemetry';
import { flushCoderReports, resetCoderReportsForTest } from '../services/coderReportEvidence';
import { describeCardFromDeck, parsePipelineProbeOutput } from './dev.routes';

const DECK = {
  nodes: [
    {
      id: 'card_magentic',
      kind: 'agent',
      runtimeType: 'magentic_one',
      runtimeOptions: { provider: 'openrouter', modelKey: 'openai/gpt-5.1-chat' },
    },
    {
      id: 'card_research_agent',
      kind: 'agent',
      title: 'Research Agent',
      runtimeType: 'assistant_agent',
      prompt: 'Research prompt',
      runtimeOptions: {
        provider: 'openrouter',
        modelKey: 'z-ai/glm-5.2',
        tools: ['retrieve_knowgraph_context'],
      },
    },
    {
      id: 'card_plan_agent',
      kind: 'agent',
      title: 'Plan Agent',
      runtimeType: 'assistant_agent',
      prompt: 'Plan prompt',
      runtimeOptions: { provider: 'openai', modelKey: 'gpt-5.1-chat-latest', tools: [] },
    },
  ],
  edges: [{ id: 'e1', source: 'card_magentic', target: 'card_research_agent', edgeType: 'magentic_option' }],
};

const CONNECTED_VIEW = {
  projectId: 'p1',
  deckId: 'deck_builder',
  orchestratorCardId: 'card_magentic',
  connectedAgents: [
    {
      cardId: 'card_research_agent',
      title: 'Research Agent',
      model: { modelKey: 'z-ai/glm-5.2', provider: 'openrouter' },
      tools: ['retrieve_knowgraph_context'],
      connected: true,
    },
  ],
};

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const express = (await import('express')).default;
  const router = (await import('./dev.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/dev', router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

let server: Server;
let baseUrl: string;
let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  // Isolate BOTH dev stores in a temp dir so route tests never touch the real
  // coder-workspace mirrors, and the durable seed cannot leak into counts.
  tempDir = mkdtempSync(path.join(tmpdir(), 'dev-routes-'));
  resetAgentTelemetryForTest(tempDir);
  resetCoderReportsForTest(tempDir);
  deckStoreMocks.getDeckDocument.mockResolvedValue({ deck: DECK, latestRun: null, runs: [], meta: {} });
  agentFlowMocks.describeConnectedAgents.mockResolvedValue(CONNECTED_VIEW);
  ({ server, baseUrl } = await createApiServer());
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await flushAgentTelemetry();
  await flushCoderReports();
  resetAgentTelemetryForTest(null);
  resetCoderReportsForTest(null);
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('production guard', () => {
  it('403s every harness route when dev test mode is off', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_TEST_REAL_LOOP', '');
    for (const [method, url] of [
      ['GET', '/api/dev/agent-harness/system?projectId=p1'],
      ['GET', '/api/dev/agent-harness/card?projectId=p1&cardId=card_research_agent'],
      ['POST', '/api/dev/agent-harness/probe-frontdoor'],
      ['POST', '/api/dev/agent-harness/probe-card'],
      ['GET', '/api/dev/agent-harness/events'],
      ['GET', '/api/dev/agent-harness/trace/x'],
      ['POST', '/api/dev/agent-harness/events/clear'],
      ['GET', '/api/dev/agent-harness/runtime-tests/capabilities'],
      ['POST', '/api/dev/agent-harness/runtime-tests'],
      ['GET', '/api/dev/agent-harness/runtime-tests/rtest_x'],
      ['POST', '/api/dev/agent-harness/runtime-tests/rtest_x/cancel'],
      ['POST', '/api/dev/agent-harness/run-pipeline-probe'],
      ['POST', '/api/dev/agent-harness/span'],
      ['GET', '/api/dev/agent-harness/coder-jobs'],
      ['GET', '/api/dev/agent-harness/coder-jobs/job_x'],
      ['POST', '/api/dev/agent-harness/coder-jobs/job_x/claim'],
      ['POST', '/api/dev/agent-harness/coder-reports'],
      ['GET', '/api/dev/agent-harness/coder-reports'],
      ['GET', '/api/dev/agent-harness/coder-reports/crpt_x'],
      ['POST', '/api/dev/agent-harness/coder-reports/crpt_x/verify'],
      ['POST', '/api/dev/agent-harness/coder-reports/clear'],
      ['GET', '/api/dev/agent-harness/drift?projectId=p1'],
    ] as const) {
      const res = await fetch(`${baseUrl}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, url).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('dev_agent_harness_disabled_in_production');
    }
    expect(runtimeMocks.runConfiguredCard).not.toHaveBeenCalled();
  });
});

describe('describe_system / describe_card', () => {
  it('returns cards with connectivity, resolved model/tools, and no full prompts', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/system?projectId=p1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orchestratorCardId).toBe('card_magentic');
    expect(body.disconnectedCards).toEqual(['card_plan_agent']); // never the main_chat front door
    const research = body.cards.find((c: any) => c.cardId === 'card_research_agent');
    expect(research.connected).toBe(true);
    expect(research.resolved).toMatchObject({ provider: 'openrouter', providerModelId: 'z-ai/glm-5.2' });
    expect(research.prompt).toBeUndefined();
    expect(research.promptChars).toBeGreaterThan(0);
  });

  it('describe_card returns the full saved prompt and graph access from tools', async () => {
    const res = await fetch(
      `${baseUrl}/api/dev/agent-harness/card?projectId=p1&cardId=card_research_agent`,
    );
    const body = await res.json();
    expect(body.card.prompt).toBe('Research prompt');
    expect(body.card.graphReads).toEqual(['knowgraph']);
    expect(body.card.graphWrites).toEqual([]);
    expect(body.card.invocableBy.join(' ')).toContain('mag_one');
  });

  it('404s an unknown card', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/card?projectId=p1&cardId=card_nope`);
    expect(res.status).toBe(404);
  });
});

describe('probe_frontdoor', () => {
  it('dry-run returns the raw turn probe and native Hermes route without executing it', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/probe-frontdoor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p1', testUserMessage: 'probe message' }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.turnProbe.userMessage).toBe('probe message');
    expect(body.connectedParticipants.map((a: any) => a.cardId)).toEqual(['card_research_agent']);
    expect(body.disconnectedExclusions).toEqual(['card_plan_agent']);
    expect(body.wouldCall.hermes).toMatch(/prompt omitted/);
    expect(runtimeMocks.runConfiguredCard).not.toHaveBeenCalled();
    // the probe left a real telemetry event
    expect(listAgentEvents().some((e) => e.stage === 'dev_probe' && e.mode === 'dry_run')).toBe(true);
  });

  it('refuses non-dry-run modes (never runs Mag One)', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/probe-frontdoor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p1', testUserMessage: 'probe', mode: 'live_single_step' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('probe_frontdoor_live_not_supported');
  });
});

describe('probe_card', () => {
  it('dry-run resolves config from the saved card without calling Python', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/probe-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p1', cardId: 'card_research_agent', testInput: 'hello' }),
    });
    const body = await res.json();
    expect(body.mode).toBe('dry_run');
    expect(body.wouldRun).toBe(true);
    expect(body.card.resolved).toMatchObject({
      provider: 'openrouter',
      providerModelId: 'z-ai/glm-5.2',
      tools: ['retrieve_knowgraph_context'],
    });
    expect(body.telemetryEventId).toMatch(/^evt_/);
    expect(runtimeMocks.runConfiguredCard).not.toHaveBeenCalled();
  });

  it('live call requires allowLive=true', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/probe-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        cardId: 'card_research_agent',
        testInput: 'hello',
        mode: 'live_single_call',
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('probe_card_live_requires_allowLive_true');
    expect(runtimeMocks.runConfiguredCard).not.toHaveBeenCalled();
  });

  it('live call on a disconnected card requires the labeled dev override', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/probe-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        cardId: 'card_plan_agent',
        testInput: 'hello',
        mode: 'live_single_call',
        allowLive: true,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('probe_card_disconnected');
    expect(runtimeMocks.runConfiguredCard).not.toHaveBeenCalled();
  });

  it('gated live call runs the canonical executor and reports the real result', async () => {
    runtimeMocks.runConfiguredCard.mockResolvedValue({
      status: 'completed',
      correlationId: 'probe_live_x',
      cardId: 'card_research_agent',
      runtimeType: 'assistant_agent',
      tools: ['retrieve_knowgraph_context'],
      output: 'real output',
      error: null,
      startedAt: '2026-07-10T00:00:00.000Z',
      endedAt: '2026-07-10T00:00:01.000Z',
      toolCallCount: null,
      returnFolder: null,
    });
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/probe-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        cardId: 'card_research_agent',
        testInput: 'hello',
        mode: 'live_single_call',
        allowLive: true,
      }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(runtimeMocks.runConfiguredCard).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', cardId: 'card_research_agent', input: 'hello' }),
    );
    expect(body.result.output).toBe('real output');
  });
});

describe('telemetry endpoints', () => {
  it('lists, traces by correlationId, and clears', async () => {
    recordAgentEvent({ stage: 'card_call', status: 'completed', mode: 'real_model_call', correlationId: 'run_t1' });
    recordAgentEvent({ stage: 'frontdoor', status: 'completed', mode: 'real_model_call', correlationId: 'run_t2' });

    const list = await (await fetch(`${baseUrl}/api/dev/agent-harness/events?limit=10`)).json();
    expect(list.events).toHaveLength(2);

    const trace = await (await fetch(`${baseUrl}/api/dev/agent-harness/trace/run_t1`)).json();
    expect(trace.count).toBe(1);
    expect(trace.events[0].stage).toBe('card_call');

    const cleared = await (
      await fetch(`${baseUrl}/api/dev/agent-harness/events/clear`, { method: 'POST' })
    ).json();
    expect(cleared.cleared).toBe(2);
    expect(listAgentEvents()).toHaveLength(0);
  });
});

describe('runtime reality endpoints', () => {
  it('describes explicit adapters, one repository grant, and honest mode availability', async () => {
    vi.stubEnv('LIQUIDAITY_GRPC_CWD', tempDir);
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/runtime-tests/capabilities`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.supportedModes).toEqual(['single_coder']);
    expect(body.unavailableModes).toEqual([{ mode: 'mag_one_team', error: 'runtime_test_mode_unavailable' }]);
    expect(body.adapters.map((item: any) => item.id)).toEqual(['claude_code', 'codex']);
    expect(body.repositoryGrant).toMatchObject({ ref: 'repo_root', root: tempDir });
  });
});

describe('span intake / coder jobs / coder reports / drift', () => {
  it('span intake records a participant_turn event tied to the run trace', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/span`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correlationId: 'mag_one_run_z',
        projectId: 'p1',
        cardId: 'card_research_agent',
        provider: 'openrouter',
        model: 'openai/gpt-5.1-chat',
        outputSummary: 'finding',
        durationMs: 850,
        metadata: { source: 'Research_Agent', turnIndex: 0 },
      }),
    });
    expect((await res.json()).ok).toBe(true);
    const trace = await (await fetch(`${baseUrl}/api/dev/agent-harness/trace/mag_one_run_z`)).json();
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({
      stage: 'participant_turn',
      caller: 'python_rails',
      provider: 'openrouter',
      durationMs: 850,
    });
  });

  it('coder jobs list/get/claim reuse the canonical job folder', async () => {
    // Point the workspace at the temp dir (resolveRepoRoot honors the env).
    vi.stubEnv('LIQUIDAITY_GRPC_CWD', tempDir);
    const jobDir = path.join(tempDir, 'coder-workspace', 'handoff', 'job_route');
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(path.join(jobDir, 'prompt.md'), '# route job', 'utf8');

    const list = await (await fetch(`${baseUrl}/api/dev/agent-harness/coder-jobs`)).json();
    expect(list.jobs.map((j: any) => j.jobId)).toEqual(['job_route']);

    const detail = await (await fetch(`${baseUrl}/api/dev/agent-harness/coder-jobs/job_route`)).json();
    expect(detail.job.prompt).toBe('# route job');

    const claim = await (
      await fetch(`${baseUrl}/api/dev/agent-harness/coder-jobs/job_route/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter: 'claude-code', executionMode: 'external_coder' }),
      })
    ).json();
    expect(claim.ok).toBe(true);
    expect(claim.claim.adapter).toBe('claude-code');
  });

  it('coder report submit verifies deterministically against the live ring', async () => {
    recordAgentEvent({
      stage: 'card_call',
      status: 'completed',
      mode: 'real_model_call',
      correlationId: 'run_report',
      cardId: 'card_research_agent',
      provider: 'openrouter',
      model: 'z-ai/glm-5.2',
    });
    const submit = await (
      await fetch(`${baseUrl}/api/dev/agent-harness/coder-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p1',
          reportText: 'VERDICT: done',
          executionMode: 'external_coder',
          adapter: 'claude-code',
          claims: { traceIds: ['run_report', 'run_ghost'], cardCalls: ['card_research_agent'] },
        }),
      })
    ).json();
    expect(submit.ok).toBe(true);
    expect(submit.verification.verdict).toBe('PARTIALLY_SUPPORTED'); // run_ghost has no proof
    const byKind = Object.fromEntries(
      submit.verification.findings.map((f: any) => [`${f.kind}:${f.claim}`, f.verdict]),
    );
    expect(byKind['trace_exists:trace run_report exists']).toBe('SUPPORTED');
    expect(byKind['trace_exists:trace run_ghost exists']).toBe('MISSING_PROOF');
    expect(byKind['card_call:card card_research_agent was called']).toBe('SUPPORTED');

    const fetched = await (
      await fetch(`${baseUrl}/api/dev/agent-harness/coder-reports/${submit.submission.id}`)
    ).json();
    expect(fetched.submission.adapter).toBe('claude-code');

    const reverified = await (
      await fetch(`${baseUrl}/api/dev/agent-harness/coder-reports/${submit.submission.id}/verify`, {
        method: 'POST',
      })
    ).json();
    expect(reverified.ok).toBe(true);
  });

  it('drift route checks every deck card and reports zero findings for the clean deck', async () => {
    const res = await fetch(`${baseUrl}/api/dev/agent-harness/drift?projectId=p1`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checkedCards).toBe(3);
    expect(body.problems).toEqual([]);
    expect(body.warnings).toEqual([]);
  });
});

describe('pure helpers', () => {
  it('describeCardFromDeck reports a broken model config as a resolution error', () => {
    const nodes = [
      { id: 'card_broken', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'nope-model' } },
    ];
    const card = describeCardFromDeck(nodes, new Set(), 'card_broken');
    expect(card?.resolved).toBeNull();
    expect(card?.resolutionError).toContain('Unknown model key');
  });

  it('parsePipelineProbeOutput extracts PASS/FAIL/SKIP stage lines', () => {
    const out = [
      '✓ [PASS] backend-health — {"status":"ok"}',
      '✗ [FAIL] services-listening — frontend:5173=DOWN',
      '○ [SKIP] live-mag-one — gated — pass --live-mag-one to run a real team run',
      'SUMMARY: 1 passed, 1 failed, 1 skipped',
    ].join('\n');
    expect(parsePipelineProbeOutput(out)).toEqual([
      { stage: 'backend-health', outcome: 'PASS', detail: '{"status":"ok"}' },
      { stage: 'services-listening', outcome: 'FAIL', detail: 'frontend:5173=DOWN' },
      { stage: 'live-mag-one', outcome: 'SKIP', detail: 'gated — pass --live-mag-one to run a real team run' },
    ]);
  });
});
