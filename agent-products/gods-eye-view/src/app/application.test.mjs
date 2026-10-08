import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplication } from './application.js';

const phases = ['Scene', 'Controls', 'Data', 'Tools'];

function fixture(overrides = {}) {
  const events = [];
  const constructors = Object.fromEntries(phases.map((phase) => [
    `create${phase}`,
    ({ defer }) => {
      events.push(`start:${phase}`);
      defer(() => events.push(`stop:${phase}`));
      return { name: phase };
    },
  ]));
  return { events, app: createApplication({ ...constructors, ...overrides }) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('constructors are validated before allocating resources', () => {
  assert.throws(() => createApplication({}), /Missing scene constructor/);
});

test('startup is shared and teardown follows tools-controls-data-scene order', async () => {
  const { app, events } = fixture();
  const first = app.start();
  assert.equal(first, app.start());
  await first;
  assert.equal(app.getState().status, 'ready');
  const stopping = app.destroy();
  assert.equal(stopping, app.destroy());
  await stopping;
  assert.deepEqual(events.slice(-4), [
    'stop:Tools', 'stop:Controls', 'stop:Data', 'stop:Scene',
  ]);
  assert.deepEqual(app.getComponents(), {});
  assert.equal(app.getState().status, 'destroyed');
});

for (const phase of phases) {
  test(`failure during ${phase} releases the partial acquisition`, async () => {
    const { app, events } = fixture({
      [`create${phase}`]({ defer }) {
        defer(() => events.push('partial:released'));
        throw new Error('broken constructor');
      },
    });
    await assert.rejects(app.start(), /broken constructor/);
    assert.equal(events.filter((event) => event === 'partial:released').length, 1);
    assert.deepEqual(app.getComponents(), {});
    await app.destroy();
    assert.equal(events.filter((event) => event === 'partial:released').length, 1);
  });
}

test('destroy aborts an in-flight constructor and waits for its late cleanup', async () => {
  const gate = deferred();
  const entered = deferred();
  const { app, events } = fixture({
    async createScene({ signal, defer }) {
      entered.resolve(signal);
      await gate.promise;
      defer(() => events.push('late:released'));
      return {};
    },
  });
  const started = app.start();
  const failed = assert.rejects(started, { name: 'AbortError' });
  const signal = await entered.promise;
  const stopped = app.destroy();
  assert.equal(signal.aborted, true);
  gate.resolve();
  await stopped;
  await failed;
  assert.deepEqual(events, ['late:released']);
});

test('separate applications never share lifecycle state', async () => {
  const first = fixture();
  const second = fixture();
  await Promise.all([first.app.start(), second.app.start()]);
  await first.app.destroy();
  assert.equal(second.app.getState().status, 'ready');
  await second.app.destroy();
});
