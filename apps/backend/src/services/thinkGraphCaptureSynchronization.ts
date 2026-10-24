/**
 * Entity: ThinkGraph
 * Relationship: This file serializes automatic completed-Main capture per Project and lets the exact matching projection read await and consume the capture outcome once.
 */

const captureTails = new Map<string, Promise<void>>();
const activeCaptures = new Map<string, Promise<void>>();
const settledCaptureByProject = new Map<string, {
  runId: string;
  completion: Promise<void>;
}>();

function captureScopeKey(projectId: string, deckId: string): string {
  return JSON.stringify([projectId, deckId]);
}

function captureRunKey(projectId: string, runId: string): string {
  return JSON.stringify([projectId, runId]);
}

export async function withThinkGraphCaptureLock<T>(
  projectId: string,
  deckId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = captureScopeKey(projectId, deckId);
  const previous = captureTails.get(key) || Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => completion);
  captureTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (captureTails.get(key) === tail) captureTails.delete(key);
  }
}

export function registerActiveThinkGraphCapture(
  projectId: string,
  runId: string,
  capture: Promise<unknown>,
): void {
  const key = captureRunKey(projectId, runId);
  const completion = capture.then(() => undefined);
  activeCaptures.set(key, completion);
  const retainSettled = () => {
    if (activeCaptures.get(key) === completion) activeCaptures.delete(key);
    settledCaptureByProject.set(projectId, { runId, completion });
  };
  void completion.then(
    retainSettled,
    retainSettled,
  );
}

export async function waitForActiveThinkGraphCapture(
  projectId: string,
  runId: string,
): Promise<void> {
  const active = activeCaptures.get(captureRunKey(projectId, runId));
  const settled = settledCaptureByProject.get(projectId);
  const capture = active || (settled?.runId === runId ? settled.completion : null);
  if (!capture) return;
  try {
    await capture;
  } finally {
    const retained = settledCaptureByProject.get(projectId);
    if (retained?.runId === runId && retained.completion === capture) {
      settledCaptureByProject.delete(projectId);
    }
  }
}
