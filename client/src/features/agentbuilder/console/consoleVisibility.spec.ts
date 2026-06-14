import { describe, expect, it } from 'vitest';
import {
  isLocalCoderBusConnected,
  shouldShowOpenClaudeConsoleRail,
} from './consoleVisibility';

const sol = { id: 'mag', runtimeType: 'magentic_one' };
const localCoder = { id: 'card_local_coder', runtimeType: 'local_coder', title: 'Local Coder' };

describe('console rail visibility', () => {
  it('is connected when Local Coder has a magentic_option edge to Sol', () => {
    const connected = isLocalCoderBusConnected(
      [sol, localCoder],
      [{ id: 'e1', source: 'mag', target: 'card_local_coder', edgeType: 'magentic_option' }],
    );
    expect(connected).toBe(true);
  });

  it('is disconnected when Local Coder has no bus path', () => {
    expect(isLocalCoderBusConnected([sol, localCoder], [])).toBe(false);
  });

  it('shows the rail icon when Local Coder is bus-connected', () => {
    expect(
      shouldShowOpenClaudeConsoleRail({
        cards: [sol, localCoder],
        edges: [{ id: 'e1', source: 'mag', target: 'card_local_coder', edgeType: 'magentic_option' }],
      }),
    ).toBe(true);
  });

  it('shows the rail icon when a console session already exists even if disconnected', () => {
    expect(
      shouldShowOpenClaudeConsoleRail({ cards: [sol, localCoder], edges: [], hasSession: true }),
    ).toBe(true);
  });

  it('hides the rail icon with no Local Coder and no session', () => {
    expect(shouldShowOpenClaudeConsoleRail({ cards: [sol], edges: [] })).toBe(false);
  });
});
