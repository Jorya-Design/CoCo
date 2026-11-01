import * as Y from 'yjs';
import {
  Bytes, collection, doc, onSnapshot, serverTimestamp, setDoc,
  type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';

export type SyncState = 'connecting' | 'saving' | 'saved' | 'offline' | 'error';

/** Append-only Yjs updates: Firestore is both the live transport and persistence. */
export class FirestoreDocument {
  readonly document = new Y.Doc();
  private pending: Uint8Array[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe: Unsubscribe;
  private writing = 0;
  private disposed = false;
  private lastError = '';
  private online = () => { void this.flush(); };
  constructor(
    private db: Firestore,
    private roomId: string,
    private user: User,
    private onState: (state: SyncState, error?: string) => void,
    onRemote: (name: string) => void,
    onReady: () => void,
  ) {
    let initialized = false;
    this.unsubscribe = onSnapshot(collection(db, 'rooms', roomId, 'updates'), { includeMetadataChanges: true }, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type !== 'added') continue;
        const data = change.doc.data();
        Y.applyUpdate(this.document, (data.bytes as Bytes).toUint8Array(), 'remote');
        if (initialized && data.authorUid !== user.uid) onRemote(data.authorName);
      }
      if (!initialized && !snapshot.empty) { initialized = true; onReady(); }
      if (!this.writing && !this.pending.length && !this.lastError) onState(snapshot.metadata.fromCache ? 'offline' : 'saved');
    }, error => { this.lastError = error.message; onState('error', error.message); });
    this.document.on('update', this.onUpdate);
    window.addEventListener('online', this.online);
  }
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    this.pending.push(update);
    this.onState('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 300);
  };
  async flush() {
    clearTimeout(this.timer);
    if (!this.pending.length) return;
    const updates = this.pending.splice(0);
    const bytes = Y.mergeUpdates(updates);
    this.writing++;
    try {
      await setDoc(doc(collection(this.db, 'rooms', this.roomId, 'updates')), {
        bytes: Bytes.fromUint8Array(bytes), authorUid: this.user.uid,
        authorName: this.user.displayName?.slice(0, 100) || 'Teammate', createdAt: serverTimestamp(),
      });
      this.lastError = '';
      if (!this.disposed) this.onState(this.writing === 1 && !this.pending.length ? 'saved' : 'saving');
    } catch (error) {
      this.pending.unshift(...updates);
      this.lastError = error instanceof Error ? error.message : 'Could not save changes';
      if (!this.disposed) this.onState('error', this.lastError);
    } finally { this.writing--; }
  }
  hasUnsavedChanges() { return this.pending.length > 0 || this.writing > 0; }
  destroy() {
    this.disposed = true;
    void this.flush();
    this.unsubscribe();
    window.removeEventListener('online', this.online);
    this.document.off('update', this.onUpdate);
    // Keep the document until any queued write settles. No edits happen after unmount.
  }
}
