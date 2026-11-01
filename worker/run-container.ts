import { mkdir, readFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { executionResultSchema, type ExecutionJob, type ExecutionResult } from '../shared/execution.ts';
import type { PlanningJob } from '../shared/planning.ts';

export async function runContainer(job: ExecutionJob | PlanningJob, signal: AbortSignal, onThread?: (threadId:string)=>void): Promise<ExecutionResult> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(job.runId) || !/^[a-f0-9-]{36}$/.test(job.attemptId)) throw new Error('Invalid job');
  const publication = 'publication' in job ? job.publication : undefined;
  // Read the VM secret only for the final publication, never for planning or DAG tasks.
  let githubToken: string | undefined;
  if (publication) {
    const file = process.env.COCO_GITHUB_TOKEN_FILE;
    if (!file) return {success:false,output:'PR creation requires COCO_GITHUB_TOKEN_FILE on the worker.'};
    try { githubToken = (await readFile(file,'utf8')).trim(); } catch {
      return {success:false,output:'The worker could not read the GitHub bot token file.'};
    }
    if (!/^[A-Za-z0-9_]{20,512}$/.test(githubToken)) return {success:false,output:'The worker GitHub bot token is invalid.'};
  }
  const root = `/var/lib/coco-worker/runs/${job.runId}`;
  const planning = ('kind' in job && job.kind === 'planning') || ('planning' in job && !!job.planning);
  if (!planning) await mkdir(root,{recursive:true,mode:0o700});
  const name = `coco-${job.attemptId}`;
  const child = spawn('docker',['run','--rm','--interactive','--name',name,'--network','coco-executor',
    '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--sysctl','net.ipv6.conf.all.disable_ipv6=1',
    '--pids-limit','256','--memory','1536m','--cpus','1',
    '--user',`${process.getuid!()}:${process.getgid!()}`,'--tmpfs','/tmp:rw,nosuid,size=512m',
    ...(planning ? ['--tmpfs','/work:rw,nosuid,size=16m,mode=1777'] : ['--mount',`type=bind,src=${root},dst=/work`]),
    process.env.COCO_EXECUTOR_IMAGE ?? 'coco-executor:current'],
    {stdio:['pipe','pipe','ignore']});
  let output='';
  let result: any;
  const abort = () => { execFile('docker',['rm','--force',name],()=>{}); child.kill(); };
  signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,(planning ? 3 : 20)*60*1000);
  if(signal.aborted)abort();
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify({...job,...(githubToken ? {githubToken} : {})}));
  try {
    return await new Promise((resolve,reject)=>{
      child.stdout.on('data',chunk=>{
        output+=chunk;if(output.length>65536){abort();reject(new Error('Executor output exceeded limit'));return;}
        let newline: number;
        while((newline=output.indexOf('\n'))>=0){
          const line=output.slice(0,newline);output=output.slice(newline+1);
          try {
            const message=JSON.parse(line);
            if(message.type==='worker/thread' && typeof message.threadId==='string' && message.threadId.length<=128)onThread?.(message.threadId);
            else result=message;
          } catch {abort();reject(new Error('Invalid executor response'));}
        }
      });
      child.on('error',()=>reject(new Error('Executor unavailable')));
      child.on('close',code=>{
        if(code!==0||signal.aborted){reject(new Error('Executor stopped'));return;}
        try {
          if(output.trim())result=JSON.parse(output.trim());
          const parsed=executionResultSchema.parse(result);
          if(parsed.success && !planning && !parsed.commit)throw new Error();
          if(parsed.success && publication && (!parsed.pullRequest || parsed.pullRequest.commit!==parsed.commit
            || parsed.pullRequest.branch!==publication.branch || parsed.pullRequest.base!==publication.base))throw new Error();
          if(parsed.pullRequest && (!publication || !parsed.success))throw new Error();
          resolve(parsed);
        } catch {reject(new Error('Invalid executor result'));}
      });
    });
  } finally {
    clearTimeout(timer);signal.removeEventListener('abort',abort);
    execFile('docker',['rm','--force',name],()=>{});
  }
}
