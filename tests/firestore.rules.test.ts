import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
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
test('presence belongs to its author and messages cannot impersonate members',async()=>{
  await assertSucceeds(setDoc(doc(client('bob'),'rooms','demo','presence','session'),{uid:'bob',name:'Bob',seenAt:serverTimestamp()}));
  await assertFails(setDoc(doc(client('alice'),'rooms','demo','presence','session'),{uid:'alice',name:'Alice',seenAt:serverTimestamp()}));
  await assertFails(setDoc(doc(client('bob'),'rooms','demo','messages','fake'),message('alice')));
});
