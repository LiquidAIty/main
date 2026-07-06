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
