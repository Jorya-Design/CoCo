export type CollaboratorActivity = 'viewing' | 'typing' | 'editing';
export interface PresenceSession {
  uid: string; name: string; seenAt: {toMillis():number} | null;
  view?: 'plan' | 'control'; activity?: CollaboratorActivity;
  active?: boolean; taskId?: string | null;
}
export function connectedMembers(sessions: PresenceSession[], now = Date.now()) {
  const users = new Map<string, PresenceSession>();
  for (const session of sessions) {
    const time=session.seenAt?.toMillis() ?? 0;
    if(time <= now-45000 || time > now+10000) continue;
    const current=users.get(session.uid);
    // Prefer an active tab, then the most recently acknowledged session.
    if(!current || (session.active!==false && current.active===false)
      || ((session.active!==false)===(current.active!==false) && time>(current.seenAt?.toMillis()??0))) users.set(session.uid,session);
  }
  return [...users.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.uid.localeCompare(b.uid));
}
export function activityLabel(session: PresenceSession, taskTitle?: string) {
  if(session.active===false) return 'Away';
  if(session.activity==='typing') return 'Typing a message';
  if(session.activity==='editing') return 'Editing the plan';
  if(session.view==='control' && session.taskId) return taskTitle ? `Viewing ${taskTitle}` : 'Viewing a task';
  return session.view==='control' ? 'Viewing implementation' : 'Viewing the plan';
}
