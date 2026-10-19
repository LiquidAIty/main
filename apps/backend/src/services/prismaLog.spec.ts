import { describe, expect, it } from 'vitest';
import { resolvePrismaLog } from './prismaLog';

describe('resolvePrismaLog — query logging is opt-in, errors always kept', () => {
  it('defaults to warn+error only (no routine query spam)', () => {
    expect(resolvePrismaLog({})).toEqual(['warn', 'error']);
    expect(resolvePrismaLog({ LIQUIDAITY_PRISMA_QUERY_LOGS: '' })).toEqual(['warn', 'error']);
    expect(resolvePrismaLog({ LIQUIDAITY_PRISMA_QUERY_LOGS: '0' })).toEqual(['warn', 'error']);
  });

  it('adds query only when the explicit flag is truthy — and keeps warn+error', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(resolvePrismaLog({ LIQUIDAITY_PRISMA_QUERY_LOGS: v })).toEqual(['query', 'warn', 'error']);
    }
  });

  it('never drops error/warn logging', () => {
    for (const env of [{}, { LIQUIDAITY_PRISMA_QUERY_LOGS: '1' }]) {
      const levels = resolvePrismaLog(env);
      expect(levels).toContain('warn');
      expect(levels).toContain('error');
    }
  });
});
