import { describe, expect, it, vi } from 'vitest';

import { runPythonOwnedStartupTasks } from './pythonOwnedStartup';

describe('Python-owned backend startup', () => {
  it('waits for Python rails and then performs model reporting and Kanban recovery once', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('connect refused'))
      .mockResolvedValueOnce({ status: 'starting' })
      .mockResolvedValueOnce({ status: 'ok' });
    const delay = vi.fn(async () => undefined);
    const logModels = vi.fn(async () => undefined);
    const recoverKanban = vi.fn(async () => ({ discovered: 2, started: 1 }));

    await expect(runPythonOwnedStartupTasks({
      request,
      delay,
      logModels,
      recoverKanban,
      maxAttempts: 3,
      pollIntervalMs: 0,
    })).resolves.toEqual({ discovered: 2, started: 1 });

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(3, '/health', { method: 'GET' });
    expect(delay).toHaveBeenCalledTimes(2);
    expect(logModels).toHaveBeenCalledOnce();
    expect(recoverKanban).toHaveBeenCalledOnce();
  });

  it('fails visibly without running dependent reads when Python rails never becomes ready', async () => {
    const logModels = vi.fn(async () => undefined);
    const recoverKanban = vi.fn(async () => ({ discovered: 0, started: 0 }));

    await expect(runPythonOwnedStartupTasks({
      request: vi.fn(async () => ({ status: 'starting' })),
      delay: vi.fn(async () => undefined),
      logModels,
      recoverKanban,
      maxAttempts: 2,
      pollIntervalMs: 0,
    })).rejects.toThrow('python_owned_startup_timeout:python_rails_health_invalid:starting');

    expect(logModels).not.toHaveBeenCalled();
    expect(recoverKanban).not.toHaveBeenCalled();
  });

  it('does not run stale startup work after its backend listener is replaced', async () => {
    await expect(runPythonOwnedStartupTasks({
      request: vi.fn(async () => ({ status: 'ok' })),
      isActive: () => false,
      maxAttempts: 1,
    })).rejects.toThrow('python_owned_startup_cancelled');
  });
});
