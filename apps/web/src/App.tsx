import { CollaborativePlan } from '@/components/collaborative-plan';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createUserWithEmailAndPassword, GoogleAuthProvider, linkWithCredential, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type OAuthCredential, type User } from 'firebase/auth';
import type { FirebaseError } from 'firebase/app';
import { addDoc, collection, deleteDoc, doc, limitToLast, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { ArrowRight, Check, CheckCheck, CircleHelp, FileText, GitBranch, Hash, Layers3, LoaderCircle, LogOut, MessageSquare, Moon, Pencil, Plus, Send, Sparkles, Sun, Terminal, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Firebase } from '@/lib/firebase';
import { createRoom, sendMessage, type ChatMessage, type Room } from '@/lib/rooms';
import { FirestoreDocument, type SyncState } from '@/lib/collaboration';
import { ExecutionGraph } from '@/components/execution-graph';
import { TaskInspector } from '@/components/task-inspector';
import type { SteeringNote } from '@/lib/steering';
import { authErrorMessage, conflictingEmail } from '@/lib/auth';
import { Markdown } from '@/components/markdown';
import { InterviewHistory } from '@/components/interview-history';
import { sendInterviewAnswer, type SavedInterviewAnswer } from '@/lib/interview';
import { replaceText } from '../../../shared/crdt.ts';
import { validateDag } from '../../../shared/plan.ts';
import { getInterviewPrompt, nextInterviewIndex, planWithInterview, type InterviewPrompt } from '../../../shared/interview.ts';
import type { Run, TaskSpec } from '../../../shared/types.ts';
import { runtimeOnline, type RuntimeHealth } from '../../../shared/runtime.ts';
import { ORGANIZATION_ID, ORGANIZATION_NAME, ORGANIZATION_MEMBERS, type Organization } from '../../../shared/organization.ts';

const initials = (name: string) => name.split(/[ @]/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
const readable = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
function Brand() { return <div className="brand"><span className="brand-mark"><Layers3 size={18}/></span> CoCo <span className="eyebrow" style={{fontSize:8,marginLeft:5}}>workspace</span></div>; }

function SignIn({ firebase, onBusyChange, onAuthenticated }: { firebase: Firebase; onBusyChange: (busy: boolean) => void; onAuthenticated: (user: User) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(firebase.emulated ? 'suryansh@gmail.com' : '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [pendingGoogle, setPendingGoogle] = useState<{email: string; credential: OAuthCredential} | null>(null);
  function working(value: boolean) { setBusy(value); onBusyChange(value); }
  async function google() {
    if (busy) return;
    working(true); setError(''); setNotice(''); setPendingGoogle(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const result = await signInWithPopup(firebase.auth, provider);
      await result.user.getIdToken(true);
      onAuthenticated(result.user);
    } catch (error) {
      const existingEmail = conflictingEmail(error);
      const credential = existingEmail ? GoogleAuthProvider.credentialFromError(error as FirebaseError) : null;
      if (existingEmail && credential) {
        setPendingGoogle({ email: existingEmail, credential }); setEmail(existingEmail); setCreating(false);
        setNotice('Sign in with your existing CoCo password once to connect Google. Your account and shared work will stay together.');
      } else setError(authErrorMessage(error));
    } finally { working(false); }
  }
  async function login() {
    if (busy) return;
    working(true); setError('');
    try {
      if (creating) {
        const result = await createUserWithEmailAndPassword(firebase.auth, email.trim(), password);
        await updateProfile(result.user,{displayName:name.trim().slice(0,100)});
        await sendEmailVerification(result.user);
        onAuthenticated(result.user);
      } else {
        const result = await signInWithEmailAndPassword(firebase.auth, email.trim(), password);
        if (pendingGoogle) {
          if (result.user.email?.toLowerCase() !== pendingGoogle.email) throw new Error('Sign in to the same email address to connect Google.');
          await linkWithCredential(result.user, pendingGoogle.credential);
          await result.user.reload();
          await result.user.getIdToken(true);
          setPendingGoogle(null);
        }
        onAuthenticated(result.user);
      }
    } catch (e) { setError(authErrorMessage(e)); } finally { working(false); }
  }
  return <main className="auth"><div className="auth-card"><Brand/><div className="eyebrow" style={{marginTop:45}}>A shared space to ship</div><h1>Think together.<br/>Build in parallel.</h1><p>Turn the conversation into a plan, then give every piece of work a clear path forward.</p>
    <Button type="button" className="w-full mt-6 h-10" disabled={busy} onClick={()=>void google()}><svg aria-hidden="true" viewBox="0 0 48 48" className="size-4"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.2H24v8h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.7c3.9-3.6 6-8.9 6-15.2Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.6-5l-6.7-5.2c-1.9 1.3-4.2 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.7v5.3A20.5 20.5 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.4a12.3 12.3 0 0 1 0-7.8v-5.3H5.7a20.5 20.5 0 0 0 0 18.4l6.9-5.3Z"/><path fill="#EA4335" d="M24 11.2c3 0 5.7 1 7.8 3.1l5.8-5.8A19.6 19.6 0 0 0 24 3 20.5 20.5 0 0 0 5.7 14.3l6.9 5.3C14.2 14.8 18.7 11.2 24 11.2Z"/></svg> Continue with Google</Button>
    <div className="auth-divider"><span>or use a CoCo password</span></div>
    <form onSubmit={e=>{e.preventDefault();void login();}} className="space-y-3 mt-6">
      {firebase.emulated&&<Badge variant="secondary">Local Firebase emulators</Badge>}
      {creating&&<Input aria-label="Your name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" maxLength={100} required/>}
      <Input type="email" aria-label="Email address" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Your email address" readOnly={!!pendingGoogle} required/>
      <Input type="password" aria-label="CoCo password" autoComplete={creating?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Your CoCo password" minLength={creating?10:undefined} required/>
      <Button className="w-full" variant="outline" type="submit" disabled={busy}>{busy?<LoaderCircle className="animate-spin" size={15}/>:<Users size={15}/>} {pendingGoogle?'Sign in & connect Google':creating?'Create your account':'Sign in to CoCo'} <ArrowRight size={15}/></Button>
    </form>
    <div className="flex justify-between mt-4 text-[10px] text-muted-foreground"><button disabled={busy} onClick={()=>{setCreating(!creating);setPendingGoogle(null);setError('');setNotice('');}}>{pendingGoogle?'Use another account':creating?'Already have an account?':'Create an account'}</button>{!creating&&<button disabled={busy} onClick={()=>{setError('');if(!email){setError('Enter your email address first.');return;}void sendPasswordResetEmail(firebase.auth,email.trim()).then(()=>setNotice('If this account exists, a password reset email is on its way.')).catch(e=>setError(authErrorMessage(e)));}}>Forgot password?</button>}</div>
    {notice&&<p role="status" style={{fontSize:11}}>{notice}</p>}{error && <div className="alert" role="alert">{error}</div>}<p style={{fontSize:10,marginTop:22}}>CoCo Co is a public hackathon workspace. Its two members can edit after signing in; everyone can browse.</p>
  </div></main>;
}

function VerifyEmail({firebase,user,onVerified}:{firebase:Firebase;user:User;onVerified:()=>void}) {
  const [notice,setNotice]=useState('Open the verification link in your email to join your team.');
  const [busy,setBusy]=useState(false);
  return <main className="auth"><div className="auth-card"><Brand/><h1>Check your inbox.</h1><p>Verify {user.email} to enable member editing.</p><p role="status" style={{fontSize:12}}>{notice}</p><Button className="w-full" disabled={busy} onClick={()=>{setBusy(true);void user.reload().then(()=>user.getIdToken(true)).then(()=>{if(user.emailVerified)onVerified();else setNotice('The email has not been verified yet. Open the link, then try again.');}).catch(e=>setNotice(readable(e))).finally(()=>setBusy(false));}}>I’ve verified my email <ArrowRight size={14}/></Button><div className="flex justify-between mt-4 text-[11px] text-muted-foreground"><button onClick={()=>void sendEmailVerification(user).then(()=>setNotice('Verification email sent.')).catch(e=>setNotice(readable(e)))}>Resend email</button><button onClick={()=>void signOut(firebase.auth).catch(e=>setNotice(authErrorMessage(e)))}>Sign out</button></div></div></main>;
}

function RoomView({ firebase, user, canEdit, organization, room, view, onSignIn }: { firebase: Firebase; user: User | null; canEdit: boolean; organization: Organization; room: Room; view: string; onSignIn: ()=>void }) {
  const [provider, setProvider] = useState<FirestoreDocument | null>(null);
  const [plan, setPlan] = useState('');
  const [tasks, setTasks] = useState<TaskSpec[]>([]);
  const [sync, setSync] = useState<SyncState>('connecting');
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [interviewDraft, setInterviewDraft] = useState('');
  const [error, setError] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [interview, setInterview] = useState<InterviewPrompt | null>(null);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [history, setHistory] = useState<SavedInterviewAnswer[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [approval, setApproval] = useState<{ id: string; plan: string; tasks: TaskSpec[]; createdAt: {toDate:()=>Date} | null } | null>(null);
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [run, setRun] = useState<(Run & {error?:string}) | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [steering, setSteering] = useState<SteeringNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [clock, setClock] = useState(Date.now());
  const composer = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const historyRef = useRef<SavedInterviewAnswer[]>([]);
  const draft = interviewOpen ? interviewDraft : chatDraft;
  const setDraft = interviewOpen ? setInterviewDraft : setChatDraft;
  const snapshotPlan = useMemo(()=>planWithInterview(plan,history),[plan,history]);
  const wordCount = useMemo(()=>snapshotPlan.trim().split(/\s+/).filter(Boolean).length,[snapshotPlan]);

  useEffect(() => {
    const stop = onSnapshot(doc(firebase.db,'organizations','coco-co','runtime','worker-health'),
      snapshot => setHealth(snapshot.exists() ? snapshot.data() as RuntimeHealth : null),
      () => setHealth(null));
    const timer = setInterval(() => setClock(Date.now()), 10000);
    return () => { stop(); clearInterval(timer); };
  }, [firebase]);
  const workerCount = runtimeOnline(health, clock) ? health!.workers.length : 0;
  useEffect(() => {
    setRun(null);setPendingRun(null);
    return onSnapshot(query(collection(firebase.db,'rooms',room.id,'runs'),orderBy('createdAt'),limitToLast(1)),
      snapshot=>setRun(snapshot.empty ? null : {id:snapshot.docs[0].id,...snapshot.docs[0].data(),roomId:room.id,mode:snapshot.docs[0].data().mode??'live',createdAt:typeof snapshot.docs[0].data().createdAt==='number'?snapshot.docs[0].data().createdAt:(snapshot.docs[0].data().createdAt?.toMillis?.()??0),events:snapshot.docs[0].data().events??[]} as Run),e=>setError(e.message));
  },[firebase,room.id]);
  useEffect(() => {
    if(!pendingRun)return;
    return onSnapshot(doc(firebase.db,'organizations','coco-co','executionRequests',pendingRun),snapshot=>{
      const status=snapshot.data()?.status;
      if(status && status!=='queued')setPendingRun(null);
      if(status==='failed')setError('The execution request could not start. Check the approved plan and worker service.');
    },e=>setError(e.message));
  },[firebase,pendingRun]);

  useEffect(() => {
    setReady(false);
    setHistoryReady(false);
    let remoteTimer: ReturnType<typeof setTimeout>;
    const p = new FirestoreDocument(firebase.db, room.id, user, canEdit, (state, detail) => { setSync(state); if (detail) setError(detail); },
      name=>{ setRemoteName(name); clearTimeout(remoteTimer); remoteTimer=setTimeout(()=>setRemoteName(''),1600); },
      ()=>setReady(true));
    const update = () => { setPlan(p.document.getText('plan').toString()); setTasks(p.document.getArray<TaskSpec>('tasks').toArray()); };
    p.document.on('update', update);
    setProvider(p);
    const beforeUnload = (event: BeforeUnloadEvent) => { if (p.hasUnsavedChanges()) { event.preventDefault(); event.returnValue=''; } };
    window.addEventListener('beforeunload', beforeUnload);
    const stopChat = onSnapshot(query(collection(firebase.db,'rooms',room.id,'messages'),orderBy('createdAt'),limitToLast(100)),
      snapshot=>setMessages(snapshot.docs.map(d=>({id:d.id,...d.data()} as ChatMessage))),e=>setError(e.message));
    const stopApprovals = onSnapshot(query(collection(firebase.db,'rooms',room.id,'approvals'),orderBy('createdAt'),limitToLast(1)),
      snapshot=>setApproval(snapshot.empty ? null : {id:snapshot.docs[0].id,...snapshot.docs[0].data()} as typeof approval),e=>setError(e.message));
    const stopSteering = onSnapshot(collection(firebase.db,'rooms',room.id,'steering'), snapshot=>{
      setSteering(snapshot.docs.map(item=>({ ...item.data(), id:item.id } as SteeringNote)).sort((a,b)=>(a.createdAt?.toMillis() ?? Infinity)-(b.createdAt?.toMillis() ?? Infinity)));
    },e=>setError(e.message));
    const stopInterview = onSnapshot(query(collection(firebase.db,'rooms',room.id,'interviews'),orderBy('createdAt')), {includeMetadataChanges:true}, snapshot=>{
      const entries=snapshot.docs.map(item=>({...item.data(),id:item.id} as SavedInterviewAnswer));
      historyRef.current=entries;setHistory(entries);
      setHistoryReady(!snapshot.metadata.fromCache);setHistoryPending(snapshot.metadata.hasPendingWrites);
    },e=>{setHistoryReady(false);setError(e.message);});
    const presenceDoc = canEdit && user ? doc(firebase.db,'rooms',room.id,'presence',crypto.randomUUID()) : null;
    const heartbeat = () => { if(presenceDoc&&user)void setDoc(presenceDoc,{uid:user.uid,name:user.displayName?.slice(0,100)||'Teammate',seenAt:serverTimestamp()}).catch(e=>setError(e.message)); };
    if(presenceDoc)heartbeat();
    const timer = presenceDoc ? setInterval(heartbeat,20000) : undefined;
    const stopPresence = onSnapshot(collection(firebase.db,'rooms',room.id,'presence'),snapshot=>{
      const current = snapshot.docs.filter(d=>(d.data().seenAt?.toMillis() || 0)>Date.now()-45000).map(d=>d.data().name as string);
      setPeople([...new Set(current)]);
    },e=>setError(e.message));
    return ()=>{ clearTimeout(remoteTimer); clearInterval(timer); stopChat(); stopApprovals(); stopSteering(); stopInterview(); stopPresence(); if(presenceDoc)void deleteDoc(presenceDoc).catch(()=>{}); p.destroy(); window.removeEventListener('beforeunload',beforeUnload); };
  }, [firebase, room.id, user, canEdit]);
  useEffect(()=>{chatEnd.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages]);

  function startInterview() {
    if(!canEdit||!ready||!historyReady||busy)return;
    if(!interview)setInterview(getInterviewPrompt(nextInterviewIndex(historyRef.current),historyRef.current));
    setInterviewOpen(true);
    requestAnimationFrame(()=>composer.current?.focus());
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy || !provider || !user || !canEdit || !ready || (interviewOpen&&!historyReady)) return;
    setBusy(true); setError('');
    try {
      if (interviewOpen && interview) {
        await sendInterviewAnswer(firebase.db,room.id,user,interview,draft);
        setInterview(getInterviewPrompt(Math.max(interview.index+1,nextInterviewIndex(historyRef.current)),historyRef.current));
      } else await sendMessage(firebase.db,room.id,user,draft);
      setDraft('');
      requestAnimationFrame(()=>composer.current?.focus({preventScroll:true}));
    } catch(e) { setError(readable(e)); } finally { setBusy(false); }
  }
  async function approve() {
    if (!provider || !user || !canEdit || !historyReady || historyPending) return;
    setBusy(true); setError('');
    try {
      validateDag(tasks);
      if(snapshotPlan.length>200000)throw new Error('The plan and interview history exceed the 200,000-character approval limit. Your full history is still saved.');
      await provider.flush();
      if (provider.hasUnsavedChanges()) throw new Error('Save the latest edits before approving.');
      await addDoc(collection(firebase.db,'rooms',room.id,'approvals'),{approvedBy:user.uid,plan:snapshotPlan,tasks,status:'approved',createdAt:serverTimestamp()});
    } catch(e) { setError(readable(e)); } finally { setBusy(false); }
  }
  const unchanged = approval?.plan === snapshotPlan && JSON.stringify(approval?.tasks) === JSON.stringify(tasks);
  async function startRun() {
    if(!approval || !user?.email || !canEdit || busy || pendingRun)return;
    setBusy(true);setError('');
    try {
      const request=await addDoc(collection(firebase.db,'organizations','coco-co','executionRequests'),{
        roomId:room.id,approvalId:approval.id,requestedBy:user.uid,requestedByEmail:user.email.toLowerCase(),status:'queued',createdAt:serverTimestamp(),
      });
      setPendingRun(request.id);
    } catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  async function cancelRun(id:string) {
    setBusy(true);setError('');
    try {await updateDoc(doc(firebase.db,'organizations','coco-co','executionRequests',id),{status:'cancelled'});}
    catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  const statusLabel = {connecting:'Connecting',saving:'Saving changes',saved:'All changes saved',offline:'Offline · reconnecting',error:'Changes need attention'}[sync];
  const syncDetail = <span role="status"><span className={'dot '+(sync==='saved'?'':'loading')}/>{statusLabel}</span>;
  const displayedRun = showDraft ? null : run;
  const displayedTasks = displayedRun?.tasks ?? tasks;
  const selectedTask = displayedTasks.find(task=>task.id===selectedId);
  return <>
    {view === 'plan' ? <div className="room-grid">
      <section className="chat-panel">
        <div className="panel-heading"><h2><MessageSquare size={14}/> Conversation</h2><span className="eyebrow" style={{fontSize:8}}>{people.length} here</span></div>
        <div className="chat-scroll"><div className="welcome-note"><strong><Sparkles size={13} className="inline mr-1"/> A good build starts with a conversation.</strong>Talk through the idea here. Shape the plan together, and use the interview to work through the details.<div className="mt-3"><Button variant="outline" size="sm" onClick={startInterview} disabled={!ready||!historyReady||!canEdit||busy||interviewOpen}><CircleHelp size={12}/> {history.length||interview?'Continue interview':'Grill me'}</Button></div></div>
        {messages.map(message=><article className="message" key={message.id}><span className="avatar">{initials(message.authorName)}</span><div><header><strong>{message.authorName}</strong><time>{message.createdAt?.toDate().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) || 'Sending'}</time></header><p>{message.text}</p></div></article>)}<div ref={chatEnd}/></div>
        {interviewOpen && interview && <div className="question" aria-live="polite"><div className="flex justify-between items-center"><span className="eyebrow">Guided interview · Question {interview.index+1}</span><Button variant="ghost" size="icon-xs" aria-label="Pause interview" disabled={busy} onClick={()=>setInterviewOpen(false)}><X size={13}/></Button></div><strong>{interview.title}</strong><p>{interview.question}</p><div className="hint">Your answer joins the history at the bottom of the plan. <a href="#interview-history">View history ↗</a></div></div>}
        {canEdit ? <form className="composer" onSubmit={event=>void submit(event)}><textarea ref={composer} aria-label={interviewOpen?'Answer the interview question':'Message the room'} placeholder={interviewOpen?interview?.placeholder:'Share a thought with your team…'} value={draft} onChange={e=>setDraft(e.target.value)} maxLength={8000} rows={3} readOnly={busy} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit(e);}}}/><div className="composer-footer"><span><Hash size={10} className="inline mr-1"/> {interviewOpen?'Saved in interview history':'Shared with everyone in this room'}</span><Button type="submit" size="icon" className="h-7 w-7" disabled={busy||!draft.trim()||!ready||(interviewOpen&&!historyReady)} aria-label={interviewOpen?'Save interview answer':'Send message'}>{busy?<LoaderCircle size={12} className="animate-spin"/>:<Send size={12}/>}</Button></div></form> : <div className="welcome-note mt-5"><strong>Public view · read only</strong>CoCo Co members can sign in to edit the plan and join the conversation.{!user&&<Button variant="outline" size="sm" className="mt-3" onClick={onSignIn}>Member sign-in <ArrowRight size={12}/></Button>}</div>}
      </section>
      <section className="plan-panel"><div className="panel-heading"><h2><FileText size={14}/> Shared plan</h2><Badge variant="secondary" className="text-[9px] font-normal">{unchanged?'Approved snapshot':'Working draft'}</Badge></div>
        <div className={'paper '+(remoteName?'remote-edit':'')}>
          <div className="paper-toolbar"><span><FileText size={11} className="inline mr-1"/> plan.md</span><div className="paper-actions">{remoteName?<span className="text-foreground">{remoteName} is editing</span>:syncDetail}{canEdit&&<Button variant="ghost" size="sm" disabled={!ready} aria-pressed={editingPlan} onClick={()=>setEditingPlan(!editingPlan)}>{editingPlan?<Check size={12}/>:<Pencil size={12}/>} {editingPlan?'Done editing':'Edit plan'}</Button>}</div></div>
          {editingPlan&&canEdit&&provider ? <CollaborativePlan provider={provider}/> : <article aria-label="Shared plan" className="plan-rendered markdown-content">{ready?<Markdown>{plan}</Markdown>:<p className="loading">Loading the plan…</p>}</article>}
          <InterviewHistory history={history} loading={!historyReady} canContinue={canEdit&&ready&&historyReady&&!busy&&!interviewOpen} onContinue={startInterview}/>
          <div className="plan-footer"><span><Users size={10} className="inline mr-1"/> {organization.memberEmails.length} teammates · editing together</span><span>{wordCount} words{historyPending?' · Saving interview…':''}</span></div>
        </div>
        <p className="hint"><CheckCheck size={11} className="inline mr-1"/> Everyone can view this demo. Approvals include the plan and interview history as a fixed snapshot.</p>
      </section>
    </div> : <section className="control">
      <div className="control-heading"><div><div className="eyebrow mb-2">Plan → implement → review</div><h1>Implementation</h1><p>A clear path for every task. Open a node to inspect the work or give Codex direction.</p></div><Button onClick={()=>void approve()} disabled={!canEdit||!ready||!historyReady||historyPending||busy||sync!=='saved'||unchanged}><Check size={14}/>{unchanged?'Plan approved':'Approve plan'}</Button></div>
      <div className="execution-summary"><span><FileText size={13}/>{displayedRun?'Run snapshot':unchanged?'Approved snapshot':approval?'Draft has changed':'Working draft'}</span><span><GitBranch size={13}/>{displayedTasks.length} tasks</span><span><Terminal size={13}/>{run ? `${run.mode==='demo'?'Demo run':'Latest run'} · ${run.status}` : 'No run yet'}</span><span><Terminal size={13}/>{workerCount ? `${workerCount} Linux worker connected` : 'Linux worker offline'}</span></div>
      {run && <div className="execution-scope" aria-label="Execution snapshot"><Button variant={!showDraft?'secondary':'ghost'} size="sm" aria-pressed={!showDraft} onClick={()=>{setShowDraft(false);setSelectedId(null);}}>Latest run</Button><Button variant={showDraft?'secondary':'ghost'} size="sm" aria-pressed={showDraft} onClick={()=>{setShowDraft(true);setSelectedId(null);}}>Working draft</Button><span>{showDraft?'Instructions for the next run':'Tasks from the approved run snapshot'}</span></div>}
      <ExecutionGraph tasks={displayedTasks} run={displayedRun} notes={steering} selectedId={selectedId} onSelect={id=>{if(!displayedRun)setShowDraft(true);setSelectedId(id);}}/>
      <div className="execution-caption"><p><GitBranch size={13}/> One worker executes tasks in dependency order. Reduce tasks bring their results together.</p>{approval ? <span><CheckCheck size={12}/> Approved {approval.createdAt?.toDate().toLocaleString() || 'just now'}</span> : <span>Approve a snapshot when the plan is ready.</span>}</div>
      <div className="flex gap-3 items-center mt-4"><Button onClick={()=>void startRun()} disabled={!canEdit||!ready||!historyReady||historyPending||sync!=='saved'||busy||!unchanged||!workerCount||!health?.executionReady||!!pendingRun||run?.status==='running'}><Terminal size={14}/>{pendingRun?'Queued for worker':'Run approved plan'}</Button>{canEdit&&(pendingRun||run?.status==='running')&&<Button variant="outline" disabled={busy} onClick={()=>void cancelRun(pendingRun||run!.id)}>Cancel run</Button>}<span className="hint">Runs use this CoCo repository at the deployed revision. Results stay on the VM.</span></div>
    </section>}
    {view==='control' && selectedTask && <TaskInspector key={selectedTask.id+'-'+(displayedRun?.id??'draft')} firebase={firebase} roomId={room.id} user={user} canEdit={canEdit} task={selectedTask} tasks={displayedTasks} run={displayedRun} notes={steering} onSelect={setSelectedId} onClose={()=>setSelectedId(null)} onSignIn={onSignIn}/>}
    {error && <div className="alert mx-6" role="alert">{error} {sync==='error'&&<Button size="sm" variant="outline" onClick={()=>{setError('');void provider?.flush();}}>Retry saving</Button>}</div>}
  </>;
}

export function App({ firebase }: { firebase: Firebase }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [organization,setOrganization] = useState<Organization>({name:ORGANIZATION_NAME,memberEmails:ORGANIZATION_MEMBERS});
  const [rooms,setRooms] = useState<Room[]>([]);
  const [roomId,setRoomId] = useState(new URLSearchParams(location.search).get('room'));
  const [view,setView] = useState('plan');
  const [authOpen,setAuthOpen] = useState(false);
  const [authBusy,setAuthBusy] = useState(false);
  const [dialog,setDialog] = useState<'create'|'members'|null>(null);
  const [value,setValue] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [,setVerificationTick]=useState(0);
  const [theme,setTheme]=useState(document.documentElement.dataset.theme==='light'?'light':'dark');
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    document.documentElement.classList.toggle('dark',theme==='dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0a0a0a':'#fafafa');
    try { localStorage.setItem('coco-theme',theme); } catch { /* Theme still works when storage is unavailable. */ }
  },[theme]);
  const canEdit=!!user?.emailVerified && !!user.email && organization.memberEmails.includes(user.email.toLowerCase());

  useEffect(()=>onAuthStateChanged(firebase.auth,setUser),[firebase]);
  useEffect(()=>onSnapshot(doc(firebase.db,'organizations',ORGANIZATION_ID),snapshot=>{
    if(snapshot.exists())setOrganization(snapshot.data() as Organization);
  },e=>setError(e.message)),[firebase]);
  useEffect(()=>onSnapshot(query(collection(firebase.db,'rooms'),where('orgId','==',ORGANIZATION_ID)),snapshot=>{
    const result=snapshot.docs.map(d=>({id:d.id,...d.data()} as Room)).sort((a,b)=>(a.createdAt?.toMillis()||0)-(b.createdAt?.toMillis()||0));
    setRooms(result);
    setRoomId(current=>current || result[0]?.id || null);
  },e=>setError(e.message)),[firebase]);
  useEffect(()=>{
    const pop=()=>setRoomId(new URLSearchParams(location.search).get('room'));
    window.addEventListener('popstate',pop);
    return()=>window.removeEventListener('popstate',pop);
  },[]);
  const room=rooms.find(r=>r.id===roomId);
  function navigate(id:string) { history.pushState(null,'','/?room='+id);setRoomId(id);setView('plan'); }
  function openDialog(type:'create'|'members') { setValue('');setError('');setDialog(type); }
  async function submitDialog(event:FormEvent) {
    event.preventDefault();
    if(!user||!canEdit||!value.trim())return;
    setBusy(true);setError('');
    try { navigate(await createRoom(firebase.db,user,value.trim().slice(0,120)));setDialog(null); }
    catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  if(authOpen) return <>
    <Button variant="ghost" className="fixed top-5 left-5 z-10" disabled={authBusy} onClick={()=>setAuthOpen(false)}>← Back to {organization.name}</Button>
    {user && !user.emailVerified && !authBusy ? <VerifyEmail firebase={firebase} user={user} onVerified={()=>{setVerificationTick(n=>n+1);setAuthOpen(false);}}/> : <SignIn firebase={firebase} onBusyChange={setAuthBusy} onAuthenticated={signedIn=>{setUser(signedIn);if(signedIn.emailVerified)setAuthOpen(false);}}/>}
  </>;

  return <div className="app">
    <aside className="sidebar">
      <Brand/>
      <div className="px-2"><div className="text-sm font-medium">{organization.name}</div><div className="hint !mt-1">Public hackathon workspace</div></div>
      <Button variant="outline" size="sm" className="justify-start text-xs" onClick={()=>openDialog('create')} disabled={!canEdit}><Plus size={13}/> New room</Button>
      <div><div className="eyebrow">Org rooms <span className="float-right">{rooms.length}</span></div>
        <nav className="room-list" aria-label="Planning rooms">{rooms.map(r=><button className={'room-link '+(r.id===roomId?'active':'')} key={r.id} onClick={()=>navigate(r.id)}><MessageSquare size={13}/><span className="truncate">{r.title}</span></button>)}{!rooms.length&&<p className="hint">The demo room is getting ready.</p>}</nav>
      </div>
      <div className="mt-2"><div className="eyebrow">Workspace</div><button className="room-link mt-2" onClick={()=>openDialog('members')}><Users size={13}/> Members <span className="ml-auto text-[10px]">{organization.memberEmails.length}</span></button><a className="room-link" href="https://github.com/Jorya-Design/CoCo" target="_blank" rel="noreferrer"><GitBranch size={13}/> Source & documentation</a></div>
      <div className="sidebar-bottom"><div className="person"><span className="avatar">{user?initials(user.displayName||user.email||'You'):'G'}</span><div className="min-w-0"><strong className="font-medium block truncate">{user?.displayName||user?.email?.split('@')[0]||'Guest'}</strong><span className="text-[9px] text-muted-foreground">{canEdit?'CoCo Co member':'Read-only visitor'}</span></div>{user?<button className="ml-auto" aria-label="Sign out" onClick={()=>void signOut(firebase.auth).catch(e=>setError(authErrorMessage(e)))}><LogOut size={13}/></button>:<button className="ml-auto text-[10px] text-primary" onClick={()=>setAuthOpen(true)}>Sign in</button>}</div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>{organization.name}</span><span>/</span><strong>{room?.title||'Shared workspace'}</strong></div>
        <div className="actions"><Button variant="ghost" size="icon-sm" aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={15}/>:<Moon size={15}/>}</Button><Badge variant="secondary" className="text-[9px]">Public demo</Badge>{!canEdit&&<Badge variant="outline" className="text-[9px]">Read only</Badge>}<Button variant="outline" size="sm" onClick={()=>openDialog('members')}><Users size={12}/> Members</Button>{!user&&<Button size="sm" onClick={()=>setAuthOpen(true)}>Sign in</Button>}{user&&!user.emailVerified&&<Button size="sm" onClick={()=>setAuthOpen(true)}>Verify email</Button>}{user&&<Button className="mobile-sign-out" variant="ghost" size="icon-sm" aria-label="Sign out" onClick={()=>void signOut(firebase.auth).catch(e=>setError(authErrorMessage(e)))}><LogOut size={14}/></Button>}</div>
      </header>
      {room?<><nav className="view-tabs" aria-label="Room views"><button aria-current={view==='plan'?'page':undefined} className={'view-tab '+(view==='plan'?'selected':'')} onClick={()=>setView('plan')}><FileText size={13}/> Plan & conversation</button><button aria-current={view==='control'?'page':undefined} className={'view-tab '+(view==='control'?'selected':'')} onClick={()=>setView('control')}><GitBranch size={13}/> Implementation </button></nav>
        <RoomView key={room.id} firebase={firebase} user={user||null} canEdit={canEdit} organization={organization} room={room} view={view} onSignIn={()=>setAuthOpen(true)}/>
      </>:<main className="empty"><div className="eyebrow">{organization.name} · public demo</div><h1>Think together.<br/>Build in parallel.</h1><p>A shared room for the conversation, a living plan for the details, and a clear path from idea to implementation. Browse the workspace freely; its two members can sign in to edit.</p>{canEdit?<Button onClick={()=>openDialog('create')}><Plus size={14}/> Create a planning room</Button>:<Button onClick={()=>setAuthOpen(true)}>Member sign-in <ArrowRight size={14}/></Button>}</main>}
      {error&&!dialog&&<div className="alert mx-6" role="alert">{error}</div>}
    </div>
    <Dialog open={dialog!==null} onOpenChange={open=>{if(!open)setDialog(null);}}>
      <DialogContent><DialogHeader><DialogTitle>{dialog==='create'?'What are we building?':organization.name+' members'}</DialogTitle><DialogDescription>{dialog==='create'?'Give this room a name. Everything in this demo org is publicly viewable.':'These two members can edit after signing in with a verified email. Everyone else can browse read-only.'}</DialogDescription></DialogHeader>
        {dialog==='create'?<form onSubmit={e=>void submitDialog(e)} className="space-y-4"><Input autoFocus aria-label="Room name" placeholder="e.g. Multiplayer Codex harness" maxLength={120} required value={value} onChange={e=>setValue(e.target.value)}/>{error&&<div role="alert" className="alert">{error}</div>}<Button type="submit" disabled={busy||!value.trim()||!canEdit} className="w-full">{busy?<LoaderCircle size={14} className="animate-spin"/>:<Plus size={14}/>} Create room</Button></form>:<div className="space-y-4 mt-2">{organization.memberEmails.map(email=><div className="person" key={email}><span className="avatar">{initials(email)}</span><div><strong className="text-xs font-medium">{email}</strong><p className="text-[10px] text-muted-foreground">Member · editor</p></div></div>)}</div>}
      </DialogContent>
    </Dialog>
  </div>;
}
