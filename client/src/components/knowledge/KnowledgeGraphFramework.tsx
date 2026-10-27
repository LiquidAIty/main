/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file keeps joined Think/Know and opt-in Code views inside one lazy shared renderer workspace while preserving independent status and read actions.
 * Entity: ThinkGraph
 * Relationship: This file presents the Engraphis projection and its exact focus-neighborhood and removal actions through the shared graph surface.
 * Entity: KnowGraph
 * Relationship: This file presents the Graphiti projection and its exact focus-neighborhood and removal actions through the shared graph surface.
 * Entity: CodeGraph
 * Relationship: This file opens CodeGraph only on explicit tab selection and passes bounded File expansion and Symbol source reads into the same renderer and Inspector.
 */

import { Suspense, lazy } from 'react';

import { GraphPaperBackground } from '../graph/GraphCanvasChrome';
import type { KnowledgeGraphKind } from '../../types/agentgraph';
import type { CanonicalEntityFocusRequest } from '../builder/canonicalEntityLinks';
import type {
  GraphProjectionV1,
  ReadProviderFocusNeighborhood,
} from './knowledgeGraphProjection';
import type { CodeGraphSelectedSymbol } from './codeGraphProjection';

const JoinedKnowledgeGraphSurface = lazy(async () => {
  const mod = await import('./KnowledgeAuthorityGraphSurface');
  return { default: mod.JoinedKnowledgeGraphSurface };
});

type Props = {
  minHeight?: number;
  surfaceRole?: 'large' | 'companion';
  projections: Record<KnowledgeGraphKind, GraphProjectionV1>;
  errors: Partial<Record<KnowledgeGraphKind, string>>;
  statuses?: Partial<Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>>;
  onReadFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
  codeGraph: {
    projection: GraphProjectionV1;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
    warning: string | null;
    freshness: string;
  };
  onOpenCodeGraph: () => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphFile: (filePath: string) => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphSource: (qualifiedName: string) => Promise<CodeGraphSelectedSymbol | null>;
};

export default function KnowledgeGraphFramework({
  minHeight = 280,
  surfaceRole = minHeight > 320 ? 'large' : 'companion',
  projections,
  errors,
  statuses,
  onReadFocusNeighborhood,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  entityFocusRequest,
  codeGraph,
  onOpenCodeGraph,
  onReadCodeGraphFile,
  onReadCodeGraphSource,
}: Props) {
  return (
    <div
      data-testid={`${surfaceRole}-surface-knowledge`}
      data-graph-framework="active"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight, overflow: 'hidden' }}
    >
      <GraphPaperBackground />
      <Suspense
        fallback={
          <div
            aria-busy="true"
            style={{
              width: '100%',
              height: '100%',
              minHeight,
              position: 'relative',
            }}
          />
        }
      >
        <JoinedKnowledgeGraphSurface
            projections={{
              thinkgraph: projections.thinkgraph,
              knowgraph: projections.knowgraph,
            }}
            statuses={{
              thinkgraph: statuses?.thinkgraph
                || (errors.thinkgraph ? 'error' : 'ready'),
              knowgraph: statuses?.knowgraph
                || (errors.knowgraph ? 'error' : 'ready'),
            }}
            errors={{
              ...(errors.thinkgraph ? { thinkgraph: errors.thinkgraph } : {}),
              ...(errors.knowgraph ? { knowgraph: errors.knowgraph } : {}),
            }}
            onReadProviderFocusNeighborhood={onReadFocusNeighborhood}
            onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
            onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
            entityFocusRequest={entityFocusRequest}
            codeGraph={codeGraph}
            onOpenCodeGraph={onOpenCodeGraph}
            onReadCodeGraphFile={onReadCodeGraphFile}
            onReadCodeGraphSource={onReadCodeGraphSource}
          />
      </Suspense>
    </div>
  );
}
