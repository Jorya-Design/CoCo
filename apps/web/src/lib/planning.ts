import { doc, serverTimestamp, type Firestore, type WriteBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';

export function queuePlanningReply(batch: WriteBatch, db: Firestore, roomId: string, messageId: string, user: User, plan: string) {
  if (!user.email || !user.emailVerified) throw new Error('Sign in with a verified email address.');
  batch.set(doc(db,'organizations','coco-co','planningRequests',messageId), {
    roomId, messageId, requestedBy:user.uid, requestedByEmail:user.email.toLowerCase(),
    plan:plan.slice(0,60000), status:'queued', createdAt:serverTimestamp(),
  });
}
