// Runs only inside the disposable executor container. stdout is a bounded result.
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
const execFile = promisify(execFileCallback);
let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if(raw.length>300000)throw new Error('Job too large'); }
const job = JSON.parse(raw);
if (!/^[a-zA-Z0-9_-]{1,128}$/.test(job.runId) || !/^[a-f0-9]{40}$/.test(job.baseSha)
  || !/^[a-zA-Z0-9_-]{1,64}$/.test(job.task.id) || !/^[a-f0-9-]{36}$/.test(job.attemptId)
  || !job.dependencyCommits.every(sha=>/^[a-f0-9]{40}$/.test(sha))) throw new Error('Invalid job');
const git = (...args) => execFile('git',['-c','core.hooksPath=/dev/null','-c','user.name=CoCo worker',
  '-c','user.email=worker@coco.invalid',...args],{maxBuffer:1024*1024});
await mkdir('/tmp/codex-home',{recursive:true});
const repository = '/work/repo.git';
const cwd = `/work/tasks/${job.attemptId}`;
await git('init','--bare',repository);
await git('--git-dir',repository,'fetch','--no-tags','https://github.com/Jorya-Design/CoCo.git',job.baseSha);
await git('--git-dir',repository,'worktree','add','--detach',cwd,job.baseSha);
for (const commit of job.dependencyCommits) await git('-C',cwd,'cherry-pick','--keep-redundant-commits',commit);

const child = spawn('codex',['-c','model_provider="coco"','-c',
  'model_providers.coco={name="CoCo",base_url="http://172.30.0.1:8790/v1",wire_api="responses",env_key="COCO_INFERENCE_TOKEN",requires_openai_auth=false}',
  'app-server','--listen','stdio://'],{cwd,env:{PATH:process.env.PATH,HOME:'/tmp/codex-home',CODEX_HOME:'/tmp/codex-home',
    COCO_INFERENCE_TOKEN:job.inferenceToken},stdio:['pipe','pipe','ignore']});
let serial=0;
const pending = new Map();
child.stdin.on('error',()=>{});
let resolveTurn, rejectTurn;
const completed = new Promise((resolve,reject)=>{resolveTurn=resolve;rejectTurn=reject;});
// Attach a handler immediately; an early process failure must not be unhandled.
void completed.catch(()=>{});
let output='';
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
      output=(output+'\n'+message.params.item.text).slice(-15000);
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
  const {thread}=await rpc('thread/start',{cwd,approvalPolicy:'never',sandbox:'danger-full-access',modelProvider:'coco',
    config:{'shell_environment_policy.exclude':['COCO_INFERENCE_TOKEN']}});
  await rpc('turn/start',{threadId:thread.id,cwd,approvalPolicy:'never',sandboxPolicy:{type:'externalSandbox',networkAccess:'enabled'},
    input:[{type:'text',text:`Implement this approved task in the current repository. Work only in the task worktree. Do not deploy or push. The supervisor will preserve your final changes as a commit. Report actual checks and limitations.\n\nTask: ${job.task.title}\n${job.task.description}\n\nApproved plan:\n${job.plan}`}]});
  await completed;
  await git('-C',cwd,'add','-A');
  const changed=await git('-C',cwd,'diff','--cached','--name-only');
  if(changed.stdout.trim())await git('-C',cwd,'commit','-m',`CoCo: ${job.task.title.slice(0,150)}`);
  const head=await git('-C',cwd,'rev-parse','HEAD');
  console.log(JSON.stringify({success:true,commit:head.stdout.trim(),output:output.split(job.inferenceToken).join('[redacted]')}));
} catch {
  console.log(JSON.stringify({success:false,output:'Codex execution failed. Check model access, API billing, or task checks in the worker logs.'}));
} finally { child.kill('SIGTERM'); lines.close(); }
