// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function readyGlobe() {
  const frame = screen.getByTitle('God’s Eye WorldView globe') as HTMLIFrameElement;
  const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
  fireEvent(window, new MessageEvent('message', {
    origin: new URL(frame.src).origin, source: frame.contentWindow,
    data: { schemaVersion: 'gev.embed.ready.v1', sourceVersion: 'unit-test',
      agentRuntime: 'supervised', nativeAgentAvailable: false, nativeAgentActive: false },
  }));
  return postMessage;
}

describe('WorldView Card-owned presentation', () => {
  it('fails closed without a saved Card attachment', () => {
    render(<WorldViewSurface projectId="project-1" cardId={null} />);
    expect(screen.getByText('WorldView Card is not connected')).toBeTruthy();
    expect(screen.queryByTitle('God’s Eye WorldView globe')).toBeNull();
  });

  it('removes the evidence drawer while preserving geographic focus', () => {
    render(<WorldViewSurface projectId="project-1" cardId="card-worldview"
      signalPackage={packageFixture} assessment={assessmentFixture} />);
    const postMessage = readyGlobe();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 'gev.embed.focus.v1', id: 'signal-candidate:geo',
      position: { longitude: -97.7431, latitude: 30.2672 },
    }), expect.any(String));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText('Observed fact')).toBeNull();
    expect(screen.queryByText('Agent hypothesis')).toBeNull();
    expect(screen.queryByText('Analyst assessment')).toBeNull();
    expect(screen.getByRole('region', { name: 'WorldView signal workspace' }).style.gridTemplateColumns).toBe('minmax(0, 1fr)');
  });

  it('does not invent globe coordinates for non-geographic candidates', () => {
    render(<WorldViewSurface projectId="project-1" cardId="card-worldview"
      signalPackage={{ ...packageFixture, candidates: [packageFixture.candidates[1]] }} />);
    expect(readyGlobe()).not.toHaveBeenCalled();
  });

  it('reads the existing Card Run for globe focus without fetching the removed assessment panel', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ok: true, result: { state: 'completed', runId: 'run-worldview-1',
        cardId: 'card-worldview', output: JSON.stringify(packageFixture) } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WorldViewSurface projectId="project-1" cardId="card-worldview" analystCardId="card-signal-analyst" />);
    const postMessage = readyGlobe();
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'signal-candidate:geo' }), expect.any(String)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      action: 'status', inspectOnly: true, projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-worldview',
    });
  });

  it.each([
    'A useful answer, but not a SignalPackage.',
    JSON.stringify({ ...packageFixture, projectId: 'another-project' }),
  ])('does not focus the globe from invalid or mismatched Card output', async (output) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ok: true, result: { state: 'completed', runId: 'run-worldview-1', cardId: 'card-worldview', output } }),
    }));
    render(<WorldViewSurface projectId="project-1" cardId="card-worldview" />);
    const postMessage = readyGlobe();
    await act(async () => {});
    expect(postMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});
