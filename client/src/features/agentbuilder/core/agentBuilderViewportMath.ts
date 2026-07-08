import type { DeckDocument } from '../../../types/agentgraph';

const MAGENTIC_BUS_BODY_WIDTH = 26;
const LANDING_BUS_TOP_Y = 72;
const LANDING_BUS_CENTER_X = 0;
function isLandingWorkbenchNode(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized.endsWith('_workbench');
}

export type CanvasLandingViewport = {
  x: number;
  y: number;
  zoom: number;
};

type SeamRectHost = {
  getBoundingClientRect: () => { left: number };
};

function isSeamRectHost(value: unknown): value is SeamRectHost {
  return Boolean(
    value && typeof (value as SeamRectHost).getBoundingClientRect === 'function',
  );
}

function normalizeViewportRuntimeType(runtimeType: unknown): string {
  const normalized = String(runtimeType ?? '').trim().toLowerCase();
  if (normalized === 'magentic-one') return 'magentic_one';
  return normalized;
}

export function buildInitialBusSeamViewport({
  busPosition,
  zoom,
  desiredBusCenterX,
  desiredBusTopY,
  busWidth = MAGENTIC_BUS_BODY_WIDTH,
}: {
  busPosition: { x: number; y: number };
  zoom: number;
  desiredBusCenterX: number;
  desiredBusTopY: number;
  busWidth?: number;
}): CanvasLandingViewport {
  return {
    x: desiredBusCenterX - (busPosition.x + busWidth / 2) * zoom,
    y: desiredBusTopY - busPosition.y * zoom,
    zoom,
  };
}

export function buildInitialWorkbenchLandingViewport(
  document: DeckDocument,
  landingBaselineZoom: number,
  options?: {
    desiredBusCenterX?: number;
    desiredBusTopY?: number;
    busWidth?: number;
  },
): CanvasLandingViewport | null {
  const busNode = document.nodes.find(
    (node) => normalizeViewportRuntimeType(node.runtimeType) === 'magentic_one',
  );
  const workbenchNode = document.nodes.find(
    (node) =>
      isLandingWorkbenchNode(node.id) ||
      isLandingWorkbenchNode(node.templateId),
  );

  if (!busNode || !workbenchNode || workbenchNode.position.x <= busNode.position.x) {
    return null;
  }

  return buildInitialBusSeamViewport({
    busPosition: busNode.position,
    zoom: landingBaselineZoom,
    desiredBusCenterX: options?.desiredBusCenterX ?? LANDING_BUS_CENTER_X,
    desiredBusTopY: options?.desiredBusTopY ?? LANDING_BUS_TOP_Y,
    busWidth: options?.busWidth ?? MAGENTIC_BUS_BODY_WIDTH,
  });
}

export function resolveInitialBusSeamCenterX(
  canvasElement: HTMLDivElement | null,
): number {
  const canvasRegion = canvasElement?.closest('[data-testid="workspace-canvas-region"]');
  if (!isSeamRectHost(canvasRegion)) {
    return LANDING_BUS_CENTER_X;
  }
  const seamHandle = canvasRegion.previousElementSibling;
  if (!isSeamRectHost(seamHandle)) {
    return LANDING_BUS_CENTER_X;
  }
  return (
    seamHandle.getBoundingClientRect().left -
    canvasRegion.getBoundingClientRect().left
  );
}

export function buildPresentationLandingViewport(
  document: DeckDocument,
  canvasElement: HTMLDivElement | null,
  landingBaselineZoom: number,
): CanvasLandingViewport | null {
  return buildInitialWorkbenchLandingViewport(document, landingBaselineZoom, {
    desiredBusCenterX: resolveInitialBusSeamCenterX(canvasElement),
  });
}
