import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import {
  Bytes, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc,
  type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';

export type SyncState = 'connecting' | 'saving' | 'saved' | 'offline' | 'error';

/** Append-only Yjs updates: Firestore is both the live transport and persistence. */
export class FirestoreDocument {
  readonly document = new Y.Doc();
  readonly awareness = new Awareness(this.document);
  private stopAwareness: Unsubscribe = () => {};
  private cursorTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private cursorDoc?: ReturnType<typeof doc>;
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
    private user: User | null,
    private canEdit: boolean,
    private onState: (state: SyncState, error?: string) => void,
    onRemote: (name: string) => void,
    onReady: () => void,
  ) {
    if (canEdit && user) {
      this.cursorDoc = doc(db,'rooms',roomId,'cursors',String(this.document.clientID));
      const color = user.uid.split('').reduce((sum,char)=>sum+char.charCodeAt(0),0)%2 ? '#9bbde0' : '#d4b693';
      this.awareness.setLocalStateField('user',{name:user.displayName||'Teammate',color,colorLight:color+'33'});
      this.awareness.on('update',this.onAwareness);
      this.heartbeat=setInterval(()=>this.publishAwareness(),15000);
      this.publishAwareness();
    } else this.awareness.setLocalState(null);
    this.stopAwareness=onSnapshot(collection(db,'rooms',roomId,'cursors'),snapshot=>{
      for(const change of snapshot.docChanges()) {
        if(change.doc.id===String(this.document.clientID))continue;
        const value=change.doc.data();
        if(change.type==='removed'||(value.seenAt?.toMillis()??0)<Date.now()-30000) {
          removeAwarenessStates(this.awareness,[Number(change.doc.id)],'remote');continue;
        }
        if(value.bytes instanceof Bytes)applyAwarenessUpdate(this.awareness,value.bytes.toUint8Array(),'remote');
      }
    },error=>this.onState('error',error.message));
    let initialized = false;
    this.unsubscribe = onSnapshot(collection(db, 'rooms', roomId, 'updates'), { includeMetadataChanges: true }, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type !== 'added') continue;
        const data = change.doc.data();
        Y.applyUpdate(this.document, (data.bytes as Bytes).toUint8Array(), 'remote');
        if (initialized && data.authorUid !== user?.uid) onRemote(data.authorName);
      }
      if (!initialized && !snapshot.empty) { initialized = true; onReady(); }
      if (!this.writing && !this.pending.length && !this.lastError) onState(snapshot.metadata.fromCache ? 'offline' : 'saved');
    }, error => { this.lastError = error.message; onState('error', error.message); });
    this.document.on('update', this.onUpdate);
    window.addEventListener('online', this.online);
  }
  private onAwareness = (_event: unknown, origin: unknown) => {
    if(origin==='remote'||this.disposed)return;
    clearTimeout(this.cursorTimer);
    this.cursorTimer=setTimeout(()=>this.publishAwareness(),100);
  };
  private publishAwareness() {
    if(!this.cursorDoc||!this.user||this.disposed)return;
    void setDoc(this.cursorDoc,{uid:this.user.uid,bytes:Bytes.fromUint8Array(encodeAwarenessUpdate(this.awareness,[this.document.clientID])),seenAt:serverTimestamp()}).catch(error=>this.onState('error',error.message));
  }
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote' || !this.canEdit || !this.user) return;
    this.pending.push(update);
    this.onState('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 300);
  };
  async flush() {
    clearTimeout(this.timer);
    if (!this.pending.length || !this.canEdit || !this.user) return;
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
    clearTimeout(this.cursorTimer);clearInterval(this.heartbeat);
    this.awareness.off('update',this.onAwareness);this.stopAwareness();this.awareness.destroy();
    const removeCursor=this.cursorDoc ? deleteDoc(this.cursorDoc).catch(()=>{}) : Promise.resolve();
    const flushed=this.flush();
    this.unsubscribe();
    window.removeEventListener('online', this.online);
    this.document.off('update', this.onUpdate);
    // Keep the document until any queued write settles. No edits happen after unmount.
    return Promise.all([removeCursor,flushed]).then(()=>{});
  }
}
