/**
 * Entity: Saved Cards
 * Relationship: This file verifies valid typed Python attachments survive saved Card readback while malformed or duplicate records are excluded from presentation.
 * Entity: Agent Builder
 * Relationship: This file verifies Agent Builder receives only validated subsystem attachment records for the selected Card.
 */

import { describe, expect, it } from 'vitest';

import { readCardSubsystemAttachments } from './cardSubsystems';

describe('Card subsystem attachments', () => {
  it('accepts a typed Python attachment and ignores malformed duplicates', () => {
    const valid = {
      id: 'lumibot',
      label: 'LumiBot',
      adapter: {
        kind: 'python' as const,
        contractVersion: 'card-subsystem.v1' as const,
        capabilities: ['state', 'events', 'readiness'] as const,
      },
      cardTab: { enabled: true },
      configurationSchema: 'trading.card.v1',
    };
    const result = readCardSubsystemAttachments({
      subsystems: [valid, { ...valid }, { ...valid, id: 'bad id' }] as any,
    });
    expect(result).toEqual([{ ...valid, adapter: {
      ...valid.adapter,
      capabilities: ['state', 'events', 'readiness'],
    } }]);
  });
});
