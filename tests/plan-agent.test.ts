import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as Y from 'yjs';
import { PlanningScheduler } from '../control-plane/planning-scheduler.ts';
import { PlanAgent } from '../control-plane/plan-agent.ts';
import { anchorReply } from '../shared/plan-agent.ts';
import type { ExecutionJob, LeaseKey } from '../shared/execution.ts';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Plan agent tests require the Firestore emulator');
const app=initializeApp({projectId:'demo-coco-plan-agent-'+process.pid});
const db=getFirestore(app), agent=new PlanAgent('b'.repeat(40));
const identity={workerId:'worker-1',tokenSha256:'a'.repeat(64)};
const path='organizations/coco-co/planRequests/request-1';
const key=(job:Omit<ExecutionJob,'inferenceToken'>):LeaseKey=>({roomId:job.roomId,runId:job.runId,attemptId:job.attemptId,fence:job.fence});
async function latest(){const document=new Y.Doc();for(const item of (await db.collection('rooms/room-1/updates').get()).docs)Y.applyUpdate(document,new Uint8Array(item.data().bytes));return document;}
async function editHuman(before:string,after:string){const document=await latest(),vector=Y.encodeStateVector(document);const text=document.getText('plan'),from=text.toString().indexOf(before);text.delete(from,before.length);text.insert(from,after);await db.collection('rooms/room-1/updates').add({bytes:Buffer.from(Y.encodeStateAsUpdate(document,vector)),authorName:'Alice',authorUid:'alice'});document.destroy();}
async function result(job:Omit<ExecutionJob,'inferenceToken'>){return agent.report(identity,{type:'worker/result',...key(job),success:true,output:JSON.stringify({reply:'I clarified the goal.',edits:[{before:'Ship a demo.',after:'Ship a collaborative demo.'}]})});}
beforeEach(async()=>{
  for(const name of ['organizations','rooms','workerLeases','planContexts'])await db.recursiveDelete(db.collection(name));
  await db.doc('organizations/coco-co').set({memberEmails:['alice@example.com','bob@example.com']});
  await db.doc('rooms/room-1').set({orgId:'coco-co'});
  const document=new Y.Doc();document.getText('plan').insert(0,'# Goal\n\nShip a demo.\n\n# Notes\nOriginal note.');
  await db.doc('rooms/room-1/updates/initial').set({bytes:Buffer.from(Y.encodeStateAsUpdate(document))});document.destroy();
  await db.doc('rooms/room-1/interviews/answer').set({question:'What matters?',answer:'Collaboration',authorName:'Alice',createdAt:Timestamp.now()});
  await db.doc('rooms/room-1/messages/message').set({authorName:'Bob',text:'Use live editing',createdAt:Timestamp.now()});
  await db.doc(path).set({roomId:'room-1',mode:'suggest',prompt:'Clarify the goal',requestedBy:'alice',requestedByEmail:'alice@example.com',status:'queued'});
});
after(async()=>{await db.terminate();await deleteApp(app);});
test('claims latest context, fences results and applies reviewed changes while preserving unrelated edits',async()=>{
  const job=await agent.claim(identity);assert.ok(job);assert.match(job.planning!.interview,/Collaboration/);assert.match(job.planning!.conversation,/Use live editing/);
  assert.equal(await agent.claim(identity),null);
  await assert.rejects(agent.report(identity,{type:'worker/heartbeat',...key(job),fence:2}));
  await result(job);
  assert.equal((await db.doc(path).get()).data()!.status,'suggested');
  await editHuman('Original note.','Bob added a note.');
  await db.doc(path).update({status:'apply_requested',decidedByEmail:'bob@example.com'});
  await agent.processDecisions();
  const document=await latest();assert.match(document.getText('plan').toString(),/Ship a collaborative demo\./);assert.match(document.getText('plan').toString(),/Bob added a note\./);document.destroy();
  assert.equal((await db.doc(path).get()).data()!.status,'applied');
  await assert.rejects(result(job));
  assert.equal((await db.doc('planContexts/request-1').get()).exists,false);
});
test('direct edits refuse overlapping human changes atomically',async()=>{
  await db.doc(path).update({mode:'edit'});const job=await agent.claim(identity);assert.ok(job);
  await editHuman('Ship a demo.','Ship a testable demo.');await result(job);
  assert.equal((await db.doc(path).get()).data()!.status,'conflict');
  const document=await latest();assert.match(document.getText('plan').toString(),/Ship a testable demo\./);document.destroy();
});
test('direct mode applies once, and cancellation rejects late output',async()=>{
  await db.doc(path).update({mode:'edit'});const job=await agent.claim(identity);assert.ok(job);await result(job);
  assert.equal((await db.doc(path).get()).data()!.status,'applied');
  await db.doc(path).set({roomId:'room-1',mode:'answer',prompt:'Explain',requestedByEmail:'alice@example.com',status:'queued'});
  const next=await agent.claim(identity);assert.ok(next);await db.doc(path).update({status:'cancelled'});
  assert.equal(await agent.report(identity,{type:'worker/heartbeat',...key(next)}),false);
  await assert.rejects(result(next));
});
test('removed members cannot apply or start requests; expired leases fail visibly',async()=>{
  const job=await agent.claim(identity);assert.ok(job);await result(job);
  await db.doc(path).update({status:'apply_requested',decidedByEmail:'bob@example.com'});
  await db.doc('organizations/coco-co').update({memberEmails:['alice@example.com']});await agent.processDecisions();
  assert.equal((await db.doc(path).get()).data()!.status,'failed');
  await db.doc(path).set({roomId:'room-1',mode:'answer',prompt:'Explain',requestedByEmail:'alice@example.com',status:'queued'});
  const next=await agent.claim(identity);assert.ok(next);await db.doc('workerLeases/worker-1').update({expiresAt:Date.now()-1});
  assert.equal(await agent.claim(identity),null);assert.equal((await db.doc(path).get()).data()!.status,'failed');
});
test('answer mode and ambiguous passages cannot mutate the plan',()=>{
  const document=new Y.Doc();document.getText('plan').insert(0,'repeat repeat');
  assert.throws(()=>anchorReply(document,{reply:'Hi',edits:[{before:'repeat',after:'once'}]},'suggest'));
  assert.throws(()=>anchorReply(document,{reply:'Hi',edits:[{before:'repeat repeat',after:'once'}]},'answer'));
  assert.throws(()=>anchorReply(document,{reply:'Hi',edits:[{before:'',after:'append'}]},'edit'));
  assert.deepEqual(anchorReply(document,{reply:'Hi',edits:[]},'answer'),{reply:'Hi',edits:[]});document.destroy();
});

test('document editing and automatic discussion share one fenced worker lease',async()=>{
  const discussion=new PlanningScheduler();
  const job=await agent.claim(identity);assert.ok(job);
  assert.equal(await discussion.claim(identity),null);
  await result(job);
  await db.doc('rooms/room-1/messages/source').set({authorUid:'alice',authorName:'Alice',text:'Discuss this',createdAt:Timestamp.now()});
  await db.doc('organizations/coco-co/planningRequests/source').set({roomId:'room-1',messageId:'source',requestedBy:'alice',requestedByEmail:'alice@example.com',plan:'A goal',status:'queued',createdAt:Timestamp.now()});
  const reply=await discussion.claim(identity);assert.ok(reply);
  await db.doc(path).set({roomId:'room-1',mode:'answer',prompt:'Explain',requestedByEmail:'alice@example.com',status:'queued'});
  assert.equal(await agent.claim(identity),null);
  await discussion.report(identity,{type:'worker/result',...{roomId:reply.roomId,runId:reply.runId,attemptId:reply.attemptId,fence:reply.fence},success:true,output:'A discussion reply.'});
  assert.ok(await agent.claim(identity));
});
