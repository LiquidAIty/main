import { beforeEach, describe, expect, it, vi } from 'vitest';

const postgres = vi.hoisted(() => ({
  connectFailures: [] as Error[],
  queryFailures: [] as Error[],
  instances: [] as Array<{
    ended: boolean;
    query: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../config/env', () => ({}));
vi.mock('pg', () => ({
  Pool: class {
    ended = false;
    query = vi.fn(async () => {
      const failure = postgres.queryFailures.shift();
      if (failure) throw failure;
      return { rows: [{ ok: 1 }] };
    });
    connect = vi.fn(async () => {
      const failure = postgres.connectFailures.shift();
      if (failure) throw failure;
      return { release: vi.fn() };
    });
    end = vi.fn(async () => {
      this.ended = true;
    });
    on = vi.fn();

    constructor() {
      postgres.instances.push(this);
    }
  },
}));

import { pool } from './pool';

function transientFailure(): Error & { code: string } {
  return Object.assign(new Error('connection terminated unexpectedly'), { code: '08006' });
}

beforeEach(async () => {
  await pool.end();
  postgres.connectFailures.length = 0;
  postgres.queryFailures.length = 0;
  postgres.instances.length = 0;
});

describe('PostgreSQL pool ownership', () => {
  it('never replays an ambiguous failed statement and refreshes only the next call', async () => {
    postgres.queryFailures.push(transientFailure());

    await expect(pool.query('INSERT INTO example(value) VALUES ($1)', ['one']))
      .rejects.toThrow('connection terminated unexpectedly');
    expect(postgres.instances).toHaveLength(1);
    expect(postgres.instances[0].query).toHaveBeenCalledTimes(1);
    expect(postgres.instances[0].end).toHaveBeenCalledOnce();

    await expect(pool.query('SELECT 1')).resolves.toEqual({ rows: [{ ok: 1 }] });
    expect(postgres.instances).toHaveLength(2);
    expect(postgres.instances[1].query).toHaveBeenCalledOnce();
  });

  it('may retry connection acquisition because no statement has been submitted', async () => {
    postgres.connectFailures.push(transientFailure());

    await expect(pool.connect()).resolves.toEqual({ release: expect.any(Function) });
    expect(postgres.instances).toHaveLength(2);
    expect(postgres.instances[0].connect).toHaveBeenCalledOnce();
    expect(postgres.instances[0].end).toHaveBeenCalledOnce();
    expect(postgres.instances[1].connect).toHaveBeenCalledOnce();
  });
});
