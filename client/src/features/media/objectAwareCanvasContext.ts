import type { SceneGraphSource } from './sceneGraphSource';

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

function buildProductContext(scene: SceneGraphSource): SelectedSceneObjectContext | null {
  const product = scene.products[0];
  if (!product) return null;

  const relatedFlows = scene.flowPaths.filter(
    (flow) => flow.from === product.id || flow.to === product.id,
  );

  return {
    selectedObjectId: product.id,
    objectType: 'product',
    objectName: product.name,
    properties: {
      mount: product.mount,
      dimensionsIn:
        product.dimensionsIn != null
          ? `${product.dimensionsIn.width}x${product.dimensionsIn.height}x${product.dimensionsIn.depth}`
          : null,
      productFamily: product.productFamily,
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
): CanvasObjectContext {
  return {
    canvasId,
    sceneId: scene.id,
    selected: buildProductContext(scene),
  };
}
