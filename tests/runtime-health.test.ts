import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtimeOnline, type RuntimeHealth } from '../shared/runtime.ts';

test('worker health expires when the VM stops reporting, including future timestamps', () => {
  const now = Date.now();
  const health = (time: number): RuntimeHealth => ({
    host: 'test', workers: ['worker-1'], updatedAt: { toMillis: () => time }, executionReady: false,
  });
  assert.equal(runtimeOnline(null, now), false);
  assert.equal(runtimeOnline(health(now), now), true);
  assert.equal(runtimeOnline(health(now - 90001), now), false);
  assert.equal(runtimeOnline(health(now + 10001), now), false);
});
