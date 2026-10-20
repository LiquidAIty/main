// @vitest-environment jsdom

/**
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies the shared inspector renders bounded graph records, identities, times, relationships, sources, and deletion controls without requiring the renderer.
 *
 * Entity: ThinkGraph
 * Relationship: This file verifies exact Think summaries and structured relationships remain readable and removable through the shared evidence presentation.
 *
 * Entity: KnowGraph
 * Relationship: This file verifies atomic Knows render finding, interpretation, direction and verified source while historical paired records remain explicit and readable.
 *
 * Entity: CodeGraph
 * Relationship: This file verifies the shared Inspector keeps exact File/Symbol/Feature identity and loads bounded source only through an explicit action.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CodeGraphNodeDetails,
  INSPECTOR_RECORD_LIMIT,
  KnowGraphKnow,
  KnowSourceList,
  ThinkRecordCard,
  knowEvidenceIdentity,
  sourceLinks,
  type KnowInspectorRecord,
} from './KnowledgeGraphInspector';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('shared knowledge inspector', () => {
  it('uses only the exact attached Graphiti episode identity for a Know', () => {
    expect(knowEvidenceIdentity({ graphitiEpisodeId: 'episode-1' })).toBe('episode-1');
    expect(knowEvidenceIdentity({ graphitiEpisodeId: '  ' })).toBeNull();
    expect(knowEvidenceIdentity({ graphitiFactUuid: 'fact-1' })).toBeNull();
  });

  it('keeps same-domain documents distinct while collapsing exact source URLs', () => {
    const links = sourceLinks({
      source_description: JSON.stringify([
        'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
        'https://investors.rocketlabcorp.com/news/fourth-quarter-2025-results',
        'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
      ]),
    });

    expect(links.map(link => [link.label, link.publisher, link.url])).toEqual([
      [
        'Third quarter 2025 results',
        'investors.rocketlabcorp.com',
        'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
      ],
      [
        'Fourth quarter 2025 results',
        'investors.rocketlabcorp.com',
        'https://investors.rocketlabcorp.com/news/fourth-quarter-2025-results',
      ],
    ]);
  });

  it('exposes only credential-free HTTPS citation links', () => {
    const links = sourceLinks({
      source_description: JSON.stringify([
        'https://example.test/report?document=10#page=2',
        'http://example.test/insecure',
        'javascript:alert(1)',
        'https://user:password@example.test/private',
        'https://example.test/private?access_token=secret',
        'https://example.test\\@attacker.test/source',
      ]),
    });

    expect(links.map(link => link.url)).toEqual([
      'https://example.test/report?document=10#page=2',
    ]);
  });

  it('renders one Think with its exact structured relationship and deletion action', () => {
    const remove = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ThinkRecordCard
      heading="Think"
      item={{
        id: 'memory-one',
        title: 'Launch thesis',
        summary: 'Electron cadence must convert into attributable launch revenue.',
        metadata: {
          structured_extraction: {
            relations: [{
              source: 'Electron cadence',
              relation: 'must convert into',
              target: 'Launch revenue',
            }],
          },
        },
      }}
      onRemove={remove}
    />);

    expect(screen.getByText('Electron cadence must convert into attributable launch revenue.'))
      .toBeTruthy();
    expect(screen.getByText('Electron cadence must convert into Launch revenue'))
      .toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('renders one atomic Know as finding, interpretation, direction, and source', () => {
    const record: KnowInspectorRecord = {
      episodeId: 'episode-atomic',
      know: {
        title: 'Rocket Lab result',
        schemaVersion: 'know.v2',
        observation: 'Rocket Lab reported one source-backed operating result.',
        interpretation: 'The result informs demand but does not decide the thesis.',
        source: {
          url: 'https://example.test/result',
          resolvedUrl: 'https://example.test/archive/result',
          title: 'Rocket Lab quarterly result',
          publisher: 'Rocket Lab',
          evidence: 'The exact source passage remains inspectable.',
          publishedAt: '2026-10-19',
          retrievedAt: '2026-10-20T08:00:00Z',
        },
        direction: {
          proposition: 'Rocket Lab can compound launch revenue.',
          relation: 'supports',
        },
      },
      episode: {},
    };

    render(<>
      <KnowGraphKnow record={record} heading="Know" />
      <KnowSourceList records={[record]} />
    </>);

    expect(screen.getByText('Finding')).toBeTruthy();
    expect(screen.getByText('Rocket Lab reported one source-backed operating result.'))
      .toBeTruthy();
    expect(screen.getByText('Interpretation')).toBeTruthy();
    expect(screen.getByText('The result informs demand but does not decide the thesis.'))
      .toBeTruthy();
    expect(screen.getByText((content, element) => (
      Boolean(element?.classList.contains('graph-know-direction'))
      && content.includes('Rocket Lab can compound launch revenue.')
    ))).toBeTruthy();
    expect(screen.queryByText('For')).toBeNull();
    expect(screen.queryByText('Against')).toBeNull();
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      'https://example.test/archive/result',
      'https://example.test/archive/result',
    ]);
    fireEvent.click(screen.getByText('Source passage'));
    expect(screen.getByText('The exact source passage remains inspectable.')).toBeTruthy();
  });

  it('keeps a historical paired Know explicitly readable and deduplicates its safe sources', () => {
    const record: KnowInspectorRecord = {
      episodeId: 'episode-one',
      know: {
        title: 'Rocket Lab evidence',
        schemaVersion: 'know.v1',
        legacy: true,
        idea: {
          body: 'Supporting paragraph stays intact.',
          detail: 'Supporting depth remains under More.',
          citations: [{
            url: 'https://example.test/source-one',
            supports: 'Supports the favorable claim.',
          }],
        },
        counterIdea: {
          body: 'Counter paragraph stays intact.',
          citations: [{
            url: 'https://example.test/source-two',
            supports: 'Supports the challenging claim.',
          }],
        },
      },
      episode: {
        source_description: JSON.stringify([
          'https://example.test/source-one',
          'https://example.test/source-two',
          'https://example.test/source-one',
        ]),
      },
    };

    render(<>
      <KnowGraphKnow record={record} heading="Know" />
      <KnowSourceList records={[record]} />
    </>);

    expect(screen.getByText('Supporting paragraph stays intact.')).toBeTruthy();
    expect(screen.getByText('Counter paragraph stays intact.')).toBeTruthy();
    expect(screen.getByText('Historical paired Know')).toBeTruthy();
    expect(screen.getByText('Supporting record')).toBeTruthy();
    expect(screen.getByText('Counter record')).toBeTruthy();
    expect(screen.getByText('Supporting depth remains under More.')).toBeTruthy();
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      'https://example.test/source-one',
      'https://example.test/source-two',
      'https://example.test/source-one',
      'https://example.test/source-two',
    ]);
    expect(INSPECTOR_RECORD_LIMIT).toBe(2);
  });

  it('shows Code identity and requests exact source only on explicit action', () => {
    const onLoadSource = vi.fn();
    render(<CodeGraphNodeDetails
      node={{
        id: 'symbol:run',
        label: 'run',
        authority: 'codegraph',
        type: 'Function',
        etype: 'Symbol',
        properties: {
          recordKind: 'symbol',
          symbolKind: 'Function',
          qualifiedName: 'C-Projects-LiquidAIty-main.client.run',
          filePath: 'client/src/run.ts',
          startLine: 10,
          endLine: 20,
          features: ['CodeGraph'],
        },
      }}
      source={null}
      sourceLoading={false}
      sourceError={null}
      onLoadSource={onLoadSource}
    />);

    expect(screen.getByText('client/src/run.ts')).toBeTruthy();
    expect(screen.getByText('CodeGraph')).toBeTruthy();
    expect(onLoadSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load source' }));
    expect(onLoadSource).toHaveBeenCalledWith('C-Projects-LiquidAIty-main.client.run');
  });
});
