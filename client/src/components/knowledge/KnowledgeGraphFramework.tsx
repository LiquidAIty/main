import { Suspense, lazy } from 'react';

import { GRAPH_THEME, graphDrawerSectionStyle } from '../graph/graphVisualTokens';
import type { KnowledgeGraphKind } from '../../types/agentgraph';

const NativeCodeGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeCodeGraphSurface };
});
const NativeKnowGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeKnowGraphSurface };
});
const NativeThinkGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeGraphProjectionSurface };
});

type KnowledgeSurfaceKind = KnowledgeGraphKind;

const GRAPH_AUTHORITIES: readonly KnowledgeSurfaceKind[] = [
  'thinkgraph',
  'knowgraph',
  'codegraph',
];

type Props = {
  codeGraphProjectName: string | null;
  codeGraphProjectError: string | null;
  kind: KnowledgeSurfaceKind;
  minHeight?: number;
  surfaceRole?: 'large' | 'companion';
  attentionProjections: Record<KnowledgeSurfaceKind, import('./NativeAuthorityGraphSurface').GraphProjectionV1>;
  attentionErrors: Partial<Record<KnowledgeSurfaceKind, string>>;
  onExpandAttentionNode: (
    authority: KnowledgeSurfaceKind,
    node: import('./NativeAuthorityGraphSurface').GraphProjectionNode,
  ) => Promise<void>;
  onUseAttentionNode: (
    authority: KnowledgeSurfaceKind,
    node: import('./NativeAuthorityGraphSurface').GraphProjectionNode,
  ) => void;
  onKindChange: (kind: KnowledgeSurfaceKind) => void;
};

export default function KnowledgeGraphFramework({
  codeGraphProjectName,
  codeGraphProjectError,
  kind,
  minHeight = 280,
  surfaceRole = minHeight > 320 ? 'large' : 'companion',
  attentionProjections,
  attentionErrors,
  onExpandAttentionNode,
  onUseAttentionNode,
  onKindChange,
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
            {`${authority.slice(0, -5)[0].toUpperCase()}${authority.slice(1, -5)}Graph`}
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
          codeGraphProjectError ? (
            <div
              data-testid="codegraph-project-error"
              role="alert"
              style={graphDrawerSectionStyle({
                width: '100%',
                height: '100%',
                minHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                borderRadius: 8,
                color: '#fda4af',
                textAlign: 'center',
              })}
            >
              {codeGraphProjectError}
            </div>
          ) : (
            <NativeCodeGraphSurface
              project={codeGraphProjectName}
              projection={attentionProjections.codegraph}
              onExpand={(node) => onExpandAttentionNode('codegraph', node)}
              onUseAsContext={(node) => onUseAttentionNode('codegraph', node)}
            />
          )
        ) : kind === 'thinkgraph' ? (
          <NativeThinkGraphSurface
            projection={attentionProjections.thinkgraph}
            status={attentionErrors.thinkgraph ? 'error' : 'ready'}
            error={attentionErrors.thinkgraph || null}
            authority="thinkgraph"
            onExpand={(node) => onExpandAttentionNode('thinkgraph', node)}
            onUseAsContext={(node) => onUseAttentionNode('thinkgraph', node)}
          />
        ) : kind === 'knowgraph' ? (
          <NativeKnowGraphSurface
            projection={attentionProjections.knowgraph}
            error={attentionErrors.knowgraph || null}
            onExpand={(node) => onExpandAttentionNode('knowgraph', node)}
            onUseAsContext={(node) => onUseAttentionNode('knowgraph', node)}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
