import assert from 'node:assert/strict';
import {after,beforeEach,test} from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {RoomDeletion} from '../control-plane/room-deletion.ts';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Room deletion tests require the emulator');
const app=initializeApp({projectId:'demo-coco-deletion'}),db=getFirestore(app),deletion=new RoomDeletion();
beforeEach(async()=>{
  for(const path of ['organizations','rooms','workerLeases','planContexts','planningRoomLeases'])await db.recursiveDelete(db.collection(path));
  await db.doc('organizations/coco-co').set({memberEmails:['alice@example.com']});
  await db.doc('rooms/demo').set({orgId:'coco-co',title:'Test'});
  await db.doc('rooms/real').set({orgId:'coco-co',title:'Real work'});
  for(const name of ['messages','interviews','updates','approvals','runs','implementationPlans'])await db.doc(`rooms/demo/${name}/saved`).set({text:'Saved data'});
  for(const name of ['planRequests','planningRequests','executionRequests'])await db.doc(`organizations/coco-co/${name}/job`).set({roomId:'demo',status:'running'});
  await db.doc('workerLeases/worker').set({roomId:'demo',status:'active'});
  await db.doc('planContexts/job').set({text:'Private context'});
  await db.doc('planningRoomLeases/demo').set({workerId:'worker'});
  await db.doc('organizations/coco-co/roomDeletionRequests/demo').set({status:'queued',requestedByEmail:'alice@example.com'});
});
after(async()=>{await db.terminate();await deleteApp(app);});
test('deleting a room cancels its worker, removes nested data and requests, and preserves other rooms',async()=>{
  await deletion.process();
  assert.equal((await db.doc('rooms/demo').get()).exists,false);
  for(const name of ['messages','interviews','updates','approvals','runs','implementationPlans'])assert.equal((await db.collection(`rooms/demo/${name}`).get()).empty,true);
  for(const name of ['planRequests','planningRequests','executionRequests'])assert.equal((await db.doc(`organizations/coco-co/${name}/job`).get()).exists,false);
  assert.equal((await db.doc('workerLeases/worker').get()).data()?.status,'cancelled');
  assert.equal((await db.doc('planContexts/job').get()).exists,false);
  assert.equal((await db.doc('planningRoomLeases/demo').get()).exists,false);
  assert.equal((await db.doc('rooms/real').get()).exists,true);
  assert.equal((await db.doc('organizations/coco-co/roomDeletionRequests/demo').get()).data()?.status,'completed');
});
test('revoked members cannot delete rooms',async()=>{
  await db.doc('organizations/coco-co').update({memberEmails:[]});await deletion.process();
  assert.equal((await db.doc('rooms/demo').get()).exists,true);
  assert.equal((await db.doc('organizations/coco-co/roomDeletionRequests/demo').get()).data()?.status,'failed');
});
test('cleanup resumes after a restart with the room already marked deleting',async()=>{
  await db.doc('rooms/demo').update({deleting:true});
  await db.doc('organizations/coco-co/roomDeletionRequests/demo').update({status:'deleting'});
  await deletion.process();assert.equal((await db.doc('rooms/demo').get()).exists,false);
});
