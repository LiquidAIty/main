import { describe, expect, it, vi } from 'vitest';

import {
  deriveAutomaticHermesCardIds,
  reconcileConnectedAgentTerminals,
  requestConnectedAgentTerminalReconcile,
  runPythonOwnedStartupTasks,
} from './pythonOwnedStartup';

describe('Python-owned backend startup', () => {
  it('waits for Python rails and then performs model reporting and Kanban recovery once', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('connect refused'))
      .mockResolvedValueOnce({ status: 'starting' })
      .mockResolvedValueOnce({ status: 'ok' });
    const delay = vi.fn(async () => undefined);
    const logModels = vi.fn(async () => undefined);
    const recoverKanban = vi.fn(async () => ({ discovered: 2, started: 1 }));
    const startCardRuntimes = vi.fn(async () => undefined);

    await expect(runPythonOwnedStartupTasks({
      request,
      delay,
      logModels,
      recoverKanban,
      startCardRuntimes,
      maxAttempts: 3,
      pollIntervalMs: 0,
    })).resolves.toEqual({ discovered: 2, started: 1 });

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(3, '/health', { method: 'GET' });
    expect(delay).toHaveBeenCalledTimes(2);
    expect(logModels).toHaveBeenCalledOnce();
    expect(startCardRuntimes).toHaveBeenCalledOnce();
    expect(recoverKanban).toHaveBeenCalledOnce();
    expect(recoverKanban).toHaveBeenCalledWith();
  });

  it('fails visibly without running dependent reads when Python rails never becomes ready', async () => {
    const logModels = vi.fn(async () => undefined);
    const recoverKanban = vi.fn(async () => ({ discovered: 0, started: 0 }));

    await expect(runPythonOwnedStartupTasks({
      request: vi.fn(async () => ({ status: 'starting' })),
      delay: vi.fn(async () => undefined),
      logModels,
      recoverKanban,
      startCardRuntimes: vi.fn(async () => undefined),
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

  it('does not replay post-readiness work when model reporting fails', async () => {
    const request = vi.fn(async () => ({ status: 'ok' }));
    const logModels = vi.fn(async () => { throw new Error('deck_transport_failed'); });
    const recoverKanban = vi.fn(async () => ({ discovered: 0, started: 0 }));

    await expect(runPythonOwnedStartupTasks({
      request,
      delay: vi.fn(async () => undefined),
      logModels,
      recoverKanban,
      startCardRuntimes: vi.fn(async () => undefined),
      maxAttempts: 3,
      pollIntervalMs: 0,
    })).rejects.toThrow('deck_transport_failed');

    expect(request).toHaveBeenCalledOnce();
    expect(logModels).toHaveBeenCalledOnce();
    expect(recoverKanban).not.toHaveBeenCalled();
  });

  it('does not replay model reporting or recovery when recovery fails after readiness', async () => {
    const request = vi.fn(async () => ({ status: 'ok' }));
    const logModels = vi.fn(async () => undefined);
    const recoverKanban = vi.fn(async () => { throw new Error('kanban_recovery_failed'); });

    await expect(runPythonOwnedStartupTasks({
      request,
      delay: vi.fn(async () => undefined),
      logModels,
      recoverKanban,
      startCardRuntimes: vi.fn(async () => undefined),
      maxAttempts: 3,
      pollIntervalMs: 0,
    })).rejects.toThrow('kanban_recovery_failed');

    expect(request).toHaveBeenCalledOnce();
    expect(logModels).toHaveBeenCalledOnce();
    expect(recoverKanban).toHaveBeenCalledOnce();
  });

  it('derives automatic Hermes demand from symmetric Bot connections and Mag One wire authority', () => {
    const main = { id: 'main-card', templateId: 'template_main_chat', title: 'Main',
      kind: 'agent', runtime: { kind: 'hermes', mode: 'main', profile: 'main-profile' },
      runtimeOptions: {}, position: { x: 0, y: 0 } };
    const controller = { id: 'controller', templateId: 'template_worker', title: 'Controller',
      kind: 'agent', runtime: { kind: 'hermes', mode: 'delegate', profile: 'controller-profile' },
      runtimeOptions: {}, position: { x: 1, y: 1 } };
    const connected = { id: 'worker', templateId: 'template_worker', title: 'Worker', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'worker-profile' }, position: { x: 2, y: 2 } };
    const builder = { id: 'builder', templateId: 'template_assist', title: 'Builder',
      kind: 'agent', runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder-profile' },
      position: { x: 3, y: 3 } };
    const magWorkerA = { id: 'mag-worker-a', templateId: 'template_worker', title: 'Mag worker A', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'mag-worker-a-profile' }, position: { x: 4, y: 4 } };
    const magWorkerB = { id: 'mag-worker-b', templateId: 'template_worker', title: 'Mag worker B', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'mag-worker-b-profile' }, position: { x: 5, y: 5 } };
    const disconnected = { id: 'idle', templateId: 'template_worker', title: 'Idle', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'idle-profile' }, position: { x: 6, y: 6 } };
    const disabled = { id: 'disabled', templateId: 'template_worker', title: 'Disabled', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'disabled-profile' },
      runtimeOptions: { enabled: false }, position: { x: 7, y: 7 } };
    const magOne = { id: 'mag-one', templateId: 'template_magentic', title: 'Mag One', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'mag-one' }, position: { x: 8, y: 8 } };
    const visual = { id: 'chart', templateId: 'template_chart', title: 'Chart',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'chart' }, position: { x: 9, y: 9 } };
    const deck = { id: 'deck', name: 'Deck', version: 1, promptTemplates: [],
      nodes: [main, controller, connected, builder, magWorkerA, magWorkerB,
        disconnected, disabled, magOne, visual],
      edges: [
        { id: 'active-worker', source: 'controller', target: 'worker', edgeType: 'flow', enabled: true },
        { id: 'active-builder', source: 'main-card', target: 'builder', edgeType: 'flow' },
        { id: 'worker-before-bus', source: 'mag-worker-a', target: 'mag-one',
          targetHandle: 'bus-in-1', edgeType: 'magentic_option' },
        { id: 'bus-before-worker', source: 'mag-one', sourceHandle: 'bus-in-2',
          target: 'mag-worker-b', edgeType: 'magentic_option' },
        { id: 'main-control', source: 'mag-one', sourceHandle: 'task-bus-top',
          target: 'main-card', edgeType: 'magentic_control' },
        { id: 'disabled-target', source: 'controller', target: 'disabled', edgeType: 'flow' },
        { id: 'disabled-edge', source: 'controller', target: 'idle', edgeType: 'flow', enabled: false },
        { id: 'unrelated-visual', source: 'chart', target: 'idle', edgeType: 'invalid' },
        { id: 'missing-reference', source: 'controller', target: 'missing', edgeType: 'flow' },
        { id: 'not-a-bus', source: 'worker', target: 'idle', edgeType: 'magentic_option' },
      ] } as any;

    const botProfiles = [
      { cardId: 'main-card', cardRevisionId: '', profile: 'main-profile', title: 'Main',
        botEnabled: true, roster: ['builder-profile'] },
      { cardId: 'controller', cardRevisionId: '', profile: 'controller-profile', title: 'Controller',
        botEnabled: true, roster: ['worker-profile'] },
      { cardId: 'worker', cardRevisionId: '', profile: 'worker-profile', title: 'Worker',
        botEnabled: true, roster: ['controller-profile'] },
      { cardId: 'builder', cardRevisionId: '', profile: 'builder-profile', title: 'Builder',
        botEnabled: true, roster: ['main-profile'] },
      { cardId: 'mag-worker-a', cardRevisionId: '', profile: 'mag-worker-a-profile', title: 'Mag worker A',
        botEnabled: true, roster: [] },
      { cardId: 'mag-worker-b', cardRevisionId: '', profile: 'mag-worker-b-profile', title: 'Mag worker B',
        botEnabled: true, roster: [] },
      { cardId: 'idle', cardRevisionId: '', profile: 'idle-profile', title: 'Idle',
        botEnabled: true, roster: [] },
      { cardId: 'disabled', cardRevisionId: '', profile: 'disabled-profile', title: 'Disabled',
        botEnabled: false, roster: [] },
    ];
    expect([...deriveAutomaticHermesCardIds(deck, botProfiles)]).toEqual([
      'main-card', 'controller', 'worker', 'builder', 'mag-one', 'mag-worker-a', 'mag-worker-b',
    ]);
    const disabledBusDeck = {
      ...deck,
      nodes: deck.nodes.map((node: any) => (
        node.id === 'mag-one' ? { ...node, runtimeOptions: { enabled: false } } : node
      )),
    } as any;
    const disabledBusDemand = deriveAutomaticHermesCardIds(disabledBusDeck, botProfiles);
    expect(disabledBusDemand.has('mag-one')).toBe(false);
    expect(disabledBusDemand.has('mag-worker-a')).toBe(false);
    expect(disabledBusDemand.has('mag-worker-b')).toBe(false);
  });

  it('keeps a Card demanded until its final activating edge is removed', () => {
    const controllerA = { id: 'controller-a', templateId: 'controller', title: 'A', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'controller-a' },
      runtimeOptions: {}, position: { x: 0, y: 0 } };
    const controllerB = { ...controllerA, id: 'controller-b', title: 'B',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'controller-b' } };
    const target = { id: 'target', templateId: 'worker', title: 'Target', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'target' }, position: { x: 1, y: 1 } };
    const base = { id: 'deck', name: 'Deck', version: 1, promptTemplates: [],
      nodes: [controllerA, controllerB, target] } as any;
    const first = { id: 'one', source: 'controller-a', target: 'target', edgeType: 'flow' };
    const second = { id: 'two', source: 'controller-b', target: 'target', edgeType: 'flow' };

    const projection = (roster: string[]) => [{
      cardId: 'target', cardRevisionId: '', profile: 'target', title: 'Target', botEnabled: true, roster,
    }];
    expect(deriveAutomaticHermesCardIds({ ...base, edges: [first, second] }, projection(['controller-a', 'controller-b'])).has('target')).toBe(true);
    expect(deriveAutomaticHermesCardIds({ ...base, edges: [second] }, projection(['controller-b'])).has('target')).toBe(true);
    expect(deriveAutomaticHermesCardIds({ ...base, edges: [] }, projection([])).has('target')).toBe(false);
  });

  it('passes exact Card identities and structural presentation workspaces to the existing manager', async () => {
    const main = { id: 'main-card', templateId: 'template_main_chat', title: 'Main', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main-profile' },
      runtimeOptions: {}, position: { x: 0, y: 0 } };
    const connected = { id: 'worker', templateId: 'template_worker', title: 'Worker', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'worker-profile' }, position: { x: 1, y: 1 } };
    const builder = { id: 'builder', templateId: 'template_assist', title: 'Builder',
      kind: 'agent', runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder-profile' },
      position: { x: 2, y: 2 } };
    const disconnected = { id: 'idle', templateId: 'template_worker', title: 'Idle', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'idle-profile' }, position: { x: 3, y: 3 } };
    const magOne = { id: 'mag-one', templateId: 'template_magentic', title: 'Mag One', kind: 'agent',
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'mag-one-profile' },
      position: { x: 4, y: 4 } };
    const deck = { id: 'deck', name: 'Deck', version: 1, promptTemplates: [],
      nodes: [main, connected, builder, disconnected, magOne], edges: [
        { id: 'active-worker', source: 'main-card', target: 'worker', edgeType: 'flow' },
        { id: 'active-builder', source: 'main-card', target: 'builder', edgeType: 'flow' },
        { id: 'mag-worker', source: 'mag-one', target: 'worker', edgeType: 'magentic_option' },
      ] } as any;
    const reconcile = vi.fn(async (desired: any[], _dimensions?: unknown, _botProfiles?: unknown[]) => desired.map((entry, index) => ({
      sessionId: `session-${index}`, cardId: entry.card.id, profile: entry.card.runtime.profile,
      pid: 1, gatewayPid: 1, tuiPid: null, ptyId: null, nativeSessionId: `native-${index}`,
      storedSessionId: `native-${index}`, hermesHome: '', unavailableToolReasons: {},
      status: 'running', cols: 120, rows: 36,
    })));

    const states = await reconcileConnectedAgentTerminals({
      listProjects: async () => [{ id: 'project', name: 'Project', code: null,
        status: 'active', project_type: 'agent', ownerUserId: 'owner' }],
      loadProject: async () => ({ decks: { deck }, meta: { decks: {} } }),
      resolveBotProfiles: async () => [
        { cardId: 'main-card', cardRevisionId: '', profile: 'main-profile', title: 'Main',
          botEnabled: true, roster: ['worker-profile', 'builder-profile'] },
        { cardId: 'worker', cardRevisionId: '', profile: 'worker-profile', title: 'Worker',
          botEnabled: true, roster: ['main-profile'] },
        { cardId: 'builder', cardRevisionId: '', profile: 'builder-profile', title: 'Builder',
          botEnabled: true, roster: ['main-profile'] },
        { cardId: 'idle', cardRevisionId: '', profile: 'idle-profile', title: 'Idle',
          botEnabled: true, roster: [] },
      ],
      reconcile: reconcile as any,
      mainWorkingDirectory: () => 'C:\\neutral-main',
      builderWorkingDirectory: () => 'C:\\repository',
    });

    expect(states.map((state) => state.cardId)).toEqual([
      'main-card', 'worker', 'builder', 'mag-one',
    ]);
    const desired = reconcile.mock.calls[0][0];
    expect(desired.map((entry: any) => entry.owner)).toEqual([
      { userId: 'owner', projectId: 'project', deckId: 'deck', cardId: 'main-card' },
      { userId: 'owner', projectId: 'project', deckId: 'deck', cardId: 'worker' },
      { userId: 'owner', projectId: 'project', deckId: 'deck', cardId: 'builder' },
      { userId: 'owner', projectId: 'project', deckId: 'deck', cardId: 'mag-one' },
    ]);
    expect(desired[0]).toMatchObject({ workingDirectory: 'C:\\neutral-main', attachTui: false });
    expect(desired[1]).toMatchObject({ attachTui: true });
    expect(desired[1]).not.toHaveProperty('workingDirectory');
    expect(desired[2]).toMatchObject({ workingDirectory: 'C:\\repository', attachTui: true });
    expect(desired[3]).toMatchObject({ attachTui: false });
    expect(desired[3]).not.toHaveProperty('workingDirectory');
    expect(reconcile.mock.calls[0][2]).toHaveLength(4);
  });

  it('serializes startup and saved-topology reconciliation through the existing manager', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const reconcile = vi.fn(async () => {
      if (reconcile.mock.calls.length === 1) await firstGate;
      return [];
    });
    const dependencies = {
      listProjects: async () => [],
      loadProject: vi.fn(),
      reconcile: reconcile as any,
    };

    const first = requestConnectedAgentTerminalReconcile(dependencies);
    const second = requestConnectedAgentTerminalReconcile(dependencies);
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([first, second]);

    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
