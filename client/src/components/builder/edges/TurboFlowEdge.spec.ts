import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { buildTurboFlowEdgePath } from './TurboFlowEdge';

describe('TurboFlowEdge path geometry', () => {
  it('uses a curve rather than orthogonal segments for left-side targets', () => {
    expect(
      buildTurboFlowEdgePath({
        sourceX: 320,
        sourceY: 120,
        sourcePosition: Position.Right,
        targetX: 80,
        targetY: 120,
        targetPosition: Position.Left,
      }),
    ).toMatch(/^M[^L]+C[^L]+$/);
  });

  it('uses a curve rather than smooth-step segments for forward edges', () => {
    const path = buildTurboFlowEdgePath({
      sourceX: 80,
      sourceY: 120,
      sourcePosition: Position.Right,
      targetX: 320,
      targetY: 120,
      targetPosition: Position.Left,
    });

    expect(path).toMatch(/^M[^L]+C[^L]+$/);
  });
});
