import { FieldValue, getFirestore } from 'firebase-admin/firestore';

/** Durable, restartable deletion. The tombstone fences readers and workers before cleanup. */
export class RoomDeletion {
  private db = getFirestore();
  private processing = false;
  async process() {
    if (this.processing) return;
    this.processing = true;
    try {
      const pending = await this.db.collection('organizations/coco-co/roomDeletionRequests').where('status','in',['queued','deleting']).limit(10).get();
      for (const request of pending.docs) {
        const roomId = request.id;
        const room = this.db.doc(`rooms/${roomId}`);
        const accepted = await this.db.runTransaction(async tx => {
          const [intent, organization, snapshot] = await Promise.all([tx.get(request.ref),tx.get(this.db.doc('organizations/coco-co')),tx.get(room)]);
          const data = intent.data();
          if (!data || !['queued','deleting'].includes(data.status)) return false;
          if (data.status === 'deleting') return true;
          if (snapshot.data()?.orgId !== 'coco-co' || !organization.data()?.memberEmails?.includes(data.requestedByEmail)) {
            tx.update(request.ref,{status:'failed',error:'Room unavailable or membership changed.'});return false;
          }
          tx.update(room,{deleting:true});
          tx.update(request.ref,{status:'deleting'});return true;
        });
        if (!accepted) continue;
        // Stop all queued and active work before removing its durable room data.
        const cleanup: FirebaseFirestore.DocumentReference[] = [];
        for (const name of ['executionRequests','planningRequests','planRequests']) {
          const requests = await this.db.collection(`organizations/coco-co/${name}`).where('roomId','==',roomId).get();
          for (const item of requests.docs) {
            await item.ref.update({status:'cancelled'});
            cleanup.push(item.ref);
            await this.db.doc(`planContexts/${item.id}`).delete();
          }
        }
        const leases = await this.db.collection('workerLeases').where('roomId','==',roomId).get();
        for (const lease of leases.docs) await lease.ref.update({status:'cancelled'});
        await this.db.doc(`planningRoomLeases/${roomId}`).delete();
        for (const ref of cleanup) await this.db.recursiveDelete(ref);
        await this.db.recursiveDelete(room);
        await request.ref.update({status:'completed',completedAt:FieldValue.serverTimestamp()});
      }
    } finally { this.processing = false; }
  }
}
