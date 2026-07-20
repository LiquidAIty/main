import { Suspense, lazy } from 'react';

import { GRAPH_THEME, graphDrawerSectionStyle } from '../graph/graphVisualTokens';
import type { GraphObjectRef } from './GraphObjectContext';
import type { UnifiedProjectionIdentity } from './UnifiedGraphSurface';
import type { KnowledgeGraphKind } from '../../types/agentgraph';
import type { ThinkGraphProjectionState } from '../../features/agentbuilder/state/useAgentBuilderThinkGraphProjection';

const UnifiedGraphSurface = lazy(() => import('./UnifiedGraphSurface'));
const KnowGraphAnalysisSurface = lazy(() => import('./KnowGraphAnalysisSurface'));
const NativeCodeGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeCodeGraphSurface };
});
const NativeThinkGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeThinkGraphSurface };
});

export type KnowledgeSurfaceKind = KnowledgeGraphKind | 'unified';

const GRAPH_AUTHORITIES: readonly KnowledgeSurfaceKind[] = [
  'unified',
  'thinkgraph',
  'knowgraph',
  'codegraph',
];

type Props = {
  projectId: string | null;
  codeGraphProjectName: string | null;
  conversationId: string | null;
  kind: KnowledgeSurfaceKind;
  minHeight?: number;
  surfaceRole?: 'large' | 'companion';
  thinkGraphProjection: ThinkGraphProjectionState;
  onKindChange: (kind: KnowledgeSurfaceKind) => void;
  onProjectionChange: (identity: UnifiedProjectionIdentity | null) => void;
  onAskMain: (ref: GraphObjectRef) => void;
  onSelectedObjectChange: (ref: GraphObjectRef | null) => void;
};

export default function KnowledgeGraphFramework({
  projectId,
  codeGraphProjectName,
  conversationId,
  kind,
  minHeight = 280,
  surfaceRole = minHeight > 320 ? 'large' : 'companion',
  thinkGraphProjection,
  onKindChange,
  onProjectionChange,
  onAskMain,
  onSelectedObjectChange,
}: Props) {
  return (
    <div
      data-testid={`${surfaceRole}-surface-knowledge`}
      data-graph-framework="active"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 6, display: 'flex', gap: 6 }}>
        {GRAPH_AUTHORITIES.map((authority) => (
          <button
            key={authority}
            type="button"
            data-testid={`graph-kind-${authority}`}
            onClick={() => onKindChange(authority)}
            style={{
              fontSize: 12,
              padding: '4px 12px',
              borderRadius: 7,
              cursor: 'pointer',
              border: `1px solid ${authority === kind ? '#2dd4bf' : '#26313f'}`,
              background: authority === kind ? 'rgba(45,212,191,0.12)' : 'rgba(13,18,32,0.7)',
              color: authority === kind ? '#a9ecdf' : '#8fb3c8',
            }}
          >
            {authority === 'unified'
              ? 'Unified'
              : `${authority.slice(0, -5)[0].toUpperCase()}${authority.slice(1, -5)}Graph`}
          </button>
        ))}
      </div>
      <Suspense
        fallback={
          <div
            style={graphDrawerSectionStyle({
              width: '100%',
              minHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              color: GRAPH_THEME.drawer.inputMuted,
            })}
          >
            Loading knowledge graph...
          </div>
        }
      >
        {kind === 'codegraph' ? (
          <NativeCodeGraphSurface project={codeGraphProjectName} onAskMain={onAskMain} onSelectedObjectChange={onSelectedObjectChange} />
        ) : kind === 'thinkgraph' ? (
          <NativeThinkGraphSurface
            projection={thinkGraphProjection.projection}
            status={thinkGraphProjection.status}
            error={thinkGraphProjection.error}
            onAskMain={onAskMain}
            onSelectedObjectChange={onSelectedObjectChange}
          />
        ) : kind === 'knowgraph' ? (
          <KnowGraphAnalysisSurface projectId={projectId ?? ''} onAskMain={onAskMain} onSelectedObjectChange={onSelectedObjectChange} />
        ) : (
          <UnifiedGraphSurface
            projectId={projectId ?? ''}
            conversationId={conversationId ?? ''}
            onProjectionChange={onProjectionChange}
            onOpenAuthority={onKindChange}
            onAskMain={onAskMain}
            onSelectedObjectChange={onSelectedObjectChange}
          />
        )}
      </Suspense>
    </div>
  );
}
