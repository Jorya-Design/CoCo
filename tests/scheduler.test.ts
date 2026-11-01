import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Scheduler } from '../control-plane/scheduler.ts';
import { makeTasks } from '../shared/plan.ts';
import type { ExecutionJob, LeaseKey } from '../shared/execution.ts';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Scheduler tests require the Firestore emulator');
const app=initializeApp({projectId:'demo-coco-scheduler'});
const db=getFirestore(app);
const scheduler=new Scheduler('b'.repeat(40));
const identity={workerId:'worker-1',tokenSha256:'a'.repeat(64)};
const key=(job:Omit<ExecutionJob,'inferenceToken'>):LeaseKey=>({roomId:job.roomId,runId:job.runId,attemptId:job.attemptId,fence:job.fence});
beforeEach(async()=>{
  for(const path of ['organizations','rooms','workerLeases'])await db.recursiveDelete(db.collection(path));
  await db.doc('organizations/coco-co').set({memberEmails:['alice@example.com']});
  await db.doc('rooms/room-1').set({orgId:'coco-co'});
  await db.doc('rooms/room-1/approvals/approved').set({status:'approved',plan:'Approved plan',tasks:makeTasks('A demo')});
  await db.doc('organizations/coco-co/executionRequests/run-1').set({roomId:'room-1',approvalId:'approved',status:'queued',
    requestedBy:'alice',requestedByEmail:'alice@example.com',createdAt:Timestamp.now()});
});
after(async()=>{await db.terminate();await deleteApp(app);});
test('scheduler claims dependency-ready tasks once and transfers the full ancestor commit set',async()=>{
  const commits:string[]=[];
  for(let i=0;i<6;i++) {
    const job=await scheduler.claim(identity);assert.ok(job);
    assert.equal(await scheduler.claim(identity),null);
    assert.equal(await scheduler.claim({...identity,workerId:'worker-2'}),null);
    if(i===4)assert.deepEqual(new Set(job.dependencyCommits),new Set(commits));
    await assert.rejects(scheduler.report(identity,{type:'worker/heartbeat',...key(job),fence:job.fence+1}));
    await assert.rejects(scheduler.report({...identity,workerId:'worker-2'},{type:'worker/heartbeat',...key(job)}));
    assert.equal(await scheduler.report(identity,{type:'worker/heartbeat',...key(job)}),true);
    const commit=String(i+1).repeat(40);commits.push(commit);
    assert.equal(await scheduler.report(identity,{type:'worker/result',...key(job),success:true,output:'Checked',commit}),true);
    await assert.rejects(scheduler.report(identity,{type:'worker/result',...key(job),success:true,output:'late',commit}));
  }
  assert.equal((await db.doc('rooms/room-1/runs/run-1').get()).data()!.status,'completed');
  assert.equal(await scheduler.claim(identity),null);
});
test('cancellation revokes the active attempt and prevents result acceptance',async()=>{
  const job=await scheduler.claim(identity);assert.ok(job);
  await db.doc('organizations/coco-co/executionRequests/run-1').update({status:'cancelled'});
  assert.equal(await scheduler.report(identity,{type:'worker/heartbeat',...key(job)}),false);
  await assert.rejects(scheduler.report(identity,{type:'worker/result',...key(job),success:true,output:'late',commit:'a'.repeat(40)}));
  assert.equal((await db.doc('rooms/room-1/runs/run-1').get()).data()!.status,'cancelled');
});
test('expired attempts fail visibly and are never silently rerun',async()=>{
  const job=await scheduler.claim(identity);assert.ok(job);
  await db.doc('workerLeases/worker-1').update({expiresAt:Date.now()-1});
  assert.equal(await scheduler.claim(identity),null);
  assert.equal((await db.doc('rooms/room-1/runs/run-1').get()).data()!.status,'failed');
});
test('a removed organization member cannot start or continue a run',async()=>{
  const job=await scheduler.claim(identity);assert.ok(job);
  await db.doc('organizations/coco-co').update({memberEmails:[]});
  assert.equal(await scheduler.report(identity,{type:'worker/heartbeat',...key(job)}),false);
});
