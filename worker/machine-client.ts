import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { runContainer } from './run-container.ts';
import type { ExecutionJob, ExecutionResult, WorkerCommand } from '../shared/execution.ts';
import type { PlanningJob } from '../shared/planning.ts';

const endpoint = new URL(process.env.COCO_CONTROL_PLANE_URL ?? '');
const tokenFile = process.env.COCO_WORKER_TOKEN_FILE;
if (!tokenFile) throw new Error('COCO_WORKER_TOKEN_FILE is required');
if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
  throw new Error('Credentials and query parameters are not allowed in the worker URL');
const local = ['127.0.0.1', '[::1]'].includes(endpoint.hostname);
if (endpoint.protocol !== 'wss:' && !(local && endpoint.protocol === 'ws:'))
  throw new Error('Remote worker connections require wss://');
endpoint.pathname = '/worker/v1/connect';
let stopping = false;
let socket: WebSocket | undefined;
let failures = 0;
let attempt: AbortController | undefined;
function stop() { stopping = true; attempt?.abort(); socket?.terminate(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
while (!stopping) {
  try {
    const token = (await readFile(tokenFile, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid credential file');
    await new Promise<void>(resolve => {
      socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 10000 });
      const connection = socket;
      let pending: {resolve:(value:any)=>void;reject:(error:Error)=>void} | null = null;
      let chain: Promise<unknown> = Promise.resolve();
      function request(command: WorkerCommand): Promise<any> {
        const next=chain.then(()=>new Promise((resolve,reject)=>{
          if(connection.readyState!==WebSocket.OPEN){reject(new Error('Disconnected'));return;}
          const timer=setTimeout(()=>{pending=null;reject(new Error('Worker response timed out'));connection.terminate();},15000);
          pending={resolve:value=>{clearTimeout(timer);pending=null;resolve(value);},reject:error=>{clearTimeout(timer);pending=null;reject(error);}};
          connection.send(JSON.stringify(command));
        }));
        chain=next.catch(()=>{});return next;
      }
      async function work() {
        while(!stopping && connection.readyState===WebSocket.OPEN) {
          const response=await request({type:'worker/poll'});
          if(response.type==='worker/idle'){await new Promise(resolve=>setTimeout(resolve,3000));continue;}
          if(response.type!=='worker/job')throw new Error('Unexpected response');
          const job=response.job as ExecutionJob | PlanningJob;
          const key={roomId:job.roomId,runId:job.runId,attemptId:job.attemptId,fence:job.fence};
          attempt=new AbortController();
          const controller=attempt;
          let heartbeatPending=false;
          const timer=setInterval(()=>{
            if(heartbeatPending)return;heartbeatPending=true;
            void request({type:'worker/heartbeat',...key}).then(reply=>{if(!reply.active)controller.abort();})
              .catch(()=>controller.abort()).finally(()=>{heartbeatPending=false;});
          },20000);
          let result:ExecutionResult;
          try {result=await runContainer(job,controller.signal,threadId=>{
            void request({type:'worker/thread',...key,threadId}).then(reply=>{if(!reply.active)controller.abort();}).catch(()=>controller.abort());
          });}
          catch {result={success:false,output:'Worker executor stopped or became unavailable.'};}
          finally {clearInterval(timer);attempt=undefined;}
          if(controller.signal.aborted)throw new Error('Attempt cancelled');
          await request({type:'worker/result',...key,...result});
        }
      }
      socket.on('message', data => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'worker/authenticated') {
            failures = 0;
            console.log('Worker authenticated');
            if(process.env.COCO_EXECUTION_ENABLED==='true')void work().catch(()=>connection.terminate());
          } else pending?.resolve(message);
        } catch { socket?.close(1008, 'Invalid control-plane message'); }
      });
      socket.on('error', () => {}); // Never log headers, token, or server-provided error text.
      socket.on('close', () => { attempt?.abort();pending?.reject(new Error('Disconnected'));resolve(); });
    });
  } catch { console.error('Worker authentication connection unavailable'); }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) + Math.random() * 500));
}
