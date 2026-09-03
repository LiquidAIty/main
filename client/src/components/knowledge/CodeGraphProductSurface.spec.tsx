// @vitest-environment jsdom

import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../vendor/codebase-memory-ui/src/components/GraphScene', () => ({
  computeCameraTarget: vi.fn(() => null),
  GraphScene: ({
    data,
  }: {
    data: {
      nodes: Array<{ native_id?: string }>;
      edges: Array<{ type: string }>;
    };
  }) => (
    <div data-testid="cbm-graph-scene">
      {data.nodes.map((node) => node.native_id).join(',')}|{data.edges.map((edge) => edge.type).join(',')}
    </div>
  ),
}));

import KnowledgeGraphFramework from './KnowledgeGraphFramework';
import AgentBuilderRail from '../../features/agentbuilder/core/AgentBuilderRail';
import CompanionSurfaceHost from '../../features/agentbuilder/core/CompanionSurfaceHost';

const empty = (authority: 'thinkgraph' | 'knowgraph') => ({
  schemaVersion: `${authority}.attention.projection.v1`,
  authority,
  projectId: 'project-1',
  nodes: [],
  edges: [],
});

const boundedCodeGraphProjection = {
  schemaVersion: 'codegraph.attention.projection.v1',
  authority: 'codegraph' as const,
  projectId: 'project-1',
  counts: { nodes: 2, edges: 1 },
  nodes: [
    {
      id: 'C-Projects-LiquidAIty-main.client.src.components.knowledge.NativeAuthorityGraphSurface.NativeCodeGraphSurface',
      label: 'NativeCodeGraphSurface',
      type: 'Function',
      mentionCount: 1,
      properties: { file_path: 'client/src/components/knowledge/NativeAuthorityGraphSurface.tsx' },
    },
    {
      id: 'C-Projects-LiquidAIty-main.client.src.components.knowledge.KnowledgeGraphFramework.KnowledgeGraphFramework',
      label: 'KnowledgeGraphFramework',
      type: 'Function',
      mentionCount: 1,
      properties: { file_path: 'client/src/components/knowledge/KnowledgeGraphFramework.tsx' },
    },
  ],
  edges: [
    {
      id: 'knowledge-framework:CALLS:native-codegraph-surface',
      source: 'C-Projects-LiquidAIty-main.client.src.components.knowledge.KnowledgeGraphFramework.KnowledgeGraphFramework',
      target: 'C-Projects-LiquidAIty-main.client.src.components.knowledge.NativeAuthorityGraphSurface.NativeCodeGraphSurface',
      predicate: 'CALLS',
      mentionCount: 1,
    },
  ],
};

function ProductGraphsHarness() {
  const [workspaceView, setWorkspaceView] = useState('chat');
  return (
    <div style={{ width: 1200, height: 800 }}>
      <AgentBuilderRail
        colors={{ panel: '#000', border: '#222', primary: '#2dd4bf', text: '#fff' }}
        workspaceView={workspaceView}
        visibleRailItems={{
          showKnowledge: true,
          showWorldsignal: false,
          showWorldview: false,
          showTrading: false,
        }}
        moonOrb={null}
        onShowWorldsignalWorkspace={vi.fn()}
        onShowWorldviewWorkspace={vi.fn()}
        onShowCanvasWorkspace={() => setWorkspaceView('canvas')}
        onQuickAddAssistNode={vi.fn()}
        onShowKnowledgeWorkspace={() => setWorkspaceView('knowledge')}
        onShowTradingWorkspace={vi.fn()}
        onOpenNavigationDrawer={vi.fn()}
      />
      <CompanionSurfaceHost
        workspaceView={workspaceView}
        minWidth={640}
        tradingSurface={null}
        worldsignalSurface={null}
        knowledgeSurface={(
          <KnowledgeGraphFramework
            codeGraphProjectName="C-Projects-LiquidAIty-main"
            codeGraphProjectError={null}
            kind="codegraph"
            attentionProjections={{
              thinkgraph: empty('thinkgraph'),
              knowgraph: empty('knowgraph'),
              codegraph: boundedCodeGraphProjection,
            }}
            attentionErrors={{}}
            onExpandAttentionNode={vi.fn()}
            onUseAttentionNode={vi.fn()}
            onKindChange={vi.fn()}
          />
        )}
      />
    </div>
  );
}

describe('product Graphs tab CodeGraph preservation', () => {
  it('opens the in-product Graphs surface and renders only supplied native CBM identities', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductGraphsHarness />);

    expect(screen.queryByTestId('cbm-graph-scene')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Graphs' }));

    const scene = await waitFor(
      () => screen.getByTestId('cbm-graph-scene'),
      { timeout: 30_000 },
    );
    expect(scene.textContent).toContain('NativeAuthorityGraphSurface.NativeCodeGraphSurface');
    expect(scene.textContent).toContain('KnowledgeGraphFramework.KnowledgeGraphFramework');
    expect(scene.textContent).toContain('CALLS');
    expect(fetchMock).not.toHaveBeenCalled();
  }, 45_000);
});
