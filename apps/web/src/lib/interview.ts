import { collection, doc, serverTimestamp, writeBatch, type Firestore, type Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { InterviewAnswer, InterviewPrompt } from '../../../../shared/interview.ts';

export interface SavedInterviewAnswer extends InterviewAnswer { createdAt: Timestamp | null }

export async function sendInterviewAnswer(db: Firestore, roomId: string, user: User, prompt: InterviewPrompt, answer: string) {
  const text = answer.trim();
  if (!text || text.length > 8000) throw new Error('Use between 1 and 8,000 characters for an answer.');
  const entry = doc(collection(db, 'rooms', roomId, 'interviews'));
  const attribution = { authorUid: user.uid, authorName: user.displayName?.slice(0, 100) || 'Teammate', createdAt: serverTimestamp() };
  const batch = writeBatch(db);
  batch.set(entry, { ...attribution, questionIndex: prompt.index, title: prompt.title, question: prompt.question, answer: text });
  // The room message and transcript entry either both save or neither saves.
  batch.set(doc(db, 'rooms', roomId, 'messages', entry.id), { ...attribution, text });
  await batch.commit();
}
