import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTasks } from './fixtures/tasks.ts';
import type { Run } from '../shared/types.ts';
import { canInterrupt, taskStages } from '../apps/web/src/lib/execution.ts';

test('DAG stages preserve fan-out and merge dependencies regardless of input order', () => {
  const stages = taskStages(makeTasks('CoCo').reverse());
  assert.deepEqual(stages.map(stage => stage.map(task => task.id).sort()), [
    ['scope'], ['interface', 'services', 'verification'], ['integration'], ['review'],
  ]);
});

test('DAG stages reject cycles and missing references instead of drawing misleading paths', () => {
  const task = makeTasks('CoCo')[0];
  assert.throws(() => taskStages([{ ...task, dependencies: ['scope'] }]), /cycle/);
  assert.throws(() => taskStages([{ ...task, dependencies: ['missing'] }]), /Missing dependency/);
});

test('interrupt is available only for the selected active task in a running run', () => {
  const tasks = makeTasks('CoCo').map(task => ({ ...task, status: task.id === 'interface' ? 'running' as const : 'pending' as const }));
  const run: Run = { id: 'run-a', roomId: 'room-a', mode: 'live', status: 'running', tasks, plan: '', createdAt: 1, events: [] };
  assert.equal(canInterrupt(run, 'interface'), true);
  assert.equal(canInterrupt(run, 'services'), false);
  assert.equal(canInterrupt(run, 'missing'), false);
  assert.equal(!!canInterrupt(null, 'interface'), false);
  for (const status of ['paused', 'completed', 'failed'] as const) assert.equal(canInterrupt({ ...run, status }, 'interface'), false);
});
