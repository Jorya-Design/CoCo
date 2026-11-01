import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { pullRequestSchema, taskSpecSchema, type ExecutionRun, type ExecutionTask, type ExecutionJob, type WorkerCommand } from '../shared/execution.ts';
import { validateDag } from '../shared/plan.ts';
import { authorizeWorkerRun, type RunLease, type WorkerIdentity } from './worker-auth.ts';
import { publicationTarget } from '../shared/publication.ts';

const leaseMs = 90000;
const requestsPath = 'organizations/coco-co/executionRequests';
export class Scheduler {
  private db = getFirestore();
  constructor(private baseSha: string) {
    if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error('A pinned COCO_REPOSITORY_SHA is required');
  }
  private lease(workerId: string) { return this.db.doc(`workerLeases/${workerId}`); }
  async claim(identity: WorkerIdentity): Promise<Omit<ExecutionJob,'inferenceToken'> | null> {
    const requests = await this.db.collection(requestsPath).where('status','in',['queued','running']).limit(20).get();
    for (const candidate of requests.docs) {
      const result = await this.db.runTransaction(async tx => {
        const requestSnap = await tx.get(candidate.ref);
        const request = requestSnap.data();
        if (!request || !['queued','running'].includes(request.status)) return null;
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.roomId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.approvalId)) return null;
        const runRef = this.db.doc(`rooms/${request.roomId}/runs/${candidate.id}`);
        const [organization, room, approval, runSnap, leaseSnap] = await Promise.all([
          tx.get(this.db.doc('organizations/coco-co')), tx.get(this.db.doc(`rooms/${request.roomId}`)),
          tx.get(this.db.doc(`rooms/${request.roomId}/approvals/${request.approvalId}`)), tx.get(runRef), tx.get(this.lease(identity.workerId)),
        ]);
        const previous = leaseSnap.data() as RunLease & { taskId: string; kind?:string } | undefined;
        if (previous?.status === 'active') {
          if(['plan','planning'].includes(previous.kind??''))return null;
          if (previous.expiresAt > Date.now()) return null;
          // Never silently rerun an attempt that could have already changed its worktree.
          const oldRunRef = this.db.doc(`rooms/${previous.roomId}/runs/${previous.runId}`);
          const oldRun = await tx.get(oldRunRef);
          const oldRequestRef = this.db.doc(`${requestsPath}/${previous.runId}`);
          const oldRequest = await tx.get(oldRequestRef);
          if (oldRun.exists) tx.update(oldRunRef,{status:'failed',error:'Worker lease expired; start a new run to retry.'});
          if (oldRequest.exists) tx.update(oldRequestRef,{status:'failed'});
          tx.update(this.lease(identity.workerId),{status:'cancelled'});
          return null;
        }
        const snapshot = approval.data();
        const allowed = room.data()?.orgId === 'coco-co' && organization.data()?.memberEmails?.includes(request.requestedByEmail);
        if (!allowed || !snapshot || snapshot.status !== 'approved') {
          tx.update(candidate.ref,{status:'failed'}); return null;
        }
        let tasks: ExecutionTask[];
        try {
          if (!runSnap.exists) {
            if (typeof snapshot.implementationPlanId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(snapshot.implementationPlanId)) throw new Error('Generate an implementation plan first');
            const implementation=(await tx.get(this.db.doc(`rooms/${request.roomId}/implementationPlans/${snapshot.implementationPlanId}`))).data();
            if (!implementation || implementation.plan!==snapshot.plan || !isDeepStrictEqual(implementation.tasks,snapshot.tasks)) throw new Error('Approval must match a Codex implementation plan');
          }
          tasks = taskSpecSchema.array().min(1).max(100).parse(snapshot.tasks).map(task=>({...task,status:'pending' as const}));
          validateDag(tasks);
          if (typeof snapshot.plan !== 'string' || snapshot.plan.length > 200000) throw new Error();
          if (Buffer.byteLength(JSON.stringify({plan:snapshot.plan,tasks}),'utf8')>256000) throw new Error('Snapshot too large for execution');
        } catch { tx.update(candidate.ref,{status:'failed'}); return null; }
        const run = runSnap.exists ? runSnap.data() as ExecutionRun : {
          status:'running' as const, tasks, plan:snapshot.plan as string, baseSha:this.baseSha,
        };
        if (run.status !== 'running' || (run.workerId && run.workerId !== identity.workerId)) return null;
        const publishing = run.tasks.every(task=>task.status==='completed');
        const task = publishing ? run.publication ?? {
          id:'publish-pr',title:'Create PR for review',description:'Validate the integrated result and create the bot-authored GitHub pull request.',
          kind:'reduce' as const,dependencies:run.tasks.map(task=>task.id),status:'pending' as const,
        } : run.tasks.find(task=>task.status === 'pending' && task.dependencies.every(id=>run.tasks.some(dep=>dep.id===id && dep.status==='completed')));
        if (!task) return null;
        if (task.status !== 'pending') return null;
        const attemptId = randomUUID();
        const fence = (task.fence ?? 0) + 1;
        const lease: RunLease & {taskId:string;kind:string} = { roomId:request.roomId, runId:candidate.id, attemptId, fence,
          workerId:identity.workerId, expiresAt:Date.now()+leaseMs, status:'active', taskId:task.id,kind:publishing?'publication':'execution' };
        const assigned = {...task,status:'running' as const,attemptId,fence,workerId:identity.workerId,startedAt:Date.now()};
        tx.set(runRef,{...run,...(publishing ? {publication:assigned} : {tasks:run.tasks.map(entry=>entry.id===task.id ? assigned : entry)}),workerId:identity.workerId,approvalId:request.approvalId,
          ...(!runSnap.exists ? {createdAt:FieldValue.serverTimestamp()} : {}),updatedAt:FieldValue.serverTimestamp()});
        tx.update(candidate.ref,{status:'running'});
        tx.set(this.lease(identity.workerId),lease);
        const commits = new Set<string>();
        const visited = new Set<string>();
        const collect = (id: string) => {
          if (visited.has(id)) return;
          visited.add(id);
          const dependency = run.tasks.find(entry=>entry.id===id)!;
          dependency.dependencies.forEach(collect);
          if (!dependency.commit || !/^[a-f0-9]{40}$/.test(dependency.commit)) throw new Error('Missing dependency artifact');
          commits.add(dependency.commit);
        };
        task.dependencies.forEach(collect);
        return {roomId:lease.roomId,runId:lease.runId,attemptId,fence,task:taskSpecSchema.parse(task),plan:run.plan,baseSha:run.baseSha,
          dependencyCommits:[...commits],...(publishing ? {publication:publicationTarget(candidate.id)} : {})};
      });
      if (result) return result;
    }
    return null;
  }
  async report(identity: WorkerIdentity, command: Exclude<WorkerCommand,{type:'worker/poll'}>) {
    return this.db.runTransaction(async tx => {
      const leaseRef = this.lease(identity.workerId);
      const leaseSnap = await tx.get(leaseRef);
      const lease = leaseSnap.exists ? leaseSnap.data() as RunLease & {taskId:string;kind?:string} : null;
      authorizeWorkerRun(identity,command,lease);
      const requestRef = this.db.doc(`${requestsPath}/${command.runId}`);
      const runRef = this.db.doc(`rooms/${command.roomId}/runs/${command.runId}`);
      const [requestSnap, runSnap, organization] = await Promise.all([
        tx.get(requestRef),tx.get(runRef),tx.get(this.db.doc('organizations/coco-co')),
      ]);
      const request = requestSnap.data();
      const run = runSnap.data() as ExecutionRun | undefined;
      if (!run || !request) throw new Error('Run unavailable');
      const active = request.status === 'running' && run.status === 'running'
        && organization.data()?.memberEmails?.includes(request.requestedByEmail);
      if (!active) {
        tx.update(leaseRef,{status:'cancelled'});
        if (run.status === 'running') tx.update(runRef,{status:'cancelled'});
        return false;
      }
      if (command.type === 'worker/heartbeat') {
        tx.update(leaseRef,{expiresAt:Date.now()+leaseMs}); return true;
      }
      if (command.type === 'worker/thread') {
        tx.update(runRef,lease!.kind==='publication' ? {publication:{...run.publication!,threadId:command.threadId}}
          : {tasks:run.tasks.map(task=>task.id===lease!.taskId ? {...task,threadId:command.threadId} : task)});
        return true;
      }
      if (command.success && !command.commit) throw new Error('A completed coding task must include a commit');
      const publishing = lease!.kind==='publication';
      if (publishing && command.success && (!command.pullRequest || command.pullRequest.commit!==command.commit
        || command.pullRequest.branch!==publicationTarget(command.runId).branch)) throw new Error('A completed run must include its published pull request');
      if (command.pullRequest && (!publishing || !command.success)) throw new Error('Unexpected pull request result');
      if (command.pullRequest) pullRequestSchema.parse(command.pullRequest);
      const task = publishing ? run.publication : run.tasks.find(task=>task.id===lease!.taskId);
      if (!task || task.status !== 'running' || task.attemptId !== command.attemptId || task.fence !== command.fence) throw new Error('Stale attempt');
      const finished = {
        ...task,status:command.success?'completed' as const:'failed' as const,output:boundedOutput(command.output),completedAt:Date.now(),
        ...(command.commit ? {commit:command.commit} : {}),
      };
      const status = !command.success ? 'failed' : publishing ? 'completed' : 'running';
      tx.update(runRef,{...(publishing ? {publication:finished} : {tasks:run.tasks.map(entry=>entry.id===task.id ? finished : entry)}),
        ...(command.pullRequest ? {pullRequest:command.pullRequest} : {}),status,updatedAt:FieldValue.serverTimestamp()});
      tx.update(requestRef,{status});
      tx.update(leaseRef,{status:'completed'});
      return true;
    });
  }
}

function boundedOutput(value: string) {
  const suffix='\n[Output truncated]';
  let output=value;
  while(Buffer.byteLength(JSON.stringify(output+(output===value?'':suffix)),'utf8')>4096)
    output=output.slice(0,Math.floor(output.length*0.8));
  return output===value?output:output+suffix;
}
