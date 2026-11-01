import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile, type User } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, limitToLast, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import * as Y from 'yjs';
import { Background, Controls, Handle, Position, ReactFlow, type NodeProps, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronDown, CircleHelp, FileText, GitBranch, Hash, Layers3, LayoutDashboard, LoaderCircle, LogOut, MessageSquare, MoreHorizontal, Plus, Send, Sparkles, Terminal, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Firebase } from '@/lib/firebase';
import { createRoom, inviteMember, sendMessage, type ChatMessage, type Room } from '@/lib/rooms';
import { FirestoreDocument, type SyncState } from '@/lib/collaboration';
import { replaceText } from '../../../shared/crdt.ts';
import { interviewQuestions, validateDag } from '../../../shared/plan.ts';
import type { TaskSpec } from '../../../shared/types.ts';

const initials = (name: string) => name.split(/[ @]/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
const readable = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
function Brand() { return <div className="brand"><span className="brand-mark"><Layers3 size={18}/></span> CoCo <span className="eyebrow" style={{fontSize:8,marginLeft:5}}>workspace</span></div>; }

function SignIn({ firebase }: { firebase: Firebase }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(firebase.emulated ? 'teammate@example.com' : '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  async function login() {
    setBusy(true); setError('');
    try {
      if (creating) {
        const result = await createUserWithEmailAndPassword(firebase.auth, email.trim(), password);
        await updateProfile(result.user,{displayName:name.trim().slice(0,100)});
        await sendEmailVerification(result.user);
      } else await signInWithEmailAndPassword(firebase.auth, email.trim(), password);
    } catch (e) { setError(readable(e)); } finally { setBusy(false); }
  }
  return <main className="auth"><div className="auth-card"><Brand/><div className="eyebrow" style={{marginTop:45}}>A shared space to ship</div><h1>Think together.<br/>Build in parallel.</h1><p>Turn the conversation into a plan, then give every piece of work a clear path forward.</p>
    <form onSubmit={e=>{e.preventDefault();void login();}} className="space-y-3 mt-6">
      {firebase.emulated&&<Badge variant="secondary">Local Firebase emulators</Badge>}
      {creating&&<Input aria-label="Your name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" maxLength={100} required/>}
      <Input type="email" aria-label="Email address" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Your email address" required/>
      <Input type="password" aria-label="Password" autoComplete={creating?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" minLength={creating?10:undefined} required/>
      <Button className="w-full" type="submit" disabled={busy}>{busy?<LoaderCircle className="animate-spin" size={15}/>:<Users size={15}/>} {creating?'Create your account':'Sign in to CoCo'} <ArrowRight size={15}/></Button>
    </form>
    <div className="flex justify-between mt-4 text-[10px] text-muted-foreground"><button onClick={()=>{setCreating(!creating);setError('');setNotice('');}}>{creating?'Already have an account?':'Create an account'}</button>{!creating&&<button onClick={()=>{setError('');if(!email){setError('Enter your email address first.');return;}void sendPasswordResetEmail(firebase.auth,email.trim()).then(()=>setNotice('If this account exists, a password reset email is on its way.')).catch(e=>setError(readable(e)));}}>Forgot password?</button>}</div>
    {notice&&<p role="status" style={{fontSize:11}}>{notice}</p>}{error && <div className="alert" role="alert">{error}</div>}<p style={{fontSize:10,marginTop:22}}>Your rooms and documents are shared only with the teammates you invite.</p>
  </div></main>;
}

function VerifyEmail({firebase,user,onVerified}:{firebase:Firebase;user:User;onVerified:()=>void}) {
  const [notice,setNotice]=useState('Open the verification link in your email to join your team.');
  const [busy,setBusy]=useState(false);
  return <main className="auth"><div className="auth-card"><Brand/><h1>Check your inbox.</h1><p>Verify {user.email} to keep shared rooms private.</p><p role="status" style={{fontSize:12}}>{notice}</p><Button className="w-full" disabled={busy} onClick={()=>{setBusy(true);void user.reload().then(()=>user.getIdToken(true)).then(()=>{if(user.emailVerified)onVerified();else setNotice('The email has not been verified yet. Open the link, then try again.');}).catch(e=>setNotice(readable(e))).finally(()=>setBusy(false));}}>I’ve verified my email <ArrowRight size={14}/></Button><div className="flex justify-between mt-4 text-[11px] text-muted-foreground"><button onClick={()=>void sendEmailVerification(user).then(()=>setNotice('Verification email sent.')).catch(e=>setNotice(readable(e)))}>Resend email</button><button onClick={()=>void signOut(firebase.auth)}>Sign out</button></div></div></main>;
}

function TaskNode({ data }: NodeProps<Node<{ task: TaskSpec }>>) {
  return <div className="task-node"><Handle type="target" position={Position.Left}/><div className="eyebrow" style={{fontSize:8}}>{data.task.kind === 'reduce' ? 'Reduce · integrate' : 'Map · build'}</div><strong>{data.task.title}</strong><small>{data.task.dependencies.length ? 'Waits for ' + data.task.dependencies.length + ' inputs' : 'Ready when run starts'}</small><Handle type="source" position={Position.Right}/></div>;
}
const nodeTypes = { task: TaskNode };
const ExecutionGraph = memo(function ExecutionGraph({ tasks }: { tasks: TaskSpec[] }) {
  const depths = new Map<string, number>();
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    const task = tasks.find(t=>t.id===id)!;
    const value = task.dependencies.length ? Math.max(...task.dependencies.map(depth)) + 1 : 0;
    depths.set(id, value); return value;
  };
  try { validateDag(tasks); } catch (e) { return <div className="alert">{readable(e)}</div>; }
  const columns = new Map<number, number>();
  const nodes = tasks.map(task => {
    const x = depth(task.id), y = columns.get(x) || 0; columns.set(x, y + 1);
    return { id: task.id, type: 'task', data: { task }, position: { x: x*270, y: y*140 } };
  });
  const edges = tasks.flatMap(t=>t.dependencies.map(id=>({id:id+'-'+t.id,source:id,target:t.id,style:{stroke:'#b2a1cc'}})));
  return <div className="graph-wrap" aria-label="Execution dependency graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:.18}} nodesDraggable={false} nodesConnectable={false} minZoom={.2}><Background gap={20} color="#eee8f4"/><Controls showInteractive={false}/></ReactFlow></div>;
}, (previous, next) => JSON.stringify(previous.tasks) === JSON.stringify(next.tasks));

function RoomView({ firebase, user, room, view, onInvite }: { firebase: Firebase; user: User; room: Room; view: string; onInvite: ()=>void }) {
  const [provider, setProvider] = useState<FirestoreDocument | null>(null);
  const [plan, setPlan] = useState('');
  const [tasks, setTasks] = useState<TaskSpec[]>([]);
  const [sync, setSync] = useState<SyncState>('connecting');
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [interview, setInterview] = useState<number | null>(null);
  const [approval, setApproval] = useState<{ plan: string; tasks: TaskSpec[]; createdAt: {toDate:()=>Date} | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const editor = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const cursor = useRef<{start:Y.RelativePosition;end:Y.RelativePosition} | null>(null);

  useEffect(() => {
    let remoteTimer: ReturnType<typeof setTimeout>;
    const p = new FirestoreDocument(firebase.db, room.id, user, (state, detail) => { setSync(state); if (detail) setError(detail); },
      name=>{ setRemoteName(name); clearTimeout(remoteTimer); remoteTimer=setTimeout(()=>setRemoteName(''),1600); },
      ()=>setReady(true));
    const update = () => { setPlan(p.document.getText('plan').toString()); setTasks(p.document.getArray<TaskSpec>('tasks').toArray()); };
    const restoreSelection = () => {
      if (!cursor.current || document.activeElement !== editor.current) return;
      const start = Y.createAbsolutePositionFromRelativePosition(cursor.current.start, p.document);
      const end = Y.createAbsolutePositionFromRelativePosition(cursor.current.end, p.document);
      requestAnimationFrame(()=>editor.current?.setSelectionRange(start?.index || 0, end?.index || 0));
    };
    p.document.on('update', update);
    p.document.on('afterTransaction', restoreSelection);
    setProvider(p);
    const beforeUnload = (event: BeforeUnloadEvent) => { if (p.hasUnsavedChanges()) { event.preventDefault(); event.returnValue=''; } };
    window.addEventListener('beforeunload', beforeUnload);
    const stopChat = onSnapshot(query(collection(firebase.db,'rooms',room.id,'messages'),orderBy('createdAt'),limitToLast(100)),
      snapshot=>setMessages(snapshot.docs.map(d=>({id:d.id,...d.data()} as ChatMessage))),e=>setError(e.message));
    const stopApprovals = onSnapshot(query(collection(firebase.db,'rooms',room.id,'approvals'),orderBy('createdAt'),limitToLast(1)),
      snapshot=>setApproval(snapshot.empty ? null : snapshot.docs[0].data() as typeof approval),e=>setError(e.message));
    const presenceId = crypto.randomUUID();
    const presenceDoc = doc(firebase.db,'rooms',room.id,'presence',presenceId);
    const heartbeat = () => { void setDoc(presenceDoc,{uid:user.uid,name:user.displayName?.slice(0,100)||'Teammate',seenAt:serverTimestamp()}).catch(e=>setError(e.message)); };
    heartbeat();
    const timer = setInterval(heartbeat,20000);
    const stopPresence = onSnapshot(collection(firebase.db,'rooms',room.id,'presence'),snapshot=>{
      const current = snapshot.docs.filter(d=>(d.data().seenAt?.toMillis() || 0)>Date.now()-45000).map(d=>d.data().name as string);
      setPeople([...new Set(current)]);
    },e=>setError(e.message));
    return ()=>{ clearTimeout(remoteTimer); clearInterval(timer); stopChat(); stopApprovals(); stopPresence(); void deleteDoc(presenceDoc).catch(()=>{}); p.destroy(); window.removeEventListener('beforeunload',beforeUnload); };
  }, [firebase, room.id, user]);
  useEffect(()=>{chatEnd.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages]);

  function captureCursor() {
    if (!provider || !editor.current) return;
    const text = provider.document.getText('plan');
    cursor.current = { start: Y.createRelativePositionFromTypeIndex(text,editor.current.selectionStart), end: Y.createRelativePositionFromTypeIndex(text,editor.current.selectionEnd) };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy || !provider) return;
    setBusy(true); setError('');
    try {
      await sendMessage(firebase.db,room.id,user,draft);
      if (interview !== null) {
        const text = provider.document.getText('plan');
        text.insert(text.length,'\n## ' + interviewQuestions[interview].title + '\n' + draft.trim() + '\n');
        setInterview(interview < interviewQuestions.length-1 ? interview+1 : null);
      }
      setDraft('');
    } catch(e) { setError(readable(e)); } finally { setBusy(false); }
  }
  async function approve() {
    if (!provider) return;
    setBusy(true); setError('');
    try {
      validateDag(tasks);
      await provider.flush();
      if (provider.hasUnsavedChanges()) throw new Error('Save the latest edits before approving.');
      await addDoc(collection(firebase.db,'rooms',room.id,'approvals'),{approvedBy:user.uid,plan,tasks,status:'approved',createdAt:serverTimestamp()});
    } catch(e) { setError(readable(e)); } finally { setBusy(false); }
  }
  const unchanged = approval?.plan === plan && JSON.stringify(approval?.tasks) === JSON.stringify(tasks);
  const statusLabel = {connecting:'Connecting',saving:'Saving changes',saved:'All changes saved',offline:'Offline · reconnecting',error:'Changes need attention'}[sync];
  const syncDetail = <span role="status"><span className="dot" style={{background:sync==='saved'?'#65a18a':'#c7a16a'}}/>{statusLabel}</span>;
  return <>
    {view === 'plan' ? <div className="room-grid">
      <section className="chat-panel">
        <div className="panel-heading"><h2><MessageSquare size={14}/> Conversation</h2><span className="eyebrow" style={{fontSize:8}}>{people.length} here</span></div>
        <div className="chat-scroll"><div className="welcome-note"><strong><Sparkles size={13} className="inline mr-1"/> A good build starts with a conversation.</strong>Talk through the idea here. Shape the plan together, and use the interview to work through the details.<div className="mt-3"><Button variant="outline" size="sm" onClick={()=>setInterview(0)} disabled={!ready}><CircleHelp size={12}/> Grill me</Button></div></div>
        {messages.map(message=><article className="message" key={message.id}><span className="avatar">{initials(message.authorName)}</span><div><header><strong>{message.authorName}</strong><time>{message.createdAt?.toDate().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) || 'Sending'}</time></header><p>{message.text}</p></div></article>)}<div ref={chatEnd}/></div>
        {interview !== null && <div className="question"><div className="flex justify-between items-center"><span className="eyebrow">Guided interview · {interview+1} / 4</span><button aria-label="Close interview" onClick={()=>setInterview(null)}><X size={13}/></button></div><strong>{interviewQuestions[interview].title}</strong><p>{interviewQuestions[interview].question}</p><div className="hint">Your answer will be added to the shared plan. Live Codex follow-up questions are a future milestone.</div></div>}
        <form className="composer" onSubmit={event=>void submit(event)}><textarea aria-label="Message the room" placeholder={interview===null?'Share a thought with your team…':'Answer the interview question…'} value={draft} onChange={e=>setDraft(e.target.value)} maxLength={8000} rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit(e);}}}/><div className="composer-footer"><span><Hash size={10} className="inline mr-1"/> {interview===null?'Shared with everyone in this room':'Added to the plan'}</span><Button type="submit" size="icon" className="h-7 w-7" disabled={busy||!draft.trim()||!ready} aria-label="Send message"><Send size={12}/></Button></div></form>
      </section>
      <section className="plan-panel"><div className="panel-heading"><h2><FileText size={14}/> Shared plan</h2><Badge variant="secondary" className="text-[9px] font-normal">{unchanged?'Approved snapshot':'Working draft'}</Badge></div>
        <div className={'paper '+(remoteName?'remote-edit':'')}><div className="paper-toolbar"><span><FileText size={11} className="inline mr-1"/> plan.md</span>{remoteName?<span style={{color:'#8b62b1'}}>{remoteName} is editing</span>:syncDetail}</div><textarea ref={editor} aria-label="Shared plan" className="plan-editor" value={plan} disabled={!ready} maxLength={120000} spellCheck={false} onSelect={captureCursor} onChange={e=>{if(provider){cursor.current=null;replaceText(provider.document.getText('plan'),e.target.value);captureCursor();}}}/><div className="plan-footer"><span><Users size={10} className="inline mr-1"/> {room.memberEmails.length} teammate{room.memberEmails.length===1?'':'s'} · Yjs + Firestore</span><span>{plan.trim().split(/\s+/).filter(Boolean).length} words</span></div></div>
        <p className="hint"><CheckCheck size={11} className="inline mr-1"/> Everyone edits the same document. Approving saves a fixed copy for execution.</p>
      </section>
    </div> : <section className="control"><div className="flex justify-between gap-4 items-start"><div><div className="eyebrow mb-2">From plan to parallel work</div><h1>Execution control plane</h1><p>Review the task dependencies and approve a snapshot for the Linux workers.</p></div><Button variant="outline" size="sm" onClick={onInvite}><Users size={13}/> Invite</Button></div>
      <div className="status-row"><div className="status-card"><span>PLAN REVISION</span><strong>{unchanged?'Approved':approval?'Draft has changed':'Working draft'}</strong></div><div className="status-card"><span>TASKS IN THE DAG</span><strong>{tasks.length} tasks</strong></div><div className="status-card"><span>LINUX WORKERS</span><strong className="flex gap-2 items-center"><Terminal size={15}/> Not connected</strong></div></div>
      <ExecutionGraph tasks={tasks}/><div className="flex justify-between gap-4 items-center mt-5"><p>Map tasks produce commits. Reduce tasks combine and verify their dependencies.<br/>The worker service will consume approved snapshots in the next milestone.</p><Button onClick={()=>void approve()} disabled={!ready||busy||sync!=='saved'||unchanged}><Check size={14}/>{unchanged?'Snapshot approved':'Approve plan'}</Button></div>
      {approval && <p><CheckCheck size={12} className="inline mr-1"/> Latest approval: {approval.createdAt?.toDate().toLocaleString() || 'saving'} · awaiting worker connection</p>}
    </section>}
    {error && <div className="alert mx-6" role="alert">{error} {sync==='error'&&<Button size="sm" variant="outline" onClick={()=>{setError('');void provider?.flush();}}>Retry saving</Button>}</div>}
  </>;
}

export function App({ firebase }: { firebase: Firebase }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [rooms,setRooms] = useState<Room[]>([]);
  const [roomId,setRoomId] = useState(new URLSearchParams(location.search).get('room'));
  const [view,setView] = useState('plan');
  const [dialog,setDialog] = useState<'create'|'invite'|null>(null);
  const [value,setValue] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [,setVerificationTick]=useState(0);
  useEffect(()=>onAuthStateChanged(firebase.auth,setUser),[firebase]);
  useEffect(()=>{
    if (!user?.email || !user.emailVerified) { setRooms([]); return; }
    setError('');
    return onSnapshot(query(collection(firebase.db,'rooms'),where('memberEmails','array-contains',user.email)),snapshot=>{
      setRooms(snapshot.docs.map(d=>({id:d.id,...d.data()} as Room)).sort((a,b)=>(b.createdAt?.toMillis()||0)-(a.createdAt?.toMillis()||0)));
    },e=>setError(e.message));
  },[firebase,user,user?.emailVerified]);
  useEffect(()=>{ const pop=()=>setRoomId(new URLSearchParams(location.search).get('room'));window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop); },[]);
  const room=rooms.find(r=>r.id===roomId);
  function navigate(id:string) { history.pushState(null,'','/?room='+id);setRoomId(id);setView('plan'); }
  function openDialog(type:'create'|'invite') { setValue('');setError('');setDialog(type); }
  async function submitDialog(event:FormEvent) {
    event.preventDefault();if(!user||!value.trim())return;
    setBusy(true);setError('');
    try {
      if(dialog==='create') navigate(await createRoom(firebase.db,user,value.trim().slice(0,120)));
      else if(room) await inviteMember(firebase.db,room.id,value);
      setDialog(null);
    } catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  if(user===undefined) return <main className="auth"><div className="loading"><Brand/></div></main>;
  if(!user) return <SignIn firebase={firebase}/>;
  if(!user.emailVerified) return <VerifyEmail firebase={firebase} user={user} onVerified={()=>setVerificationTick(n=>n+1)}/>;
  return <div className="app"><aside className="sidebar"><Brand/><Button variant="outline" size="sm" className="justify-start bg-white/70 text-xs" onClick={()=>openDialog('create')}><Plus size={13}/> New room <span className="ml-auto text-[10px] text-muted-foreground">↵</span></Button><div><div className="eyebrow">Your rooms <span className="float-right">{rooms.length}</span></div><nav className="room-list" aria-label="Planning rooms">{rooms.map(r=><button className={'room-link '+(r.id===roomId?'active':'')} key={r.id} onClick={()=>navigate(r.id)}><MessageSquare size={13}/><span className="truncate">{r.title}</span></button>)}{!rooms.length&&<p className="hint">Create your first shared workspace.</p>}</nav></div><div className="mt-2"><div className="eyebrow">Workspace</div><div className="room-link mt-2"><GitBranch size={13}/> Jorya-Design / CoCo</div><a className="room-link" href="https://github.com/Jorya-Design/CoCo" target="_blank" rel="noreferrer"><ArrowDownToLine size={13}/> Source & documentation</a></div><div className="sidebar-bottom"><div className="person"><span className="avatar">{initials(user.displayName||user.email||'You')}</span><div className="min-w-0"><strong className="font-medium block truncate">{user.displayName||'Teammate'}</strong><span className="text-[9px] text-muted-foreground">Personal workspace</span></div><button className="ml-auto" aria-label="Sign out" onClick={()=>void signOut(firebase.auth)}><LogOut size={13}/></button></div></div></aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{room?.title||'Your next great build'}</strong><ChevronDown size={11}/></div><div className="actions">{room&&<><div className="avatars flex -space-x-1">{room.memberEmails.slice(0,3).map(email=><span className="avatar border-2 border-white" title={email} key={email}>{initials(email)}</span>)}</div><Button variant="outline" size="sm" disabled={room.ownerUid!==user.uid} onClick={()=>openDialog('invite')}><Users size={12}/> Invite</Button></>}<span className="text-muted-foreground"><MoreHorizontal size={17}/></span></div></header>
    {room?<><nav className="view-tabs" aria-label="Room views"><button className={'view-tab '+(view==='plan'?'selected':'')} onClick={()=>setView('plan')}><FileText size={13}/> Plan & conversation</button><button className={'view-tab '+(view==='control'?'selected':'')} onClick={()=>setView('control')}><LayoutDashboard size={13}/> Control plane <Badge variant="secondary" className="text-[8px] px-1.5 py-0">DAG</Badge></button></nav><RoomView key={room.id} firebase={firebase} user={user} room={room} view={view} onInvite={()=>openDialog('invite')}/></>:<main className="empty"><div className="eyebrow">Good ideas deserve good company</div><h1>A little less coordination.<br/>A lot more creating.</h1><p>A shared room for the conversation, a living plan for the details, and a clear path from idea to implementation.</p><div className="empty-grid"><div className="empty-card"><MessageSquare size={22}/><strong>Start with a conversation</strong><span className="text-muted-foreground">Bring your team into one room and work through the real questions.</span></div><div className="empty-card"><FileText size={22}/><strong>Shape the plan together</strong><span className="text-muted-foreground">Edit one shared document with live, conflict-free updates.</span></div><div className="empty-card"><GitBranch size={22}/><strong>Give the work a path</strong><span className="text-muted-foreground">Review a dependency graph and freeze the plan for execution.</span></div></div><Button onClick={()=>openDialog('create')}><Plus size={14}/> Create a planning room <ArrowRight size={14}/></Button>{roomId&&<p className="hint">This room is loading or has not been shared with your email address.</p>}</main>}
    {error&&!dialog&&<div className="alert mx-6" role="alert">{error}</div>}</div>
    <Dialog open={dialog!==null} onOpenChange={open=>{if(!open)setDialog(null);}}><DialogContent><DialogHeader><DialogTitle>{dialog==='create'?'What are we building?':'Bring a teammate in'}</DialogTitle><DialogDescription>{dialog==='create'?'Give this room a name. You can work out the details together.':'Add their verified email address. They will see this room when they sign in. No email is sent.'}</DialogDescription></DialogHeader><form onSubmit={e=>void submitDialog(e)} className="space-y-4"><Input autoFocus aria-label={dialog==='create'?'Room name':'Teammate email'} placeholder={dialog==='create'?'e.g. Multiplayer Codex harness':'teammate@company.com'} type={dialog==='create'?'text':'email'} maxLength={dialog==='create'?120:254} required value={value} onChange={e=>setValue(e.target.value)}/>{error&&<div role="alert" className="alert">{error}</div>}<Button type="submit" disabled={busy||!value.trim()} className="w-full">{busy?<LoaderCircle size={14} className="animate-spin"/>:<Plus size={14}/>} {dialog==='create'?'Create room':'Share room'}</Button></form></DialogContent></Dialog>
  </div>;
}
