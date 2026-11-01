import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyTasks, validateDag } from '../shared/plan.ts';
import { makeTasks } from './fixtures/tasks.ts';
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

test('new plans contain no default implementation strategy or tasks',async()=>{
  const {makePlan}=await import('../shared/plan.ts');
  assert.equal(makePlan('Offline notes'),'# Offline notes\n\n');
});
test('Codex implementation tasks must be specific, valid and tied to their source plan',async()=>{
  const {parseImplementationReply,implementationMatchesPlan}=await import('../shared/implementation-plan.ts');
  const tasks=[{id:'sync',title:'Synchronize notes',description:'Persist and merge offline note edits.',kind:'map' as const,dependencies:[]}];
  assert.deepEqual(parseImplementationReply({reply:'One task',tasks}).tasks,tasks);
  assert.throws(()=>parseImplementationReply({reply:'Empty',tasks:[]}));
  assert.throws(()=>parseImplementationReply({reply:'Cycle',tasks:[{...tasks[0],dependencies:['sync']}]}));
  assert.throws(()=>parseImplementationReply({reply:'Missing',tasks:[{...tasks[0],dependencies:['missing']}]}));
  assert.equal(implementationMatchesPlan({id:'generated',plan:'Agreed',tasks},'Agreed'),true);
  assert.equal(implementationMatchesPlan({id:'generated',plan:'Agreed',tasks},'Changed'),false);
  assert.equal(implementationMatchesPlan(null,'Agreed'),false);
});
