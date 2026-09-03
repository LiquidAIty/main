// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SignalAssessment, SignalPackage } from './signalContracts';
import WorldViewSurface from './WorldViewSurface';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const packageFixture: SignalPackage = {
  schemaVersion: 'signal.package.v1',
  packageId: 'signal-package:bounded-1',
  projectId: 'project-1',
  deckId: 'deck_builder',
  producerCardId: 'card-worldview',
  producerRunId: 'run-worldview-1',
  generatedAt: '2026-09-03T10:00:00Z',
  query: {
    schemaVersion: 'signal.query.v1',
    queryId: 'signal-query:1',
    requestingCardId: 'card-worldview',
    requestingRunId: 'run-worldview-1',
    reason: 'Inspect two bounded source results.',
  },
  candidates: [
    {
      schemaVersion: 'signal.candidate.v1',
      candidateId: 'signal-candidate:geo',
      projectId: 'project-1',
      deckId: 'deck_builder',
      producerCardId: 'card-worldview',
      producerRunId: 'run-worldview-1',
      source: {
        system: 'worldsignals',
        nativeRef: 'worldsignals:earthquakes:native-1',
        retrievalMethod: 'get_layer_slice',
        contentHash: `sha256:${'a'.repeat(64)}`,
      },
      retrievedAt: '2026-09-03T10:00:00Z',
      freshness: 'fresh',
      stalenessState: 'current',
      domain: 'geophysical',
      location: { type: 'Point', coordinates: [-97.7431, 30.2672] },
      entityRefs: ['native-1'],
      assetRefs: [],
      topics: [],
      lifecycleStatus: 'observed',
      evidenceRefs: [{
        sourceNativeRef: 'worldsignals:earthquakes:native-1',
        contentHash: `sha256:${'a'.repeat(64)}`,
      }],
      rawObservation: { magnitude: 4.2 },
      agentHypothesis: null,
    },
    {
      schemaVersion: 'signal.candidate.v1',
      candidateId: 'signal-candidate:entity',
      projectId: 'project-1',
      deckId: 'deck_builder',
      producerCardId: 'card-worldview',
      producerRunId: 'run-worldview-1',
      source: {
        system: 'worldsignals',
        nativeRef: 'worldsignals:news:native-2',
        retrievalMethod: 'search_news',
        contentHash: `sha256:${'b'.repeat(64)}`,
      },
      retrievedAt: '2026-09-03T10:00:00Z',
      freshness: 'unknown',
      stalenessState: 'unknown',
      domain: 'news',
      location: null,
      entityRefs: ['Example Corp'],
      assetRefs: [],
      topics: [],
      lifecycleStatus: 'observed',
      evidenceRefs: [{
        sourceNativeRef: 'worldsignals:news:native-2',
        contentHash: `sha256:${'b'.repeat(64)}`,
      }],
      rawObservation: { headline: 'Sourced headline' },
      agentHypothesis: 'This may merit corroboration.',
    },
  ],
  truncated: false,
  cursor: null,
  sourceClocks: { worldsignals: '2026-09-03T10:00:00Z' },
  errors: [],
};

const assessmentFixture: SignalAssessment = {
  schemaVersion: 'signal.assessment.v1',
  assessmentId: 'assessment-1',
  projectId: 'project-1',
  deckId: 'deck_builder',
  requestingCardId: 'card-worldview',
  requestingRunId: 'run-worldview-1',
  analystCardId: 'card-signal-analyst',
  analysisRunId: 'run-analyst-1',
  packageId: 'signal-package:bounded-1',
  candidateIds: ['signal-candidate:geo'],
  disposition: 'INCONCLUSIVE',
  method: 'Single-source assessment.',
  observations: ['One observation is present.'],
  inference: 'More corroboration is required.',
  evidenceRefs: [{
    sourceNativeRef: 'worldsignals:earthquakes:native-1',
    contentHash: `sha256:${'a'.repeat(64)}`,
  }],
  limitations: ['One source.'],
  confidence: 0.35,
  assessedAt: '2026-09-03T10:05:00Z',
  asOfAt: '2026-09-03T10:00:00Z',
  freshness: 'fresh',
};

describe('WorldView Card-owned presentation', () => {
  it('fails closed without a saved Card attachment', () => {
    render(<WorldViewSurface projectId="project-1" cardId={null} />);
    expect(screen.getByText('WorldView Card is not connected')).toBeTruthy();
    expect(screen.queryByTitle('God’s Eye WorldView globe')).toBeNull();
  });

  it('separates observations, hypotheses, and linked assessments', () => {
    render(<WorldViewSurface
      projectId="project-1"
      cardId="card-worldview"
      signalPackage={packageFixture}
      assessment={assessmentFixture}
    />);
    expect(screen.getByText('Observed fact')).toBeTruthy();
    expect(screen.getByText('Agent hypothesis')).toBeTruthy();
    expect(screen.getByText('Analyst assessment')).toBeTruthy();
    expect(screen.getByText('INCONCLUSIVE')).toBeTruthy();
    expect(screen.getByText('More corroboration is required.')).toBeTruthy();
  });

  it('keeps non-geographic candidates off the globe while retaining evidence', () => {
    render(<WorldViewSurface
      projectId="project-1"
      cardId="card-worldview"
      signalPackage={packageFixture}
    />);
    fireEvent.click(screen.getByRole('button', { name: /Example Corp/ }));
    expect(screen.getByText('non-geographic · evidence only')).toBeTruthy();
    expect(screen.getByText('This may merit corroboration.')).toBeTruthy();
    expect(screen.getByText('worldsignals:news:native-2')).toBeTruthy();
  });

  it('reads exact typed evidence from the latest persisted Card Runs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { state: 'completed', runId: 'run-worldview-1', cardId: 'card-worldview', output: JSON.stringify(packageFixture) },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { state: 'completed', runId: 'run-analyst-1', cardId: 'card-signal-analyst', output: JSON.stringify(assessmentFixture) },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<WorldViewSurface
      projectId="project-1"
      deckId="deck_builder"
      cardId="card-worldview"
      analystCardId="card-signal-analyst"
    />);

    expect(await screen.findByText('signal-package:bounded-1')).toBeTruthy();
    expect(screen.getByText('More corroboration is required.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      action: 'status',
      inspectOnly: true,
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId: 'card-worldview',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      cardId: 'card-signal-analyst',
    });
  });

  it('does not present untyped Card output as live evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { state: 'completed', runId: 'run-worldview-1', cardId: 'card-worldview', output: 'A useful answer, but not a SignalPackage.' },
      }),
    }));

    render(<WorldViewSurface projectId="project-1" cardId="card-worldview" />);

    expect(await screen.findByText(/A Card Run can request one bounded package/)).toBeTruthy();
    expect(screen.getByText('No SignalPackage attached')).toBeTruthy();
    expect(screen.queryByText('A useful answer, but not a SignalPackage.')).toBeNull();
  });

  it('rejects a package whose scope does not match the persisted Card Run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          state: 'completed', runId: 'run-worldview-1', cardId: 'card-worldview',
          output: JSON.stringify({ ...packageFixture, projectId: 'another-project' }),
        },
      }),
    }));

    render(<WorldViewSurface projectId="project-1" cardId="card-worldview" />);

    expect(await screen.findByText(/A Card Run can request one bounded package/)).toBeTruthy();
    expect(screen.getByText('No SignalPackage attached')).toBeTruthy();
    expect(screen.queryByText('signal-package:bounded-1')).toBeNull();
  });
});
