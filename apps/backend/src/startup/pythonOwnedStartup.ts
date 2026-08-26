import { recoverActiveKanbanRunMonitors } from '../hermes/kanbanRunRecovery';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import { logModelConfiguration } from './modelConfig';

type PythonOwnedStartupDependencies = {
  request?: (endpointPath: string, init: RequestInit) => Promise<unknown>;
  delay?: (milliseconds: number) => Promise<void>;
  logModels?: () => Promise<unknown>;
  recoverKanban?: () => Promise<{ discovered: number; started: number }>;
  isActive?: () => boolean;
  maxAttempts?: number;
  pollIntervalMs?: number;
};

const DEFAULT_MAX_ATTEMPTS = 120;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const STARTUP_PROBE_TIMEOUT_MS = 2_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'python_rails_unavailable');
}

/**
 * Wait for the one supervised Python rails process, then perform each
 * Python-owned backend startup read exactly once for this backend listener.
 */
export async function runPythonOwnedStartupTasks(
  dependencies: PythonOwnedStartupDependencies = {},
): Promise<{ discovered: number; started: number }> {
  const request = dependencies.request ?? ((endpointPath, init) => (
    requestPythonRailsJson(endpointPath, init, { timeoutMs: STARTUP_PROBE_TIMEOUT_MS })
  ));
  const wait = dependencies.delay ?? delay;
  const logModels = dependencies.logModels ?? logModelConfiguration;
  const recoverKanban = dependencies.recoverKanban ?? recoverActiveKanbanRunMonitors;
  const isActive = dependencies.isActive ?? (() => true);
  const maxAttempts = Math.max(1, Math.trunc(dependencies.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const pollIntervalMs = Math.max(0, Math.trunc(
    dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  ));
  let lastFailure = 'python_rails_unavailable';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!isActive()) throw new Error('python_owned_startup_cancelled');
    try {
      const response = await request('/health', { method: 'GET' }) as { status?: unknown };
      if (String(response?.status || '').trim() === 'ok') {
        if (!isActive()) throw new Error('python_owned_startup_cancelled');
        await logModels();
        if (!isActive()) throw new Error('python_owned_startup_cancelled');
        return recoverKanban();
      }
      lastFailure = `python_rails_health_invalid:${String(response?.status || 'missing')}`;
    } catch (error) {
      const message = errorMessage(error);
      if (message === 'python_owned_startup_cancelled') throw error;
      lastFailure = message;
    }
    if (attempt < maxAttempts) await wait(pollIntervalMs);
  }

  throw new Error(`python_owned_startup_timeout:${lastFailure}`);
}
