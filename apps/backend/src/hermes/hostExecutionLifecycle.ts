import {
  createHermesChildExecutionContext,
  executionToolCallMeta,
  finishHermesExecutionContext,
  type HermesExecutionContext,
} from './childExecutionContext';
import { startHermesTeamRunMonitor } from './kanbanRunRecovery';

export type HermesTeamResultDelivery = {
  sessionId: string;
  taskId: string;
  result: string;
  state: 'completed' | 'blocked' | 'failed' | 'cancelled';
};

export type HermesHostExecutionMethod =
  | 'session/create_execution_context'
  | 'session/finish_execution_context';

export async function handleHermesHostExecutionRequest(args: {
  method: HermesHostExecutionMethod;
  params: Record<string, unknown>;
}): Promise<{
  result: Record<string, unknown>;
  nativeContext?: HermesExecutionContext;
}> {
  if (args.method === 'session/create_execution_context') {
    const context = await createHermesChildExecutionContext({
      sessionId: String(args.params.sessionId || ''),
      parentExecutionContextId: String(args.params.parentExecutionContextId || ''),
      nativeChildId: String(args.params.nativeChildId || ''),
      provider: String(args.params.provider || ''),
      model: String(args.params.model || ''),
    });
    return {
      result: {
        executionContextId: context.contextId,
        runId: context.runId,
        toolCallMeta: executionToolCallMeta(context.contextId),
      },
      nativeContext: context,
    };
  }

  const closed = await finishHermesExecutionContext({
    contextId: String(args.params.executionContextId || ''),
    state: ['completed', 'failed', 'cancelled'].includes(String(args.params.state || ''))
      ? args.params.state as 'completed' | 'failed' | 'cancelled'
      : 'failed',
    errorSummary: String(args.params.errorSummary || '') || undefined,
    usage: args.params.usage && typeof args.params.usage === 'object'
      ? args.params.usage as any
      : undefined,
    configuration: args.params.configuration && typeof args.params.configuration === 'object'
      ? args.params.configuration as any
      : undefined,
  });
  return { result: { closed } };
}

export function startHermesHostTeamMonitor(args: {
  context: HermesExecutionContext;
  appendTeamResult: (result: HermesTeamResultDelivery) => Promise<void>;
  appendRetryAttempts?: number;
}): boolean {
  return startHermesTeamRunMonitor(args.context, args.appendTeamResult, {
    ...(args.appendRetryAttempts
      ? { appendRetryAttempts: args.appendRetryAttempts }
      : {}),
  });
}

export function isHermesHostExecutionMethod(value: unknown): value is HermesHostExecutionMethod {
  return value === 'session/create_execution_context'
    || value === 'session/finish_execution_context';
}
