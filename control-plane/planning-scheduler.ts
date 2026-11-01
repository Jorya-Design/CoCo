import { randomUUID } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { authorizeWorkerRun, type RunLease, type WorkerIdentity } from './worker-auth.ts';
import type { WorkerCommand } from '../shared/execution.ts';
import { planningPrompt, type PlanningJob } from '../shared/planning.ts';

const queue = 'organizations/coco-co/planningRequests';
const leaseMs = 90000;
type PlanningLease = RunLease & { kind?: 'planning' };
export class PlanningScheduler {
  private db = getFirestore();
  async handles(workerId: string) {
    return (await this.db.doc(`workerLeases/${workerId}`).get()).data()?.kind === 'planning';
  }
  async claim(identity: WorkerIdentity): Promise<Omit<PlanningJob,'inferenceToken'> | null> {
    const leaseRef = this.db.doc(`workerLeases/${identity.workerId}`);
    // Recover even when there are no queued requests. A completed model turn may
    // have lost its connection: fail visibly instead of generating another reply.
    const occupied = await this.db.runTransaction(async tx => {
      const lease = (await tx.get(leaseRef)).data() as PlanningLease | undefined;
      if (lease?.status !== 'active') return false;
      if (lease.kind !== 'planning' || lease.expiresAt > Date.now()) return true;
      tx.update(this.db.doc(`${queue}/${lease.runId}`),{status:'failed'});
      tx.update(this.db.doc(`rooms/${lease.roomId}/messages/${lease.runId}`),{
        replyStatus:'failed', replyError:'Codex disconnected before saving its reply. Send a new message to retry.',
      });
      tx.update(leaseRef,{status:'cancelled'});
      tx.delete(this.db.doc(`planningRoomLeases/${lease.roomId}`));
      return false;
    });
    if (occupied) return null;
    const candidates = await this.db.collection(queue).where('status','==','queued').orderBy('createdAt').limit(20).get();
    for (const candidate of candidates.docs) {
      const result = await this.db.runTransaction(async tx => {
        const request = (await tx.get(candidate.ref)).data();
        if (!request || request.status !== 'queued') return null;
        const roomRef = this.db.doc(`rooms/${request.roomId}`);
        const messageRef = roomRef.collection('messages').doc(candidate.id);
        const roomLeaseRef = this.db.doc(`planningRoomLeases/${request.roomId}`);
        const [org,room,message,workerLease,roomLease] = await Promise.all([
          tx.get(this.db.doc('organizations/coco-co')),tx.get(roomRef),tx.get(messageRef),tx.get(leaseRef),tx.get(roomLeaseRef),
        ]);
        if (workerLease.data()?.status === 'active' || roomLease.exists) return null;
        const source = message.data();
        if (room.data()?.orgId !== 'coco-co' || !org.data()?.memberEmails?.includes(request.requestedByEmail)
          || !source || source.agent || source.authorUid !== request.requestedBy || request.messageId !== candidate.id) {
          tx.update(candidate.ref,{status:'failed'});
          if (message.exists) tx.update(messageRef,{replyStatus:'failed',replyError:'Codex could not verify this member message.'});
          return null;
        }
        // Include prior Codex replies even when members send several messages quickly.
        const history = await tx.get(roomRef.collection('messages').orderBy('createdAt','desc').limit(30));
        const messages = history.docs.reverse().filter(doc=>doc.id===candidate.id || doc.data().agent==='codex'
          || doc.data().createdAt.toMillis() <= source.createdAt.toMillis()).map(doc=>({
            id:doc.id,authorName:String(doc.data().authorName).slice(0,100),
            text:String(doc.data().text).slice(0,doc.id===candidate.id ? 8000 : 2000),
            ...(doc.data().agent==='codex' ? {agent:'codex'} : {}),
          }));
        if (!messages.some(message=>message.id===candidate.id)) messages.push({id:candidate.id,authorName:source.authorName,text:source.text});
        const attemptId = randomUUID();
        const fence = (request.fence ?? 0) + 1;
        const lease: PlanningLease = {kind:'planning',roomId:request.roomId,runId:candidate.id,attemptId,fence,
          workerId:identity.workerId,status:'active',expiresAt:Date.now()+leaseMs};
        tx.set(leaseRef,lease); tx.set(roomLeaseRef,{workerId:identity.workerId,attemptId});
        tx.update(candidate.ref,{status:'running',fence});
        tx.update(messageRef,{replyStatus:'running'});
        return {kind:'planning' as const,roomId:request.roomId,runId:candidate.id,attemptId,fence,
          prompt:planningPrompt(request.plan,messages,candidate.id)};
      });
      if (result) return result;
    }
    return null;
  }
  async report(identity: WorkerIdentity, command: Exclude<WorkerCommand,{type:'worker/poll'}>) {
    return this.db.runTransaction(async tx => {
      const leaseRef = this.db.doc(`workerLeases/${identity.workerId}`);
      const lease = (await tx.get(leaseRef)).data() as PlanningLease | undefined;
      authorizeWorkerRun(identity,command,lease ?? null);
      if (lease?.kind !== 'planning') throw new Error('Planning lease required');
      const requestRef = this.db.doc(`${queue}/${command.runId}`);
      const messageRef = this.db.doc(`rooms/${command.roomId}/messages/${command.runId}`);
      const roomLeaseRef = this.db.doc(`planningRoomLeases/${command.roomId}`);
      const [request,org] = await Promise.all([tx.get(requestRef),tx.get(this.db.doc('organizations/coco-co'))]);
      if (request.data()?.status !== 'running' || !org.data()?.memberEmails?.includes(request.data()?.requestedByEmail)) {
        tx.update(leaseRef,{status:'cancelled'});tx.delete(roomLeaseRef);
        tx.update(requestRef,{status:'failed'});
        tx.update(messageRef,{replyStatus:'failed',replyError:'Membership changed before Codex could reply.'});
        return false;
      }
      if (command.type === 'worker/heartbeat') { tx.update(leaseRef,{expiresAt:Date.now()+leaseMs});return true; }
      if (command.type === 'worker/thread') { tx.update(requestRef,{threadId:command.threadId});return true; }
      const success = command.success && command.output.trim().length > 0;
      if (success) tx.create(this.db.doc(`rooms/${command.roomId}/messages/codex-${command.runId}`),{
        authorUid:'codex',authorName:'Codex',agent:'codex',text:command.output,
        inReplyTo:command.runId,createdAt:FieldValue.serverTimestamp(),
      });
      tx.update(messageRef,{replyStatus:success?'completed':'failed',...(!success ? {
        replyError:'Codex could not reply. Check model access, API billing, and worker health, then send a new message.',
      } : {})});
      tx.update(requestRef,{status:success?'completed':'failed'});
      tx.update(leaseRef,{status:'completed'});tx.delete(roomLeaseRef);
      return true;
    });
  }
}
