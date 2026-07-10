// @vitest-environment jsdom
// Hermes Dev Observatory: honest empty/unreachable states, run grouping with
// pipeline stage chips, event JSON expansion, RAM-vs-disk source labels, the
// System topology tab, the Cards tab (saved vs resolved config + drift
// inline), the Coder Reports tab (claim-by-claim verification), and the Drift
// tab. Everything rendered comes from injected (test) fetch results — the
// page never invents runs, cards, reports, or findings.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DevAgentRuns, {
  groupEventsIntoRuns,
  type AgentEventsFetchResult,
  type AgentTelemetryEvent,
  type CoderReportsFetchResult,
  type DriftFetchResult,
  type ProjectsFetchResult,
  type SystemFetchResult,
} from './devAgentRuns';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLElement[] = [];

async function render(node: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

function event(partial: Partial<AgentTelemetryEvent>): AgentTelemetryEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: '2026-07-10T06:00:00.000Z',
    projectId: 'p1',
    deckId: 'deck_builder',
    conversationId: 'main',
    correlationId: 'run_1',
    stage: 'card_call',
    caller: 'harness_doorway',
    cardId: 'card_thinkgraph_agent',
    provider: 'openrouter',
    model: 'z-ai/glm-5.2',
    inputSummary: 'in',
    outputSummary: 'out',
    status: 'completed',
    errorSummary: null,
    durationMs: 1200,
    tools: ['apply_thinkgraph_patch'],
    graphReads: [],
    graphWrites: ['thinkgraph'],
    mode: 'real_model_call',
    metadata: { calledAgents: ['card_research_agent'] },
    source: 'ram',
    ...partial,
  };
}

const NO_PROJECTS: ProjectsFetchResult = { ok: true, projects: [] };

function props(overrides: {
  events?: AgentEventsFetchResult;
  system?: SystemFetchResult;
  drift?: DriftFetchResult;
  reports?: CoderReportsFetchResult;
  projects?: ProjectsFetchResult;
  clear?: () => Promise<void>;
}) {
  return {
    fetchEvents: vi.fn(async () => overrides.events ?? ({ ok: true, events: [] } as AgentEventsFetchResult)),
    fetchSystem: vi.fn(async () => overrides.system ?? ({ ok: false, error: 'not stubbed' } as SystemFetchResult)),
    fetchDrift: vi.fn(async () => overrides.drift ?? ({ ok: false, error: 'not stubbed' } as DriftFetchResult)),
    fetchCoderReports: vi.fn(
      async () => overrides.reports ?? ({ ok: true, reports: [] } as CoderReportsFetchResult),
    ),
    fetchProjects: vi.fn(async () => overrides.projects ?? NO_PROJECTS),
    clearEvents: overrides.clear ?? vi.fn(async () => undefined),
  };
}

describe('Runs tab', () => {
  it('shows the honest empty state', async () => {
    const container = await render(<DevAgentRuns {...props({})} />);
    expect(container.querySelector('[data-testid="dev-agent-runs-empty"]')?.textContent).toContain(
      'No agent events recorded yet',
    );
  });

  it('shows the honest unreachable state', async () => {
    const container = await render(
      <DevAgentRuns {...props({ events: { ok: false, error: 'backend_unreachable' } })} />,
    );
    expect(container.querySelector('[data-testid="dev-agent-runs-error"]')?.textContent).toContain(
      'backend_unreachable',
    );
  });

  it('shows stage chips including participant turns; missing postflight visibly absent', async () => {
    const events = [
      event({ correlationId: 'run_a', stage: 'frontdoor', cardId: null }),
      event({ correlationId: 'run_a', stage: 'mag_one_dispatch' }),
      event({ correlationId: 'run_a', stage: 'participant_turn', cardId: 'card_research_agent' }),
    ];
    const container = await render(<DevAgentRuns {...props({ events: { ok: true, events } })} />);
    const row = container.querySelector('[data-testid="dev-agent-run-row"]')!;
    expect(row.querySelector('[data-testid="stage-chip-participant_turn"]')?.getAttribute('data-present')).toBe(
      'true',
    );
    expect(row.querySelector('[data-testid="stage-chip-hermes_postflight"]')?.getAttribute('data-present')).toBe(
      'false',
    );
  });

  it('opens the detail timeline, labels restored events, and expands full JSON', async () => {
    const events = [
      event({ correlationId: 'run_a', stage: 'frontdoor', cardId: null, source: 'durable' }),
      event({ correlationId: 'run_a', stage: 'card_call' }),
    ];
    const container = await render(<DevAgentRuns {...props({ events: { ok: true, events } })} />);
    expect(container.querySelector('[data-testid="dev-agent-runs-counter"]')?.textContent).toContain(
      '1 restored from disk',
    );
    await act(async () => {
      (container.querySelector('[data-testid="dev-agent-run-row"]') as HTMLElement).click();
    });
    const detailRows = [...container.querySelectorAll('[data-testid="dev-agent-event-row"]')];
    expect(detailRows[0].textContent).toContain('disk');
    expect(detailRows[1].textContent).toContain('openrouter / z-ai/glm-5.2');
    await act(async () => {
      (detailRows[1] as HTMLElement).click();
    });
    expect(container.querySelector('[data-testid="dev-agent-event-json"]')?.textContent).toContain(
      'calledAgents',
    );
  });

  it('clear button calls the backend clear then refreshes', async () => {
    const clear = vi.fn(async () => undefined);
    const p = props({ events: { ok: true, events: [event({})] }, clear });
    const container = await render(<DevAgentRuns {...p} />);
    await act(async () => {
      (container.querySelector('[data-testid="dev-agent-runs-clear"]') as HTMLElement).click();
    });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(p.fetchEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

const SYSTEM: SystemFetchResult = {
  ok: true,
  system: {
    projectId: 'p1',
    deckId: 'deck_builder',
    orchestratorCardId: 'card_magentic',
    busEdges: 5,
    disconnectedCards: ['card_plan_agent'],
    cards: [
      {
        cardId: 'card_research_agent',
        title: 'Research Agent',
        runtimeType: 'assistant_agent',
        runtimeBinding: null,
        connected: true,
        enabled: true,
        promptChars: 420,
        provider: 'openrouter',
        modelKey: 'z-ai/glm-5.2',
        resolved: { provider: 'openrouter', providerModelId: 'z-ai/glm-5.2', tools: [] },
        resolutionError: null,
        graphReads: [],
        graphWrites: [],
        invocableBy: ['mag_one (team run)'],
      },
      {
        cardId: 'card_broken',
        title: 'Broken Card',
        runtimeType: 'assistant_agent',
        runtimeBinding: null,
        connected: false,
        enabled: true,
        promptChars: 10,
        provider: 'openai',
        modelKey: 'nope-model',
        resolved: null,
        resolutionError: 'Unknown model key: nope-model',
        graphReads: [],
        graphWrites: [],
        invocableBy: ['task tab (single assist only — disconnected from the Mag One bus)'],
      },
    ],
    graphEndpoints: { thinkGraph: 'Postgres/AGE' },
    runStages: ['frontdoor'],
  },
};

describe('System + Cards tabs', () => {
  it('System tab shows topology; Cards tab shows resolution errors + drift inline', async () => {
    const drift: DriftFetchResult = {
      ok: true,
      drift: {
        checkedCards: 2,
        problems: [
          {
            cardId: 'card_broken',
            kind: 'model_resolution_failed',
            severity: 'problem',
            detail: 'runtime resolution fails: Unknown model key: nope-model',
          },
        ],
        warnings: [],
      },
    };
    const container = await render(
      <DevAgentRuns
        {...props({ system: SYSTEM, drift, projects: { ok: true, projects: [{ id: 'p1', name: 'ADMIN' }] } })}
      />,
    );
    await act(async () => {
      (container.querySelector('[data-testid="tab-system"]') as HTMLElement).click();
    });
    const systemView = container.querySelector('[data-testid="dev-system-view"]')!;
    expect(systemView.textContent).toContain('card_magentic');
    expect(systemView.textContent).toContain('card_plan_agent');
    expect(systemView.textContent).toContain('card_research_agent');

    await act(async () => {
      (container.querySelector('[data-testid="tab-cards"]') as HTMLElement).click();
    });
    const rows = [...container.querySelectorAll('[data-testid="dev-system-card-row"]')];
    const broken = rows.find((row) => row.textContent?.includes('card_broken'))!;
    expect(broken.textContent).toContain('✗ Unknown model key: nope-model');
    expect(broken.textContent).toContain('model_resolution_failed');
    const research = rows.find((row) => row.textContent?.includes('card_research_agent'))!;
    expect(research.textContent).toContain('connected');
  });
});

describe('Coder Reports tab', () => {
  it('shows the honest empty state and a claim-by-claim verification detail', async () => {
    const emptyContainer = await render(<DevAgentRuns {...props({})} />);
    await act(async () => {
      (emptyContainer.querySelector('[data-testid="tab-reports"]') as HTMLElement).click();
    });
    expect(emptyContainer.querySelector('[data-testid="dev-reports-empty"]')?.textContent).toContain(
      'No CoderReports submitted yet',
    );

    const reports: CoderReportsFetchResult = {
      ok: true,
      reports: [
        {
          submission: {
            id: 'crpt_1',
            timestamp: '2026-07-10T06:00:00.000Z',
            projectId: 'p1',
            executionMode: 'external_coder',
            adapter: 'claude-code',
            jobId: null,
            reportText: 'VERDICT: DONE',
            claims: {},
          },
          verification: {
            verdict: 'CONTRADICTED',
            supported: 1,
            unsupported: 0,
            contradicted: 1,
            missingProof: 0,
            findings: [
              {
                kind: 'graph_write',
                claim: 'wrote graph thinkgraph',
                verdict: 'CONTRADICTED',
                evidence: ['evt_abc'],
                note: 'write was blocked/failed: thinkgraph_authority_missing',
              },
            ],
          },
        },
      ],
    };
    const container = await render(<DevAgentRuns {...props({ reports })} />);
    await act(async () => {
      (container.querySelector('[data-testid="tab-reports"]') as HTMLElement).click();
    });
    const row = container.querySelector('[data-testid="dev-report-row"]')!;
    expect(row.textContent).toContain('claude-code / external_coder');
    expect(row.textContent).toContain('CONTRADICTED');
    await act(async () => {
      (row as HTMLElement).click();
    });
    const finding = container.querySelector('[data-testid="dev-report-finding"]')!;
    expect(finding.textContent).toContain('thinkgraph_authority_missing');
    expect(finding.textContent).toContain('evt_abc');
  });
});

describe('Drift tab', () => {
  it('shows the clean state and findings when present', async () => {
    const cleanContainer = await render(
      <DevAgentRuns
        {...props({
          drift: { ok: true, drift: { checkedCards: 11, problems: [], warnings: [] } },
          projects: { ok: true, projects: [{ id: 'p1', name: 'ADMIN' }] },
        })}
      />,
    );
    await act(async () => {
      (cleanContainer.querySelector('[data-testid="tab-drift"]') as HTMLElement).click();
    });
    expect(cleanContainer.querySelector('[data-testid="dev-drift-clean"]')?.textContent).toContain('11 card(s)');

    const container = await render(
      <DevAgentRuns
        {...props({
          drift: {
            ok: true,
            drift: {
              checkedCards: 2,
              problems: [
                {
                  cardId: 'card_thinkgraph_agent',
                  kind: 'removed_tool_reference',
                  severity: 'problem',
                  detail: "live prompt references removed tool 'apply_live_patch'",
                },
              ],
              warnings: [],
            },
          },
          projects: { ok: true, projects: [{ id: 'p1', name: 'ADMIN' }] },
        })}
      />,
    );
    await act(async () => {
      (container.querySelector('[data-testid="tab-drift"]') as HTMLElement).click();
    });
    const row = container.querySelector('[data-testid="dev-drift-row"]')!;
    expect(row.textContent).toContain('removed_tool_reference');
    expect(row.textContent).toContain('card_thinkgraph_agent');
  });
});

describe('groupEventsIntoRuns', () => {
  it('marks a run failed when any event failed, flags pure-probe runs, sorts newest first', () => {
    const runs = groupEventsIntoRuns([
      event({ correlationId: 'old', timestamp: '2026-07-10T05:00:00.000Z' }),
      event({ correlationId: 'new', timestamp: '2026-07-10T07:00:00.000Z', status: 'failed' }),
      event({ correlationId: 'probe', timestamp: '2026-07-10T06:00:00.000Z', stage: 'dev_probe', mode: 'dry_run' }),
    ]);
    expect(runs.map((r) => r.correlationId)).toEqual(['new', 'probe', 'old']);
    expect(runs[0].failed).toBe(true);
    expect(runs[1].isProbe).toBe(true);
    expect(runs[2].failed).toBe(false);
  });
});
