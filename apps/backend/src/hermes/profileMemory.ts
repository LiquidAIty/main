import path from 'node:path';

export function resolveHermesRuntimeHome(hermesRoot: string): string {
  return path.join(hermesRoot, '.hermes');
}
