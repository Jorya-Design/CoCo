import { randomUUID } from 'node:crypto';
import { getFirestore, FieldValue, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import * as Y from 'yjs';
import { anchorReply, planModeSchema } from '../shared/plan-agent.ts';
import { applyPlanEdits, type PlanEdit } from '../shared/plan-edits.ts';
import { planWithInterview, type InterviewAnswer } from '../shared/interview.ts';
import { parseImplementationReply } from '../shared/implementation-plan.ts';
import type { ExecutionJob, WorkerCommand } from '../shared/execution.ts';
import { authorizeWorkerRun, type RunLease, type WorkerIdentity } from './worker-auth.ts';

const path='organizations/coco-co/planRequests';
const stamp=()=>FieldValue.serverTimestamp();
const validId=(id:unknown):id is string=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
function documentFromUpdates(updates:FirebaseFirestore.QuerySnapshot) {
  const document=new Y.Doc();
  for(const update of updates.docs)Y.applyUpdate(document,new Uint8Array(update.data().bytes));
  return document;
}
/** Firestore intent adapter; the machine protocol stays the same as coding jobs. */
export class PlanAgent {
  private db=getFirestore();
  private deciding=false;
  constructor(private baseSha:string) {}
  async owns(workerId:string) {return (await this.db.doc(`workerLeases/${workerId}`).get()).data()?.kind==='plan';}
  private async apply(tx:Transaction, ref:DocumentReference, roomId:string, edits:PlanEdit[]) {
    const updates=await tx.get(this.db.collection(`rooms/${roomId}/updates`));
    const document=documentFromUpdates(updates);
    try {
      const vector=Y.encodeStateVector(document);
      if(!applyPlanEdits(document,edits)) {tx.update(ref,{status:'conflict',error:'The plan changed in a proposed passage. Ask Codex to revise using the latest plan.'});return;}
      tx.create(this.db.collection(`rooms/${roomId}/updates`).doc(),{bytes:Buffer.from(Y.encodeStateAsUpdate(document,vector)),
        authorUid:'codex',authorName:'Codex',createdAt:stamp()});
      tx.update(ref,{status:'applied',appliedAt:stamp()});
    } finally {document.destroy();}
  }
  async processDecisions() {
    if(this.deciding)return;
    this.deciding=true;
    try {
      const pending=await this.db.collection(path).where('status','==','apply_requested').limit(10).get();
      for(const candidate of pending.docs)await this.db.runTransaction(async tx=>{
        const [snap,org]=await Promise.all([tx.get(candidate.ref),tx.get(this.db.doc('organizations/coco-co'))]);
        const request=snap.data();
        if(request?.status!=='apply_requested')return;
        if(!org.data()?.memberEmails?.includes(request.decidedByEmail)) {tx.update(candidate.ref,{status:'failed',error:'Membership changed.'});return;}
        await this.apply(tx,candidate.ref,request.roomId,request.edits);
      });
    } finally {this.deciding=false;}
  }
  async claim(identity:WorkerIdentity):Promise<Omit<ExecutionJob,'inferenceToken'>|null> {
    const leaseRef=this.db.doc(`workerLeases/${identity.workerId}`);
    // Resolve expired planning jobs before the coding scheduler inspects the shared lease.
    const previous=(await leaseRef.get()).data();
    if(previous?.kind==='plan' && previous.status==='active' && previous.expiresAt<=Date.now()) {
      await this.db.runTransaction(async tx=>{
        const snap=await tx.get(leaseRef), lease=snap.data();
        if(lease?.kind!=='plan'||lease.status!=='active'||lease.expiresAt>Date.now())return;
        tx.update(this.db.doc(`${path}/${lease.runId}`),{status:'failed',error:'Worker disconnected. Send a new request to retry.'});
        tx.update(leaseRef,{status:'cancelled'});
        tx.delete(this.db.doc(`planContexts/${lease.runId}`));
      });
    }
    const pending=await this.db.collection(path).where('status','==','queued').limit(20).get();
    for(const candidate of pending.docs) {
      const job=await this.db.runTransaction(async tx=>{
        const [snap,leaseSnap,org]=await Promise.all([tx.get(candidate.ref),tx.get(leaseRef),tx.get(this.db.doc('organizations/coco-co'))]);
        const request=snap.data(),lease=leaseSnap.data();
        if(request?.status!=='queued'||lease?.status==='active')return null;
        if(!validId(request.roomId)) {tx.update(candidate.ref,{status:'failed',error:'Invalid room.'});return null;}
        const roomRef=this.db.doc(`rooms/${request.roomId}`);
        const [room,updates,messages,history]=await Promise.all([tx.get(roomRef),tx.get(roomRef.collection('updates')),
          tx.get(roomRef.collection('messages').orderBy('createdAt','desc').limit(30)),
          tx.get(request.mode==='implementation' ? roomRef.collection('interviews').orderBy('createdAt') : roomRef.collection('interviews').orderBy('createdAt','desc').limit(100))]);
        const mode=planModeSchema.safeParse(request.mode);
        if(room.data()?.orgId!=='coco-co'||!org.data()?.memberEmails?.includes(request.requestedByEmail)||!mode.success
          ||typeof request.prompt!=='string'||!request.prompt.trim()||request.prompt.length>8000) {
          tx.update(candidate.ref,{status:'failed',error:'Request is no longer authorized.'});return null;
        }
        const document=documentFromUpdates(updates);
        try {
          const plan=document.getText('plan').toString();
          if(plan.length>120000) {tx.update(candidate.ref,{status:'failed',error:'Plan exceeds the 120,000 character AI editing limit.'});return null;}
          const agreedPlan=request.mode==='implementation'
            ? planWithInterview(plan,history.docs.map(d=>({id:d.id,...d.data()} as InterviewAnswer))) : plan;
          if(request.mode==='implementation' && (typeof request.agreedPlan!=='string' || !plan.trim() || agreedPlan.length>200000 || agreedPlan!==request.agreedPlan)) {
            tx.update(candidate.ref,{status:'conflict',error:'The shared plan or interview changed. Agree on the latest plan and create the implementation plan again.'});return null;
          }
          const bytes=Buffer.from(Y.encodeStateAsUpdate(document));
          if(bytes.length>700000) {tx.update(candidate.ref,{status:'failed',error:'The document history is too large for an AI editing snapshot.'});return null;}
          const attemptId=randomUUID(), fence=1;
          const key={roomId:request.roomId,runId:candidate.id,attemptId,fence};
          tx.create(this.db.doc(`planContexts/${candidate.id}`),{bytes});
          tx.set(leaseRef,{...key,workerId:identity.workerId,kind:'plan',status:'active',expiresAt:Date.now()+90000});
          tx.update(candidate.ref,{status:'running',startedAt:stamp(),workerId:identity.workerId,attemptId,fence});
          return {...key,task:{id:'plan-chat',title:request.mode==='implementation'?'Create implementation plan':'Collaborate on the shared plan',description:request.prompt,kind:'map' as const,dependencies:[]},
            plan:agreedPlan,baseSha:this.baseSha,dependencyCommits:[],planning:{mode:mode.data,prompt:request.prompt,
              conversation:messages.docs.reverse().map(d=>`${d.data().authorName}: ${d.data().text}`).join('\n').slice(-50000),
              interview:request.mode==='implementation'?'':history.docs.reverse().map(d=>`${d.data().question}\n${d.data().authorName}: ${d.data().answer}`).join('\n').slice(-70000)}};
        } finally {document.destroy();}
      });
      if(job)return job;
    }
    return null;
  }
  async report(identity:WorkerIdentity, command:Exclude<WorkerCommand,{type:'worker/poll'}>) {
    return this.db.runTransaction(async tx=>{
      const leaseRef=this.db.doc(`workerLeases/${identity.workerId}`);
      const lease=(await tx.get(leaseRef)).data() as RunLease & {kind?:string}|undefined;
      authorizeWorkerRun(identity,command,lease??null);
      if(lease?.kind!=='plan')throw new Error('Wrong lease kind');
      const ref=this.db.doc(`${path}/${command.runId}`);
      const [snap,org,context]=await Promise.all([tx.get(ref),tx.get(this.db.doc('organizations/coco-co')),tx.get(this.db.doc(`planContexts/${command.runId}`))]);
      const request=snap.data();
      if(request?.status!=='running'||!org.data()?.memberEmails?.includes(request.requestedByEmail)) {
        tx.update(leaseRef,{status:'cancelled'});
        if(request?.status==='running')tx.update(ref,{status:'failed',error:'Membership changed.'});
        tx.delete(context.ref);return false;
      }
      if(command.type==='worker/heartbeat'){tx.update(leaseRef,{expiresAt:Date.now()+90000});return true;}
      if(command.type==='worker/thread'){tx.update(ref,{threadId:command.threadId});return true;}
      if(!command.success) {
        tx.update(ref,{status:'failed',error:'Codex could not complete this request. Check worker model access and API billing, then retry.'});
      } else if(request.mode==='implementation') {
        let result:ReturnType<typeof parseImplementationReply>;
        try {result=parseImplementationReply(JSON.parse(command.output));}
        catch {
          tx.update(ref,{status:'failed',error:'Codex returned an invalid implementation task graph. Create the implementation plan again.'});
          tx.update(leaseRef,{status:'completed'});tx.delete(context.ref);return true;
        }
        // Publish only a subdivision of the exact plan the room agreed to, even if humans edit during generation.
        const roomRef=this.db.doc(`rooms/${request.roomId}`);
        const [updates,history]=await Promise.all([tx.get(roomRef.collection('updates')),tx.get(roomRef.collection('interviews').orderBy('createdAt'))]);
        const document=documentFromUpdates(updates);
        try {
          const latest=planWithInterview(document.getText('plan').toString(),history.docs.map(d=>({id:d.id,...d.data()} as InterviewAnswer)));
          if(latest!==request.agreedPlan)tx.update(ref,{status:'conflict',error:'The shared plan or interview changed while Codex was planning. Agree on the latest plan and generate again.'});
          else {
            tx.create(roomRef.collection('implementationPlans').doc(command.runId),{plan:request.agreedPlan,tasks:result.tasks,createdAt:stamp()});
            tx.update(ref,{status:'completed',reply:result.reply,completedAt:stamp()});
            tx.create(roomRef.collection('messages').doc(),{authorUid:'codex',authorName:'Codex',text:result.reply,createdAt:stamp()});
          }
        } finally {document.destroy();}
      } else {
        const document=new Y.Doc();
        try {
          Y.applyUpdate(document,new Uint8Array(context.data()!.bytes));
          let result:ReturnType<typeof anchorReply>;
          try {result=anchorReply(document,JSON.parse(command.output),request.mode);}
          catch {tx.update(ref,{status:'failed',error:'Codex returned an invalid or ambiguous edit. Ask for a smaller, specific change.'});tx.update(leaseRef,{status:'completed'});tx.delete(context.ref);return true;}
          // All reads required by apply happen before any writes in this transaction.
          if(result.edits.length && request.mode==='edit')await this.apply(tx,ref,request.roomId,result.edits);
          else tx.update(ref,{status:result.edits.length?'suggested':'completed'});
          tx.update(ref,{reply:result.reply,edits:result.edits,completedAt:stamp()});
          tx.create(this.db.collection(`rooms/${request.roomId}/messages`).doc(),{authorUid:'codex',authorName:'Codex',text:result.reply,createdAt:stamp()});
        } finally {document.destroy();}
      }
      tx.update(leaseRef,{status:'completed'});tx.delete(context.ref);return true;
    });
  }
}
