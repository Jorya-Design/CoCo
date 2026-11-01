import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

export async function connectFirebase() {
  const emulated = import.meta.env.VITE_USE_EMULATORS === 'true';
  const response = emulated ? null : await fetch('/__/firebase/init.json');
  if (response && !response.ok) throw new Error('Firebase configuration is unavailable. Use Firebase Hosting or start the local emulators.');
  const config: FirebaseOptions = emulated
    ? { apiKey: 'demo-coco-key', authDomain: 'localhost', projectId: 'demo-coco' }
    : await response!.json();
  if (!config.projectId || !config.apiKey) throw new Error('Register the CoCo web app in Firebase to finish setup.');
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (emulated) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { app, auth, db, emulated };
}
export type Firebase = Awaited<ReturnType<typeof connectFirebase>>;
