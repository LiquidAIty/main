import bcrypt from 'bcryptjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../services/database', () => ({ prisma: { user: db } }));

import {
  createUser,
  ensureLocalDevelopmentUser,
  verifyPassword,
} from './userService';

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('user credential authority', () => {
  it('hashes new passwords and never returns the hash', async () => {
    db.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'user-one',
      email: data.email,
      name: data.name,
      createdAt: new Date('2026-10-16T00:00:00Z'),
    }));

    const user = await createUser('owner@example.test', 'correct horse battery staple', 'Owner');

    const data = db.create.mock.calls[0]?.[0].data;
    expect(data.password).not.toBe('correct horse battery staple');
    await expect(bcrypt.compare('correct horse battery staple', data.password)).resolves.toBe(true);
    expect(user).not.toHaveProperty('password');
  });

  it('performs bcrypt work for an absent account and returns no user', async () => {
    db.findUnique.mockResolvedValue(null);
    const compare = vi.spyOn(bcrypt, 'compare');

    await expect(verifyPassword('absent@example.test', 'password')).resolves.toBeNull();

    expect(compare).toHaveBeenCalledTimes(1);
    expect(String(compare.mock.calls[0]?.[1])).toMatch(/^\$2b\$10\$/);
  });

  it('returns only a valid user and upgrades a weaker bcrypt hash', async () => {
    const weakHash = await bcrypt.hash('password', 4);
    db.findUnique.mockResolvedValue({
      id: 'user-one',
      email: 'owner@example.test',
      password: weakHash,
      name: 'Owner',
      createdAt: new Date('2026-10-16T00:00:00Z'),
    });
    db.update.mockResolvedValue({});

    const user = await verifyPassword('owner@example.test', 'password');

    expect(user).toEqual({
      id: 'user-one',
      email: 'owner@example.test',
      name: 'Owner',
      createdAt: new Date('2026-10-16T00:00:00Z'),
    });
    const upgraded = db.update.mock.calls[0]?.[0].data.password;
    expect(bcrypt.getRounds(upgraded)).toBe(10);
    await expect(bcrypt.compare('password', upgraded)).resolves.toBe(true);

    await expect(verifyPassword('owner@example.test', 'wrong')).resolves.toBeNull();
  });

  it('reuses the one local owner and rejects another bootstrap identity', async () => {
    const existing = {
      id: 'local-owner',
      email: 'local-user@localhost',
      name: 'Local owner',
      createdAt: new Date('2026-10-16T00:00:00Z'),
    };
    db.findUnique.mockResolvedValue(existing);

    await expect(ensureLocalDevelopmentUser('LOCAL-USER@LOCALHOST')).resolves.toBe(existing);
    expect(db.upsert).not.toHaveBeenCalled();
    await expect(ensureLocalDevelopmentUser('other@example.test')).rejects.toThrow(
      'local_development_user_email_invalid',
    );
  });
});
