import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, doc, getDoc, setDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
let env: RulesTestEnvironment;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-coco',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'rooms','private'),{title:'CoCo',ownerUid:'alice',memberEmails:['alice@example.com','bob@example.com'],createdAt:serverTimestamp()});
  });
});
after(async()=>{await env?.cleanup();});
const client=(uid:string)=>env.authenticatedContext(uid,{email:uid+'@example.com',email_verified:true}).firestore();
const update=(uid:string)=>({bytes:Bytes.fromUint8Array(new Uint8Array([1,2,3])),authorUid:uid,authorName:uid,createdAt:serverTimestamp()});
test('only verified members can read a room',async()=>{
  await assertSucceeds(getDoc(doc(client('alice'),'rooms','private')));
  await assertFails(getDoc(doc(client('eve'),'rooms','private')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'rooms','private')));
  await assertFails(getDoc(doc(env.authenticatedContext('alice',{email:'alice@example.com',email_verified:false}).firestore(),'rooms','private')));
});
test('room creation and CRDT seed are atomic',async()=>{
  const db=client('alice'),batch=writeBatch(db);
  batch.set(doc(db,'rooms','new'),{title:'New plan',ownerUid:'alice',memberEmails:['alice@example.com'],createdAt:serverTimestamp()});
  batch.set(doc(db,'rooms','new','updates','initial'),update('alice'));
  await assertSucceeds(batch.commit());
});
test('members append updates but cannot overwrite another update',async()=>{
  await assertSucceeds(setDoc(doc(client('bob'),'rooms','private','updates','edit'),update('bob')));
  await assertFails(setDoc(doc(client('alice'),'rooms','private','updates','edit'),update('alice')));
  await assertFails(setDoc(doc(client('eve'),'rooms','private','updates','stolen'),update('eve')));
});
test('an update cannot impersonate another member or exceed the size bound',async()=>{
  await assertFails(setDoc(doc(client('bob'),'rooms','private','updates','forged'),update('alice')));
  await assertFails(setDoc(doc(client('bob'),'rooms','private','updates','huge'),{...update('bob'),bytes:Bytes.fromUint8Array(new Uint8Array(262145))}));
});
test('only the owner can grant room membership',async()=>{
  await assertFails(updateDoc(doc(client('bob'),'rooms','private'),{memberEmails:['alice@example.com','bob@example.com','eve@example.com']}));
  await assertSucceeds(updateDoc(doc(client('alice'),'rooms','private'),{memberEmails:['alice@example.com','bob@example.com','eve@example.com']}));
  await assertSucceeds(getDoc(doc(client('eve'),'rooms','private')));
});
test('members cannot forge worker execution or mutate approvals',async()=>{
  const db=client('alice');
  await assertFails(setDoc(doc(db,'rooms','private','runs','fake'),{status:'completed'}));
  const approval=doc(db,'rooms','private','approvals','snapshot');
  await assertSucceeds(setDoc(approval,{approvedBy:'alice',plan:'A plan',tasks:[{id:'a'}],status:'approved',createdAt:serverTimestamp()}));
  await assertFails(updateDoc(approval,{plan:'Changed after approval'}));
});
test('presence is owned by its author and messages cannot impersonate teammates',async()=>{
  await assertSucceeds(setDoc(doc(client('bob'),'rooms','private','presence','session'),{uid:'bob',name:'Bob',seenAt:serverTimestamp()}));
  await assertFails(setDoc(doc(client('alice'),'rooms','private','presence','session'),{uid:'alice',name:'Alice',seenAt:serverTimestamp()}));
  await assertFails(setDoc(doc(client('bob'),'rooms','private','messages','fake'),{authorUid:'alice',authorName:'Alice',text:'Forged',createdAt:serverTimestamp()}));
});
