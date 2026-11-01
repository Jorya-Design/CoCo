import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, doc, setDoc, serverTimestamp, type Firestore } from 'firebase/firestore';
import * as Y from 'yjs';
import type { User } from 'firebase/auth';
import { FirestoreDocument } from '../apps/web/src/lib/collaboration.ts';

test('two authenticated Firestore clients converge edits, exchange named cursors and reconnect from durable updates',async()=>{
  // The provider only uses window for online events; no browser is simulated here.
  const previous=globalThis.window;
  globalThis.window=new EventTarget() as unknown as Window & typeof globalThis;
  const env=await initializeTestEnvironment({projectId:'demo-coco-collaboration-'+process.pid,firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
  const initial=new Y.Doc();initial.getText('plan').insert(0,'# Shared plan\n\nA goal.\n');
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();await setDoc(doc(db,'organizations','coco-co'),{memberEmails:['suryansh@gmail.com','jhosephchi@gmail.com']});
    await setDoc(doc(db,'rooms','test'),{orgId:'coco-co'});
    await setDoc(doc(db,'rooms','test','updates','initial'),{bytes:Bytes.fromUint8Array(Y.encodeStateAsUpdate(initial)),authorUid:'seed',authorName:'Seed',createdAt:serverTimestamp()});
  });
  initial.destroy();
  const alice=env.authenticatedContext('alice',{email:'suryansh@gmail.com',email_verified:true}).firestore() as unknown as Firestore;
  const bob=env.authenticatedContext('bob',{email:'jhosephchi@gmail.com',email_verified:true}).firestore() as unknown as Firestore;
  const failures:string[]=[];
  const make=(db:Firestore,uid:string,name:string)=>new FirestoreDocument(db,'test',{uid,displayName:name} as User,true,(state,error)=>{if(state==='error')failures.push(error!);},()=>{},()=>{});
  const first=make(alice,'alice','Alice'),second=make(bob,'bob','Bob');let reconnected:FirestoreDocument|undefined;
  async function until(check:()=>boolean){const end=Date.now()+7000;while(!check()){if(Date.now()>end)throw new Error('Collaboration timed out: '+failures.join('; '));await new Promise(resolve=>setTimeout(resolve,25));}}
  try {
    await until(()=>first.document.getText('plan').length>0&&second.document.getText('plan').length>0);
    first.document.getText('plan').insert(0,'Alice introduction.\n');
    second.document.getText('plan').insert(second.document.getText('plan').length,'Bob conclusion.\n');
    await Promise.all([first.flush(),second.flush()]);
    await until(()=>first.document.getText('plan').toString()===second.document.getText('plan').toString());
    assert.match(first.document.getText('plan').toString(),/Alice introduction/);assert.match(first.document.getText('plan').toString(),/Bob conclusion/);
    const position=Y.createRelativePositionFromTypeIndex(first.document.getText('plan'),5);
    first.awareness.setLocalStateField('cursor',{anchor:position,head:position});
    await until(()=>[...second.awareness.getStates().values()].some(state=>state.user?.name==='Alice'&&state.cursor));
    await second.destroy();reconnected=make(bob,'bob','Bob');
    await until(()=>reconnected!.document.getText('plan').toString()===first.document.getText('plan').toString());
    assert.deepEqual(failures,[]);
  } finally {await first.destroy();await reconnected?.destroy();if(!reconnected)await second.destroy();await env.clearFirestore();await env.cleanup();globalThis.window=previous;}
});
