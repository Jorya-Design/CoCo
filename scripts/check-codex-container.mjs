import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child=spawn('docker',['run','--rm','--interactive','--network','none','--read-only','--cap-drop','ALL',
  '--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,size=64m','--env','HOME=/tmp',
  '--env','CODEX_HOME=/tmp/codex','--entrypoint','codex',process.argv[2]??'coco-executor:test','app-server','--listen','stdio://'],{stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:child.stdout});
const timer=setTimeout(()=>{child.kill();process.exitCode=1;},30000);
let initialized=false,thread=false;
const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
child.stdin.on('error',()=>{});
child.stderr.resume();
lines.on('line',line=>{
  const message=JSON.parse(line);
  if(message.error){console.error('Codex protocol smoke check failed');child.kill();process.exitCode=1;return;}
  if(message.id===1){
    initialized=true;send({method:'initialized',params:{}});
    send({id:2,method:'thread/start',params:{cwd:'/tmp',sandbox:'read-only',approvalPolicy:'never'}});
  }
  if(message.id===2 && message.result?.thread?.id){thread=true;console.log('Codex stdio initialize/thread/start verified');child.stdin.end();}
});
child.on('error',()=>{process.exitCode=1;clearTimeout(timer);});
child.on('close',()=>{clearTimeout(timer);lines.close();if(!initialized||!thread)process.exitCode=1;});
send({id:1,method:'initialize',params:{clientInfo:{name:'coco-protocol-test',version:'0.1.0'}}});
