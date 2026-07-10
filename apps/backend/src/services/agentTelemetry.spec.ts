import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAgentEvents,
  flushAgentTelemetry,
  getAgentRunTrace,
  listAgentEvents,
  recordAgentEvent,
  resetAgentTelemetryForTest,
  summarizeForTelemetry,
} from './agentTelemetry';

// Every test runs against a temp mirror dir so no test garbage lands in the
// real coder-workspace/dev-telemetry evidence file.
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agent-telemetry-'));
  resetAgentTelemetryForTest(dir);
});

afterEach(async () => {
  // Let any fire-and-forget append settle before deleting the temp dir
  // (Windows ENOTEMPTY race), then retry the removal.
  await flushAppends();
  resetAgentTelemetryForTest(null);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  vi.unstubAllEnvs();
});

/** Wait for the fire-and-forget JSONL appends to land (deterministic). */
async function flushAppends(): Promise<void> {
  await flushAgentTelemetry();
}

describe('recordAgentEvent — dev-only, non-blocking, honest', () => {
  it('records a complete event with generated id/timestamp, defaults, and source=ram', () => {
    const id = recordAgentEvent({
      stage: 'card_call',
      status: 'completed',
      mode: 'real_model_call',
      projectId: 'p1',
      cardId: 'card_research_agent',
      provider: 'openrouter',
      model: 'z-ai/glm-5.2',
      correlationId: 'run_1',
      inputSummary: 'investigate satellite schedule',
      outputSummary: 'found three anchors',
      durationMs: 1234,
      tools: ['retrieve_knowgraph_context'],
    });
    expect(id).toMatch(/^evt_/);
    const [event] = listAgentEvents(1);
    expect(event).toMatchObject({
      stage: 'card_call',
      status: 'completed',
      mode: 'real_model_call',
      projectId: 'p1',
      deckId: null,
      cardId: 'card_research_agent',
      provider: 'openrouter',
      model: 'z-ai/glm-5.2',
      correlationId: 'run_1',
      durationMs: 1234,
      tools: ['retrieve_knowgraph_context'],
      graphReads: [],
      graphWrites: [],
      source: 'ram',
    });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts secrets and bounds input/output summaries', () => {
    recordAgentEvent({
      stage: 'frontdoor',
      status: 'started',
      mode: 'real_model_call',
      inputSummary: `key sk-ABCDEFGHIJKLMNOP ${'x'.repeat(600)}`,
    });
    const [event] = listAgentEvents(1);
    expect(event.inputSummary).not.toContain('sk-ABCDEFGHIJKLMNOP');
    expect(event.inputSummary.length).toBeLessThanOrEqual(300);
  });

  it('is a no-op in production (dev-only telemetry)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_TEST_REAL_LOOP', '');
    const id = recordAgentEvent({ stage: 'frontdoor', status: 'started', mode: 'real_model_call' });
    expect(id).toBeNull();
    expect(listAgentEvents()).toHaveLength(0);
  });

  it('never throws on malformed input (telemetry must not break the app)', () => {
    expect(() =>
      recordAgentEvent({
        stage: 'card_call',
        status: 'failed',
        mode: 'blocked',
        // a summary whose serialization explodes
        inputSummary: {
          toString() {
            throw new Error('boom');
          },
        } as unknown as string,
      }),
    ).not.toThrow();
  });

  it('bounds the ring buffer at 500 events', () => {
    for (let i = 0; i < 520; i += 1) {
      recordAgentEvent({ stage: 'dev_probe', status: 'completed', mode: 'dry_run', correlationId: `c${i}` });
    }
    const all = listAgentEvents(500);
    expect(all).toHaveLength(500);
    expect(all[0].correlationId).toBe('c20'); // oldest 20 dropped
  });
});

describe('durable JSONL mirror — evidence survives a backend restart', () => {
  it('appends events to the mirror and restores them as source=durable after a reset', async () => {
    recordAgentEvent({ stage: 'frontdoor', status: 'started', mode: 'real_model_call', correlationId: 'run_x' });
    recordAgentEvent({ stage: 'card_call', status: 'completed', mode: 'real_model_call', correlationId: 'run_x' });
    await flushAppends();
    const file = path.join(dir, 'agent-events.jsonl');
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);

    // Simulate a backend watch reload: fresh module state, same mirror dir.
    resetAgentTelemetryForTest(dir);
    const restored = listAgentEvents();
    expect(restored).toHaveLength(2);
    expect(restored.every((e) => e.source === 'durable')).toBe(true);
    expect(getAgentRunTrace('run_x').map((e) => e.stage)).toEqual(['frontdoor', 'card_call']);

    // New events after the reload are ram-sourced and follow the durable ones.
    recordAgentEvent({ stage: 'hermes_postflight', status: 'completed', mode: 'real_model_call', correlationId: 'run_x' });
    const all = listAgentEvents();
    expect(all[all.length - 1].source).toBe('ram');
  });

  it('drops corrupt mirror lines instead of inventing history', async () => {
    recordAgentEvent({ stage: 'dev_probe', status: 'completed', mode: 'dry_run' });
    await flushAppends();
    const file = path.join(dir, 'agent-events.jsonl');
    const { appendFileSync } = await import('node:fs');
    appendFileSync(file, 'not json\n{"id":123,"stage":true}\n', 'utf8');
    resetAgentTelemetryForTest(dir);
    expect(listAgentEvents()).toHaveLength(1);
  });

  it('clear empties both the ring and the mirror', async () => {
    recordAgentEvent({ stage: 'dev_probe', status: 'completed', mode: 'dry_run' });
    await flushAppends();
    expect(clearAgentEvents()).toBe(1);
    expect(listAgentEvents()).toHaveLength(0);
    const file = path.join(dir, 'agent-events.jsonl');
    expect(readFileSync(file, 'utf8')).toBe('');
    // A reset after clear restores nothing.
    resetAgentTelemetryForTest(dir);
    expect(listAgentEvents()).toHaveLength(0);
  });

  it('does not write a mirror in production mode', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_TEST_REAL_LOOP', '');
    recordAgentEvent({ stage: 'dev_probe', status: 'completed', mode: 'dry_run' });
    await flushAppends();
    expect(() => readFileSync(path.join(dir, 'agent-events.jsonl'), 'utf8')).toThrow();
  });
});

describe('getAgentRunTrace / clearAgentEvents', () => {
  it('returns only the events for one correlationId, oldest first', () => {
    recordAgentEvent({ stage: 'frontdoor', status: 'started', mode: 'real_model_call', correlationId: 'run_a' });
    recordAgentEvent({ stage: 'card_call', status: 'completed', mode: 'real_model_call', correlationId: 'run_b' });
    recordAgentEvent({ stage: 'hermes_postflight', status: 'completed', mode: 'real_model_call', correlationId: 'run_a' });
    const trace = getAgentRunTrace('run_a');
    expect(trace.map((e) => e.stage)).toEqual(['frontdoor', 'hermes_postflight']);
    expect(getAgentRunTrace('')).toEqual([]);
  });

  it('clear empties the buffer and reports the count', () => {
    recordAgentEvent({ stage: 'dev_probe', status: 'completed', mode: 'dry_run' });
    expect(clearAgentEvents()).toBe(1);
    expect(listAgentEvents()).toHaveLength(0);
  });
});

describe('summarizeForTelemetry', () => {
  it('collapses whitespace and returns empty for nullish', () => {
    expect(summarizeForTelemetry('  a\n\n b\t c ')).toBe('a b c');
    expect(summarizeForTelemetry(null)).toBe('');
    expect(summarizeForTelemetry(undefined)).toBe('');
  });
});
