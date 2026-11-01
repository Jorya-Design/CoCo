import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTasks, readyTasks, validateDag } from '../shared/plan.ts';
import type { Task } from '../shared/types.ts';
test('generated task graph fans out after contracts and gates the reducer', () => {
  const tasks: Task[] = makeTasks('CoCo').map(t=>({...t,status:'pending'}));
  validateDag(tasks);
  assert.deepEqual(readyTasks(tasks).map(t=>t.id), ['scope']);
  tasks[0].status = 'completed';
  assert.deepEqual(readyTasks(tasks).map(t=>t.id), ['interface','services','verification']);
  tasks.find(t=>t.id==='interface')!.status='failed';
  assert.ok(!readyTasks(tasks).some(t=>t.id==='integration'));
});
test('invalid dependencies, duplicate IDs, and cycles cannot be approved', () => {
  const tasks=makeTasks('CoCo');
  assert.throws(()=>validateDag([...tasks,tasks[0]]), /unique/);
  assert.throws(()=>validateDag([{...tasks[0],dependencies:['missing']}]), /Missing dependency/);
  assert.throws(()=>validateDag([{...tasks[0],dependencies:['scope']}]), /cycle/);
});
