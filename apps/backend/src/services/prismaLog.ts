/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Application Observability
 * Relationship: This file keeps Prisma warnings and errors visible while making routine query logging an explicit environment-controlled diagnostic choice.
 */

export type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

/**
 * Prisma dev log levels. Meaningful signal (warnings + errors) is ALWAYS kept so
 * startup/runtime/auth/gRPC failures stay visible. Routine SQL `query` logging is
 * opt-in via LIQUIDAITY_PRISMA_QUERY_LOGS so it never buries agent/tool traces in
 * the dev terminal. Never removes error logs; never prints secrets.
 */
export function resolvePrismaLog(env: NodeJS.ProcessEnv): PrismaLogLevel[] {
  const base: PrismaLogLevel[] = ['warn', 'error'];
  const flag = String(env.LIQUIDAITY_PRISMA_QUERY_LOGS || '').trim().toLowerCase();
  const enabled = flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on';
  return enabled ? ['query', ...base] : base;
}
