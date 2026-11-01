import { useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { ArrowRight, Check, Clock3, Copy, CornerDownLeft, GitBranch, LoaderCircle, MessageSquare, Send, Terminal, X, Zap } from 'lucide-react';
import type { Run, TaskSpec } from '../../../../shared/types.ts';
import type { Firebase } from '@/lib/firebase';
import { canInterrupt, formatTime, taskStatus } from '@/lib/execution';
import { cancelSteering, queueSteering, type SteeringNote } from '@/lib/steering';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function TaskInspector({ firebase, roomId, user, canEdit, task, tasks, run, notes, onSelect, onClose, onSignIn }: {
  firebase: Firebase; roomId: string; user: User | null; canEdit: boolean;
  task: TaskSpec; tasks: TaskSpec[]; run: Run | null; notes: SteeringNote[];
  onSelect: (id: string) => void; onClose: () => void; onSignIn: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const execution = run?.tasks.find(item => item.id === task.id);
  const interruptible = canInterrupt(run, task.id);
  const finished = execution?.status === 'completed' || execution?.status === 'failed' || run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled';
  const scopedNotes = notes.filter(note => note.taskId === task.id && note.runId === (run?.id ?? null));
  const pending = scopedNotes.filter(note => note.status === 'queued');
  const history = scopedNotes.filter(note => note.status !== 'queued');
  const events = run?.events?.filter(event => event.taskId === task.id) ?? [];
  const dependencies = task.dependencies.map(id => tasks.find(item => item.id === id)).filter(item => !!item);
  const dependents = tasks.filter(item => item.dependencies.includes(task.id));

  async function submit(timing: 'next' | 'now') {
    if (!user || !canEdit || busy || !draft.trim() || finished || (timing === 'now' && !interruptible)) return;
    const text = draft.trim();
    setBusy(true); setError(''); setNotice('');
    try {
      await queueSteering(firebase.db, roomId, user, { taskId: task.id, runId: run?.id ?? null, text, timing });
      setDraft('');
      setNotice(timing === 'now' ? 'Interrupt requested. Waiting for the worker to acknowledge.' : run ? 'Instruction queued for the next step.' : 'Instruction saved for the next run. Waiting for a worker connection.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this instruction.'); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!canEdit || busy) return;
    setBusy(true); setError('');
    try { await cancelSteering(firebase.db, roomId, id); setNotice('Instruction cancelled.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel this instruction.'); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="task-inspector" aria-describedby="task-description" onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }} onEscapeKeyDown={event => { if (draft) { event.preventDefault(); setDraft(''); } }}>
      <DialogHeader className="inspector-header">
        <div className="eyebrow flex items-center gap-2"><Terminal size={13}/> Codex implementation <Badge variant="outline">{execution ? taskStatus(execution) : 'Planned'}</Badge></div>
        <DialogTitle ref={heading} tabIndex={-1}>{task.title}</DialogTitle>
        <DialogDescription id="task-description">{task.kind === 'reduce' ? 'Integrates and verifies its inputs.' : 'An independent implementation task.'} <span className="font-mono">{task.id}</span></DialogDescription>
      </DialogHeader>
      <div className="inspector-body">
        <section className="inspector-section"><h3><GitBranch size={14}/> Task context</h3><p className="task-prompt">{task.description}</p>
          {dependencies.length > 0 && <div className="dependency-group"><span>Depends on</span><div>{dependencies.map(item => <button key={item.id} className="dependency-link" onClick={() => onSelect(item.id)}>{item.title}<ArrowRight size={11}/></button>)}</div></div>}
          {dependents.length > 0 && <div className="dependency-group"><span>Unlocks</span><div>{dependents.map(item => <button key={item.id} className="dependency-link" onClick={() => onSelect(item.id)}>{item.title}<ArrowRight size={11}/></button>)}</div></div>}
        </section>

        <section className="inspector-section steering-section" aria-labelledby="steering-title">
          <p>Instructions are saved for later delivery. Live steering is not available in this release.</p>
          <div className="section-title"><h3 id="steering-title"><MessageSquare size={14}/> Steer implementation</h3><span>{pending.length} queued</span></div>
          <p>{finished ? 'This task has ended. Select the working draft to leave direction for the next run.' : run ? 'Give Codex a correction or a new constraint for this task.' : 'Leave direction for this task. Instructions stay queued until a worker picks them up.'}</p>
          {pending.length > 0 && <ol className="steering-queue" aria-label="Queued instructions">{pending.map(note => <li key={note.id}>
            <div className="note-heading"><span><Clock3 size={11}/>{note.timing === 'now' ? 'Interrupt requested' : run ? 'Next step' : 'Next run'}</span>{canEdit && <Button variant="ghost" size="icon-xs" disabled={busy} aria-label={`Cancel instruction: ${note.text}`} onClick={() => void remove(note.id)}><X size={12}/></Button>}</div>
            <p>{note.text}</p><small>{note.authorName} · {note.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? 'Saving'}</small>
          </li>)}</ol>}
          {canEdit ? <form className="steering-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void submit('next'); }}>
            <label htmlFor="steer-agent" className="sr-only">Steer the agent</label>
            <textarea id="steer-agent" placeholder="What should Codex do differently?" value={draft} onChange={event => setDraft(event.target.value)} rows={3} maxLength={4000} disabled={!!finished} readOnly={busy}
              aria-describedby="steering-shortcuts" onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(event.metaKey || event.ctrlKey ? 'now' : 'next'); }
              }}/>
            <div className="steering-actions"><Button type="button" variant="ghost" size="sm" disabled={!interruptible || busy || !draft.trim()} title={interruptible ? 'Request an interrupt of the active step' : 'Available when this task is running'} onClick={() => void submit('now')}><Zap size={12}/> Interrupt now</Button><Button type="submit" size="sm" disabled={busy || !draft.trim() || !!finished}>{busy ? <LoaderCircle size={12} className="animate-spin"/> : <Send size={12}/>} Queue instruction</Button></div>
            <div id="steering-shortcuts" className="steering-shortcuts"><CornerDownLeft size={11}/> Queue · Shift + Enter for a new line{interruptible && ' · ⌘ / Ctrl + Enter to interrupt'}</div>
          </form> : <div className="read-only-note">Members can sign in to steer this task.{!user && <Button size="sm" variant="outline" onClick={() => { onClose(); onSignIn(); }}>Member sign-in <ArrowRight size={12}/></Button>}</div>}
          <p className="steering-notice" role="status" aria-live="polite">{notice}</p>
          {error && <div className="alert" role="alert">{error}</div>}
          {history.length > 0 && <details className="instruction-history"><summary>Instruction history · {history.length}</summary>{history.map(note => <div key={note.id}><Badge variant="outline">{note.status}</Badge><p>{note.text}</p><small>{note.authorName}</small></div>)}</details>}
        </section>

        <section className="inspector-section" aria-labelledby="thread-title"><h3 id="thread-title"><Terminal size={14}/> Implementation thread</h3>
          {execution?.threadId ? <>
            <div className="thread-id"><code>{execution.threadId}</code><Button variant="ghost" size="icon-xs" aria-label="Copy Codex thread ID" onClick={() => { void navigator.clipboard.writeText(execution.threadId!).then(() => setCopied(true)).catch(() => setError('Could not copy the thread ID.')); }}>{copied ? <Check size={12}/> : <Copy size={12}/>}</Button></div>
            <dl className="thread-metadata"><div><dt>Worker</dt><dd>{execution.workerId ?? 'Unassigned'}</dd></div><div><dt>Started</dt><dd>{formatTime(execution.startedAt)}</dd></div><div><dt>Finished</dt><dd>{execution.completedAt ? formatTime(execution.completedAt) : '—'}</dd></div><div><dt>Run</dt><dd className="font-mono">{run!.id}</dd></div></dl>
          </> : <div className="thread-empty"><Terminal size={20}/><strong>No Codex thread yet</strong><p>{run ? 'The worker has not attached a thread to this task.' : 'Approve the plan and connect a worker to start implementation. The thread ID and activity will appear here.'}</p></div>}
          {events.length > 0 && <ol className="thread-events" aria-label="Task activity">{events.map(event => <li key={event.id}><span className="event-dot"/><div><time>{formatTime(event.at)}</time><p>{event.text}</p></div></li>)}</ol>}
          {execution?.error && <div className="alert" role="alert">{execution.error}</div>}
          {execution?.commit && <p className="font-mono text-xs">Commit: {execution.commit}</p>}
          {execution?.output && <details className="task-output" open><summary>Implementation output</summary><pre>{execution.output}</pre></details>}
        </section>
      </div>
      <div className="inspector-footer"><span className="dot"/>{run ? 'Instructions apply to this run only' : 'Instructions are saved for the next run'}</div>
    </DialogContent>
  </Dialog>;
}
