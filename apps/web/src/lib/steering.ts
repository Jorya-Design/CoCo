import { addDoc, collection, doc, serverTimestamp, updateDoc, type Firestore, type Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';

export interface SteeringNote {
  id: string;
  taskId: string;
  runId: string | null;
  text: string;
  timing: 'next' | 'now';
  status: 'queued' | 'applied' | 'cancelled' | 'rejected';
  authorUid: string;
  authorName: string;
  createdAt: Timestamp | null;
}

export async function queueSteering(db: Firestore, roomId: string, user: User, note: Pick<SteeringNote, 'taskId' | 'runId' | 'text' | 'timing'>) {
  const text = note.text.trim();
  if (!text || text.length > 4000) throw new Error('Use between 1 and 4,000 characters for an instruction.');
  await addDoc(collection(db, 'rooms', roomId, 'steering'), {
    ...note, text, status: 'queued', authorUid: user.uid,
    authorName: user.displayName?.slice(0, 100) || 'Teammate', createdAt: serverTimestamp(),
  });
}

export async function cancelSteering(db: Firestore, roomId: string, noteId: string) {
  await updateDoc(doc(db, 'rooms', roomId, 'steering', noteId), { status: 'cancelled' });
}
