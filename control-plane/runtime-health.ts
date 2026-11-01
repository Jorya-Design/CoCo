import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export function createHealthPublisher(projectId: string, host: string) {
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app);
  const reference = db.doc('organizations/coco-co/runtime/worker-health');
  return {
    publish: (workers: string[], executionReady: boolean) => reference.set({
      host, workers, executionReady, updatedAt: FieldValue.serverTimestamp(),
    }),
    close: () => db.terminate(),
  };
}
