import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Scheduler } from '../control-plane/scheduler.ts';
import { PlanningScheduler } from '../control-plane/planning-scheduler.ts';
import { makeTasks } from '../shared/plan.ts';
import type { ExecutionJob, LeaseKey } from '../shared/execution.ts';
import { verifiedPullRequest } from '../shared/publication.ts';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Scheduler tests require the Firestore emulator');
const app=initializeApp({projectId:'demo-coco-scheduler'});
const db=getFirestore(app);
const scheduler=new Scheduler('b'.repeat(40));
const identity={workerId:'worker-1',tokenSha256:'a'.repeat(64)};
const key=(job:LeaseKey):LeaseKey=>({roomId:job.roomId,runId:job.runId,attemptId:job.attemptId,fence:job.fence});
const pullRequest=(job:Omit<ExecutionJob,'inferenceToken'>,commit='f'.repeat(40))=>verifiedPullRequest({
  number:42,url:'https://github.com/Jorya-Design/CoCo/pull/42',title:'Approved implementation',
  headRefName:job.publication!.branch,baseRefName:'main',headRefOid:commit,state:'OPEN',isDraft:false,isCrossRepository:false,author:{login:'joryatm'},
},job.runId,commit);
async function finishImplementation() {
  for(let i=0;i<6;i++) {
    const job=await scheduler.claim(identity);assert.ok(job);assert.equal(job.publication,undefined);
    await scheduler.report(identity,{type:'worker/result',...key(job),success:true,output:'Checked',commit:String(i+1).repeat(40)});
  }
}
beforeEach(async()=>{
  for(const path of ['organizations','rooms','workerLeases','planningRoomLeases'])await db.recursiveDelete(db.collection(path));
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
  const beforePublication=(await db.doc('rooms/room-1/runs/run-1').get()).data()!;
  assert.equal(beforePublication.status,'running');
  assert.equal(beforePublication.tasks.length,6);
  assert.equal(beforePublication.publication,undefined);
  const publication=await scheduler.claim(identity);assert.ok(publication?.publication);
  assert.deepEqual(new Set(publication.dependencyCommits),new Set(commits));
  assert.equal(await scheduler.claim(identity),null);
  assert.equal(await scheduler.claim({...identity,workerId:'worker-2'}),null);
  await scheduler.report(identity,{type:'worker/thread',...key(publication),threadId:'publication-thread'});
  assert.equal((await db.doc('rooms/room-1/runs/run-1').get()).data()!.publication.threadId,'publication-thread');
  await assert.rejects(scheduler.report(identity,{type:'worker/result',...key(publication),success:true,output:'No PR',commit:'f'.repeat(40)}),/pull request/);
  const pr=pullRequest(publication);
  await assert.rejects(scheduler.report(identity,{type:'worker/result',...key(publication),success:true,output:'Wrong commit',commit:'e'.repeat(40),pullRequest:pr}));
  await assert.rejects(scheduler.report(identity,{type:'worker/result',...key(publication),success:true,output:'Wrong branch',commit:pr.commit,pullRequest:{...pr,branch:'codex/coco-other-run'}}));
  await scheduler.report(identity,{type:'worker/result',...key(publication),success:true,output:'Created and checked',commit:pr.commit,pullRequest:pr});
  const finished=(await db.doc('rooms/room-1/runs/run-1').get()).data()!;
  assert.deepEqual(finished.pullRequest,pr);
  assert.equal(finished.publication.status,'completed');
  assert.equal(finished.tasks.length,6);
  assert.equal((await db.doc('rooms/room-1/runs/run-1').get()).data()!.status,'completed');
  assert.equal(await scheduler.claim(identity),null);
});
test('publication waits for every independent DAG branch and collects all of them',async()=>{
  const tasks=makeTasks('A demo').slice(0,2);
  tasks.push({...tasks[0],id:'independent',dependencies:[]});
  await db.doc('rooms/room-1/approvals/approved').update({tasks});
  const commits=[];
  for(let i=0;i<3;i++) {
    const job=await scheduler.claim(identity);assert.ok(job);assert.equal(job.publication,undefined);
    const commit=String(i+1).repeat(40);commits.push(commit);
    const fakePr=verifiedPullRequest({number:42,url:'https://github.com/Jorya-Design/CoCo/pull/42',title:'Too early',
      headRefName:'codex/coco-run-1',baseRefName:'main',headRefOid:commit,state:'OPEN',isDraft:false,isCrossRepository:false,author:{login:'joryatm'}},job.runId,commit);
    await assert.rejects(scheduler.report(identity,{type:'worker/result',...key(job),success:true,output:'Too early',commit,pullRequest:fakePr}),/Unexpected/);
    await scheduler.report(identity,{type:'worker/result',...key(job),success:true,output:'Checked',commit});
  }
  const job=await scheduler.claim(identity);assert.ok(job?.publication);
  assert.deepEqual(new Set(job.dependencyCommits),new Set(commits));
});
test('publication failures preserve the completed DAG and fail the run visibly',async()=>{
  await finishImplementation();
  const job=await scheduler.claim(identity);assert.ok(job?.publication);
  await scheduler.report(identity,{type:'worker/result',...key(job),success:false,output:'Missing bot token'});
  const run=(await db.doc('rooms/room-1/runs/run-1').get()).data()!;
  assert.equal(run.status,'failed');assert.equal(run.publication.status,'failed');
  assert.ok(run.tasks.every((task:{status:string})=>task.status==='completed'));
  assert.equal(run.pullRequest,undefined);
  assert.equal(await scheduler.claim(identity),null);
});
test('cancellation also fences the final publication attempt',async()=>{
  await finishImplementation();
  const job=await scheduler.claim(identity);assert.ok(job?.publication);
  await db.doc('organizations/coco-co/executionRequests/run-1').update({status:'cancelled'});
  assert.equal(await scheduler.report(identity,{type:'worker/heartbeat',...key(job)}),false);
  const pr=pullRequest(job);
  await assert.rejects(scheduler.report(identity,{type:'worker/result',...key(job),success:true,output:'Late',commit:pr.commit,pullRequest:pr}));
  assert.equal((await db.doc('rooms/room-1/runs/run-1').get()).data()!.pullRequest,undefined);
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

const planner = new PlanningScheduler();
async function queueMessage(id: string, time: number) {
  await db.doc(`rooms/room-1/messages/${id}`).set({authorUid:'alice',authorName:'Alice',text:`Question ${id}`,createdAt:Timestamp.fromMillis(time),replyStatus:'queued'});
  await db.doc(`organizations/coco-co/planningRequests/${id}`).set({roomId:'room-1',messageId:id,requestedBy:'alice',requestedByEmail:'alice@example.com',
    plan:'Shared plan context',status:'queued',createdAt:Timestamp.fromMillis(time)});
}
test('planning replies preserve conversation context, serialize a room and cannot post duplicates',async()=>{
  await queueMessage('first',1000);await queueMessage('second',2000);
  const job=await planner.claim(identity);assert.ok(job);assert.equal(job.runId,'first');
  assert.match(job.prompt,/Shared plan context/);assert.match(job.prompt,/Question first/);
  assert.doesNotMatch(job.prompt,/Question second/);
  assert.equal(await planner.claim(identity),null);
  assert.equal(await planner.claim({...identity,workerId:'worker-2'}),null);
  assert.equal(await scheduler.claim(identity),null);
  await assert.rejects(planner.report(identity,{type:'worker/heartbeat',...key(job),fence:job.fence+1}));
  await assert.rejects(planner.report({...identity,workerId:'worker-2'},{type:'worker/heartbeat',...key(job)}));
  assert.equal(await planner.report(identity,{type:'worker/heartbeat',...key(job)}),true);
  await planner.report(identity,{type:'worker/thread',...key(job),threadId:'thread-123'});
  await planner.report(identity,{type:'worker/result',...key(job),success:true,output:'A useful planning answer.'});
  await assert.rejects(planner.report(identity,{type:'worker/result',...key(job),success:true,output:'Duplicate'}));
  const reply=(await db.doc('rooms/room-1/messages/codex-first').get()).data()!;
  assert.equal(reply.agent,'codex');assert.equal(reply.inReplyTo,'first');
  assert.equal((await db.doc('rooms/room-1/messages/first').get()).data()!.replyStatus,'completed');
  const next=await planner.claim(identity);assert.ok(next);assert.equal(next.runId,'second');
  assert.match(next.prompt,/A useful planning answer/);
  await planner.report(identity,{type:'worker/result',...key(next),success:true,output:'Second answer'});
  assert.equal(await planner.claim(identity),null); // Codex messages do not enqueue more work.
});
test('expired planning leases fail visibly without replaying a turn and release the room',async()=>{
  await queueMessage('first',1000);
  const job=await planner.claim(identity);assert.ok(job);
  await db.doc('workerLeases/worker-1').update({expiresAt:Date.now()-1});
  assert.equal(await scheduler.claim(identity),null);
  assert.equal(await planner.claim(identity),null);
  assert.equal((await db.doc('rooms/room-1/messages/first').get()).data()!.replyStatus,'failed');
  assert.equal((await db.doc('planningRoomLeases/room-1').get()).exists,false);
  await assert.rejects(planner.report(identity,{type:'worker/result',...key(job),success:true,output:'Stale'}));
  await queueMessage('second',2000);assert.ok(await planner.claim(identity));
});
test('planning respects active coding work and revoked members, and shows model failures',async()=>{
  const coding=await scheduler.claim(identity);assert.ok(coding);
  await queueMessage('first',1000);assert.equal(await planner.claim(identity),null);
  await scheduler.report(identity,{type:'worker/result',...key(coding),success:false,output:'Stopped'});
  const job=await planner.claim(identity);assert.ok(job);
  await planner.report(identity,{type:'worker/result',...key(job),success:false,output:'Model unavailable'});
  assert.equal((await db.doc('rooms/room-1/messages/codex-first').get()).exists,false);
  assert.equal((await db.doc('rooms/room-1/messages/first').get()).data()!.replyStatus,'failed');
  await queueMessage('second',2000);const next=await planner.claim(identity);assert.ok(next);
  await db.doc('organizations/coco-co').update({memberEmails:[]});
  assert.equal(await planner.report(identity,{type:'worker/heartbeat',...key(next)}),false);
  await queueMessage('third',3000);assert.equal(await planner.claim(identity),null);
});
