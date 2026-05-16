import type { SceneGraphSource } from './sceneGraphSource';
import type { AssetResolutionResult } from './sceneAssetRegistry';

export type ObjectAwareAction =
  | 'focusCamera'
  | 'annotate'
  | 'moveObject'
  | 'tuneFlowPath'
  | 'captureSeedFrame'
  | 'queueDiffusionJob'
  | 'queuePeepshowReview';

export type SelectedSceneObjectContext = {
  selectedObjectId: string;
  objectType: 'set' | 'asset' | 'actor' | 'prop' | 'product' | 'flowPath' | 'overlay' | 'camera';
  objectName: string;
  sourceAssetId?: string | null;
  properties: Record<string, string | number | boolean | null>;
  relationships: Array<{
    relation: string;
    targetId: string;
    targetName: string;
  }>;
  allowedActions: ObjectAwareAction[];
};

export type CanvasObjectContext = {
  canvasId: string;
  sceneId: string;
  selected: SelectedSceneObjectContext | null;
};

function formatDimensionHint(asset: AssetResolutionResult | null): string | null {
  if (!asset?.dimensionHint) return null;
  const dim = asset.dimensionHint;
  const width = dim.width ?? '?';
  const height = dim.height ?? '?';
  const depth = dim.depth ?? '?';
  return `${width}x${height}x${depth}${dim.unit}`;
}

function buildProductContext(
  scene: SceneGraphSource,
  resolvedAssets?: AssetResolutionResult[],
): SelectedSceneObjectContext | null {
  const product = scene.products[0];
  if (!product) return null;
  const matchedAsset =
    resolvedAssets?.find((asset) => asset.category === 'product') || null;

  const relatedFlows = scene.flowPaths.filter(
    (flow) => flow.from === product.id || flow.to === product.id,
  );

  return {
    selectedObjectId: product.id,
    objectType: 'product',
    objectName: product.name,
    sourceAssetId: matchedAsset?.sceneAssetId ?? null,
    properties: {
      mount: product.mount,
      dimensionsIn:
        product.dimensionsIn != null
          ? `${product.dimensionsIn.width}x${product.dimensionsIn.height}x${product.dimensionsIn.depth}`
          : null,
      productFamily: product.productFamily,
      sourceTemplateId: matchedAsset?.templateId ?? null,
      sourceGeometryKind: matchedAsset?.geometryKind ?? null,
      sourceDimensions: formatDimensionHint(matchedAsset),
      sourceFallbackStatus: matchedAsset?.fallbackStatus ?? null,
    },
    relationships: relatedFlows.map((flow) => ({
      relation: flow.flowType,
      targetId: flow.to === product.id ? flow.from : flow.to,
      targetName: flow.name,
    })),
    allowedActions: [
      'focusCamera',
      'annotate',
      'tuneFlowPath',
      'captureSeedFrame',
      'queueDiffusionJob',
      'queuePeepshowReview',
    ],
  };
}

export function buildCanvasObjectContext(
  scene: SceneGraphSource,
  canvasId = 'video',
  resolvedAssets?: AssetResolutionResult[],
): CanvasObjectContext {
  return {
    canvasId,
    sceneId: scene.id,
    selected: buildProductContext(scene, resolvedAssets),
  };
}
