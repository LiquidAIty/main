/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Authentication
 * Relationship: This file provides the one shared Prisma client used by user and session persistence while reusing its connection during development reloads.
 */

import '../config/env';
import { PrismaClient } from '@prisma/client';
import { resolvePrismaLog } from './prismaLog';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Warnings + errors always; routine SQL query logging only when
    // LIQUIDAITY_PRISMA_QUERY_LOGS is set (keeps the dev terminal legible).
    log: resolvePrismaLog(process.env),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
