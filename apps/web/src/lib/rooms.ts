import * as Y from 'yjs';
import {
  Bytes, collection, doc, serverTimestamp, writeBatch, addDoc, updateDoc,
  type Firestore, type Timestamp,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { makePlan, makeTasks } from '../../../../shared/plan.ts';
import type { TaskSpec } from '../../../../shared/types.ts';
import { ORGANIZATION_ID } from '../../../../shared/organization.ts';
import { queuePlanningReply } from './planning.ts';

export interface Room { id: string; title: string; ownerUid: string; orgId: string; createdAt: Timestamp | null }
export interface ChatMessage { id: string; authorUid: string; authorName: string; text: string; createdAt: Timestamp | null; agent?: 'codex'; replyStatus?: 'queued' | 'running' | 'completed' | 'failed'; replyError?: string }
export async function createRoom(db: Firestore, user: User, title: string) {
  if (!user.email || !user.emailVerified) throw new Error('Sign in with a verified email address.');
  const room = doc(collection(db, 'rooms'));
  const document = new Y.Doc();
  document.getText('plan').insert(0, makePlan(title));
  document.getArray<TaskSpec>('tasks').push(makeTasks(title));
  const batch = writeBatch(db);
  batch.set(room, { title, ownerUid: user.uid, orgId: ORGANIZATION_ID, createdAt: serverTimestamp() });
  batch.set(doc(db, 'rooms', room.id, 'updates', 'initial'), {
    bytes: Bytes.fromUint8Array(Y.encodeStateAsUpdate(document)),
    authorUid: user.uid, authorName: user.displayName?.slice(0, 100) || 'Teammate', createdAt: serverTimestamp(),
  });
  await batch.commit();
  document.destroy();
  return room.id;
}
export async function sendMessage(db: Firestore, roomId: string, user: User, text: string, plan = '', respond = true) {
  const message = doc(collection(db, 'rooms', roomId, 'messages'));
  const batch = writeBatch(db);
  batch.set(message, {
    authorUid: user.uid, authorName: user.displayName?.slice(0, 100) || 'Teammate',
    text: text.trim(), ...(respond ? {replyStatus:'queued'} : {}), createdAt: serverTimestamp(),
  });
  if(respond)queuePlanningReply(batch,db,roomId,message.id,user,plan);
  await batch.commit();
}
