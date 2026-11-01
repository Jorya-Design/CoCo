import { mkdir } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import type { ExecutionJob } from '../shared/execution.ts';

export async function runContainer(job: ExecutionJob, signal: AbortSignal): Promise<{success:boolean;output:string;commit?:string}> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(job.runId) || !/^[a-f0-9-]{36}$/.test(job.attemptId)) throw new Error('Invalid job');
  const root = `/var/lib/coco-worker/runs/${job.runId}`;
  await mkdir(root,{recursive:true,mode:0o700});
  const name = `coco-${job.attemptId}`;
  const child = spawn('docker',['run','--rm','--interactive','--name',name,'--network','coco-executor',
    '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--pids-limit','256','--memory','1536m','--cpus','1',
    '--user',`${process.getuid!()}:${process.getgid!()}`,'--tmpfs','/tmp:rw,nosuid,size=512m',
    '--mount',`type=bind,src=${root},dst=/work`,process.env.COCO_EXECUTOR_IMAGE ?? 'coco-executor:current'],
    {stdio:['pipe','pipe','ignore']});
  let output='';
  const abort = () => { execFile('docker',['rm','--force',name],()=>{}); child.kill(); };
  signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,20*60*1000);
  if(signal.aborted)abort();
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify(job));
  try {
    return await new Promise((resolve,reject)=>{
      child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){abort();reject(new Error('Executor output exceeded limit'));}});
      child.on('error',()=>reject(new Error('Executor unavailable')));
      child.on('close',code=>{
        if(code!==0||signal.aborted){reject(new Error('Executor stopped'));return;}
        try {
          const result=JSON.parse(output.trim());
          if(typeof result.success!=='boolean'||typeof result.output!=='string'||result.output.length>16000
            || (result.success && !/^[a-f0-9]{40}$/.test(result.commit)))throw new Error();
          resolve(result);
        } catch {reject(new Error('Invalid executor result'));}
      });
    });
  } finally {
    clearTimeout(timer);signal.removeEventListener('abort',abort);
    execFile('docker',['rm','--force',name],()=>{});
  }
}
