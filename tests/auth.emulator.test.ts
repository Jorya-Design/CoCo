import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, linkWithCredential, signInWithCredential, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ORGANIZATION_MEMBERS } from '../shared/organization.ts';

// Disposable demo project only. This suite resets local Auth/Firestore fixtures.
// Run serially with the rules suite; the Auth emulator maps API keys to its project.
const projectId='demo-coco';
let app: FirebaseApp, auth: Auth, db: Firestore, env: RulesTestEnvironment;
before(async()=>{
  const reset=await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`,{method:'DELETE'});
  assert.equal(reset.ok,true);
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
  await env.clearFirestore();
  app=initializeApp({projectId,apiKey:'demo-coco-key'},'google-auth-regression');
  auth=getAuth(app);
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  db=getFirestore(app);
  connectFirestoreEmulator(db,'127.0.0.1',8080);
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'organizations','coco-co'),{name:'CoCo Co',memberEmails:ORGANIZATION_MEMBERS});
    await setDoc(doc(context.firestore(),'rooms','auth-regression'),{title:'Auth regression',orgId:'coco-co'});
  });
});
after(async()=>{
  if(app)await deleteApp(app);
  if(env){await env.clearFirestore();await env.cleanup();}
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`,{method:'DELETE'});
});

const google=(email:string)=>GoogleAuthProvider.credential(JSON.stringify({sub:'emulator-'+email,email,email_verified:true,name:'Emulator member'}));
const message=(uid:string)=>({authorUid:uid,authorName:'Emulator member',text:'Auth regression',createdAt:serverTimestamp()});
async function verifiedPasswordAccount(email:string,password:string) {
  let user;
  try { user=(await createUserWithEmailAndPassword(auth,email,password)).user; }
  catch(error) {
    if((error as {code:string}).code!=='auth/email-already-in-use')throw error;
    user=(await signInWithEmailAndPassword(auth,email,password)).user;
  }
  const response=await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,{
    method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({localId:user.uid,emailVerified:true}),
  });
  assert.equal(response.ok,true);
  await user.reload();await user.getIdToken(true);
  return user;
}

test('both Google members retain their password-account UID, authored content, and editing access',async()=>{
  for(const [index,email] of ORGANIZATION_MEMBERS.entries()) {
    const legacy=await verifiedPasswordAccount(email,'emulator-auth-password');
    const uid=legacy.uid;
    const existing=doc(db,'rooms','auth-regression','messages','legacy-'+index);
    await setDoc(existing,message(uid));
    await signOut(auth);
    const result=await signInWithCredential(auth,google(email));
    assert.equal(result.user.uid,uid);
    assert.equal(result.user.emailVerified,true);
    const token=await result.user.getIdTokenResult(true);
    assert.equal(token.signInProvider,'google.com');
    assert.equal((await getDoc(existing)).data()?.authorUid,uid);
    await setDoc(doc(db,'rooms','auth-regression','messages','google-'+index),message(uid));
    await signOut(auth);
    assert.equal(auth.currentUser,null);
  }
});

test('explicit provider linking keeps the legacy UID for subsequent Google sign-in',async()=>{
  const email='legacy-link@example.test', password='emulator-link-password';
  const original=await verifiedPasswordAccount(email,password);
  const uid=original.uid;
  await signOut(auth);
  const credential=google(email);
  const existing=await signInWithEmailAndPassword(auth,email,password);
  const linked=await linkWithCredential(existing.user,credential);
  assert.equal(linked.user.uid,uid);
  assert.ok(linked.user.providerData.some(provider=>provider.providerId==='google.com'));
  await signOut(auth);
  assert.equal((await signInWithCredential(auth,credential)).user.uid,uid);
  await signOut(auth);
});

test('a verified Google outsider stays read-only and sign-out restores public browsing',async()=>{
  const result=await signInWithCredential(auth,google('outsider@gmail.com'));
  assert.equal(result.user.emailVerified,true);
  await getDoc(doc(db,'rooms','auth-regression'));
  await assert.rejects(setDoc(doc(db,'rooms','auth-regression','messages','outsider'),message(result.user.uid)),{code:'permission-denied'});
  await signOut(auth);
  assert.equal((await getDoc(doc(db,'rooms','auth-regression'))).exists(),true);
  await assert.rejects(setDoc(doc(db,'rooms','auth-regression','messages','guest'),message('guest')),{code:'permission-denied'});
});
