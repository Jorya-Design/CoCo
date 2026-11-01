// Runs only inside the disposable executor container. stdout is a bounded result.
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { planAgentPrompt, planOutputSchema } from '../shared/plan-prompt.ts';
import { publicationTarget, publicationPrompt, verifiedPullRequest } from '../shared/publication.ts';
const execFile = promisify(execFileCallback);
let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if(raw.length>300000)throw new Error('Job too large'); }
const job = JSON.parse(raw);
const planning=job.kind==='planning'||!!job.planning;
const target=job.publication ? publicationTarget(job.runId) : null;
if(job.publication && (planning || job.publication.repository!==target.repository || job.publication.base!==target.base || job.publication.branch!==target.branch
  || typeof job.githubToken!=='string' || !/^[A-Za-z0-9_]{20,512}$/.test(job.githubToken))) throw new Error('Invalid publication job');
if (!/^[a-zA-Z0-9_-]{1,128}$/.test(job.runId) || !/^[a-f0-9-]{36}$/.test(job.attemptId))throw new Error('Invalid job');
if(job.kind==='planning' && (typeof job.prompt!=='string'||job.prompt.length>200000))throw new Error('Invalid prompt');
if (job.kind!=='planning' && (!/^[a-zA-Z0-9_-]{1,128}$/.test(job.runId) || !/^[a-f0-9]{40}$/.test(job.baseSha)
  || !/^[a-zA-Z0-9_-]{1,64}$/.test(job.task.id) || !/^[a-f0-9-]{36}$/.test(job.attemptId)
  || !job.dependencyCommits.every(sha=>/^[a-f0-9]{40}$/.test(sha)))) throw new Error('Invalid job');
const git = (...args) => execFile('git',['-c','core.hooksPath=/dev/null','-c','user.name=CoCo worker',
  '-c','user.email=worker@coco.invalid',...args],{maxBuffer:1024*1024});
const redact = text => [job.inferenceToken,job.githubToken].filter(Boolean).reduce((value,secret)=>value.split(secret).join('[redacted]'),text);
const agentEnv = {PATH:process.env.PATH,HOME:'/tmp/codex-home',CODEX_HOME:'/tmp/codex-home',
  COCO_INFERENCE_TOKEN:job.inferenceToken,GIT_AUTHOR_NAME:'CoCo bot',GIT_AUTHOR_EMAIL:'worker@coco.invalid',
  GIT_COMMITTER_NAME:'CoCo bot',GIT_COMMITTER_EMAIL:'worker@coco.invalid',
  ...(job.publication ? {GH_TOKEN:job.githubToken,GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1'} : {})};
await mkdir('/tmp/codex-home',{recursive:true});
const repository = '/work/repo.git';
const cwd = planning ? '/work' : `/work/tasks/${job.attemptId}`;
if (!planning) {
await git('init','--bare',repository);
await git('--git-dir',repository,'fetch','--no-tags','https://github.com/Jorya-Design/CoCo.git',job.baseSha);
await git('--git-dir',repository,'worktree','add','--detach',cwd,job.baseSha);
for (const commit of job.dependencyCommits) await git('-C',cwd,'cherry-pick','--keep-redundant-commits',commit);
}

if(job.publication) {
  await git('-C',cwd,'remote','add','origin',`https://github.com/${job.publication.repository}.git`);
  await execFile('gh',['auth','setup-git','--hostname','github.com'],{cwd,env:agentEnv});
}

const child = spawn('codex',['-c','model_provider="coco"','-c',
  'model_providers.coco={name="CoCo",base_url="http://172.30.0.1:8790/v1",wire_api="responses",env_key="COCO_INFERENCE_TOKEN",requires_openai_auth=false}',
  'app-server','--listen','stdio://'],{cwd,env:agentEnv,stdio:['pipe','pipe','ignore']});
let serial=0;
const pending = new Map();
child.stdin.on('error',()=>{});
let resolveTurn, rejectTurn;
const completed = new Promise((resolve,reject)=>{resolveTurn=resolve;rejectTurn=reject;});
// Attach a handler immediately; an early process failure must not be unhandled.
void completed.catch(()=>{});
let output='';
let finalMessage='';
const lines=createInterface({input:child.stdout});
function send(message) { child.stdin.write(JSON.stringify(message)+'\n'); }
function rpc(method,params) {
  return new Promise((resolve,reject)=>{
    const id=++serial;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Codex RPC timed out'));},60000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    send({id,method,params});
  });
}
lines.on('line',line=>{
  try {
    const message=JSON.parse(line);
    if (message.id !== undefined && !message.method) {
      const request=pending.get(message.id); pending.delete(message.id);
      if(message.error)request?.reject(new Error('Codex request failed'));else request?.resolve(message.result);
    } else if (message.id !== undefined) {
      // No interactive or host-side tool requests are accepted by this worker.
      send({id:message.id,error:{code:-32601,message:'Interactive requests are unavailable'}});
    } else if (message.method==='item/completed' && message.params?.item?.type==='agentMessage') {
      finalMessage=message.params.item.text;
      output=(output+'\n'+finalMessage).slice(-15000);
    } else if (message.method==='turn/completed') {
      if(message.params?.turn?.status==='completed')resolveTurn();else rejectTurn(new Error('Codex turn failed'));
    }
  } catch { rejectTurn(new Error('Invalid Codex protocol message')); }
});
child.on('error',()=>rejectTurn(new Error('Codex could not start')));
child.on('close',()=>{
  for(const request of pending.values())request.reject(new Error('Codex exited'));
  rejectTurn(new Error('Codex exited before completing the turn'));
});
try {
  await rpc('initialize',{clientInfo:{name:'coco-worker',version:'0.1.0'}});
  send({method:'initialized',params:{}});
  const {thread}=await rpc('thread/start',{cwd,approvalPolicy:'never',sandbox:planning?'read-only':'danger-full-access',modelProvider:'coco',
    ...(planning ? {baseInstructions:'You are Codex collaborating on a shared plan. Return helpful discussion or the requested structured plan changes. Do not use tools, execute commands, edit files, or deploy.'} : {}),
    config:{'shell_environment_policy.exclude':['COCO_INFERENCE_TOKEN'],
      ...(job.publication ? {'shell_environment_policy.inherit':'all','shell_environment_policy.ignore_default_excludes':true} : {})}});
  console.log(JSON.stringify({type:'worker/thread',threadId:thread.id}));
  await rpc('turn/start',{threadId:thread.id,cwd,approvalPolicy:'never',sandboxPolicy:planning?{type:'readOnly'}:{type:'externalSandbox',networkAccess:'enabled'},
    ...(job.planning ? {outputSchema:planOutputSchema} : {}),
    input:[{type:'text',text:job.planning ? planAgentPrompt(job.plan,job.planning) : planning ? job.prompt : job.publication ? publicationPrompt(job.plan,job.runId) : `Implement this approved task in the current repository. Work only in the task worktree. Do not deploy or push. The supervisor will preserve your final changes as a commit. Report actual checks and limitations.\n\nTask: ${job.task.title}\n${job.task.description}\n\nApproved plan:\n${job.plan}`}]});
  await completed;
  if(job.planning) {
    const parsed=JSON.parse(finalMessage);
    const result=redact(JSON.stringify(parsed));
    if(result.length>16000)throw new Error('Plan reply too large');
    console.log(JSON.stringify({success:true,output:result}));
  } else if(planning) {
    console.log(JSON.stringify({success:!!output.trim(),output:redact(output)}));
  } else if(job.publication) {
    const dirty=await git('-C',cwd,'status','--porcelain');
    if(dirty.stdout.trim())throw new Error('Publication left uncommitted changes');
    const head=(await git('-C',cwd,'rev-parse','HEAD')).stdout.trim();
    const branch=(await git('-C',cwd,'branch','--show-current')).stdout.trim();
    if(branch!==job.publication.branch)throw new Error('Unexpected publication branch');
    const response=await execFile('gh',['pr','view',branch,'--repo',job.publication.repository,
      '--json','number,url,title,headRefName,baseRefName,headRefOid,state,isDraft,isCrossRepository'],{cwd,env:agentEnv,maxBuffer:65536});
    const pullRequest=verifiedPullRequest(JSON.parse(response.stdout),job.runId,head);
    console.log(redact(JSON.stringify({success:true,commit:head,pullRequest,output})));
  } else {
  await git('-C',cwd,'add','-A');
  const changed=await git('-C',cwd,'diff','--cached','--name-only');
  if(changed.stdout.trim())await git('-C',cwd,'commit','-m',`CoCo: ${job.task.title.slice(0,150)}`);
  const head=await git('-C',cwd,'rev-parse','HEAD');
  console.log(JSON.stringify({success:true,commit:head.stdout.trim(),output:redact(output)}));
  }
} catch {
  console.log(JSON.stringify({success:false,output:job.publication
    ? 'PR creation failed or GitHub could not verify the final branch and commit. Check the bot token permissions and worker logs. An already-created PR may remain on GitHub.'
    : 'Codex execution failed. Check model access, API billing, or task checks in the worker logs.'}));
} finally { child.kill('SIGTERM'); lines.close(); }
