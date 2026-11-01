import { collection, doc, serverTimestamp, writeBatch, updateDoc, type Firestore, type Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { PlanMode } from '../../../../shared/plan-agent.ts';
import type { PlanEdit } from '../../../../shared/plan-edits.ts';
export interface PlanRequest {
  id:string;roomId:string;prompt:string;mode:PlanMode;status:string;reply?:string;error?:string;
  edits?:PlanEdit[];threadId?:string;createdAt:Timestamp|null;
}
export async function requestPlanAgent(db:Firestore,roomId:string,user:User,prompt:string,mode:PlanMode,agreedPlan?:string) {
  if(mode==='implementation'&&!agreedPlan?.trim())throw new Error('Agree on a shared plan before creating implementation tasks.');
  const ref=doc(collection(db,'organizations','coco-co','planRequests'));
  const batch=writeBatch(db);
  batch.set(ref,{roomId,requestedBy:user.uid,requestedByEmail:user.email!.toLowerCase(),prompt:prompt.trim(),mode,
    ...(mode==='implementation'?{agreedPlan}:{}),status:'queued',createdAt:serverTimestamp()});
  batch.set(doc(db,'rooms',roomId,'messages',ref.id),{authorUid:user.uid,authorName:user.displayName?.slice(0,100)||'Teammate',text:prompt.trim(),createdAt:serverTimestamp()});
  await batch.commit();
}
export async function decidePlanRequest(db:Firestore,user:User,id:string,status:'apply_requested'|'rejected'|'cancelled') {
  await updateDoc(doc(db,'organizations','coco-co','planRequests',id),{status,...(status==='cancelled'?{}:{decidedByEmail:user.email!.toLowerCase()})});
}
