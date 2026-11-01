import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, collection, deleteDoc, doc, getDoc, getDocs, query, where, setDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { ORGANIZATION_MEMBERS } from '../shared/organization.ts';
let env: RulesTestEnvironment;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-coco',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'organizations','coco-co'),{name:'CoCo Co',memberEmails:ORGANIZATION_MEMBERS});
    await setDoc(doc(db,'rooms','demo'),{title:'CoCo',ownerUid:'alice',orgId:'coco-co',createdAt:serverTimestamp()});
    await setDoc(doc(db,'rooms','unrelated'),{title:'Unrelated',ownerUid:'eve',orgId:'other',createdAt:serverTimestamp()});
    await setDoc(doc(db,'rooms','demo','updates','initial'),{bytes:Bytes.fromUint8Array(new Uint8Array([1])),authorUid:'bootstrap',authorName:'CoCo',createdAt:serverTimestamp()});
  });
});
after(async()=>{if(env){await env.clearFirestore();await env.cleanup();}});
const email=(uid:string)=>uid==='alice'?'suryansh@gmail.com':uid==='bob'?'jhosephchi@gmail.com':uid+'@example.com';
const client=(uid:string)=>env.authenticatedContext(uid,{email:email(uid),email_verified:true}).firestore();
const guest=()=>env.unauthenticatedContext().firestore();
const update=(uid:string)=>({bytes:Bytes.fromUint8Array(new Uint8Array([1,2,3])),authorUid:uid,authorName:uid,createdAt:serverTimestamp()});
const message=(uid:string)=>({authorUid:uid,authorName:uid,text:'Hello team',createdAt:serverTimestamp()});
const room=(uid:string)=>({title:'New room',ownerUid:uid,orgId:'coco-co',createdAt:serverTimestamp()});
test('anonymous visitors can view CoCo Co and its rooms, but not unrelated orgs',async()=>{
  const db=guest();
  await assertSucceeds(getDoc(doc(db,'organizations','coco-co')));
  await assertSucceeds(getDoc(doc(db,'rooms','demo')));
  await assertSucceeds(getDoc(doc(db,'rooms','demo','updates','initial')));
  await assertSucceeds(getDocs(query(collection(db,'rooms'),where('orgId','==','coco-co'))));
  await assertFails(getDoc(doc(db,'rooms','unrelated')));
  await assertFails(getDocs(collection(db,'rooms')));
});
test('anonymous access is read-only across every writable browser path',async()=>{
  const db=guest();
  await assertFails(setDoc(doc(db,'rooms','new'),room('guest')));
  await assertFails(setDoc(doc(db,'rooms','demo','updates','edit'),update('guest')));
  await assertFails(setDoc(doc(db,'rooms','demo','messages','edit'),message('guest')));
  await assertFails(setDoc(doc(db,'rooms','demo','presence','session'),{uid:'guest',name:'Guest',seenAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db,'rooms','demo','approvals','snapshot'),{approvedBy:'guest',plan:'A plan',tasks:[{id:'a'}],status:'approved',createdAt:serverTimestamp()}));
});
test('verified outsiders cannot write or grant themselves membership',async()=>{
  const db=client('eve');
  await assertSucceeds(getDoc(doc(db,'rooms','demo')));
  await assertFails(setDoc(doc(db,'rooms','new'),room('eve')));
  await assertFails(setDoc(doc(db,'rooms','demo','updates','outsider'),update('eve')));
  await assertFails(updateDoc(doc(db,'organizations','coco-co'),{memberEmails:[...ORGANIZATION_MEMBERS,email('eve')]}));
});
test('both verified members can contribute, including normalized email claims',async()=>{
  for(const uid of ['alice','bob']) {
    await assertSucceeds(setDoc(doc(client(uid),'rooms','demo','updates',uid),update(uid)));
    await assertSucceeds(setDoc(doc(client(uid),'rooms','demo','messages',uid),message(uid)));
  }
  const upper=env.authenticatedContext('alice',{email:'SURYANSH@GMAIL.COM',email_verified:true}).firestore();
  await assertSucceeds(setDoc(doc(upper,'rooms','demo','messages','upper'),message('alice')));
});
test('an unverified member cannot edit',async()=>{
  const db=env.authenticatedContext('alice',{email:email('alice'),email_verified:false}).firestore();
  await assertSucceeds(getDoc(doc(db,'rooms','demo')));
  await assertFails(setDoc(doc(db,'rooms','demo','updates','unverified'),update('alice')));
});
test('a member creates a room and CRDT seed atomically',async()=>{
  const db=client('alice'),batch=writeBatch(db);
  batch.set(doc(db,'rooms','new'),room('alice'));
  batch.set(doc(db,'rooms','new','updates','initial'),update('alice'));
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(db,'rooms','wrong-org'),{...room('alice'),orgId:'other'}));
});
test('updates are immutable, attributed, and bounded in size',async()=>{
  const db=client('bob');
  await assertSucceeds(setDoc(doc(db,'rooms','demo','updates','edit'),update('bob')));
  await assertFails(setDoc(doc(client('alice'),'rooms','demo','updates','edit'),update('alice')));
  await assertFails(setDoc(doc(db,'rooms','demo','updates','forged'),update('alice')));
  await assertFails(setDoc(doc(db,'rooms','demo','updates','huge'),{...update('bob'),bytes:Bytes.fromUint8Array(new Uint8Array(262145))}));
});
test('membership is administrative and a room cannot change orgs',async()=>{
  await assertFails(updateDoc(doc(client('alice'),'organizations','coco-co'),{memberEmails:['suryansh@gmail.com']}));
  await assertSucceeds(updateDoc(doc(client('bob'),'rooms','demo'),{title:'Shared title'}));
  await assertFails(updateDoc(doc(client('alice'),'rooms','demo'),{orgId:'other'}));
});
test('approvals are immutable and clients cannot forge worker execution',async()=>{
  const db=client('alice');
  await assertFails(setDoc(doc(db,'rooms','demo','runs','fake'),{status:'completed'}));
  const approval=doc(db,'rooms','demo','approvals','snapshot');
  await assertSucceeds(setDoc(approval,{approvedBy:'alice',plan:'A plan',tasks:[{id:'a'}],status:'approved',createdAt:serverTimestamp()}));
  await assertFails(updateDoc(approval,{plan:'Changed after approval'}));
  await assertSucceeds(getDoc(doc(guest(),'rooms','demo','approvals','snapshot')));
});

test('worker health is public but only the trusted server can publish it',async()=>{
  const path = ['organizations','coco-co','runtime','worker-health'] as const;
  await assertSucceeds(getDoc(doc(guest(),...path)));
  await assertFails(setDoc(doc(client('alice'),...path),{workers:['fake'],updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(guest(),...path),{workers:['fake']}));
  await assertFails(getDoc(doc(guest(),'organizations','coco-co','runtime','credentials')));
});

test('only verified members queue immutable approved snapshots and may cancel their execution',async()=>{
  const db=client('alice');
  const approval=doc(db,'rooms','demo','approvals','approved');
  await setDoc(approval,{approvedBy:'alice',plan:'Plan',tasks:[{id:'a'}],status:'approved',createdAt:serverTimestamp()});
  const value={roomId:'demo',approvalId:'approved',requestedBy:'alice',requestedByEmail:email('alice'),status:'queued',createdAt:serverTimestamp()};
  const path=['organizations','coco-co','executionRequests','request-1'] as const;
  await assertFails(setDoc(doc(guest(),...path),value));
  await assertFails(setDoc(doc(client('eve'),...path),{...value,requestedBy:'eve',requestedByEmail:email('eve')}));
  await assertFails(setDoc(doc(db,...path),{...value,requestedByEmail:email('bob')}));
  await assertFails(setDoc(doc(db,...path),{...value,approvalId:'missing'}));
  await assertSucceeds(setDoc(doc(db,...path),value));
  await assertFails(updateDoc(doc(db,...path),{status:'completed'}));
  await assertFails(updateDoc(doc(db,...path),{approvalId:'different'}));
  await assertSucceeds(updateDoc(doc(client('bob'),...path),{status:'cancelled'}));
  await assertFails(setDoc(doc(db,'workerLeases','worker-1'),{status:'active'}));
});
test('presence belongs to its author and messages cannot impersonate members',async()=>{
  await assertSucceeds(setDoc(doc(client('bob'),'rooms','demo','presence','session'),{uid:'bob',name:'Bob',seenAt:serverTimestamp()}));
  await assertFails(setDoc(doc(client('alice'),'rooms','demo','presence','session'),{uid:'alice',name:'Alice',seenAt:serverTimestamp()}));
  await assertFails(setDoc(doc(client('bob'),'rooms','demo','messages','fake'),message('alice')));
});

const steering=(uid:string)=>({taskId:'interface',runId:null as string|null,text:'Use accessible controls',timing:'next',status:'queued',authorUid:uid,authorName:uid,createdAt:serverTimestamp()});
test('steering is public to read and limited to verified members to create',async()=>{
  const note=doc(client('alice'),'rooms','demo','steering','note');
  await assertSucceeds(setDoc(note,steering('alice')));
  await assertSucceeds(getDoc(doc(guest(),'rooms','demo','steering','note')));
  await assertSucceeds(getDocs(collection(guest(),'rooms','demo','steering')));
  await assertFails(setDoc(doc(guest(),'rooms','demo','steering','guest'),steering('guest')));
  await assertFails(setDoc(doc(client('eve'),'rooms','demo','steering','outsider'),steering('eve')));
  const unverified=env.authenticatedContext('alice',{email:email('alice'),email_verified:false}).firestore();
  await assertFails(setDoc(doc(unverified,'rooms','demo','steering','unverified'),steering('alice')));
  await assertFails(setDoc(doc(client('alice'),'rooms','unrelated','steering','note'),steering('alice')));
});
test('steering validates attribution, content, scope, and server-owned acknowledgement',async()=>{
  const db=client('alice');
  const invalid=[{authorUid:'bob'},{text:''},{text:'  \n\t'},{text:'x'.repeat(4001)},{taskId:''},{taskId:'x'.repeat(201)},{status:'applied'},{timing:'later'},{runId:'missing'},{timing:'now'},{extra:true}];
  for(let index=0;index<invalid.length;index++) await assertFails(setDoc(doc(db,'rooms','demo','steering',String(index)),{...steering('alice'),...invalid[index]}));
  await assertSucceeds(setDoc(doc(db,'rooms','demo','steering','multiline'),{...steering('alice'),text:'First line\nSecond line'}));
});
test('interrupt requests require a running run and queued instructions accept paused runs',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    for(const status of ['running','paused','completed','failed']) await setDoc(doc(context.firestore(),'rooms','demo','runs',status),{status});
  });
  const db=client('bob');
  await assertSucceeds(setDoc(doc(db,'rooms','demo','steering','now'),{...steering('bob'),runId:'running',timing:'now'}));
  await assertSucceeds(setDoc(doc(db,'rooms','demo','steering','next'),{...steering('bob'),runId:'paused'}));
  for(const status of ['paused','completed','failed']) await assertFails(setDoc(doc(db,'rooms','demo','steering',status),{...steering('bob'),runId:status,timing:'now'}));
  await assertFails(setDoc(doc(db,'rooms','demo','steering','finished-next'),{...steering('bob'),runId:'completed'}));
});
test('members can cancel requests but cannot edit, delete, apply, or revive them',async()=>{
  const note=doc(client('alice'),'rooms','demo','steering','note');
  await assertSucceeds(setDoc(note,steering('alice')));
  await assertFails(updateDoc(doc(guest(),'rooms','demo','steering','note'),{status:'cancelled'}));
  await assertFails(updateDoc(doc(client('eve'),'rooms','demo','steering','note'),{status:'cancelled'}));
  await assertFails(updateDoc(note,{text:'Changed instruction'}));
  await assertFails(updateDoc(note,{status:'applied'}));
  await assertFails(updateDoc(note,{status:'rejected'}));
  await assertFails(deleteDoc(note));
  await assertSucceeds(updateDoc(doc(client('bob'),'rooms','demo','steering','note'),{status:'cancelled'}));
  await assertFails(updateDoc(note,{status:'queued'}));
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'rooms','demo','steering','applied'),{...steering('alice'),status:'applied'});
  });
  await assertFails(updateDoc(doc(client('alice'),'rooms','demo','steering','applied'),{status:'cancelled'}));
});

const interview=(uid:string)=>({questionIndex:0,title:'Who are we building for?',question:'Who is the primary user?',answer:'Small engineering teams',authorUid:uid,authorName:uid,createdAt:serverTimestamp()});
function answerPair(db:ReturnType<typeof client>,uid:string,id:string,patch:Record<string,unknown>={}) {
  const entry={...interview(uid),...patch};
  const batch=writeBatch(db);
  batch.set(doc(db,'rooms','demo','interviews',id),entry);
  batch.set(doc(db,'rooms','demo','messages',id),{...message(uid),authorName:entry.authorName,text:entry.answer});
  return batch.commit();
}
test('interview answers and room messages save atomically for both members',async()=>{
  for(const uid of ['alice','bob']) await assertSucceeds(answerPair(client(uid),uid,uid));
  await assertSucceeds(getDocs(collection(guest(),'rooms','demo','interviews')));
  await assertFails(getDocs(collection(guest(),'rooms','unrelated','interviews')));
  await assertFails(setDoc(doc(client('alice'),'rooms','demo','interviews','orphan'),interview('alice')));
  await assertSucceeds(setDoc(doc(client('alice'),'rooms','demo','messages','old-message'),message('alice')));
  await assertFails(setDoc(doc(client('alice'),'rooms','demo','interviews','old-message'),interview('alice')));
  const db=client('alice'), mismatch=writeBatch(db);
  mismatch.set(doc(db,'rooms','demo','interviews','mismatch'),interview('alice'));
  mismatch.set(doc(db,'rooms','demo','messages','mismatch'),message('alice'));
  await assertFails(mismatch.commit());
  assert.equal((await getDoc(doc(guest(),'rooms','demo','messages','mismatch'))).exists(),false);
});
test('guests, unverified members, and outsiders cannot add interview history',async()=>{
  await assertFails(answerPair(guest(),'guest','guest'));
  await assertFails(answerPair(client('eve'),'eve','outsider'));
  const unverified=env.authenticatedContext('alice',{email:email('alice'),email_verified:false}).firestore();
  await assertFails(answerPair(unverified,'alice','unverified'));
  assert.equal((await getDoc(doc(guest(),'rooms','demo','messages','outsider'))).exists(),false);
});
test('interview history is attributed, bounded, and immutable',async()=>{
  const db=client('alice');
  const invalid=[{questionIndex:-1},{questionIndex:1.5},{title:''},{title:'x'.repeat(201)},{question:''},{question:'x'.repeat(2001)},{answer:' \n\t'},{answer:'x'.repeat(8001)},{authorUid:'bob'},{createdAt:null},{extra:true}];
  for(let index=0;index<invalid.length;index++) await assertFails(answerPair(db,'alice','invalid-'+index,invalid[index]));
  await assertSucceeds(answerPair(db,'alice','saved'));
  const record=doc(db,'rooms','demo','interviews','saved');
  await assertFails(updateDoc(record,{answer:'Rewritten'}));
  await assertFails(deleteDoc(record));
  assert.equal((await getDoc(record)).data()?.answer,'Small engineering teams');
});
