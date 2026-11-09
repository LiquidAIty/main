/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file keeps joined Think/Know and opt-in Code views inside one lazy shared renderer workspace while preserving independent status and read actions.
 * Entity: ThinkGraph
 * Relationship: This file presents the Engraphis projection and its exact removal actions through the shared graph surface.
 * Entity: KnowGraph
 * Relationship: This file presents the Graphiti projection and its exact removal actions through the shared graph surface.
 * Entity: CodeGraph
 * Relationship: This file passes explicit Code selection, File connection and source reads into the same Entity-first renderer and Inspector.
 */

import { Suspense, lazy } from 'react';

import { GraphPaperBackground } from '../graph/GraphCanvasChrome';
import type { KnowledgeGraphKind } from '../../types/agentgraph';
import type { CanonicalEntityFocusRequest } from '../builder/canonicalEntityLinks';
import type {
  GraphProjectionV1,
  GraphViewContext,
} from './knowledgeGraphProjection';
import type { CodeGraphFileSource } from './codeGraphProjection';

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
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
  codeGraph: {
    projection: GraphProjectionV1;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
    warning: string | null;
    freshness: string;
    selectedCategoryIds?: string[];
    visible?: boolean;
  };
  onOpenCodeGraph: () => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphFiles: (filePaths: string[]) => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphSource: (filePath: string) => Promise<CodeGraphFileSource | null>;
  onConfigureCodeCategories: (change: { enable?: string[]; disable?: string[]; visible?: boolean }) => Promise<void>;
  onViewContext?: (context: GraphViewContext) => void;
};

export default function KnowledgeGraphFramework({
  minHeight = 280,
  surfaceRole = minHeight > 320 ? 'large' : 'companion',
  projections,
  errors,
  statuses,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  entityFocusRequest,
  codeGraph,
  onOpenCodeGraph,
  onReadCodeGraphFiles,
  onReadCodeGraphSource,
  onConfigureCodeCategories,
  onViewContext,
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
            onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
            onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
            entityFocusRequest={entityFocusRequest}
            codeGraph={codeGraph}
            onOpenCodeGraph={onOpenCodeGraph}
            onReadCodeGraphFiles={onReadCodeGraphFiles}
            onReadCodeGraphSource={onReadCodeGraphSource}
            onConfigureCodeCategories={onConfigureCodeCategories}
            onViewContext={onViewContext}
          />
      </Suspense>
    </div>
  );
}
