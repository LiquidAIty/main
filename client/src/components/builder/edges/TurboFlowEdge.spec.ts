import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { buildTurboFlowEdgePath } from './TurboFlowEdge';

describe('TurboFlowEdge path geometry', () => {
  it('routes magentic edges to left-side targets without a forward sweep', () => {
    expect(
      buildTurboFlowEdgePath({
        sourceX: 320,
        sourceY: 120,
        sourcePosition: Position.Right,
        targetX: 80,
        targetY: 120,
        targetPosition: Position.Left,
        borderRadius: 14,
        offset: 24,
        edgeType: 'magentic_option',
      }),
    ).toBe('M 320,120 L 80,120');
  });

  it('keeps normal forward flow edges on the existing smooth-step path', () => {
    const path = buildTurboFlowEdgePath({
      sourceX: 80,
      sourceY: 120,
      sourcePosition: Position.Right,
      targetX: 320,
      targetY: 120,
      targetPosition: Position.Left,
      borderRadius: 14,
      offset: 24,
      edgeType: 'flow',
    });

    expect(path).toBe('M80 120L104 120L200 120L200 120L296 120L320 120');
  });
});
