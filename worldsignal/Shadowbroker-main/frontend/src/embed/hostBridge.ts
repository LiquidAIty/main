/**
 * In-process bridge between the WorldSignals app and an embedding host.
 *
 * When the app is mounted directly by a host React application
 * (see mountWorldSignals.tsx) there is no frame boundary, so host commands and
 * app events are plain function calls rather than postMessage traffic.
 *
 * Standalone (Next.js) mode never registers a host, so every emit here is a
 * no-op and the app behaves exactly as it does today.
 */

export type WorldSignalsSelectionRef = {
  id: string;
  type: string;
  label: string | null;
};

export type WorldSignalsFlyToInput = {
  lat: number;
  lng: number;
  zoom?: number;
};

type HostListeners = {
  onSelectionChange?: (selection: WorldSignalsSelectionRef | null) => void;
  onReady?: () => void;
};

type AppCommands = {
  flyTo?: (input: WorldSignalsFlyToInput) => void;
};

const listeners: HostListeners = {};
const commands: AppCommands = {};

/** Host side: called by mountWorldSignals before the app renders. */
export function registerHostListeners(next: HostListeners): () => void {
  Object.assign(listeners, next);
  return () => {
    listeners.onSelectionChange = undefined;
    listeners.onReady = undefined;
  };
}

/** App side: the running app publishes the commands it can actually service. */
export function registerAppCommand<K extends keyof AppCommands>(
  name: K,
  handler: NonNullable<AppCommands[K]>,
): () => void {
  commands[name] = handler;
  return () => {
    delete commands[name];
  };
}

/** Host side: invoked by the mount handle. Loud when the app is not mounted. */
export function invokeAppCommand<K extends keyof AppCommands>(
  name: K,
  ...args: Parameters<NonNullable<AppCommands[K]>>
): void {
  const handler = commands[name];
  if (!handler) {
    throw new Error(`worldsignals_command_unavailable: ${String(name)} (app not mounted)`);
  }
  (handler as (...a: unknown[]) => void)(...args);
}

/** App side. */
export function emitSelectionChange(selection: WorldSignalsSelectionRef | null): void {
  listeners.onSelectionChange?.(selection);
}

/** App side. */
export function emitReady(): void {
  listeners.onReady?.();
}
