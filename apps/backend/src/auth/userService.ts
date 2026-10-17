/**
 * Entity: Authentication
 * Relationship: Creates and verifies users with bounded bcrypt work, upgrades weak hashes, hides credential fields, and preserves the single local-development owner identity.
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../services/database';

const SALT_ROUNDS = 10;
const ABSENT_USER_PASSWORD_HASH = '$2b$10$aQHG61.KkNsZA/pbj4jqoergQ1tb78Ogu4oVibCa9gLoPlHPHzDoy';

export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

export async function createUser(email: string, password: string, name?: string): Promise<User> {
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name: name || null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  return user;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  return user;
}

export async function ensureLocalDevelopmentUser(email: string): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail !== 'local-user@localhost') {
    throw new Error('local_development_user_email_invalid');
  }
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) return existing;
  const password = await bcrypt.hash(randomBytes(32).toString('hex'), SALT_ROUNDS);
  return prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {},
    create: {
      email: normalizedEmail,
      password,
      name: 'Local owner',
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });
}

export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  const isValid = await bcrypt.compare(
    password,
    user?.password || ABSENT_USER_PASSWORD_HASH,
  );

  if (!user || !isValid) {
    return null;
  }

  if (bcrypt.getRounds(user.password) < SALT_ROUNDS) {
    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(password, SALT_ROUNDS) },
    });
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}
