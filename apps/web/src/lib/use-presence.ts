import { useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { connectedMembers, type CollaboratorActivity, type PresenceSession } from '../../../../shared/presence.ts';

export function usePresence(db: Firestore, roomId: string, user: User | null, canEdit: boolean,
  view: string, taskId: string | null) {
  const [sessions,setSessions]=useState<PresenceSession[]>([]);
  const [connection,setConnection]=useState<'connecting'|'live'|'offline'|'error'>('connecting');
  const [now,setNow]=useState(Date.now());
  const [activity,setActivity]=useState<CollaboratorActivity>('viewing');
  const activityTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish=useRef<()=>void>(()=>{});
  const state=useRef({view,taskId,activity});state.current={view,taskId,activity};
  function interact(next: CollaboratorActivity) {
    clearTimeout(activityTimer.current);setActivity(next);
    if(next!=='viewing') activityTimer.current=setTimeout(()=>setActivity('viewing'),6000);
  }
  useEffect(()=>{interact('viewing');},[roomId,view]);
  useEffect(()=>{
    let disposed=false;
    setSessions([]);setConnection('connecting');
    const presenceDoc=canEdit&&user?doc(db,'rooms',roomId,'presence',crypto.randomUUID()):null;
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    // Throttle interaction writes; draft contents and keystrokes are never sent.
    const send=()=>{
      if(disposed||!presenceDoc||!user||!navigator.onLine)return;
      const current=state.current;
      void setDoc(presenceDoc,{uid:user.uid,name:user.displayName?.slice(0,100)||'Teammate',seenAt:serverTimestamp(),
        active:document.visibilityState==='visible',view:current.view==='control'?'control':'plan',
        activity:document.visibilityState==='visible'?current.activity:'viewing',
        taskId:current.view==='control'?current.taskId:null,
      }).catch(()=>{if(!disposed)setConnection('error');});
    };
    publish.current=()=>{clearTimeout(sendTimer);sendTimer=setTimeout(send,250);};
    const stop=onSnapshot(collection(db,'rooms',roomId,'presence'),{includeMetadataChanges:true},snapshot=>{
      setSessions(snapshot.docs.map(entry=>entry.data({serverTimestamps:'estimate'}) as PresenceSession));
      setConnection(snapshot.metadata.fromCache||!navigator.onLine?'offline':'live');
    },()=>setConnection('error'));
    const offline=()=>setConnection('offline');
    const online=()=>{setConnection('connecting');send();};
    const visibility=()=>{if(document.visibilityState!=='visible')setActivity('viewing');send();};
    window.addEventListener('offline',offline);window.addEventListener('online',online);
    document.addEventListener('visibilitychange',visibility);
    const heartbeat=setInterval(send,15000);
    const clock=setInterval(()=>setNow(Date.now()),2000);
    send();
    return ()=>{
      disposed=true;clearTimeout(sendTimer);clearTimeout(activityTimer.current);clearInterval(heartbeat);clearInterval(clock);stop();publish.current=()=>{};
      window.removeEventListener('offline',offline);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visibility);
      if(presenceDoc)void deleteDoc(presenceDoc).catch(()=>{});
    };
  },[db,roomId,user,canEdit]);
  useEffect(()=>{publish.current();},[view,taskId,activity]);
  return {people:connection==='live'?connectedMembers(sessions,now):[],connection,interact};
}
