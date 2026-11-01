import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectedMembers, activityLabel, type PresenceSession } from '../shared/presence.ts';
const session=(uid:string,time:number,active=true):PresenceSession=>({uid,name:'Same name',seenAt:{toMillis:()=>time},active,view:'plan',activity:'viewing'});
test('members expire without another snapshot and future or pending heartbeats are ignored',()=>{
  const sessions=[session('fresh',100000),session('old',50000),session('future',120001),{...session('pending',100000),seenAt:null}];
  assert.deepEqual(connectedMembers(sessions,100000).map(p=>p.uid),['fresh']);
  assert.deepEqual(connectedMembers([sessions[0]],145000),[]);
});
test('multiple tabs are grouped by identity rather than display name, preferring an active tab',()=>{
  const active={...session('alice',99000),activity:'typing' as const};
  const result=connectedMembers([active,session('alice',100000,false),session('bob',100000)],100000);
  assert.equal(result.length,2);assert.equal(result.find(p=>p.uid==='alice')?.activity,'typing');
  assert.equal(connectedMembers([active,session('alice',100000)],100000)[0].activity,'viewing');
});
test('activity labels distinguish away, typing, plan editing, and task inspection',()=>{
  const base=session('alice',100000);
  assert.equal(activityLabel({...base,active:false,activity:'typing'}),'Away');
  assert.equal(activityLabel({...base,activity:'typing'}),'Typing a message');
  assert.equal(activityLabel({...base,activity:'editing'}),'Editing the plan');
  assert.equal(activityLabel({...base,view:'control',taskId:'task-1'},'Design API'),'Viewing Design API');
});
