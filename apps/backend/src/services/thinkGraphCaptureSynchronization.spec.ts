/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: ThinkGraph
 * Relationship: This file verifies completed-Main captures serialize per Project and exact projection reads await either the active or retained matching outcome once.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  registerActiveThinkGraphCapture,
  waitForActiveThinkGraphCapture,
  withThinkGraphCaptureLock,
} from './thinkGraphCaptureSynchronization';

describe('completed Main ThinkGraph capture synchronization', () => {
  it('holds one projection refresh until the exact active Run capture settles', async () => {
    let release!: () => void;
    const capture = new Promise<void>((resolve) => { release = resolve; });
    registerActiveThinkGraphCapture('project-one', 'run-one', capture);

    let refreshed = false;
    const waiting = waitForActiveThinkGraphCapture('project-one', 'run-one')
      .then(() => { refreshed = true; });
    await Promise.resolve();
    expect(refreshed).toBe(false);

    release();
    await waiting;
    expect(refreshed).toBe(true);
  });

  it('retains an exact capture failure until the matching projection refresh consumes it', async () => {
    let rejectCapture!: (error: Error) => void;
    const capture = new Promise<void>((_resolve, reject) => { rejectCapture = reject; });
    registerActiveThinkGraphCapture('project-failure', 'run-failure', capture);
    rejectCapture(new Error('thinkgraph_saved_card_not_authorized'));
    await Promise.resolve();
    await Promise.resolve();

    await expect(waitForActiveThinkGraphCapture('project-failure', 'run-failure'))
      .rejects.toThrow('thinkgraph_saved_card_not_authorized');
    await expect(waitForActiveThinkGraphCapture('project-failure', 'run-failure'))
      .resolves.toBeUndefined();
  });

  it('runs repeated captures one at a time for the same Project and deck', async () => {
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const order: string[] = [];
    const first = withThinkGraphCaptureLock('project-one', 'deck-one', async () => {
      order.push('first:start');
      await firstMayFinish;
      order.push('first:end');
    });
    const second = withThinkGraphCaptureLock('project-one', 'deck-one', async () => {
      order.push('second:start');
      order.push('second:end');
    });

    await vi.waitFor(() => expect(order).toEqual(['first:start']));
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });
});
